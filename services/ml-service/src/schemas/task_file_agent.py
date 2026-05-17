from typing import Any

from pydantic import BaseModel, Field


class AgentToolCallTrace(BaseModel):
    tool_name: str
    tool_input: dict[str, Any] = Field(default_factory=dict)
    tool_output: dict[str, Any] | None = None
    error: dict[str, Any] | None = None


class TaskFileAgentRequest(BaseModel):
    request_id: str = Field(min_length=1)
    message: str = Field(min_length=1)
    team_id: str = Field(min_length=1, max_length=128)
    project_id: str = Field(min_length=1, max_length=128)
    max_iterations: int = Field(default=8, ge=1, le=12)
    include_capabilities: bool = True


class TaskFileAgentResponse(BaseModel):
    request_id: str
    answer: str
    succeeded: bool
    tool_calls: list[AgentToolCallTrace] = Field(default_factory=list)
    capabilities: list[dict[str, Any]] = Field(default_factory=list)
