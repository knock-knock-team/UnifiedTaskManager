from ..schemas import ExecutionContext, FileEntryRecord, TaskAttachmentRecord
from .mq_transport import MqRpcTransport


class FileServiceClient:
    def __init__(self, transport: MqRpcTransport, queue_name: str) -> None:
        self.transport = transport
        self.queue_name = queue_name

    async def list_entries(self, context: ExecutionContext, *, directory: str = ".") -> list[FileEntryRecord]:
        response = await self.transport.request(
            service_name="file_service",
            queue_name=self.queue_name,
            operation="list_files",
            context=context,
            payload={"directory": directory or "."},
        )
        return [FileEntryRecord.model_validate(item) for item in response.data.get("files", [])]

    async def attach_file_to_task(
        self,
        context: ExecutionContext,
        *,
        task_id: str,
        file_path: str,
        display_name: str | None = None,
    ) -> TaskAttachmentRecord:
        response = await self.transport.request(
            service_name="file_service",
            queue_name=self.queue_name,
            operation="attach_file_to_task",
            context=context,
            payload={
                "task_id": task_id,
                "file_path": file_path,
                "display_name": display_name,
            },
        )
        return TaskAttachmentRecord.model_validate(response.data.get("attachment", {}))

    async def detach_file_from_task(
        self,
        context: ExecutionContext,
        *,
        task_id: str,
        attachment_id: str | None = None,
        file_path: str | None = None,
    ) -> list[TaskAttachmentRecord]:
        response = await self.transport.request(
            service_name="file_service",
            queue_name=self.queue_name,
            operation="detach_file_from_task",
            context=context,
            payload={
                "task_id": task_id,
                "attachment_id": attachment_id,
                "file_path": file_path,
            },
        )
        return [TaskAttachmentRecord.model_validate(item) for item in response.data.get("attachments", [])]

    async def list_task_attachments(self, context: ExecutionContext, *, task_id: str) -> list[TaskAttachmentRecord]:
        response = await self.transport.request(
            service_name="file_service",
            queue_name=self.queue_name,
            operation="list_task_attachments",
            context=context,
            payload={"task_id": task_id},
        )
        return [TaskAttachmentRecord.model_validate(item) for item in response.data.get("attachments", [])]
