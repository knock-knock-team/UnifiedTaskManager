from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession

from src.db.models import FileEnvironment, FileEnvironmentMember


class EnvironmentRepository:
    def __init__(self, session: AsyncSession) -> None:
        self.session = session

    async def create_environment(
        self,
        *,
        name: str,
        owner_user_id: str,
        team_id: str,
        project_id: str,
        root_path: str,
    ) -> FileEnvironment:
        env = FileEnvironment(
            name=name,
            owner_user_id=owner_user_id,
            team_id=team_id,
            project_id=project_id,
            root_path=root_path,
        )
        self.session.add(env)
        await self.session.flush()
        return env

    async def get_environment(self, environment_id: str) -> FileEnvironment | None:
        result = await self.session.execute(
            select(FileEnvironment).where(FileEnvironment.id == environment_id)
        )
        return result.scalar_one_or_none()

    async def get_environment_by_scope(self, team_id: str, project_id: str) -> FileEnvironment | None:
        result = await self.session.execute(
            select(FileEnvironment).where(
                FileEnvironment.team_id == team_id,
                FileEnvironment.project_id == project_id,
            )
        )
        return result.scalar_one_or_none()

    async def delete_environment(self, environment_id: str) -> None:
        await self.session.execute(
            delete(FileEnvironment).where(FileEnvironment.id == environment_id)
        )

    async def add_member(self, environment_id: str, user_id: str) -> None:
        exists = await self.session.execute(
            select(FileEnvironmentMember).where(
                FileEnvironmentMember.environment_id == environment_id,
                FileEnvironmentMember.user_id == user_id,
            )
        )
        if exists.scalar_one_or_none() is None:
            self.session.add(
                FileEnvironmentMember(environment_id=environment_id, user_id=user_id)
            )

    async def remove_member(self, environment_id: str, user_id: str) -> None:
        await self.session.execute(
            delete(FileEnvironmentMember).where(
                FileEnvironmentMember.environment_id == environment_id,
                FileEnvironmentMember.user_id == user_id,
            )
        )

    async def list_members(self, environment_id: str) -> list[str]:
        result = await self.session.execute(
            select(FileEnvironmentMember.user_id).where(
                FileEnvironmentMember.environment_id == environment_id
            )
        )
        return list(result.scalars().all())

    async def has_access(self, environment_id: str, user_id: str) -> bool:
        result = await self.session.execute(
            select(FileEnvironmentMember.id).where(
                FileEnvironmentMember.environment_id == environment_id,
                FileEnvironmentMember.user_id == user_id,
            )
        )
        return result.scalar_one_or_none() is not None

    async def list_team_environments(self, team_id: str) -> list[FileEnvironment]:
        result = await self.session.execute(
            select(FileEnvironment).where(FileEnvironment.team_id == team_id)
        )
        return list(result.scalars().all())
