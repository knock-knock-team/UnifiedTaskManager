import asyncio

from src.mq.client import MqClient


mq_client: MqClient | None = None
agent_commands_consumer_task: asyncio.Task | None = None
