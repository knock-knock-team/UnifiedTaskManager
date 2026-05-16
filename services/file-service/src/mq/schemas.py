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
