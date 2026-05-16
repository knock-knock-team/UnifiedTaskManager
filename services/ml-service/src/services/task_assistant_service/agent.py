import os

from langchain_core.prompts import ChatPromptTemplate

from .prompts import TASKS_SYSTEM, TASKS_PROMPT, create_tasks_prompt_input_d

from ..llm import create_gigachat, DEFAULT_GIGACHAT_PARAMS

from ...schemas import (
    TaskNameDescriptionGenerationRequest,
    TaskNameDescriptionGenerationResponse
)

from libs.log_py import LoggerFactory
from libs.json_py import safe_parse_json


logger = LoggerFactory.get_logger("TaskAssistantService", level=os.getenv("LOGGER_LEVEL"))


class TaskAssistantService:
    def __init__(self):
        self.params = {
            "credentials": os.getenv("SBER_AUTH"),
            **DEFAULT_GIGACHAT_PARAMS
        }
        self.runnable = create_gigachat(**self.params)
    
    async def process(
        self,
        request: TaskNameDescriptionGenerationRequest
    ) -> TaskNameDescriptionGenerationResponse:
        prompt = ChatPromptTemplate.from_messages([
            ("system", TASKS_SYSTEM),
            ("human", TASKS_PROMPT)
        ])
        chain = prompt | self.runnable
        input_d = create_tasks_prompt_input_d(
            raw_description=request.raw_task_description, 
            task_name=request.current_task_name or "",
        )
        response = await chain.ainvoke(input_d)
        response_d = safe_parse_json(response.content)
        return TaskNameDescriptionGenerationResponse(
            request_id=request.request_id,
            raw_task_description=request.raw_task_description,
            task_name=response_d.get("task_name", ""),
            task_description=response_d.get("task_description", "")
        )