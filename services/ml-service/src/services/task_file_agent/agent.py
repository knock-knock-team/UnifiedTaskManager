import json
from typing import Any

from langchain_core.language_models.chat_models import BaseChatModel
from langchain_core.messages import HumanMessage, SystemMessage, ToolMessage
from langchain_core.tools import BaseTool

from libs.json_py import safe_parse_json

from .schemas import AgentRunResult, AgentToolTrace, ResourceMetadata, ServiceErrorPayload


class TaskFileAgentRuntime:
    def __init__(
        self,
        *,
        llm: BaseChatModel,
        tools: list[BaseTool],
        max_iterations: int,
    ) -> None:
        self.llm = llm
        self.tools = tools
        self.max_iterations = max_iterations
        self.tools_by_name = {tool.name: tool for tool in tools}

    async def run(
        self,
        *,
        user_message: str,
        capabilities: list[ResourceMetadata],
        max_iterations: int | None = None,
        actor_user_id: str | None = None,
    ) -> AgentRunResult:
        iterations = max_iterations or self.max_iterations
        try:
            result = await self._run_loop(
                user_message=user_message,
                capabilities=capabilities,
                iterations=iterations,
                actor_user_id=actor_user_id,
            )
        except Exception as exc:
            return AgentRunResult(
                answer=f"Не удалось завершить запрос: {exc}",
                succeeded=False,
                tool_calls=[],
            )
        return result

    async def stream(
        self,
        *,
        user_message: str,
        capabilities: list[ResourceMetadata],
        max_iterations: int | None = None,
        actor_user_id: str | None = None,
    ):
        iterations = max_iterations or self.max_iterations
        messages = self._build_messages(user_message, capabilities, actor_user_id)
        traces: list[AgentToolTrace] = []
        bound_llm = self.llm.bind_tools(self.tools)
        tool_cache: dict[str, tuple[AgentToolTrace, ToolMessage]] = {}
        try:
            yield {"type": "status", "text": "Думаю над запросом...", "tool_name": "", "payload": {}}
            for _ in range(iterations):
                streamed_any_text = False
                collected = None
                try:
                    async for chunk in bound_llm.astream(messages):
                        collected = chunk if collected is None else collected + chunk
                        chunk_text = self._message_text(getattr(chunk, "content", ""))
                        if chunk_text:
                            streamed_any_text = True
                            yield {"type": "token", "text": chunk_text, "tool_name": "", "payload": {}}
                except Exception:
                    response = await bound_llm.ainvoke(messages)
                else:
                    response = collected if collected is not None else await bound_llm.ainvoke(messages)
                messages.append(response)
                tool_calls = self._extract_tool_calls(response)
                final_text = self._message_text(response.content)

                if not tool_calls:
                    answer = final_text or self._build_iteration_limit_answer(traces, completed=False)
                    if not streamed_any_text:
                        for chunk in self._chunk_text(answer):
                            yield {"type": "token", "text": chunk, "tool_name": "", "payload": {}}
                    yield {"type": "final", "text": answer, "tool_name": "", "payload": {}}
                    return

                for tool_call in tool_calls:
                    tool_name = str(tool_call.get("name") or "").strip()
                    yield {"type": "tool_start", "text": "", "tool_name": tool_name, "payload": tool_call}
                    trace, tool_message = await self._execute_tool_call(tool_call, tool_cache)
                    traces.append(trace)
                    messages.append(tool_message)
                    yield {
                        "type": "tool_end",
                        "text": "",
                        "tool_name": trace.tool_name,
                        "payload": trace.tool_output or {},
                    }

            answer = self._build_iteration_limit_answer(traces, completed=False)
            for chunk in self._chunk_text(answer):
                yield {"type": "token", "text": chunk, "tool_name": "", "payload": {}}
            yield {"type": "final", "text": answer, "tool_name": "", "payload": {}}
        except Exception as exc:
            yield {"type": "error", "text": str(exc), "tool_name": "", "payload": {}}

    @staticmethod
    def _normalize_tool_output(result: Any) -> dict[str, Any]:
        if isinstance(result, dict):
            return result
        if hasattr(result, "model_dump"):
            return result.model_dump(mode="json")
        if isinstance(result, str):
            stripped = result.strip()
            if stripped.startswith("{") and stripped.endswith("}"):
                try:
                    return safe_parse_json(stripped)
                except Exception:
                    return {"success": True, "message": stripped, "data": {}}
        return {"success": True, "message": str(result), "data": {}}

    async def _run_loop(
        self,
        *,
        user_message: str,
        capabilities: list[ResourceMetadata],
        iterations: int,
        actor_user_id: str | None = None,
    ) -> AgentRunResult:
        messages = self._build_messages(user_message, capabilities, actor_user_id)
        traces: list[AgentToolTrace] = []
        bound_llm = self.llm.bind_tools(self.tools)
        tool_cache: dict[str, tuple[AgentToolTrace, ToolMessage]] = {}

        for _ in range(iterations):
            response = await bound_llm.ainvoke(messages)
            tool_calls = self._extract_tool_calls(response)
            final_text = self._message_text(response.content)
            messages.append(response)

            if not tool_calls:
                return AgentRunResult(
                    answer=final_text or "Готово.",
                    succeeded=True,
                    tool_calls=traces,
                )

            for tool_call in tool_calls:
                trace, tool_message = await self._execute_tool_call(tool_call, tool_cache)
                traces.append(trace)
                messages.append(tool_message)

        return AgentRunResult(
            answer=self._build_iteration_limit_answer(traces, completed=False),
            succeeded=False,
            tool_calls=traces,
        )

    async def _execute_tool_call(
        self,
        tool_call: dict[str, Any],
        tool_cache: dict[str, tuple[AgentToolTrace, ToolMessage]],
    ) -> tuple[AgentToolTrace, ToolMessage]:
        tool_name = str(tool_call.get("name") or "").strip()
        tool_input = self._parse_tool_args(tool_call.get("args"))
        signature = self._tool_signature(tool_name, tool_input)
        cached = tool_cache.get(signature)
        if cached is not None:
            return cached
        tool = self.tools_by_name.get(tool_name)
        if tool is None:
            output = {
                "success": False,
                "message": f"Tool '{tool_name}' is not available",
                "error": {
                    "service": "agent_runtime",
                    "operation": tool_name,
                    "message": f"Tool '{tool_name}' is not available",
                    "code": "tool_not_found",
                    "retryable": False,
                    "details": {},
                },
            }
        else:
            try:
                observation = await tool.ainvoke(tool_input)
            except Exception as exc:
                observation = {
                    "success": False,
                    "message": str(exc),
                    "error": {
                        "service": "agent_runtime",
                        "operation": tool_name,
                        "message": str(exc),
                        "code": "tool_execution_failed",
                        "retryable": False,
                        "details": {},
                    },
                }
            output = self._normalize_tool_output(observation)

        error_payload = output.get("error")
        trace = AgentToolTrace(
            tool_name=tool_name,
            tool_input=tool_input,
            tool_output=output,
            error=ServiceErrorPayload.model_validate(error_payload) if isinstance(error_payload, dict) else None,
        )
        tool_message = ToolMessage(
            content=json.dumps(output, ensure_ascii=False),
            tool_call_id=str(tool_call.get("id") or tool_name or "tool-call"),
        )
        tool_cache[signature] = (trace, tool_message)
        return trace, tool_message

    @staticmethod
    def _parse_tool_args(raw_args: Any) -> dict[str, Any]:
        if isinstance(raw_args, dict):
            return raw_args
        if isinstance(raw_args, str):
            stripped = raw_args.strip()
            if stripped.startswith("{") and stripped.endswith("}"):
                try:
                    parsed = safe_parse_json(stripped)
                    if isinstance(parsed, dict):
                        return parsed
                except Exception:
                    return {}
        return {}

    @staticmethod
    def _extract_tool_calls(response: Any) -> list[dict[str, Any]]:
        calls = list(getattr(response, "tool_calls", []) or [])
        if calls:
            return [item for item in calls if isinstance(item, dict)]
        additional_kwargs = getattr(response, "additional_kwargs", {}) or {}
        raw_calls = additional_kwargs.get("tool_calls")
        if isinstance(raw_calls, list):
            normalized: list[dict[str, Any]] = []
            for item in raw_calls:
                if not isinstance(item, dict):
                    continue
                function_payload = item.get("function") if isinstance(item.get("function"), dict) else {}
                normalized.append(
                    {
                        "id": item.get("id"),
                        "name": function_payload.get("name") or item.get("name"),
                        "args": function_payload.get("arguments") or item.get("args") or {},
                    }
                )
            return normalized
        return []

    def _build_messages(
        self,
        user_message: str,
        capabilities: list[ResourceMetadata],
        actor_user_id: str | None,
    ) -> list[Any]:
        effective_user_message = self._augment_user_message(user_message, actor_user_id)
        return [
            SystemMessage(content=self._build_system_prompt(capabilities, actor_user_id)),
            HumanMessage(content=effective_user_message),
        ]

    @staticmethod
    def _message_text(content: Any) -> str:
        if isinstance(content, str):
            return content.strip()
        if isinstance(content, list):
            parts: list[str] = []
            for item in content:
                if isinstance(item, str):
                    parts.append(item)
                elif isinstance(item, dict) and item.get("text"):
                    parts.append(str(item["text"]))
                elif hasattr(item, "text"):
                    parts.append(str(item.text))
            return "".join(parts).strip()
        return str(content or "").strip()

    @staticmethod
    def _chunk_text(text: str) -> list[str]:
        value = str(text or "")
        if not value:
            return []
        words = value.split(" ")
        chunks: list[str] = []
        for index, word in enumerate(words):
            suffix = " " if index < len(words) - 1 else ""
            chunks.append(f"{word}{suffix}")
        return chunks

    def _build_iteration_limit_answer(self, traces: list[AgentToolTrace], *, completed: bool) -> str:
        if not traces:
            return "Не удалось завершить запрос. Попробуйте уточнить формулировку короче и конкретнее."
        successful_tools = [
            trace.tool_name
            for trace in traces
            if trace.error is None and (trace.tool_output or {}).get("success") is not False
        ]
        distinct_successes = list(dict.fromkeys(successful_tools))
        parts: list[str] = []
        if distinct_successes:
            parts.append(f"Успел выполнить шаги: {', '.join(distinct_successes)}.")
        last_error = next((trace.error for trace in reversed(traces) if trace.error is not None), None)
        if last_error is not None:
            parts.append(f"Последняя ошибка: {last_error.message}")
        elif not completed:
            parts.append("Для завершения запроса нужна более точная формулировка следующего действия.")
        return " ".join(parts).strip() or "Не удалось завершить запрос."

    @staticmethod
    def _augment_user_message(user_message: str, actor_user_id: str | None) -> str:
        text = str(user_message or "").strip()
        if not text:
            return text
        lower = text.lower()
        hints: list[str] = []
        if actor_user_id and (
            "назначь меня" in lower
            or "назнач меня" in lower
            or "assign me" in lower
            or "на меня" in lower
        ):
            hints.append(
                f"If the request implies assigning work to the current user, use assignee_user_id='{actor_user_id}'."
            )
        if (
            "создай колон" in lower
            and ("отредач" in lower or "backend" in lower or "бэкенд" in lower or "код" in lower)
        ):
            hints.append(
                "Treat the described coding work as a new task to create in the board, not as direct source code editing."
            )
        if ("создай задач" not in lower and "create task" not in lower) and (
            "назначь меня" in lower or "assign me" in lower
        ):
            hints.append(
                "If there is no existing task id or exact task title to update, create a new task from the described work and assign it to the current user."
            )
        if not hints:
            return text
        return f"{text}\n\nOperational hints:\n- " + "\n- ".join(hints)

    @staticmethod
    def _tool_signature(tool_name: str, tool_input: dict[str, Any]) -> str:
        try:
            payload = json.dumps(tool_input, ensure_ascii=False, sort_keys=True)
        except TypeError:
            payload = str(tool_input)
        return f"{tool_name}:{payload}"

    @staticmethod
    def _build_system_prompt(capabilities: list[ResourceMetadata], actor_user_id: str | None) -> str:
        capability_lines: list[str] = []
        for resource in capabilities:
            capability_lines.append(f"- {resource.resource}: {resource.description} (source={resource.source})")
            if resource.fields:
                fields = ", ".join(
                    f"{field.name}:{field.type}{'*' if field.required else ''}"
                    for field in resource.fields
                )
                capability_lines.append(f"  fields: {fields}")
            if resource.operations:
                operations = ", ".join(operation.name for operation in resource.operations)
                capability_lines.append(f"  operations: {operations}")
        capability_block = "\n".join(capability_lines)
        return (
            "You are a modular task and file operations assistant.\n"
            "Use tools whenever the request needs data lookup or state changes.\n"
            "Prefer listing columns/tasks/files first when ids or paths are ambiguous.\n"
            "Do not invent task ids, column ids, or file paths.\n"
            "Preserve the user's original language and exact wording for created column titles and task titles unless the user explicitly asks for translation.\n"
            "If the user says 'assign to me' and actor_user_id is available, use it as assignee_user_id.\n"
            "If the request mixes supported task/file actions with unsupported actions like source code editing, complete the supported actions first and explicitly say what is out of scope.\n"
            "When the user describes a new piece of work without naming an existing task, you may create a new task with a concise title and use the rest as description.\n"
            "Do not call the same tool with the same arguments repeatedly. If something is ambiguous, ask for a concise clarification.\n"
            "After enough tool calls to satisfy the supported part of the request, stop and provide the final answer.\n"
            "If a tool returns an error, explain it clearly and try another safe step only when justified.\n"
            "Keep final answers concise and action-oriented.\n"
            f"Current actor_user_id: {actor_user_id or 'unknown'}\n"
            "Available domain capabilities:\n"
            f"{capability_block}"
        )
