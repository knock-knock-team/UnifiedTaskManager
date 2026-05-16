from ..schemas import ExecutionContext, TaskAttachmentRecord
from .file_service import FileServiceClient
from .task_service import TaskServiceClient


class TaskAttachmentAdapter:
    def __init__(
        self,
        *,
        file_client: FileServiceClient,
        task_client: TaskServiceClient,
        manifest_root: str,
    ) -> None:
        self.file_client = file_client
        self.task_client = task_client
        self.manifest_root = manifest_root

    async def attach_file_to_task(
        self,
        context: ExecutionContext,
        *,
        task_id: str,
        file_path: str,
        display_name: str | None = None,
    ) -> TaskAttachmentRecord:
        await self.task_client.get_task(context, task_id=task_id)
        return await self.file_client.attach_file_to_task(
            context,
            task_id=task_id,
            file_path=file_path,
            display_name=display_name,
        )

    async def detach_file_from_task(
        self,
        context: ExecutionContext,
        *,
        task_id: str,
        attachment_id: str | None = None,
        file_path: str | None = None,
    ) -> list[TaskAttachmentRecord]:
        await self.task_client.get_task(context, task_id=task_id)
        return await self.file_client.detach_file_from_task(
            context,
            task_id=task_id,
            attachment_id=attachment_id,
            file_path=file_path,
        )

    async def list_task_attachments(
        self,
        context: ExecutionContext,
        *,
        task_id: str,
    ) -> list[TaskAttachmentRecord]:
        await self.task_client.get_task(context, task_id=task_id)
        return await self.file_client.list_task_attachments(context, task_id=task_id)
