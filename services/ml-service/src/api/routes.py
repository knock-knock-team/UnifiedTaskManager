import datetime
from functools import lru_cache
from typing import Dict, Any

from fastapi import Depends, APIRouter, Request

from ..schemas import (
    TaskNameDescriptionGenerationRequest,
    TaskNameDescriptionGenerationResponse
)
from ..services import TaskAssistantService


task_router = APIRouter(tags=["tasks"])


@lru_cache(maxsize=1)
def get_task_assistant_agent(request: Request):
    return request.app.state.task_assistant_service


@task_router.get("/health", response_model=Dict[str, Any])
async def health():
    return {
        "status": "ok",
        "service": "Tasks assistant",
        "timestamp": datetime.now().isoformat()
    }


@task_router.get("/task_name_description", response_model=TaskNameDescriptionGenerationResponse)
async def generate_task_name_description(
    request: TaskNameDescriptionGenerationRequest,
    agent: TaskAssistantService = Depends(get_task_assistant_agent)
):
    return agent.process(request)