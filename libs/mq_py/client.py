import asyncio
import json
import time
import uuid
from typing import Any, Awaitable, Callable, TypeVar

import aio_pika
from aio_pika import Channel, Connection, DeliveryMode, ExchangeType, Message

from libs.mq_py.error import MqConnectionError, MqError, MqPublishError, MqSerializationError, MqTimeoutError
from libs.mq_py.types import PublishOptions

T = TypeVar("T")
R = TypeVar("R")


def _encode_json(value: Any) -> bytes:
    try:
        return json.dumps(value).encode("utf-8")
    except (TypeError, ValueError) as e:
        raise MqSerializationError(f"Failed to serialize: {e}")


def _decode_json[T](data: bytes) -> T:
    try:
        return json.loads(data.decode("utf-8"))
    except (json.JSONDecodeError, UnicodeDecodeError) as e:
        raise MqSerializationError(f"Failed to deserialize: {e}")


def _generate_correlation_id(prefix: str = "corr") -> str:
    ts = int(time.time() * 1_000_000)  # microseconds
    uid = uuid.uuid4().hex[:8]
    return f"{prefix}-{ts}-{uid}"


class MqClient:
    """Async RabbitMQ client with publish and RPC helpers."""

    def __init__(self, connection: Connection):
        self._connection = connection

    @classmethod
    async def connect(cls, uri: str) -> "MqClient":
        try:
            connection = await aio_pika.connect_robust(uri)
            return cls(connection)
        except Exception as e:
            raise MqConnectionError.from_exception(e, "Connection failed")

    async def close(self) -> None:
        await self._connection.close()

    async def channel(self) -> Channel:
        return await self._connection.channel()

    async def declare_queue(
        self,
        channel: Channel,
        name: str,
        durable: bool = True,
        exclusive: bool = False,
        auto_delete: bool = False,
    ) -> aio_pika.Queue:
        return await channel.declare_queue(
            name=name,
            durable=durable,
            exclusive=exclusive,
            auto_delete=auto_delete,
        )

    async def declare_exchange(
        self,
        channel: Channel,
        name: str,
        exchange_type: ExchangeType = ExchangeType.DIRECT,
        durable: bool = True,
    ) -> aio_pika.Exchange:
        return await channel.declare_exchange(
            name=name,
            type=exchange_type,
            durable=durable,
        )

    def _apply_publish_options(self, body: bytes, opts: PublishOptions) -> Message:
        delivery_mode = DeliveryMode.PERSISTENT if opts.persistent else DeliveryMode.NOT_PERSISTENT
        return Message(
            body=body,
            content_type=opts.content_type,
            content_encoding=opts.content_encoding,
            type=opts.message_type,
            correlation_id=opts.correlation_id,
            reply_to=opts.reply_to,
            delivery_mode=delivery_mode,
            headers=opts.headers or {},
        )

    async def publish_json(
        self,
        channel: Channel,
        exchange: str,
        routing_key: str,
        payload: Any,
        opts: PublishOptions | None = None,
    ) -> None:
        opts = opts or PublishOptions()
        body = _encode_json(payload)
        message = self._apply_publish_options(body, opts)

        try:
            if exchange:
                exchange_obj = await self.declare_exchange(channel, exchange)
                await exchange_obj.publish(message, routing_key=routing_key)
            else:
                await channel.default_exchange.publish(message, routing_key=routing_key)
        except Exception as e:
            raise MqPublishError.from_exception(e, "Publish failed")

    async def request_json[Resp](
        self,
        channel: Channel,
        queue: str,
        request: Any,
        timeout: float | None = None,
    ) -> Resp:
        reply_queue = await self.declare_queue(
            channel,
            name="",
            exclusive=True,
            auto_delete=True,
            durable=False,
        )
        correlation_id = _generate_correlation_id()
        opts = PublishOptions(
            content_type="application/json",
            correlation_id=correlation_id,
            reply_to=reply_queue.name,
            persistent=False,
        )
        await self.publish_json(channel, "", queue, request, opts)

        response_future: asyncio.Future[Resp] = asyncio.get_running_loop().create_future()

        async def on_reply(message: aio_pika.abc.AbstractIncomingMessage) -> None:
            async with message.process(ignore_processed=True):
                if message.correlation_id != correlation_id:
                    return
                try:
                    payload = _decode_json(message.body)
                except MqSerializationError as exc:
                    if not response_future.done():
                        response_future.set_exception(exc)
                    return
                if not response_future.done():
                    response_future.set_result(payload)

        consumer_tag = await reply_queue.consume(on_reply, no_ack=False)
        try:
            wait_timeout = timeout if timeout and timeout > 0 else 3.0
            return await asyncio.wait_for(response_future, timeout=wait_timeout)
        except TimeoutError as exc:
            raise MqTimeoutError(f"RPC request timed out after {wait_timeout} seconds") from exc
        finally:
            await reply_queue.cancel(consumer_tag)

    async def serve_rpc[Req, Resp](
        self,
        channel: Channel,
        queue_name: str,
        handler: Callable[[Req], Awaitable[Resp]],
        prefetch_count: int = 10,
    ) -> None:
        queue = await self.declare_queue(channel, name=queue_name)
        await channel.set_qos(prefetch_count=prefetch_count)
        async with queue.iterator() as messages:
            async for message in messages:
                async with message.process(requeue=False):
                    req = _decode_json(message.body)
                    if not message.reply_to:
                        continue
                    resp = await handler(req)
                    response_body = _encode_json(resp)
                    response_msg = Message(
                        body=response_body,
                        content_type="application/json",
                        correlation_id=message.correlation_id,
                    )
                    await channel.default_exchange.publish(
                        response_msg,
                        routing_key=message.reply_to,
                    )