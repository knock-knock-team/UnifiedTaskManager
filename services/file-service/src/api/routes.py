import logging
import mimetypes
from pathlib import PurePosixPath

from fastapi import APIRouter, Depends, File, Query, UploadFile
from fastapi.responses import FileResponse
from sqlalchemy.ext.asyncio import AsyncSession

from src.api.deps import get_current_user_id
from src.api.schemas import (
    AddMembersRequest,
    CreateFolderRequest,
    DeleteEntryRequest,
    EnsureEnvironmentRequest,
    EnvironmentResponse,
    RemoveMembersRequest,
    RenameEntryRequest,
)
import src.core.state as state
from src.db.database import get_db_session
from src.services.storage_service import StorageService

router = APIRouter(prefix="/v1/file-environments", tags=["file-environments"])
logger = logging.getLogger("file-service.audit")


def path_meta(path: str | None) -> dict[str, object]:
    value = (path or "").strip()
    if not value or value == ".":
        return {"path_depth": 0, "file_ext": ""}
    normalized = PurePosixPath(value.replace("\\", "/"))
    parts = [part for part in normalized.parts if part not in ("", ".")]
    return {"path_depth": len(parts), "file_ext": normalized.suffix[:24]}


def audit(event_type: str, actor_user_id: str, team_id: str, project_id: str, **extra):
    logger.info(
        "audit_event",
        extra={
            "event_type": event_type,
            "actor_user_id": actor_user_id,
            "team_id": team_id,
            "project_id": project_id,
            **extra,
        },
    )


def get_storage_service(
    session: AsyncSession = Depends(get_db_session),
):
    return StorageService(session=session, mq_client=state.mq_client)


@router.post("/ensure", response_model=EnvironmentResponse)
async def ensure_environment(
    payload: EnsureEnvironmentRequest,
    actor_user_id: str = Depends(get_current_user_id),
    service: StorageService = Depends(get_storage_service),
):
    environment = await service.ensure_environment(payload.team_id, payload.project_id, actor_user_id)
    audit("file_environment_ensured", actor_user_id, payload.team_id, payload.project_id)
    return environment


@router.post("/members")
async def add_members(
    payload: AddMembersRequest,
    actor_user_id: str = Depends(get_current_user_id),
    service: StorageService = Depends(get_storage_service),
):
    members = await service.add_members(payload.team_id, payload.project_id, actor_user_id, payload.user_ids)
    audit("file_environment_members_added", actor_user_id, payload.team_id, payload.project_id, member_count=len(payload.user_ids))
    return {"members": members}


@router.delete("/members")
async def remove_members(
    payload: RemoveMembersRequest,
    actor_user_id: str = Depends(get_current_user_id),
    service: StorageService = Depends(get_storage_service),
):
    members = await service.remove_members(payload.team_id, payload.project_id, actor_user_id, payload.user_ids)
    audit("file_environment_members_removed", actor_user_id, payload.team_id, payload.project_id, member_count=len(payload.user_ids))
    return {"members": members}


@router.post("/folders")
async def create_folder(
    payload: CreateFolderRequest,
    actor_user_id: str = Depends(get_current_user_id),
    service: StorageService = Depends(get_storage_service),
):
    await service.create_folder(payload.team_id, payload.project_id, actor_user_id, payload.path)
    audit("file_folder_created", actor_user_id, payload.team_id, payload.project_id, **path_meta(payload.path))
    return {"status": "ok"}


@router.post("/files")
async def upload_file(
    team_id: str = Query(...),
    project_id: str = Query(...),
    directory: str = Query(default="."),
    file: UploadFile = File(...),
    actor_user_id: str = Depends(get_current_user_id),
    service: StorageService = Depends(get_storage_service),
):
    stored_path = await service.upload_file(team_id, project_id, actor_user_id, directory, file)
    audit(
        "file_uploaded",
        actor_user_id,
        team_id,
        project_id,
        content_type=(file.content_type or "")[:80],
        **path_meta(stored_path),
    )
    return {"path": stored_path}


@router.delete("/entries")
async def delete_entry(
    payload: DeleteEntryRequest,
    actor_user_id: str = Depends(get_current_user_id),
    service: StorageService = Depends(get_storage_service),
):
    await service.delete_entry(payload.team_id, payload.project_id, actor_user_id, payload.path)
    audit("file_entry_deleted", actor_user_id, payload.team_id, payload.project_id, **path_meta(payload.path))
    return {"status": "ok"}


@router.patch("/entries/rename")
async def rename_entry(
    payload: RenameEntryRequest,
    actor_user_id: str = Depends(get_current_user_id),
    service: StorageService = Depends(get_storage_service),
):
    await service.rename_entry(payload.team_id, payload.project_id, actor_user_id, payload.old_path, payload.new_path)
    audit(
        "file_entry_renamed",
        actor_user_id,
        payload.team_id,
        payload.project_id,
        old_path_depth=path_meta(payload.old_path)["path_depth"],
        new_path_depth=path_meta(payload.new_path)["path_depth"],
        new_file_ext=path_meta(payload.new_path)["file_ext"],
    )
    return {"status": "ok"}


@router.get("/files/download")
async def download_file(
    team_id: str = Query(...),
    project_id: str = Query(...),
    path: str = Query(...),
    actor_user_id: str = Depends(get_current_user_id),
    service: StorageService = Depends(get_storage_service),
):
    file_path = await service.get_file_for_download(team_id, project_id, actor_user_id, path)
    audit("file_downloaded", actor_user_id, team_id, project_id, **path_meta(path))
    return FileResponse(file_path, media_type="application/octet-stream", filename=file_path.name)


@router.get("/files/view")
async def view_file(
    team_id: str = Query(...),
    project_id: str = Query(...),
    path: str = Query(...),
    actor_user_id: str = Depends(get_current_user_id),
    service: StorageService = Depends(get_storage_service),
):
    file_path = await service.get_file_for_download(team_id, project_id, actor_user_id, path)
    media_type, _ = mimetypes.guess_type(str(file_path))
    audit("file_viewed", actor_user_id, team_id, project_id, media_type=(media_type or "")[:80], **path_meta(path))
    return FileResponse(file_path, media_type=media_type or "application/octet-stream", filename=file_path.name)


@router.get("/entries")
async def list_entries(
    team_id: str = Query(...),
    project_id: str = Query(...),
    directory: str = Query(default="."),
    actor_user_id: str = Depends(get_current_user_id),
    service: StorageService = Depends(get_storage_service),
):
    items = await service.list_entries(team_id, project_id, actor_user_id, directory)
    return {"items": items}
