use async_trait::async_trait;
use chrono::{DateTime, Utc};
use sqlx::{postgres::PgPoolOptions, PgPool};
use uuid::Uuid;

use crate::{
    domain::{ChatMessage, ChatRoom},
    ports::ChatRepository,
};

pub struct PgChatRepository {
    pool: PgPool,
}

impl PgChatRepository {
    pub fn new(pool: PgPool) -> Self {
        Self { pool }
    }

    pub fn pool(&self) -> &PgPool {
        &self.pool
    }

    pub async fn connect(database_url: &str) -> Result<Self, sqlx::Error> {
        let pool = PgPoolOptions::new()
            .max_connections(10)
            .connect(database_url)
            .await?;

        Ok(Self::new(pool))
    }
}

#[derive(Debug, sqlx::FromRow)]
struct RoomRow {
    id: Uuid,
    title: Option<String>,
    created_by: Uuid,
    created_at: DateTime<Utc>,
    updated_at: DateTime<Utc>,
}

#[derive(Debug, sqlx::FromRow)]
struct MessageRow {
    id: Uuid,
    room_id: Uuid,
    sender_user_id: Uuid,
    body: String,
    created_at: DateTime<Utc>,
    updated_at: DateTime<Utc>,
    edited_at: Option<DateTime<Utc>>,
}

#[async_trait]
impl ChatRepository for PgChatRepository {
    async fn create_room(
        &self,
        room_id: Uuid,
        title: Option<String>,
        created_by: Uuid,
        participant_ids: &[Uuid],
    ) -> Result<ChatRoom, sqlx::Error> {
        let now = Utc::now();
        let mut tx = self.pool.begin().await?;

        sqlx::query(
            r#"
            INSERT INTO chat_rooms (id, title, created_by, created_at, updated_at)
            VALUES ($1, $2, $3, $4, $5)
            "#,
        )
        .bind(room_id)
        .bind(&title)
        .bind(created_by)
        .bind(now)
        .bind(now)
        .execute(&mut *tx)
        .await?;

        for &user_id in participant_ids {
            sqlx::query(
                r#"
                INSERT INTO chat_room_members (room_id, user_id, joined_at)
                VALUES ($1, $2, $3)
                ON CONFLICT (room_id, user_id) DO NOTHING
                "#,
            )
            .bind(room_id)
            .bind(user_id)
            .bind(now)
            .execute(&mut *tx)
            .await?;
        }

        tx.commit().await?;

        Ok(ChatRoom {
            id: room_id,
            title,
            created_by,
            created_at: now,
            updated_at: now,
        })
    }

    async fn list_rooms_for_user(
        &self,
        user_id: Uuid,
        limit: i64,
        offset: i64,
    ) -> Result<Vec<ChatRoom>, sqlx::Error> {
        let rows = sqlx::query_as::<_, RoomRow>(
            r#"
            SELECT r.id, r.title, r.created_by, r.created_at, r.updated_at
            FROM chat_rooms r
            INNER JOIN chat_room_members m ON m.room_id = r.id
            WHERE m.user_id = $1
            ORDER BY r.updated_at DESC, r.id DESC
            LIMIT $2 OFFSET $3
            "#,
        )
        .bind(user_id)
        .bind(limit)
        .bind(offset)
        .fetch_all(&self.pool)
        .await?;

        Ok(rows
            .into_iter()
            .map(|row| ChatRoom {
                id: row.id,
                title: row.title,
                created_by: row.created_by,
                created_at: row.created_at,
                updated_at: row.updated_at,
            })
            .collect())
    }

    async fn get_room_for_user(
        &self,
        room_id: Uuid,
        user_id: Uuid,
    ) -> Result<Option<ChatRoom>, sqlx::Error> {
        let row = sqlx::query_as::<_, RoomRow>(
            r#"
            SELECT r.id, r.title, r.created_by, r.created_at, r.updated_at
            FROM chat_rooms r
            INNER JOIN chat_room_members m ON m.room_id = r.id
            WHERE r.id = $1 AND m.user_id = $2
            LIMIT 1
            "#,
        )
        .bind(room_id)
        .bind(user_id)
        .fetch_optional(&self.pool)
        .await?;

        Ok(row.map(|row| ChatRoom {
            id: row.id,
            title: row.title,
            created_by: row.created_by,
            created_at: row.created_at,
            updated_at: row.updated_at,
        }))
    }

