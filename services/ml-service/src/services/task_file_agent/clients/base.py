from ..schemas import ServiceErrorPayload


class ServiceClientError(Exception):
    def __init__(self, payload: ServiceErrorPayload) -> None:
        super().__init__(payload.message)
        self.payload = payload

import asyncio
from typing import Any

import httpx

from ..schemas import ExecutionContext, ServiceErrorPayload


class ServiceClientError(Exception):
    def __init__(self, payload: ServiceErrorPayload) -> None:
        super().__init__(payload.message)
        self.payload = payload


class ResilientServiceClient:
    def __init__(
        self,
        *,
        service_name: str,
        base_url: str,
        timeout_seconds: float,
        max_retries: int,
    ) -> None:
        self.service_name = service_name
        self.base_url = base_url.rstrip("/")
        self.timeout_seconds = timeout_seconds
        self.max_retries = max_retries
        self._client = httpx.AsyncClient(base_url=self.base_url, timeout=self.timeout_seconds)

    async def aclose(self) -> None:
        await self._client.aclose()

    async def _request_json(
        self,
        context: ExecutionContext,
        method: str,
        path: str,
        *,
        operation: str,
        params: dict[str, Any] | None = None,
        json_body: dict[str, Any] | None = None,
        headers: dict[str, str] | None = None,
    ) -> dict[str, Any]:
        response = await self._request(
            context,
            method,
            path,
            operation=operation,
            params=params,
            json_body=json_body,
            headers=headers,
        )
        if response.status_code == 204 or not response.content:
            return {}
        try:
            data = response.json()
        except ValueError as exc:
            raise self._build_error(
                operation=operation,
                message="Service returned invalid JSON",
                status_code=response.status_code,
                code="invalid_json",
                retryable=False,
            ) from exc
        if isinstance(data, dict):
            return data
        return {"items": data}

    async def _request_bytes(
        self,
        context: ExecutionContext,
        method: str,
        path: str,
        *,
        operation: str,
        params: dict[str, Any] | None = None,
        headers: dict[str, str] | None = None,
    ) -> bytes:
        response = await self._request(
            context,
            method,
            path,
            operation=operation,
            params=params,
            headers=headers,
        )
        return response.content

    async def _request_multipart_json(
        self,
        context: ExecutionContext,
        path: str,
        *,
        operation: str,
        params: dict[str, Any],
        files: dict[str, Any],
    ) -> dict[str, Any]:
        request_headers = self._build_headers(context)
        for attempt in range(self.max_retries + 1):
            try:
                response = await self._client.post(
                    path,
                    params=params,
                    headers=request_headers,
                    files=files,
                )
                if response.status_code >= 400:
                    raise self._handle_http_error(response, operation)
                if not response.content:
                    return {}
                payload = response.json()
                return payload if isinstance(payload, dict) else {"items": payload}
            except ServiceClientError as exc:
                if not exc.payload.retryable or attempt >= self.max_retries:
                    raise
                await asyncio.sleep(self._retry_delay_seconds(attempt))
            except httpx.HTTPError as exc:
                if attempt >= self.max_retries:
                    raise self._build_error(
                        operation=operation,
                        message=str(exc),
                        code="transport_error",
                        retryable=True,
                    ) from exc
                await asyncio.sleep(self._retry_delay_seconds(attempt))
        raise self._build_error(
            operation=operation,
            message="Request failed after retries",
            code="request_failed",
            retryable=True,
        )

    async def _fetch_openapi_schema(self) -> dict[str, Any] | None:
        try:
            response = await self._client.get("/openapi.json", headers={"Accept": "application/json"})
            response.raise_for_status()
            payload = response.json()
        except (httpx.HTTPError, ValueError):
            return None
        return payload if isinstance(payload, dict) else None

    async def _request(
        self,
        context: ExecutionContext,
        method: str,
        path: str,
        *,
        operation: str,
        params: dict[str, Any] | None = None,
        json_body: dict[str, Any] | None = None,
        headers: dict[str, str] | None = None,
    ) -> httpx.Response:
        request_headers = self._build_headers(context)
        if headers:
            request_headers.update(headers)
        for attempt in range(self.max_retries + 1):
            try:
                response = await self._client.request(
                    method=method,
                    url=path,
                    params=params,
                    json=json_body,
                    headers=request_headers,
                )
                if response.status_code >= 400:
                    raise self._handle_http_error(response, operation)
                return response
            except ServiceClientError as exc:
                if not exc.payload.retryable or attempt >= self.max_retries:
                    raise
                await asyncio.sleep(self._retry_delay_seconds(attempt))
            except httpx.HTTPError as exc:
                if attempt >= self.max_retries:
                    raise self._build_error(
                        operation=operation,
                        message=str(exc),
                        code="transport_error",
                        retryable=True,
                    ) from exc
                await asyncio.sleep(self._retry_delay_seconds(attempt))
        raise self._build_error(
            operation=operation,
            message="Request failed after retries",
            code="request_failed",
            retryable=True,
        )

    def _build_headers(self, context: ExecutionContext) -> dict[str, str]:
        headers = {
            "Accept": "application/json",
            "Authorization": f"Bearer {context.access_token}",
            "X-Team-Id": context.team_id,
        }
        if context.actor_user_id:
            headers["X-User-Id"] = context.actor_user_id
            headers["X-Gateway-User-Id"] = context.actor_user_id
        return headers

    def _handle_http_error(self, response: httpx.Response, operation: str) -> ServiceClientError:
        payload = {}
        try:
            payload = response.json()
        except ValueError:
            payload = {}
        message = (
            payload.get("message")
            or payload.get("detail")
            or response.text.strip()
            or f"{self.service_name} returned HTTP {response.status_code}"
        )
        code = payload.get("code")
        retryable = response.status_code >= 500 or response.status_code == 429
        return self._build_error(
            operation=operation,
            message=message,
            status_code=response.status_code,
            code=code,
            retryable=retryable,
            details=payload if isinstance(payload, dict) else {},
        )

    def _build_error(
        self,
        *,
        operation: str,
        message: str,
        status_code: int | None = None,
        code: str | None = None,
        retryable: bool,
        details: dict[str, Any] | None = None,
    ) -> ServiceClientError:
        return ServiceClientError(
            ServiceErrorPayload(
                service=self.service_name,
                operation=operation,
                message=message,
                status_code=status_code,
                code=code,
                retryable=retryable,
                details=details or {},
            )
        )

    @staticmethod
    def _retry_delay_seconds(attempt: int) -> float:
        return min(0.5 * (2**attempt), 2.0)
