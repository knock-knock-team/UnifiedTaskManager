import os

from libs.log_py import LoggerFactory


logger = LoggerFactory.get_logger("TaskAssistantServicePrompts", level=os.getenv("LOGGER_LEVEL"))

TASKS_SYSTEM = """
Ты - AI-помощник по составлению задач. 
Твоя задача - по предоставленному сырому описанию задачи и прочего контекста переформулировать название и описание задачи.
Твой вывод должен быть строго структурирован в виде JSON. Ключи должны быть строго task_name и task_descrpition.
Пример:
{{
    "task_name": "...",
    "task_description": "...",
}}
"""

TASKS_PROMPT = """
Сырое описание задачи: {raw_description}.
Текущее название зачачи (если есть): {task_name}.
"""

def create_tasks_prompt_input_d(raw_description, task_name) -> dict:
    return {
        "raw_description": raw_description,
        "task_name": task_name,
    }