import datetime
import base64
import hashlib
import hmac
import json
import os
import time
from dataclasses import dataclass

from fastapi import APIRouter, Depends, Header, HTTPException, Request, status
from fastapi.responses import StreamingResponse

from ..schemas import TaskFileAgentRequest, TaskFileAgentResponse
from ..services.task_file_agent.entrypoint import TaskFileAgentEntrypoint


assistant_router = APIRouter(tags=["task-file-agent"])


@dataclass(frozen=True)
class AuthContext:
    user_id: str | None
    team_ids: set[str]
    enforce_team_ids: bool


def get_task_file_agent(request: Request) -> TaskFileAgentEntrypoint:
    return request.app.state.task_file_agent


def get_auth_context(
    authorization: str | None,
    x_gateway_user_id: str | None,
    x_user_id: str | None,
) -> AuthContext:
    if not authorization or not authorization.lower().startswith("bearer "):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Authorization header with Bearer token is required",
        )

    jwt_secret = os.getenv("JWT_SECRET", "").strip()
    if not jwt_secret:
        return AuthContext(
            user_id=(x_gateway_user_id or x_user_id or "").strip() or None,
            team_ids=set(),
            enforce_team_ids=False,
        )

    token = authorization[7:].strip()
    parts = token.split(".")
    if len(parts) != 3:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Unauthorized")

    signing_input = f"{parts[0]}.{parts[1]}".encode("utf-8")
    expected_signature = base64.urlsafe_b64encode(
        hmac.new(jwt_secret.encode("utf-8"), signing_input, hashlib.sha256).digest()
    ).rstrip(b"=").decode("ascii")
    if not hmac.compare_digest(parts[2], expected_signature):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Unauthorized")

    try:
        payload = json.loads(_b64url_decode(parts[1]))
        expires_at = int(payload.get("exp") or 0)
    except (ValueError, json.JSONDecodeError, TypeError):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Unauthorized") from None

    if payload.get("typ") != "access" or not payload.get("sub") or expires_at <= int(time.time()):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Unauthorized")

    return AuthContext(
        user_id=str(payload["sub"]).strip(),
        team_ids={str(item).strip() for item in payload.get("teamIds") or [] if str(item).strip()},
        enforce_team_ids=True,
    )


def require_team_access(auth: AuthContext, team_id: str) -> None:
    if auth.enforce_team_ids and (team_id or "").strip() not in auth.team_ids:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Forbidden")


def _b64url_decode(value: str) -> str:
    padded = value + "=" * (-len(value) % 4)
    return base64.urlsafe_b64decode(padded.encode("ascii")).decode("utf-8")


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
    auth = get_auth_context(authorization, x_gateway_user_id, x_user_id)
    require_team_access(auth, payload.team_id)
    return await agent.handle(
        payload,
        authorization=authorization,
        actor_user_id=auth.user_id,
    )


@assistant_router.post("/api/tasks/assistant/stream")
async def stream_task_file_agent(
    payload: TaskFileAgentRequest,
    agent: TaskFileAgentEntrypoint = Depends(get_task_file_agent),
    authorization: str | None = Header(default=None),
    x_gateway_user_id: str | None = Header(default=None),
    x_user_id: str | None = Header(default=None),
):
    auth = get_auth_context(authorization, x_gateway_user_id, x_user_id)
    require_team_access(auth, payload.team_id)

    async def event_stream():
        async for item in agent.stream(
            payload,
            authorization=authorization,
            actor_user_id=auth.user_id,
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
