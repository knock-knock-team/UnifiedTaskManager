import asyncio
import json
import time
from dataclasses import dataclass
from uuid import uuid4

import aio_pika
from aio_pika.abc import AbstractChannel, AbstractRobustConnection


@dataclass(slots=True)
class PublishOptions:
    content_type: str = "application/json"
    correlation_id: str | None = None
    reply_to: str | None = None
    persistent: bool = True


class MqClient:
    def __init__(self, connection: AbstractRobustConnection) -> None:
        self._connection = connection

    @classmethod
    async def connect(cls, url: str) -> "MqClient":
        connection = await aio_pika.connect_robust(url)
        return cls(connection)

    async def close(self) -> None:
        await self._connection.close()

    async def channel(self) -> AbstractChannel:
        return await self._connection.channel()

    async def publish_json(
        self,
        channel: AbstractChannel,
        queue_name: str,
        payload: dict,
        options: PublishOptions | None = None,
    ) -> None:
        opts = options or PublishOptions()
        body = json.dumps(payload).encode("utf-8")
        message = aio_pika.Message(
            body=body,
            content_type=opts.content_type,
            correlation_id=opts.correlation_id,
            reply_to=opts.reply_to,
            delivery_mode=(
                aio_pika.DeliveryMode.PERSISTENT
                if opts.persistent
                else aio_pika.DeliveryMode.NOT_PERSISTENT
            ),
            timestamp=int(time.time()),
        )
        await channel.default_exchange.publish(message, routing_key=queue_name)

    async def request_json(
        self,
        channel: AbstractChannel,
        queue_name: str,
        request_payload: dict,
        timeout_seconds: float = 3.0,
    ) -> dict:
        correlation_id = f"corr-{uuid4()}"
        reply_queue = await channel.declare_queue(exclusive=True, auto_delete=True)
        response_future: asyncio.Future[dict] = asyncio.get_running_loop().create_future()

        async def on_reply(message: aio_pika.abc.AbstractIncomingMessage) -> None:
            async with message.process(ignore_processed=True):
                if message.correlation_id != correlation_id:
                    return
                if not response_future.done():
                    response_future.set_result(json.loads(message.body.decode("utf-8")))

        await reply_queue.consume(on_reply, no_ack=False)
        await self.publish_json(
            channel=channel,
            queue_name=queue_name,
            payload=request_payload,
            options=PublishOptions(
                correlation_id=correlation_id,
                reply_to=reply_queue.name,
                persistent=False,
            ),
        )
        return await asyncio.wait_for(response_future, timeout=timeout_seconds)
