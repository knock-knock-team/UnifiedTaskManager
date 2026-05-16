from ..schemas import FieldDefinition, OperationDefinition, ResourceMetadata
from .file_service import FileServiceClient


class TaskServiceMetadataProvider:
    async def describe(self) -> list[ResourceMetadata]:
        return [
            ResourceMetadata(
                resource="task_columns",
                description="Task board columns inside a project",
                source="registry",
                fields=[
                    FieldDefinition(name="id", type="string", required=True, description="Column identifier"),
                    FieldDefinition(name="title", type="string", required=True, description="Column title"),
                    FieldDefinition(name="position", type="integer", required=True, description="Column sort position"),
                    FieldDefinition(name="projectId", type="string", required=True, description="Project identifier"),
                    FieldDefinition(name="teamId", type="string", required=True, description="Team identifier"),
                ],
                operations=[
                    OperationDefinition(name="list_columns", description="List all columns for the active project", method="GET", path="/v1/task-columns"),
                    OperationDefinition(name="create_column", description="Create a new column", method="POST", path="/v1/task-columns"),
                    OperationDefinition(name="update_column", description="Update a column title", method="PATCH", path="/v1/task-columns/{id}"),
                    OperationDefinition(name="delete_column", description="Delete an empty column", method="DELETE", path="/v1/task-columns/{id}"),
                ],
            ),
            ResourceMetadata(
                resource="tasks",
                description="Project tasks managed by task-service",
                source="registry",
                fields=[
                    FieldDefinition(name="id", type="string", required=True, description="Task identifier"),
                    FieldDefinition(name="title", type="string", required=True, description="Task title"),
                    FieldDefinition(name="description", type="string", description="Task description"),
                    FieldDefinition(
                        name="status",
                        type="string",
                        required=True,
                        description="Current column/status identifier",
                        allowed_values=["todo", "in_progress", "done"],
                    ),
                    FieldDefinition(
                        name="priority",
                        type="string",
                        required=True,
                        description="Task priority",
                        allowed_values=["low", "medium", "high"],
                    ),
                    FieldDefinition(name="dueAt", type="datetime", description="Task deadline in ISO-8601"),
                    FieldDefinition(name="completed", type="boolean", description="Explicit completion toggle"),
                    FieldDefinition(name="assigneeUserId", type="string", description="Assignee user id"),
                    FieldDefinition(name="assigneeName", type="string", description="Assignee display name"),
                ],
                operations=[
                    OperationDefinition(name="list_tasks", description="List tasks for the active project", method="GET", path="/v1/tasks"),
                    OperationDefinition(name="get_task", description="Get task details", method="GET", path="/v1/tasks/{id}"),
                    OperationDefinition(name="create_task", description="Create a task", method="POST", path="/v1/tasks"),
                    OperationDefinition(name="update_task", description="Patch task fields", method="PATCH", path="/v1/tasks/{id}"),
                    OperationDefinition(name="delete_task", description="Delete a task", method="DELETE", path="/v1/tasks/{id}"),
                ],
            ),
        ]


class FileServiceMetadataProvider:
    def __init__(self, file_client: FileServiceClient) -> None:
        self.file_client = file_client

    async def describe(self) -> list[ResourceMetadata]:
        operations = [
            OperationDefinition(name="list_files", description="List files and folders in a directory", method="RPC", path="file-service.agent-commands"),
            OperationDefinition(name="attach_file_to_task", description="Attach an existing environment file to a task", method="RPC", path="file-service.agent-commands"),
            OperationDefinition(name="detach_file_from_task", description="Detach a file from a task", method="RPC", path="file-service.agent-commands"),
            OperationDefinition(name="list_task_attachments", description="List files attached to a task", method="RPC", path="file-service.agent-commands"),
        ]
        return [
            ResourceMetadata(
                resource="file_environment",
                description="Files available in the active team/project environment",
                source="registry",
                fields=[
                    FieldDefinition(name="path", type="string", required=True, description="Environment-relative path"),
                    FieldDefinition(name="name", type="string", required=True, description="File or folder name"),
                    FieldDefinition(name="kind", type="string", required=True, description="Entry kind", allowed_values=["file", "directory"]),
                    FieldDefinition(name="size_bytes", type="integer", description="File size in bytes"),
                ],
                operations=operations,
            ),
            ResourceMetadata(
                resource="task_attachments",
                description="Agent-managed task attachment registry stored in the file environment",
                source="registry",
                fields=[
                    FieldDefinition(name="attachment_id", type="string", required=True, description="Attachment identifier"),
                    FieldDefinition(name="task_id", type="string", required=True, description="Task identifier"),
                    FieldDefinition(name="file_path", type="string", required=True, description="Referenced file path in the environment"),
                    FieldDefinition(name="file_name", type="string", required=True, description="Display name"),
                    FieldDefinition(name="attached_at", type="datetime", required=True, description="Attachment creation time"),
                ],
                operations=operations[1:],
            ),
        ]
