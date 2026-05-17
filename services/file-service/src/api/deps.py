import asyncio
import base64
import hashlib
import hmac
import json
import time
from dataclasses import dataclass
from urllib.error import HTTPError, URLError
from urllib.parse import quote
from urllib.request import Request, urlopen

from fastapi import Header, HTTPException, status

from src.core.config import settings


@dataclass(frozen=True)
class AuthContext:
    user_id: str
    role: str
    team_ids: set[str]
    access_token: str = ""


def get_current_user_id(
    x_gateway_user_id: str | None = Header(default=None),
    x_user_id: str | None = Header(default=None),
) -> str:
    user_id = (x_gateway_user_id or x_user_id or "").strip()
    if not user_id:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Unauthorized",
        )
    return user_id


def get_auth_context(
    authorization: str | None = Header(default=None),
    x_gateway_user_id: str | None = Header(default=None),
    x_gateway_role: str | None = Header(default=None),
    x_gateway_team_ids: str | None = Header(default=None),
) -> AuthContext:
    if settings.jwt_secret:
        return _auth_from_bearer_token(authorization)

    user_id = (x_gateway_user_id or "").strip()
    if not user_id:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Unauthorized",
        )
    return AuthContext(
        user_id=user_id,
        role=(x_gateway_role or "").strip(),
        team_ids=_parse_team_ids(x_gateway_team_ids),
    )


async def require_team_access(auth: AuthContext, team_id: str) -> None:
    normalized_team_id = (team_id or "").strip()
    if not normalized_team_id:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="team_id is required")
    if normalized_team_id in auth.team_ids:
        return
    if auth.access_token and await _user_service_allows_team(auth.access_token, normalized_team_id):
        return
    if not auth.access_token:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Forbidden")
    raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Forbidden")


def _auth_from_bearer_token(authorization: str | None) -> AuthContext:
    header = (authorization or "").strip()
    if not header.lower().startswith("bearer "):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Unauthorized")

    token = header[7:].strip()
    parts = token.split(".")
    if len(parts) != 3:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Unauthorized")

    signing_input = f"{parts[0]}.{parts[1]}".encode("utf-8")
    expected_signature = base64.urlsafe_b64encode(
        hmac.new(settings.jwt_secret.encode("utf-8"), signing_input, hashlib.sha256).digest()
    ).rstrip(b"=").decode("ascii")
    if not hmac.compare_digest(parts[2], expected_signature):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Unauthorized")

    try:
        payload = json.loads(_b64url_decode(parts[1]))
    except (ValueError, json.JSONDecodeError):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Unauthorized") from None

    try:
        expires_at = int(payload.get("exp") or 0)
    except (TypeError, ValueError):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Unauthorized") from None

    if payload.get("typ") != "access" or not payload.get("sub") or expires_at <= int(time.time()):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Unauthorized")

    return AuthContext(
        user_id=str(payload["sub"]).strip(),
        role=str(payload.get("role") or "").strip(),
        team_ids={str(item).strip() for item in payload.get("teamIds") or [] if str(item).strip()},
        access_token=token,
    )


def _parse_team_ids(header_value: str | None) -> set[str]:
    return {item.strip() for item in (header_value or "").split(",") if item.strip()}


def _b64url_decode(value: str) -> str:
    padded = value + "=" * (-len(value) % 4)
    return base64.urlsafe_b64decode(padded.encode("ascii")).decode("utf-8")


async def _user_service_allows_team(access_token: str, team_id: str) -> bool:
    return await asyncio.to_thread(_user_service_allows_team_sync, access_token, team_id)


def _user_service_allows_team_sync(access_token: str, team_id: str) -> bool:
    base_url = settings.file_service_user_service_url.rstrip("/")
    if not base_url:
        return False
    request = Request(
        f"{base_url}/v1/teams/{quote(team_id, safe='')}",
        headers={"Authorization": f"Bearer {access_token}"},
        method="GET",
    )
    try:
        with urlopen(request, timeout=settings.file_service_rpc_timeout_seconds) as response:
            return 200 <= response.status < 300
    except HTTPError as exc:
        if exc.code in (401, 403, 404):
            return False
        return False
    except (OSError, URLError):
        return False
