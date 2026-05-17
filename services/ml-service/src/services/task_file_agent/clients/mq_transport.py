import asyncio
import uuid
from typing import Any

from libs.mq_py import MqClient, MqError
from libs.log_py import LoggerFactory

from ..config import TaskFileAgentSettings
from ..schemas import AgentCommandRequest, AgentCommandResponse, ExecutionContext, ServiceErrorPayload
from .base import ServiceClientError


logger = LoggerFactory.get_logger("TaskFileAgentMqTransport")


class MqRpcTransport:
    def __init__(self, settings: TaskFileAgentSettings) -> None:
        self.settings = settings
        self._mq_client: MqClient | None = None

    async def connect(self) -> None:
        if not self.settings.rabbitmq_enabled:
            return
        attempts = max(self.settings.service_max_retries + 3, 5)
        last_error: Exception | None = None
        for attempt in range(attempts):
            try:
                self._mq_client = await MqClient.connect(self.settings.rabbitmq_url)
                return
            except MqError as exc:
                last_error = exc
                if attempt >= attempts - 1:
                    break
                delay_seconds = min(1.0 * (2**attempt), 5.0)
                logger.warning(
                    "RabbitMQ connect retry scheduled",
                    extra={
                        "attempt": attempt + 1,
                        "attempts": attempts,
                        "delay_seconds": delay_seconds,
                        "rabbitmq_url": self.settings.rabbitmq_url,
                        "error": str(exc),
                    },
                )
                await asyncio.sleep(delay_seconds)
        assert last_error is not None
        raise last_error

    async def aclose(self) -> None:
        if self._mq_client is None:
            return
        await self._mq_client.close()
        self._mq_client = None

    async def request(
        self,
        *,
        service_name: str,
        queue_name: str,
        operation: str,
        context: ExecutionContext,
        payload: dict[str, Any] | None = None,
    ) -> AgentCommandResponse:
        if not self.settings.rabbitmq_enabled or self._mq_client is None:
            raise self._error(service_name, operation, "RabbitMQ transport is not connected", code="mq_not_connected")
        request = AgentCommandRequest(
            request_id=str(uuid.uuid4()),
            command=operation,
            team_id=context.team_id,
            project_id=context.project_id,
            access_token=context.access_token,
            actor_user_id=context.actor_user_id,
            payload=payload or {},
        )
        for attempt in range(self.settings.service_max_retries + 1):
            channel = await self._mq_client.channel()
            try:
                await self._mq_client.declare_queue(channel, queue_name, durable=True)
                raw = await self._mq_client.request_json(
                    channel=channel,
                    queue=queue_name,
                    request=request.model_dump(mode="json"),
                    timeout=self.settings.service_request_timeout_seconds,
                )
                response = AgentCommandResponse.model_validate(raw)
                if not response.success and response.error is not None:
                    raise ServiceClientError(response.error)
                return response
            except ServiceClientError:
                raise
            except (MqError, asyncio.TimeoutError, ValueError) as exc:
                if attempt >= self.settings.service_max_retries:
                    raise self._error(
                        service_name,
                        operation,
                        str(exc),
                        code="mq_request_failed",
                        retryable=True,
                    ) from exc
                await asyncio.sleep(min(0.5 * (2**attempt), 2.0))
            finally:
                await channel.close()
        raise self._error(service_name, operation, "MQ request failed", code="mq_request_failed", retryable=True)

    @staticmethod
    def _error(
        service_name: str,
        operation: str,
        message: str,
        *,
        code: str,
        retryable: bool = False,
    ) -> ServiceClientError:
        return ServiceClientError(
            ServiceErrorPayload(
                service=service_name,
                operation=operation,
                message=message,
                code=code,
                retryable=retryable,
            )
        )
