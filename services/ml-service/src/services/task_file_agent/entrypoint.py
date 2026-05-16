from libs.log_py import LoggerFactory

from ..task_file_agent.agent import TaskFileAgentRuntime
from ..task_file_agent.clients import (
    FileServiceClient,
    FileServiceMetadataProvider,
    MqRpcTransport,
    TaskAttachmentAdapter,
    TaskServiceClient,
    TaskServiceMetadataProvider,
)
from ..task_file_agent.config import TaskFileAgentSettings, get_task_file_agent_settings
from ..task_file_agent.llm import create_task_file_agent_llm
from ..task_file_agent.schemas import AgentStreamEvent, ExecutionContext
from ..task_file_agent.tools import TaskFileToolFactory
from ...schemas.task_file_agent import AgentToolCallTrace, TaskFileAgentRequest, TaskFileAgentResponse


logger = LoggerFactory.get_logger("TaskFileAgentEntrypoint")


class TaskFileAgentEntrypoint:
    def __init__(self, settings: TaskFileAgentSettings | None = None) -> None:
        self.settings = settings or get_task_file_agent_settings()
        self.llm = create_task_file_agent_llm(self.settings)
        self.transport = MqRpcTransport(self.settings)
        self.task_client = TaskServiceClient(self.transport, self.settings.task_commands_queue)
        self.file_client = FileServiceClient(self.transport, self.settings.file_commands_queue)
        self.attachment_adapter = TaskAttachmentAdapter(
            file_client=self.file_client,
            task_client=self.task_client,
            manifest_root=self.settings.attachment_manifest_root,
        )
        self.tool_factory = TaskFileToolFactory(
            task_client=self.task_client,
            file_client=self.file_client,
            attachment_adapter=self.attachment_adapter,
        )
        self.task_metadata_provider = TaskServiceMetadataProvider()
        self.file_metadata_provider = FileServiceMetadataProvider(self.file_client)

    async def connect(self) -> None:
        await self.transport.connect()

    async def aclose(self) -> None:
        await self.transport.aclose()

    async def handle(
        self,
        request: TaskFileAgentRequest,
        *,
        authorization: str,
        actor_user_id: str | None = None,
    ) -> TaskFileAgentResponse:
        token = authorization.removeprefix("Bearer ").removeprefix("bearer ").strip()
        context = ExecutionContext(
            access_token=token,
            team_id=request.team_id,
            project_id=request.project_id,
            actor_user_id=actor_user_id,
        )
        capabilities = [
            *(await self.task_metadata_provider.describe()),
            *(await self.file_metadata_provider.describe()),
        ]
        runtime = TaskFileAgentRuntime(
            llm=self.llm,
            tools=self.tool_factory.build(context),
            max_iterations=self.settings.agent_max_iterations,
        )
        result = await runtime.run(
            user_message=request.message,
            capabilities=capabilities,
            max_iterations=request.max_iterations,
            actor_user_id=actor_user_id,
        )
        logger.info(
            "Task/file agent request processed",
            extra={
                "request_id": request.request_id,
                "team_id": request.team_id,
                "project_id": request.project_id,
                "succeeded": result.succeeded,
                "tool_calls": len(result.tool_calls),
            },
        )
        return TaskFileAgentResponse(
            request_id=request.request_id,
            answer=result.answer,
            succeeded=result.succeeded,
            tool_calls=[
                AgentToolCallTrace(
                    tool_name=item.tool_name,
                    tool_input=item.tool_input,
                    tool_output=item.tool_output,
                    error=item.error.model_dump(mode="json") if item.error else None,
                )
                for item in result.tool_calls
            ],
            capabilities=[item.model_dump(mode="json") for item in capabilities] if request.include_capabilities else [],
        )

    async def stream(
        self,
        request: TaskFileAgentRequest,
        *,
        authorization: str,
        actor_user_id: str | None = None,
    ):
        token = authorization.removeprefix("Bearer ").removeprefix("bearer ").strip()
        context = ExecutionContext(
            access_token=token,
            team_id=request.team_id,
            project_id=request.project_id,
            actor_user_id=actor_user_id,
        )
        capabilities = [
            *(await self.task_metadata_provider.describe()),
            *(await self.file_metadata_provider.describe()),
        ]
        runtime = TaskFileAgentRuntime(
            llm=self.llm,
            tools=self.tool_factory.build(context),
            max_iterations=self.settings.agent_max_iterations,
        )
        async for event in runtime.stream(
            user_message=request.message,
            capabilities=capabilities,
            max_iterations=request.max_iterations,
            actor_user_id=actor_user_id,
        ):
            payload = AgentStreamEvent.model_validate(event)
            yield payload
