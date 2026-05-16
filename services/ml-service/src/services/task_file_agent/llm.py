import inspect

from langchain_gigachat import GigaChat
from langchain_core.language_models.chat_models import BaseChatModel

from ..llm import DEFAULT_GIGACHAT_PARAMS, create_gigachat
from .config import TaskFileAgentSettings


def create_task_file_agent_llm(settings: TaskFileAgentSettings) -> BaseChatModel:
    params = {
        **DEFAULT_GIGACHAT_PARAMS,
        "credentials": settings.sber_auth,
        "model": settings.gigachat_model,
        "temperature": settings.gigachat_temperature,
        "top_p": settings.gigachat_top_p,
        "max_tokens": settings.gigachat_max_tokens,
        "timeout": settings.gigachat_timeout_seconds,
    }
    if "streaming" in inspect.signature(GigaChat).parameters:
        params["streaming"] = True
    return create_gigachat(**params)