    async fn list_room_members(&self, room_id: Uuid) -> Result<Vec<Uuid>, sqlx::Error> {
        let rows = sqlx::query_as::<_, (Uuid,)>(
            r#"
            SELECT user_id
            FROM chat_room_members
            WHERE room_id = $1
            ORDER BY joined_at ASC
            "#,
        )
        .bind(room_id)
        .fetch_all(&self.pool)
        .await?;

        Ok(rows.into_iter().map(|(user_id,)| user_id).collect())
    }

    async fn add_room_members(
        &self,
        room_id: Uuid,
        participant_ids: &[Uuid],
    ) -> Result<(), sqlx::Error> {
        let now = Utc::now();
        let mut tx = self.pool.begin().await?;

        for &user_id in participant_ids {
            sqlx::query(
                r#"
                INSERT INTO chat_room_members (room_id, user_id, joined_at)
                VALUES ($1, $2, $3)
                ON CONFLICT (room_id, user_id) DO NOTHING
                "#,
            )
            .bind(room_id)
            .bind(user_id)
            .bind(now)
            .execute(&mut *tx)
            .await?;
        }

        sqlx::query(
            r#"
            UPDATE chat_rooms
            SET updated_at = $1
            WHERE id = $2
            "#,
        )
        .bind(now)
        .bind(room_id)
        .execute(&mut *tx)
        .await?;

        tx.commit().await?;
        Ok(())
    }

    async fn remove_room_member(&self, room_id: Uuid, user_id: Uuid) -> Result<bool, sqlx::Error> {
        let now = Utc::now();
        let mut tx = self.pool.begin().await?;

        let result = sqlx::query(
            r#"
            DELETE FROM chat_room_members
            WHERE room_id = $1 AND user_id = $2
            "#,
        )
        .bind(room_id)
        .bind(user_id)
        .execute(&mut *tx)
        .await?;

        if result.rows_affected() > 0 {
            sqlx::query(
                r#"
                UPDATE chat_rooms
                SET updated_at = $1
                WHERE id = $2
                "#,
            )
            .bind(now)
            .bind(room_id)
            .execute(&mut *tx)
            .await?;
        }

        tx.commit().await?;
        Ok(result.rows_affected() > 0)
    }

    async fn is_member(&self, room_id: Uuid, user_id: Uuid) -> Result<bool, sqlx::Error> {
        let row: (bool,) = sqlx::query_as(
            r#"
            SELECT EXISTS(
                SELECT 1
                FROM chat_room_members
                WHERE room_id = $1 AND user_id = $2
            )
            "#,
        )
        .bind(room_id)
        .bind(user_id)
        .fetch_one(&self.pool)
        .await?;

        Ok(row.0)
    }

    async fn create_message(
        &self,
        room_id: Uuid,
        sender_user_id: Uuid,
        body: String,
    ) -> Result<ChatMessage, sqlx::Error> {
        let now = Utc::now();
        let message_id = Uuid::new_v4();

        let mut tx = self.pool.begin().await?;

        sqlx::query(
            r#"
            INSERT INTO chat_messages
                (id, room_id, sender_user_id, body, created_at, updated_at)
            VALUES ($1, $2, $3, $4, $5, $6)
            "#,
        )
        .bind(message_id)
        .bind(room_id)
        .bind(sender_user_id)
        .bind(body.clone())
        .bind(now)
        .bind(now)
        .execute(&mut *tx)
        .await?;

        sqlx::query(
            r#"
            UPDATE chat_rooms
            SET updated_at = $1
            WHERE id = $2
            "#,
        )
        .bind(now)
        .bind(room_id)
        .execute(&mut *tx)
        .await?;

        tx.commit().await?;

        Ok(ChatMessage {
            id: message_id,
            room_id,
            sender_user_id,
            body,
            created_at: now,
            updated_at: now,
            edited_at: None,
        })
    }

    async fn list_messages(
        &self,
        room_id: Uuid,
        limit: i64,
        offset: i64,
    ) -> Result<Vec<ChatMessage>, sqlx::Error> {
        let rows = sqlx::query_as::<_, MessageRow>(
            r#"
            SELECT id, room_id, sender_user_id, body, created_at, updated_at, edited_at
            FROM chat_messages
            WHERE room_id = $1
            ORDER BY created_at ASC, id ASC
            LIMIT $2 OFFSET $3
            "#,
        )
        .bind(room_id)
        .bind(limit)
        .bind(offset)
        .fetch_all(&self.pool)
        .await?;

        Ok(rows
            .into_iter()
            .map(|row| ChatMessage {
                id: row.id,
                room_id: row.room_id,
                sender_user_id: row.sender_user_id,
                body: row.body,
                created_at: row.created_at,
                updated_at: row.updated_at,
                edited_at: row.edited_at,
            })
            .collect())
    }
}