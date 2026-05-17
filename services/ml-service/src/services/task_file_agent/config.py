from functools import lru_cache

from pydantic import AliasChoices, Field
from pydantic_settings import BaseSettings, SettingsConfigDict


class TaskFileAgentSettings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        extra="ignore",
    )

    gateway_base_url: str = Field(
        default="http://localhost:8080",
        validation_alias=AliasChoices("API_GATEWAY_BASE_URL", "TASK_FILE_AGENT_GATEWAY_BASE_URL"),
    )
    task_service_base_url: str | None = Field(
        default=None,
        validation_alias=AliasChoices("TASK_SERVICE_BASE_URL", "TASK_FILE_AGENT_TASK_SERVICE_BASE_URL"),
    )
    file_service_base_url: str | None = Field(
        default=None,
        validation_alias=AliasChoices("FILE_SERVICE_BASE_URL", "TASK_FILE_AGENT_FILE_SERVICE_BASE_URL"),
    )
    service_request_timeout_seconds: float = Field(default=20.0, ge=1.0, le=120.0)
    service_max_retries: int = Field(default=2, ge=0, le=5)
    agent_max_iterations: int = Field(default=8, ge=1, le=12)
    attachment_manifest_root: str = Field(default=".assistant/task-attachments")
    rabbitmq_enabled: bool = Field(default=True, validation_alias=AliasChoices("ML_SERVICE_RABBITMQ_ENABLED", "RABBITMQ_ENABLED"))
    rabbitmq_url: str = Field(
        default="amqp://guest:guest@rabbitmq:5672/",
        validation_alias=AliasChoices("ML_SERVICE_RABBITMQ_URL", "RABBITMQ_URL"),
    )
    task_commands_queue: str = Field(
        default="task-service.agent-commands",
        validation_alias=AliasChoices("TASK_SERVICE_AGENT_COMMANDS_QUEUE", "ML_SERVICE_TASK_COMMANDS_QUEUE"),
    )
    file_commands_queue: str = Field(
        default="file-service.agent-commands",
        validation_alias=AliasChoices("FILE_SERVICE_AGENT_COMMANDS_QUEUE", "ML_SERVICE_FILE_COMMANDS_QUEUE"),
    )
    sber_auth: str = Field(default="", validation_alias="SBER_AUTH")
    gigachat_model: str = Field(default="GigaChat")
    gigachat_temperature: float = Field(default=0.3, ge=0.0, le=2.0)
    gigachat_top_p: float = Field(default=0.1, ge=0.0, le=1.0)
    gigachat_max_tokens: int = Field(default=1024, ge=64, le=8192)
    gigachat_timeout_seconds: int = Field(default=120, ge=10, le=300)

    @property
    def resolved_task_service_base_url(self) -> str:
        return (self.task_service_base_url or self.gateway_base_url).rstrip("/")

    @property
    def resolved_file_service_base_url(self) -> str:
        return (self.file_service_base_url or self.gateway_base_url).rstrip("/")


@lru_cache(maxsize=1)
def get_task_file_agent_settings() -> TaskFileAgentSettings:
    return TaskFileAgentSettings()
