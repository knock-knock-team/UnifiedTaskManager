import datetime
from functools import lru_cache
from typing import Dict, Any

from fastapi import Depends, APIRouter

from ..schemas import (
    TaskNameDescriptionGenerationRequest,
    TaskNameDescriptionGenerationResponse
)
from ..services import AgentService


router = APIRouter(tags=["tasks"])


@lru_cache(maxsize=1)
def get_task_assistant_agent():
    return AgentService()


@router.get("/health", response_model=Dict[str, Any])
async def health():
    return {
        "status": "ok",
        "service": "Tasks assistant",
        "timestamp": datetime.now().isoformat()
    }


@router.get("/task_name_description", response_model=TaskNameDescriptionGenerationResponse)
async def generate_task_name_description(
    request: TaskNameDescriptionGenerationRequest,
    agent: AgentService = Depends(get_task_assistant_agent)
):
    return agent.process(request)