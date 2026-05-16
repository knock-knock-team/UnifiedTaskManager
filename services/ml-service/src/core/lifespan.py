from contextlib import asynccontextmanager
from fastapi import FastAPI

from ..services import TaskAssistantService


@asynccontextmanager
async def lifespan(app: FastAPI):
    task_assistant_service = TaskAssistantService()
    app.state.task_assistant_service = task_assistant_service
    yield