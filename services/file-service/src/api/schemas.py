from pydantic import BaseModel, Field


class AddMembersRequest(BaseModel):
    team_id: str = Field(min_length=1, max_length=128)
    project_id: str = Field(min_length=1, max_length=128)
    user_ids: list[str] = Field(min_length=1)


class RemoveMembersRequest(BaseModel):
    team_id: str = Field(min_length=1, max_length=128)
    project_id: str = Field(min_length=1, max_length=128)
    user_ids: list[str] = Field(min_length=1)


class CreateFolderRequest(BaseModel):
    team_id: str = Field(min_length=1, max_length=128)
    project_id: str = Field(min_length=1, max_length=128)
    path: str = Field(min_length=1, max_length=500)


class DeleteEntryRequest(BaseModel):
    team_id: str = Field(min_length=1, max_length=128)
    project_id: str = Field(min_length=1, max_length=128)
    path: str = Field(min_length=1, max_length=500)


class RenameEntryRequest(BaseModel):
    team_id: str = Field(min_length=1, max_length=128)
    project_id: str = Field(min_length=1, max_length=128)
    old_path: str = Field(min_length=1, max_length=500)
    new_path: str = Field(min_length=1, max_length=500)


class EnvironmentResponse(BaseModel):
    id: str
    name: str
    owner_user_id: str
    team_id: str
    project_id: str
    member_user_ids: list[str]


class EnsureEnvironmentRequest(BaseModel):
    team_id: str = Field(min_length=1, max_length=128)
    project_id: str = Field(min_length=1, max_length=128)
