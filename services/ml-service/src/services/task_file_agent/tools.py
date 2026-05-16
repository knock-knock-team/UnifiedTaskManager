from typing import Awaitable, Callable

from langchain_core.tools import StructuredTool

from .clients import ServiceClientError, TaskAttachmentAdapter, TaskServiceClient, FileServiceClient
from .schemas import (
    AttachFileToTaskInput,
    ChangeTaskDescriptionInput,
    ChangeTaskStatusInput,
    CreateTaskColumnInput,
    CreateTaskInput,
    DeleteTaskColumnInput,
    DeleteTaskInput,
    DetachFileFromTaskInput,
    ExecutionContext,
    GetTaskDetailsInput,
    ListTaskColumnsInput,
    ListFilesInput,
    ListTaskAttachmentsInput,
    ListTasksInput,
    ToolResult,
    UpdateTaskColumnInput,
    UpdateTaskInput,
)


class TaskFileToolFactory:
    def __init__(
        self,
        *,
        task_client: TaskServiceClient,
        file_client: FileServiceClient,
        attachment_adapter: TaskAttachmentAdapter,
    ) -> None:
        self.task_client = task_client
        self.file_client = file_client
        self.attachment_adapter = attachment_adapter

    def build(self, context: ExecutionContext) -> list[StructuredTool]:
        async def create_task_column(title: str) -> dict:
            return await self._execute(
                lambda: self.task_client.create_column(context, title=title),
                success_message="Column created",
                data_key="column",
            )

        async def update_task_column(column_id: str, title: str) -> dict:
            return await self._execute(
                lambda: self.task_client.update_column(context, column_id=column_id, title=title),
                success_message="Column updated",
                data_key="column",
            )

        async def delete_task_column(column_id: str) -> dict:
            return await self._execute(
                lambda: self.task_client.delete_column(context, column_id=column_id),
                success_message="Column deleted",
            )

        async def list_task_columns() -> dict:
            return await self._execute(
                lambda: self.task_client.list_columns(context),
                success_message="Columns listed",
                data_key="columns",
            )

        async def create_task(
            title: str,
            description: str | None = None,
            status: str | None = None,
            priority: str | None = None,
            due_at: str | None = None,
            assignee_user_id: str | None = None,
            assignee_name: str | None = None,
        ) -> dict:
            return await self._execute(
                lambda: self.task_client.create_task(
                    context,
                    title=title,
                    description=description,
                    status=status,
                    priority=priority,
                    due_at=due_at,
                    assignee_user_id=assignee_user_id,
                    assignee_name=assignee_name,
                ),
                success_message="Task created",
                data_key="task",
            )

        async def update_task(
            task_id: str,
            title: str | None = None,
            description: str | None = None,
            status: str | None = None,
            priority: str | None = None,
            due_at: str | None = None,
            assignee_user_id: str | None = None,
            assignee_name: str | None = None,
            completed: bool | None = None,
        ) -> dict:
            return await self._execute(
                lambda: self.task_client.update_task(
                    context,
                    task_id=task_id,
                    title=title,
                    description=description,
                    status=status,
                    priority=priority,
                    due_at=due_at,
                    assignee_user_id=assignee_user_id,
                    assignee_name=assignee_name,
                    completed=completed,
                ),
                success_message="Task updated",
                data_key="task",
            )

        async def delete_task(task_id: str) -> dict:
            return await self._execute(
                lambda: self.task_client.delete_task(context, task_id=task_id),
                success_message="Task deleted",
            )

        async def change_task_status(task_id: str, status: str, completed: bool | None = None) -> dict:
            return await self._execute(
                lambda: self.task_client.update_task(
                    context,
                    task_id=task_id,
                    status=status,
                    completed=completed,
                ),
                success_message="Task status changed",
                data_key="task",
            )

        async def change_task_description(task_id: str, description: str) -> dict:
            return await self._execute(
                lambda: self.task_client.update_task(
                    context,
                    task_id=task_id,
                    description=description,
                ),
                success_message="Task description changed",
                data_key="task",
            )

        async def list_tasks(search: str | None = None, limit: int = 50, offset: int = 0) -> dict:
            return await self._execute(
                lambda: self.task_client.list_tasks(
                    context,
                    search=search,
                    limit=limit,
                    offset=offset,
                ),
                success_message="Tasks listed",
                data_key="tasks",
            )

        async def get_task_details(task_id: str) -> dict:
            return await self._execute(
                lambda: self.task_client.get_task(context, task_id=task_id),
                success_message="Task details loaded",
                data_key="task",
            )

        async def attach_file_to_task(task_id: str, file_path: str, display_name: str | None = None) -> dict:
            return await self._execute(
                lambda: self.attachment_adapter.attach_file_to_task(
                    context,
                    task_id=task_id,
                    file_path=file_path,
                    display_name=display_name,
                ),
                success_message="File attached to task",
                data_key="attachment",
            )

        async def detach_file_from_task(
            task_id: str,
            attachment_id: str | None = None,
            file_path: str | None = None,
        ) -> dict:
            return await self._execute(
                lambda: self.attachment_adapter.detach_file_from_task(
                    context,
                    task_id=task_id,
                    attachment_id=attachment_id,
                    file_path=file_path,
                ),
                success_message="File detached from task",
                data_key="attachments",
            )

        async def list_task_attachments(task_id: str) -> dict:
            return await self._execute(
                lambda: self.attachment_adapter.list_task_attachments(context, task_id=task_id),
                success_message="Task attachments listed",
                data_key="attachments",
            )

        async def list_files(directory: str = ".") -> dict:
            return await self._execute(
                lambda: self.file_client.list_entries(context, directory=directory),
                success_message="Files listed",
                data_key="files",
            )

        return [
            StructuredTool.from_function(
                coroutine=create_task_column,
                name="create_task_column",
                description="Create a new task column in the active project.",
                args_schema=CreateTaskColumnInput,
            ),
            StructuredTool.from_function(
                coroutine=update_task_column,
                name="update_task_column",
                description="Rename an existing task column.",
                args_schema=UpdateTaskColumnInput,
            ),
            StructuredTool.from_function(
                coroutine=delete_task_column,
                name="delete_task_column",
                description="Delete an empty task column by id.",
                args_schema=DeleteTaskColumnInput,
            ),
            StructuredTool.from_function(
                coroutine=list_task_columns,
                name="list_task_columns",
                description="List all task columns for the active project.",
                args_schema=ListTaskColumnsInput,
            ),
            StructuredTool.from_function(
                coroutine=create_task,
                name="create_task",
                description="Create a task in the active project.",
                args_schema=CreateTaskInput,
            ),
            StructuredTool.from_function(
                coroutine=update_task,
                name="update_task",
                description="Patch one or more fields on an existing task.",
                args_schema=UpdateTaskInput,
            ),
            StructuredTool.from_function(
                coroutine=delete_task,
                name="delete_task",
                description="Delete a task by id.",
                args_schema=DeleteTaskInput,
            ),
            StructuredTool.from_function(
                coroutine=change_task_status,
                name="change_task_status",
                description="Change task status and optional completion flag.",
                args_schema=ChangeTaskStatusInput,
            ),
            StructuredTool.from_function(
                coroutine=change_task_description,
                name="change_task_description",
                description="Replace the description of a task.",
                args_schema=ChangeTaskDescriptionInput,
            ),
            StructuredTool.from_function(
                coroutine=list_tasks,
                name="list_tasks",
                description="List tasks for the active project, optionally filtered by search query.",
                args_schema=ListTasksInput,
            ),
            StructuredTool.from_function(
                coroutine=get_task_details,
                name="get_task_details",
                description="Get full details for one task by id.",
                args_schema=GetTaskDetailsInput,
            ),
            StructuredTool.from_function(
                coroutine=attach_file_to_task,
                name="attach_file_to_task",
                description="Attach an existing environment file to a task by file path.",
                args_schema=AttachFileToTaskInput,
            ),
            StructuredTool.from_function(
                coroutine=detach_file_from_task,
                name="detach_file_from_task",
                description="Detach a previously attached file from a task.",
                args_schema=DetachFileFromTaskInput,
            ),
            StructuredTool.from_function(
                coroutine=list_task_attachments,
                name="list_task_attachments",
                description="List files attached to a task.",
                args_schema=ListTaskAttachmentsInput,
            ),
            StructuredTool.from_function(
                coroutine=list_files,
                name="list_files",
                description="List files and folders from the active project file environment.",
                args_schema=ListFilesInput,
            ),
        ]

    async def _execute(
        self,
        operation: Callable[[], Awaitable[object]],
        *,
        success_message: str,
        data_key: str | None = None,
    ) -> dict:
        try:
            payload = await operation()
        except ServiceClientError as exc:
            return ToolResult(
                success=False,
                message=exc.payload.message,
                error=exc.payload,
            ).model_dump(mode="json")

        data = {}
        if data_key is not None:
            if isinstance(payload, list):
                data[data_key] = [self._serialize_item(item) for item in payload]
            elif payload is None:
                data[data_key] = None
            else:
                data[data_key] = self._serialize_item(payload)
        return ToolResult(
            success=True,
            message=success_message,
            data=data,
        ).model_dump(mode="json")

    @staticmethod
    def _serialize_item(payload: object) -> object:
        if hasattr(payload, "model_dump"):
            return payload.model_dump(mode="json")  # type: ignore[no-any-return]
        return payload
