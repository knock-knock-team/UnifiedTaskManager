import json
import logging
import os
import shutil
from datetime import datetime, timezone
from pathlib import Path
from uuid import uuid4

from fastapi import HTTPException, UploadFile, status
from sqlalchemy.ext.asyncio import AsyncSession

from src.core.config import settings
from src.db.repository import EnvironmentRepository
from src.mq.client import MqClient
from src.mq.schemas import FileDeletedEvent, TaskAttachmentRecord, UserExistsRequest, UserExistsResponse

logger = logging.getLogger("file-service.storage")
TEAM_QUOTA_BYTES = 100 * 1024 * 1024
ATTACHMENTS_ROOT = ".assistant/task-attachments"


class StorageService:
    def __init__(self, session: AsyncSession, mq_client: MqClient | None) -> None:
        self.session = session
        self.repo = EnvironmentRepository(session)
        self.mq_client = mq_client
        self.storage_root = Path(settings.file_service_storage_root).resolve()
        self.storage_root.mkdir(parents=True, exist_ok=True)

    async def ensure_environment(self, team_id: str, project_id: str, actor_user_id: str) -> dict:
        team_id = team_id.strip()
        project_id = project_id.strip()
        if not team_id or not project_id:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="team_id and project_id are required")
        env = await self.repo.get_environment_by_scope(team_id, project_id)
        if env is None:
            env = await self.repo.create_environment(
                name=f"Team {team_id} Project {project_id}",
                owner_user_id=actor_user_id,
                team_id=team_id,
                project_id=project_id,
                root_path=str(self.storage_root / f"team-{team_id}" / f"project-{project_id}"),
            )
            Path(env.root_path).mkdir(parents=True, exist_ok=True)
            await self.repo.add_member(env.id, actor_user_id)
            await self.session.commit()
            logger.info("scoped environment auto-created", extra={"environment_id": env.id, "team_id": team_id, "project_id": project_id})
        else:
            if not await self.repo.has_access(env.id, actor_user_id):
                await self.repo.add_member(env.id, actor_user_id)
                await self.session.commit()
        return await self._as_response(env.id)

    async def add_members(self, team_id: str, project_id: str, actor_user_id: str, user_ids: list[str]) -> list[str]:
        env = await self._ensure_access_scoped(team_id, project_id, actor_user_id)
        _ = env
        for user_id in user_ids:
            normalized = user_id.strip()
            if not normalized:
                continue
            await self._assert_user_exists(normalized)
            await self.repo.add_member(env.id, normalized)
        await self.session.commit()
        return await self.repo.list_members(env.id)

    async def remove_members(self, team_id: str, project_id: str, actor_user_id: str, user_ids: list[str]) -> list[str]:
        env = await self._ensure_access_scoped(team_id, project_id, actor_user_id)
        _ = env
        for user_id in user_ids:
            normalized = user_id.strip()
            if normalized:
                await self.repo.remove_member(env.id, normalized)
        await self.session.commit()
        return await self.repo.list_members(env.id)

    async def delete_environment(self, environment_id: str, actor_user_id: str) -> None:
        env = await self._ensure_access(environment_id, actor_user_id)
        env_root = Path(env.root_path)
        if env_root.exists():
            shutil.rmtree(env_root)
        await self.repo.delete_environment(environment_id)
        await self.session.commit()
        logger.info("environment deleted", extra={"environment_id": environment_id, "actor_user_id": actor_user_id})

    async def create_folder(self, team_id: str, project_id: str, actor_user_id: str, path: str) -> None:
        env = await self._ensure_access_scoped(team_id, project_id, actor_user_id)
        target = self._safe_path(env.root_path, path)
        target.mkdir(parents=True, exist_ok=True)

    async def upload_file(self, team_id: str, project_id: str, actor_user_id: str, directory: str, upload: UploadFile) -> str:
        env = await self._ensure_access_scoped(team_id, project_id, actor_user_id)
        base = self._safe_path(env.root_path, directory or ".")
        base.mkdir(parents=True, exist_ok=True)
        filename = os.path.basename(upload.filename or "uploaded.bin")
        target = self._safe_path(str(base), filename)
        data = await upload.read()
        await self._assert_team_quota(team_id, len(data))
        target.write_bytes(data)
        return str(target.relative_to(Path(env.root_path)))

    async def delete_entry(self, team_id: str, project_id: str, actor_user_id: str, path: str) -> None:
        env = await self._ensure_access_scoped(team_id, project_id, actor_user_id)
        target = self._safe_path(env.root_path, path)
        if target.is_file():
            target.unlink()
            await self._publish_file_deleted(env.id, actor_user_id, path)
            return
        if target.is_dir():
            shutil.rmtree(target)
            return
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Entry not found")

    async def rename_entry(self, team_id: str, project_id: str, actor_user_id: str, old_path: str, new_path: str) -> None:
        env = await self._ensure_access_scoped(team_id, project_id, actor_user_id)
        source = self._safe_path(env.root_path, old_path)
        destination = self._safe_path(env.root_path, new_path)
        if not source.exists():
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Entry not found")
        destination.parent.mkdir(parents=True, exist_ok=True)
        source.rename(destination)

    async def get_file_for_download(self, team_id: str, project_id: str, actor_user_id: str, path: str) -> Path:
        env = await self._ensure_access_scoped(team_id, project_id, actor_user_id)
        target = self._safe_path(env.root_path, path)
        if not target.is_file():
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="File not found")
        return target

    async def list_entries(self, team_id: str, project_id: str, actor_user_id: str, directory: str = ".") -> list[dict]:
        env = await self._ensure_access_scoped(team_id, project_id, actor_user_id)
        base = self._safe_path(env.root_path, directory or ".")
        if not base.exists():
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Directory not found")
        if not base.is_dir():
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Path is not a directory")

        items: list[dict] = []
        for child in sorted(base.iterdir(), key=lambda item: (item.is_file(), item.name.lower())):
            rel = str(child.relative_to(Path(env.root_path)))
            items.append(
                {
                    "name": child.name,
                    "path": rel,
                    "kind": "file" if child.is_file() else "directory",
                    "size_bytes": child.stat().st_size if child.is_file() else 0,
                }
            )
        return items

    async def attach_file_to_task(
        self,
        team_id: str,
        project_id: str,
        actor_user_id: str,
        task_id: str,
        file_path: str,
        display_name: str | None = None,
    ) -> dict:
        env = await self._ensure_access_scoped(team_id, project_id, actor_user_id)
        target = self._safe_path(env.root_path, file_path)
        if not target.is_file():
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="File not found")
        attachments = self._load_task_attachments(env.root_path, task_id)
        normalized_path = str(target.relative_to(Path(env.root_path)))
        for item in attachments:
            if item.file_path == normalized_path:
                return item.model_dump(mode="json")
        attachment = TaskAttachmentRecord(
            attachment_id=str(uuid4()),
            task_id=task_id.strip(),
            file_path=normalized_path,
            file_name=(display_name or target.name).strip() or target.name,
            attached_at=datetime.now(timezone.utc).isoformat(),
        )
        attachments.append(attachment)
        self._save_task_attachments(env.root_path, task_id, attachments)
        return attachment.model_dump(mode="json")

    async def detach_file_from_task(
        self,
        team_id: str,
        project_id: str,
        actor_user_id: str,
        task_id: str,
        attachment_id: str | None = None,
        file_path: str | None = None,
    ) -> list[dict]:
        env = await self._ensure_access_scoped(team_id, project_id, actor_user_id)
        attachments = self._load_task_attachments(env.root_path, task_id)
        filtered = [
            item
            for item in attachments
            if item.attachment_id != (attachment_id or "").strip()
            and item.file_path != (file_path or "").strip()
        ]
        if len(filtered) == len(attachments):
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Attachment not found")
        self._save_task_attachments(env.root_path, task_id, filtered)
        return [item.model_dump(mode="json") for item in filtered]

    async def list_task_attachments(
        self,
        team_id: str,
        project_id: str,
        actor_user_id: str,
        task_id: str,
    ) -> list[dict]:
        env = await self._ensure_access_scoped(team_id, project_id, actor_user_id)
        return [item.model_dump(mode="json") for item in self._load_task_attachments(env.root_path, task_id)]

    async def _assert_user_exists(self, user_id: str) -> None:
        if not settings.file_service_rabbitmq_enabled or self.mq_client is None:
            return
        channel = await self.mq_client.channel()
        try:
            await channel.declare_queue(settings.file_service_user_exists_queue, durable=True)
            response_payload = await self.mq_client.request_json(
                channel=channel,
                queue_name=settings.file_service_user_exists_queue,
                request_payload=UserExistsRequest(user_id=user_id).model_dump(),
                timeout_seconds=settings.file_service_rpc_timeout_seconds,
            )
            response = UserExistsResponse.model_validate(response_payload)
            if not response.exists:
                raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=f"User {user_id} does not exist")
        finally:
            await channel.close()

    async def _publish_file_deleted(self, environment_id: str, actor_user_id: str, deleted_path: str) -> None:
        if not settings.file_service_rabbitmq_enabled or self.mq_client is None:
            return
        channel = await self.mq_client.channel()
        try:
            await channel.declare_queue(settings.file_service_deleted_file_queue, durable=True)
            await self.mq_client.publish_json(
                channel=channel,
                queue_name=settings.file_service_deleted_file_queue,
                payload=FileDeletedEvent(
                    environment_id=environment_id,
                    deleted_path=deleted_path,
                    actor_user_id=actor_user_id,
                ).model_dump(),
            )
        finally:
            await channel.close()

    async def _ensure_access(self, environment_id: str, actor_user_id: str):
        env = await self.repo.get_environment(environment_id)
        if env is None:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Environment not found")
        has_access = await self.repo.has_access(environment_id, actor_user_id)
        if not has_access:
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Forbidden")
        return env

    async def _ensure_access_scoped(self, team_id: str, project_id: str, actor_user_id: str):
        env = await self.repo.get_environment_by_scope(team_id.strip(), project_id.strip())
        if env is None:
            ensured = await self.ensure_environment(team_id, project_id, actor_user_id)
            env = await self.repo.get_environment(ensured["id"])
        if env is None:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Environment not found")
        has_access = await self.repo.has_access(env.id, actor_user_id)
        if not has_access:
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Forbidden")
        return env

    async def _as_response(self, environment_id: str) -> dict:
        env = await self.repo.get_environment(environment_id)
        if env is None:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Environment not found")
        members = await self.repo.list_members(environment_id)
        return {
            "id": env.id,
            "name": env.name,
            "owner_user_id": env.owner_user_id,
            "team_id": env.team_id,
            "project_id": env.project_id,
            "member_user_ids": sorted(members),
        }

    async def _assert_team_quota(self, team_id: str, incoming_bytes: int) -> None:
        total = 0
        for env in await self.repo.list_team_environments(team_id):
            total += self._directory_size(Path(env.root_path))
        if total + max(incoming_bytes, 0) > TEAM_QUOTA_BYTES:
            raise HTTPException(
                status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
                detail="Team storage quota exceeded (100MB)",
            )

    def _directory_size(self, root: Path) -> int:
        if not root.exists():
            return 0
        total = 0
        for current_root, _, files in os.walk(root):
            for filename in files:
                file_path = Path(current_root) / filename
                try:
                    total += file_path.stat().st_size
                except FileNotFoundError:
                    continue
        return total

    def _safe_path(self, root: str, relative_path: str) -> Path:
        root_path = Path(root).resolve()
        normalized = (relative_path or "").strip().lstrip("/")
        target = (root_path / normalized).resolve()
        if target != root_path and root_path not in target.parents:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid path")
        return target

    def _attachments_manifest_path(self, root: str, task_id: str) -> Path:
        return self._safe_path(root, f"{ATTACHMENTS_ROOT}/{task_id.strip()}.json")

    def _load_task_attachments(self, root: str, task_id: str) -> list[TaskAttachmentRecord]:
        manifest_path = self._attachments_manifest_path(root, task_id)
        if not manifest_path.exists():
            return []
        try:
            payload = json.loads(manifest_path.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError):
            return []
        items = payload.get("attachments", []) if isinstance(payload, dict) else []
        return [TaskAttachmentRecord.model_validate(item) for item in items]

    def _save_task_attachments(self, root: str, task_id: str, attachments: list[TaskAttachmentRecord]) -> None:
        manifest_path = self._attachments_manifest_path(root, task_id)
        if not attachments:
            if manifest_path.exists():
                manifest_path.unlink()
            return
        manifest_path.parent.mkdir(parents=True, exist_ok=True)
        payload = {
            "task_id": task_id.strip(),
            "attachments": [item.model_dump(mode="json") for item in attachments],
        }
        manifest_path.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
