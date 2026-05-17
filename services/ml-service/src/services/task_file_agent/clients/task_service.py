from typing import Any

from ..schemas import ExecutionContext, TaskColumnRecord, TaskRecord
from .mq_transport import MqRpcTransport


def _compact_dict(payload: dict[str, Any]) -> dict[str, Any]:
    return {key: value for key, value in payload.items() if value is not None}


class TaskServiceClient:
    def __init__(self, transport: MqRpcTransport, queue_name: str) -> None:
        self.transport = transport
        self.queue_name = queue_name

    async def list_columns(self, context: ExecutionContext) -> list[TaskColumnRecord]:
        response = await self.transport.request(
            service_name="task_service",
            queue_name=self.queue_name,
            operation="list_task_columns",
            context=context,
        )
        return [TaskColumnRecord.model_validate(item) for item in response.data.get("columns", [])]

    async def create_column(self, context: ExecutionContext, *, title: str) -> TaskColumnRecord:
        response = await self.transport.request(
            service_name="task_service",
            queue_name=self.queue_name,
            operation="create_task_column",
            context=context,
            payload={"title": title},
        )
        return TaskColumnRecord.model_validate(response.data.get("column", {}))

    async def update_column(self, context: ExecutionContext, *, column_id: str, title: str) -> TaskColumnRecord:
        response = await self.transport.request(
            service_name="task_service",
            queue_name=self.queue_name,
            operation="update_task_column",
            context=context,
            payload={"column_id": column_id, "title": title},
        )
        return TaskColumnRecord.model_validate(response.data.get("column", {}))

    async def delete_column(self, context: ExecutionContext, *, column_id: str) -> None:
        await self.transport.request(
            service_name="task_service",
            queue_name=self.queue_name,
            operation="delete_task_column",
            context=context,
            payload={"column_id": column_id},
        )

    async def list_tasks(
        self,
        context: ExecutionContext,
        *,
        search: str | None = None,
        limit: int = 50,
        offset: int = 0,
    ) -> list[TaskRecord]:
        response = await self.transport.request(
            service_name="task_service",
            queue_name=self.queue_name,
            operation="list_tasks",
            context=context,
            payload=_compact_dict({"search": search, "limit": limit, "offset": offset}),
        )
        return [TaskRecord.model_validate(item) for item in response.data.get("tasks", [])]

    async def get_task(self, context: ExecutionContext, *, task_id: str) -> TaskRecord:
        response = await self.transport.request(
            service_name="task_service",
            queue_name=self.queue_name,
            operation="get_task_details",
            context=context,
            payload={"task_id": task_id},
        )
        return TaskRecord.model_validate(response.data.get("task", {}))

    async def create_task(
        self,
        context: ExecutionContext,
        *,
        title: str,
        description: str | None = None,
        status: str | None = None,
        column_id: str | None = None,
        column_title: str | None = None,
        priority: str | None = None,
        due_at: str | None = None,
        assignee_user_id: str | None = None,
        assignee_name: str | None = None,
    ) -> TaskRecord:
        resolved_status = (column_id or status or "").strip() or None
        if not resolved_status and column_title:
            normalized_title = column_title.strip().casefold()
            columns = await self.list_columns(context)
            matched = next((column for column in columns if column.title.strip().casefold() == normalized_title), None)
            if matched is not None:
                resolved_status = matched.id
        response = await self.transport.request(
            service_name="task_service",
            queue_name=self.queue_name,
            operation="create_task",
            context=context,
            payload=_compact_dict(
                {
                    "title": title,
                    "description": description,
                    "status": resolved_status,
                    "priority": priority,
                    "dueAt": due_at,
                    "assigneeUserId": assignee_user_id,
                    "assigneeName": assignee_name,
                }
            ),
        )
        return TaskRecord.model_validate(response.data.get("task", {}))

    async def update_task(
        self,
        context: ExecutionContext,
        *,
        task_id: str,
        title: str | None = None,
        description: str | None = None,
        status: str | None = None,
        priority: str | None = None,
        due_at: str | None = None,
        assignee_user_id: str | None = None,
        assignee_name: str | None = None,
        completed: bool | None = None,
    ) -> TaskRecord:
        response = await self.transport.request(
            service_name="task_service",
            queue_name=self.queue_name,
            operation="update_task",
            context=context,
            payload=_compact_dict(
                {
                    "task_id": task_id,
                    "title": title,
                    "description": description,
                    "status": status,
                    "priority": priority,
                    "dueAt": due_at,
                    "assigneeUserId": assignee_user_id,
                    "assigneeName": assignee_name,
                    "completed": completed,
                }
            ),
        )
        return TaskRecord.model_validate(response.data.get("task", {}))

    async def delete_task(self, context: ExecutionContext, *, task_id: str) -> None:
        await self.transport.request(
            service_name="task_service",
            queue_name=self.queue_name,
            operation="delete_task",
            context=context,
            payload={"task_id": task_id},
        )
