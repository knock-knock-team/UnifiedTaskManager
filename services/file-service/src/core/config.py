from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    app_name: str = "file-service"
    app_version: str = "1.0.0"
    app_debug: bool = False

    file_service_http_addr: str = ":8088"
    file_service_database_url: str = "postgresql+asyncpg://postgres:postgres@localhost:5432/unified_task_manager"
    file_service_storage_root: str = "/var/lib/unified-task-manager-file-service/storage"

    file_service_rabbitmq_enabled: bool = True
    file_service_rabbitmq_url: str = "amqp://guest:guest@localhost:5672/"
    file_service_user_exists_queue: str = "user-service.user-exists"
    file_service_deleted_file_queue: str = "task-service.file-deleted"
    file_service_agent_commands_queue: str = "file-service.agent-commands"
    file_service_rpc_timeout_seconds: float = 3.0
    file_service_user_service_url: str = "http://user-service:8082"

    jwt_secret: str = ""
    cors_allow_origin: str = "*"


settings = Settings()
