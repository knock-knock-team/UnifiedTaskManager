import datetime
import json

from fastapi import APIRouter, Depends, Header, HTTPException, Request, status
from fastapi.responses import StreamingResponse

from ..schemas import TaskFileAgentRequest, TaskFileAgentResponse
from ..services.task_file_agent.entrypoint import TaskFileAgentEntrypoint


assistant_router = APIRouter(tags=["task-file-agent"])


def get_task_file_agent(request: Request) -> TaskFileAgentEntrypoint:
    return request.app.state.task_file_agent


@assistant_router.get("/api/tasks/assistant/health")
async def assistant_health() -> dict[str, str]:
    return {
        "status": "ok",
        "service": "Task/File assistant",
        "timestamp": datetime.datetime.now().isoformat(),
    }


@assistant_router.post(
    "/api/tasks/assistant",
    response_model=TaskFileAgentResponse,
)
async def run_task_file_agent(
    payload: TaskFileAgentRequest,
    agent: TaskFileAgentEntrypoint = Depends(get_task_file_agent),
    authorization: str | None = Header(default=None),
    x_gateway_user_id: str | None = Header(default=None),
    x_user_id: str | None = Header(default=None),
):
    if not authorization or not authorization.lower().startswith("bearer "):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Authorization header with Bearer token is required",
        )
    actor_user_id = (x_gateway_user_id or x_user_id or "").strip() or None
    return await agent.handle(
        payload,
        authorization=authorization,
        actor_user_id=actor_user_id,
    )


@assistant_router.post("/api/tasks/assistant/stream")
async def stream_task_file_agent(
    payload: TaskFileAgentRequest,
    agent: TaskFileAgentEntrypoint = Depends(get_task_file_agent),
    authorization: str | None = Header(default=None),
    x_gateway_user_id: str | None = Header(default=None),
    x_user_id: str | None = Header(default=None),
):
    if not authorization or not authorization.lower().startswith("bearer "):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Authorization header with Bearer token is required",
        )
    actor_user_id = (x_gateway_user_id or x_user_id or "").strip() or None

    async def event_stream():
        async for item in agent.stream(
            payload,
            authorization=authorization,
            actor_user_id=actor_user_id,
        ):
            yield f"data: {json.dumps(item.model_dump(mode='json'), ensure_ascii=False)}\n\n"

    return StreamingResponse(
        event_stream(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        },
    )
