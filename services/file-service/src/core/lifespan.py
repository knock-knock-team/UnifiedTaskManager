import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI

from src.core.config import settings
import src.core.state as state
from src.db.database import engine
from src.db.models import Base
from src.mq.client import MqClient

logger = logging.getLogger("file-service.lifespan")


@asynccontextmanager
async def lifespan(_: FastAPI):
    async with engine.begin() as connection:
        await connection.run_sync(Base.metadata.create_all)
    logger.info("database initialized")

    if settings.file_service_rabbitmq_enabled:
        state.mq_client = await MqClient.connect(settings.file_service_rabbitmq_url)
        logger.info("rabbitmq connected")

    try:
        yield
    finally:
        if state.mq_client is not None:
            await state.mq_client.close()
            state.mq_client = None
            logger.info("rabbitmq disconnected")
