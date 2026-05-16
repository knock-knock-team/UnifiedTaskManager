from typing import Any, Literal

from pydantic import BaseModel, Field, model_validator


class ExecutionContext(BaseModel):
    access_token: str = Field(min_length=1)
    team_id: str = Field(min_length=1, max_length=128)
    project_id: str = Field(min_length=1, max_length=128)
    actor_user_id: str | None = Field(default=None, max_length=128)


class ServiceErrorPayload(BaseModel):
    service: str
    operation: str
    message: str
    status_code: int | None = None
    code: str | None = None
    retryable: bool = False
    details: dict[str, Any] = Field(default_factory=dict)


class FieldDefinition(BaseModel):
    name: str
    type: str
    required: bool = False
    description: str = ""
    allowed_values: list[str] = Field(default_factory=list)


class OperationDefinition(BaseModel):
    name: str
    description: str
    method: str
    path: str


class ResourceMetadata(BaseModel):
    resource: str
    description: str
    source: Literal["introspection", "registry"] = "registry"
    fields: list[FieldDefinition] = Field(default_factory=list)
    operations: list[OperationDefinition] = Field(default_factory=list)


class TaskColumnRecord(BaseModel):
    id: str
    teamId: str
    projectId: str
    title: str
    position: int
    createdAt: str
    updatedAt: str


class TaskRecord(BaseModel):
    id: str
    title: str
    description: str = ""
    status: str
    priority: str
    dueAt: str | None = None
    completedAt: str | None = None
    completedBy: str = ""
    createdBy: str
    assigneeUserId: str = ""
    assigneeName: str = ""
    teamId: str = ""
    projectId: str = ""
    unreadComments: int = 0
    createdAt: str
    updatedAt: str


class FileEntryRecord(BaseModel):
    name: str
    path: str
    kind: Literal["file", "directory"]
    size_bytes: int = 0


class TaskAttachmentRecord(BaseModel):
    attachment_id: str
    task_id: str
    file_path: str
    file_name: str
    attached_at: str


class ToolResult(BaseModel):
    success: bool
    message: str
    data: dict[str, Any] = Field(default_factory=dict)
    error: ServiceErrorPayload | None = None


class AgentToolTrace(BaseModel):
    tool_name: str
    tool_input: dict[str, Any] = Field(default_factory=dict)
    tool_output: dict[str, Any] | None = None
    error: ServiceErrorPayload | None = None


class AgentRunResult(BaseModel):
    answer: str
    succeeded: bool
    tool_calls: list[AgentToolTrace] = Field(default_factory=list)


class AgentCommandRequest(BaseModel):
    request_id: str
    command: str
    team_id: str
    project_id: str
    access_token: str
    actor_user_id: str | None = None
    payload: dict[str, Any] = Field(default_factory=dict)


class AgentCommandResponse(BaseModel):
    success: bool
    message: str
    data: dict[str, Any] = Field(default_factory=dict)
    error: ServiceErrorPayload | None = None


class AgentExecutionEvent(BaseModel):
    event_type: Literal["agent.execution.completed"] = "agent.execution.completed"
    request_id: str
    team_id: str
    project_id: str
    actor_user_id: str | None = None
    answer: str
    succeeded: bool
    domains: list[Literal["task", "file"]] = Field(default_factory=list)
    tool_calls: list[AgentToolTrace] = Field(default_factory=list)
    occurred_at: str


class AgentStreamEvent(BaseModel):
    type: Literal["status", "token", "tool_start", "tool_end", "final", "error"]
    text: str = ""
    tool_name: str = ""
    payload: dict[str, Any] = Field(default_factory=dict)


class CreateTaskColumnInput(BaseModel):
    title: str = Field(min_length=1, max_length=200)


class UpdateTaskColumnInput(BaseModel):
    column_id: str = Field(min_length=1)
    title: str = Field(min_length=1, max_length=200)


class DeleteTaskColumnInput(BaseModel):
    column_id: str = Field(min_length=1)


class CreateTaskInput(BaseModel):
    title: str = Field(min_length=1, max_length=300)
    description: str | None = None
    status: str | None = None
    priority: str | None = None
    due_at: str | None = None
    assignee_user_id: str | None = None
    assignee_name: str | None = None


class UpdateTaskInput(BaseModel):
    task_id: str = Field(min_length=1)
    title: str | None = None
    description: str | None = None
    status: str | None = None
    priority: str | None = None
    due_at: str | None = None
    assignee_user_id: str | None = None
    assignee_name: str | None = None
    completed: bool | None = None


class DeleteTaskInput(BaseModel):
    task_id: str = Field(min_length=1)


class ChangeTaskStatusInput(BaseModel):
    task_id: str = Field(min_length=1)
    status: str = Field(min_length=1)
    completed: bool | None = None


class ChangeTaskDescriptionInput(BaseModel):
    task_id: str = Field(min_length=1)
    description: str = Field(min_length=1)


class ListTasksInput(BaseModel):
    search: str | None = None
    limit: int = Field(default=50, ge=1, le=100)
    offset: int = Field(default=0, ge=0)


class ListTaskColumnsInput(BaseModel):
    pass


class GetTaskDetailsInput(BaseModel):
    task_id: str = Field(min_length=1)


class ListTaskAttachmentsInput(BaseModel):
    task_id: str = Field(min_length=1)


class AttachFileToTaskInput(BaseModel):
    task_id: str = Field(min_length=1)
    file_path: str = Field(min_length=1)
    display_name: str | None = None


class DetachFileFromTaskInput(BaseModel):
    task_id: str = Field(min_length=1)
    attachment_id: str | None = None
    file_path: str | None = None

    @model_validator(mode="after")
    def validate_reference(self) -> "DetachFileFromTaskInput":
        if not self.attachment_id and not self.file_path:
            raise ValueError("attachment_id or file_path is required")
        return self


class ListFilesInput(BaseModel):
    directory: str = "."
