from typing import Optional

from pydantic import BaseModel


class TaskNameDescriptionGenerationRequest(BaseModel):
    request_id: str
    raw_task_description: str
    current_task_name: Optional[str] = None


class TaskNameDescriptionGenerationResponse(BaseModel):
    request_id: str
    raw_task_description: str
    task_name: str
    task_description: str
