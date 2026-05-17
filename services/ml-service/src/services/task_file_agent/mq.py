from datetime import datetime, timezone

from libs.log_py import LoggerFactory
from libs.mq_py import MqClient, MqError, PublishOptions

from .config import TaskFileAgentSettings
from .schemas import AgentExecutionEvent, AgentRunResult


logger = LoggerFactory.get_logger("TaskFileAgentMQ")


TASK_TOOL_NAMES = {
    "create_task_column",
    "update_task_column",
    "delete_task_column",
    "list_task_columns",
    "create_task",
    "update_task",
    "delete_task",
    "change_task_status",
    "change_task_description",
    "list_tasks",
    "get_task_details",
    "list_task_attachments",
}

FILE_TOOL_NAMES = {
    "attach_file_to_task",
    "detach_file_from_task",
    "list_files",
    "list_task_attachments",
}


class AgentResultPublisher:
    def __init__(self, settings: TaskFileAgentSettings) -> None:
        self.settings = settings
        self._mq_client: MqClient | None = None

    async def connect(self) -> None:
        if not self.settings.rabbitmq_enabled:
            return
        self._mq_client = await MqClient.connect(self.settings.rabbitmq_url)
        logger.info("Agent result publisher connected to RabbitMQ")

    async def aclose(self) -> None:
        if self._mq_client is None:
            return
        await self._mq_client.close()
        self._mq_client = None

    async def publish_execution_result(
        self,
        *,
        request_id: str,
        team_id: str,
        project_id: str,
        actor_user_id: str | None,
        result: AgentRunResult,
    ) -> None:
        if not self.settings.rabbitmq_enabled or self._mq_client is None:
            return
        event = AgentExecutionEvent(
            request_id=request_id,
            team_id=team_id,
            project_id=project_id,
            actor_user_id=actor_user_id,
            answer=result.answer,
            succeeded=result.succeeded,
            domains=self._resolve_domains(result),
            tool_calls=result.tool_calls,
            occurred_at=datetime.now(timezone.utc).isoformat(),
        )
        channel = await self._mq_client.channel()
        try:
            if "task" in event.domains:
                await self._mq_client.declare_queue(channel, self.settings.task_results_queue, durable=True)
                await self._mq_client.publish_json(
                    channel,
                    "",
                    self.settings.task_results_queue,
                    event.model_dump(mode="json"),
                    PublishOptions(message_type="agent.execution.completed", persistent=True),
                )
            if "file" in event.domains:
                await self._mq_client.declare_queue(channel, self.settings.file_results_queue, durable=True)
                await self._mq_client.publish_json(
                    channel,
                    "",
                    self.settings.file_results_queue,
                    event.model_dump(mode="json"),
                    PublishOptions(message_type="agent.execution.completed", persistent=True),
                )
        except MqError:
            logger.exception("Failed to publish agent execution result")
        finally:
            await channel.close()

    @staticmethod
    def _resolve_domains(result: AgentRunResult) -> list[str]:
        domains: set[str] = set()
        for trace in result.tool_calls:
            if trace.tool_name in TASK_TOOL_NAMES:
                domains.add("task")
            if trace.tool_name in FILE_TOOL_NAMES:
                domains.add("file")
        if not domains:
            domains.update({"task", "file"})
        return sorted(domains)
