from pydantic import BaseModel, Field


class UserExistsRequest(BaseModel):
    user_id: str = Field(min_length=1, max_length=128)


class UserExistsResponse(BaseModel):
    exists: bool


class FileDeletedEvent(BaseModel):
    event_type: str = "file.deleted"
    environment_id: str
    deleted_path: str
    actor_user_id: str


class TaskAttachmentRecord(BaseModel):
    attachment_id: str
    task_id: str
    file_path: str
    file_name: str
    attached_at: str


class AgentCommandRequest(BaseModel):
    request_id: str
    command: str
    team_id: str = Field(min_length=1, max_length=128)
    project_id: str = Field(min_length=1, max_length=128)
    access_token: str = Field(min_length=1)
    actor_user_id: str | None = None
    payload: dict = Field(default_factory=dict)


class AgentCommandError(BaseModel):
    service: str
    operation: str
    message: str
    status_code: int | None = None
    code: str | None = None
    retryable: bool = False
    details: dict = Field(default_factory=dict)


class AgentCommandResponse(BaseModel):
    success: bool
    message: str
    data: dict = Field(default_factory=dict)
    error: AgentCommandError | None = None
