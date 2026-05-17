import datetime
from typing import Any, Dict

from fastapi import Depends, APIRouter, Request

from ..schemas import (
    TaskNameDescriptionGenerationRequest,
    TaskNameDescriptionGenerationResponse,
)
from ..services.task_assistant_service.agent import TaskAssistantService


task_router = APIRouter(tags=["tasks"])


def get_task_assistant_agent(request: Request) -> TaskAssistantService:
    return request.app.state.task_assistant_service


@task_router.get("/health", response_model=Dict[str, Any])
async def health():
    return {
        "status": "ok",
        "service": "Tasks assistant",
        "timestamp": datetime.datetime.now().isoformat(),
    }


@task_router.post(
    "/task_name_description",
    response_model=TaskNameDescriptionGenerationResponse,
)
async def generate_task_name_description(
    request: TaskNameDescriptionGenerationRequest,
    agent: TaskAssistantService = Depends(get_task_assistant_agent),
):
    return await agent.process(request)
