import asyncio
import logging
from contextlib import suppress

from fastapi import HTTPException

from src.core.config import settings
from src.db.database import SessionLocal
from src.mq.client import MqClient, PublishOptions
from src.mq.schemas import AgentCommandError, AgentCommandRequest, AgentCommandResponse
from src.services.storage_service import StorageService


logger = logging.getLogger("file-service.agent-commands-consumer")


async def consume_agent_commands(mq_client: MqClient) -> None:
    channel = await mq_client.channel()
    queue = await channel.declare_queue(settings.file_service_agent_commands_queue, durable=True)
    await channel.set_qos(prefetch_count=10)
    try:
        async with queue.iterator() as messages:
            async for message in messages:
                async with message.process(requeue=False):
                    try:
                        request = AgentCommandRequest.model_validate_json(message.body)
                    except Exception:
                        logger.warning("invalid agent command payload received")
                        continue
                    response = await _handle_request(mq_client, request)
                    if message.reply_to:
                        await mq_client.publish_json(
                            channel=channel,
                            queue_name=message.reply_to,
                            payload=response.model_dump(mode="json"),
                            options=PublishOptions(
                                correlation_id=message.correlation_id,
                                persistent=False,
                            ),
                        )
    except asyncio.CancelledError:
        logger.info("agent command consumer cancelled")
        raise
    finally:
        with suppress(Exception):
            await channel.close()


async def _handle_request(mq_client: MqClient, request: AgentCommandRequest) -> AgentCommandResponse:
    actor_user_id = (request.actor_user_id or "").strip()
    if not actor_user_id:
        return _error_response(request.command, "Unauthorized", 401, "unauthorized", False)
    async with SessionLocal() as session:
        service = StorageService(session=session, mq_client=mq_client)
        try:
            if request.command == "list_files":
                items = await service.list_entries(
                    request.team_id,
                    request.project_id,
                    actor_user_id,
                    request.payload.get("directory", "."),
                )
                return AgentCommandResponse(success=True, message="Files listed", data={"files": items})
            if request.command == "attach_file_to_task":
                attachment = await service.attach_file_to_task(
                    request.team_id,
                    request.project_id,
                    actor_user_id,
                    str(request.payload.get("task_id", "")),
                    str(request.payload.get("file_path", "")),
                    request.payload.get("display_name"),
                )
                return AgentCommandResponse(success=True, message="File attached to task", data={"attachment": attachment})
            if request.command == "detach_file_from_task":
                attachments = await service.detach_file_from_task(
                    request.team_id,
                    request.project_id,
                    actor_user_id,
                    str(request.payload.get("task_id", "")),
                    request.payload.get("attachment_id"),
                    request.payload.get("file_path"),
                )
                return AgentCommandResponse(success=True, message="File detached from task", data={"attachments": attachments})
            if request.command == "list_task_attachments":
                attachments = await service.list_task_attachments(
                    request.team_id,
                    request.project_id,
                    actor_user_id,
                    str(request.payload.get("task_id", "")),
                )
                return AgentCommandResponse(success=True, message="Task attachments listed", data={"attachments": attachments})
            return _error_response(request.command, "unknown command", 400, "unknown_command", False)
        except HTTPException as exc:
            return _error_response(
                request.command,
                str(exc.detail),
                exc.status_code,
                "http_error",
                exc.status_code >= 500,
            )
        except Exception as exc:  # pragma: no cover
            logger.exception("agent command handling failed")
            return _error_response(request.command, str(exc), 500, "internal_error", True)


def _error_response(operation: str, message: str, status_code: int, code: str, retryable: bool) -> AgentCommandResponse:
    return AgentCommandResponse(
        success=False,
        message=message,
        error=AgentCommandError(
            service="file_service",
            operation=operation,
            message=message,
            status_code=status_code,
            code=code,
            retryable=retryable,
        ),
    )
