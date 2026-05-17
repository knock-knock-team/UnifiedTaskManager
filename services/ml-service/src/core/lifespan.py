from contextlib import asynccontextmanager
from fastapi import FastAPI

from ..services.task_assistant_service.agent import TaskAssistantService
from ..services.task_file_agent.entrypoint import TaskFileAgentEntrypoint


@asynccontextmanager
async def lifespan(app: FastAPI):
    task_assistant_service = TaskAssistantService()
    task_file_agent = TaskFileAgentEntrypoint()
    await task_file_agent.connect()
    app.state.task_assistant_service = task_assistant_service
    app.state.task_file_agent = task_file_agent
    try:
        yield
    finally:
        await task_file_agent.aclose()