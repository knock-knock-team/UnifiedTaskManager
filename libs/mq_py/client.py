import json
import time
import uuid
from typing import Any, Callable, TypeVar, Generic, Awaitable
from collections.abc import Coroutine

import aio_pika
from aio_pika import Message, DeliveryMode, ExchangeType, Channel, Connection
from aio_pika.abc import AbstractIncomingMessage

from libs.mq_py.error import MqError, MqTimeoutError, MqSerializationError
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
            raise MqError.from_exception(e, "Connection failed")
    
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
        delivery_mode = DeliveryMode.PERSISTENT if opts.persistent else DeliveryMode.TRANSIENT
        
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
        exchange_obj = await channel.get_exchange(exchange) if exchange else None
        try:
            if exchange_obj:
                await exchange_obj.publish(message, routing_key=routing_key)
            else:
                await channel.default_exchange.publish(message, routing_key=routing_key)
        except Exception as e:
            raise MqError.from_exception(e, "Publish failed")
    
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
        
        async with channel.iterator(queue=reply_queue.name) as messages:
            async for message in messages:
                async with message.process():
                    if message.correlation_id != correlation_id:
                        continue
                    return _decode_json[Resp](message.body)
        raise MqTimeoutError("RPC request timed out")
    
    async def serve_rpc[Req, Resp](
        self,
        channel: Channel,
        queue_name: str,
        handler: Callable[[Req], Awaitable[Resp]],
        prefetch_count: int = 10,
    ) -> None:
        queue = await self.declare_queue(channel, name=queue_name)
        await channel.set_qos(prefetch_count=prefetch_count)
        
        async for message in queue.iterator():
            async with message.process(requeue_on_error=False):
                try:
                    req = _decode_json[Req](message.body)
                    
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
                except Exception:
                    continue