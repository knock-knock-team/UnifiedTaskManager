use async_trait::async_trait;
use uuid::Uuid;

use crate::domain::{ChatMessage, ChatRoom};

#[async_trait]
pub trait ChatRepository: Send + Sync {
    async fn create_room(
        &self,
        room_id: Uuid,
        title: Option<String>,
        created_by: Uuid,
        participant_ids: &[Uuid],
    ) -> Result<ChatRoom, sqlx::Error>;

    async fn list_rooms_for_user(
        &self,
        user_id: Uuid,
        limit: i64,
        offset: i64,
    ) -> Result<Vec<ChatRoom>, sqlx::Error>;

    async fn get_room_for_user(
        &self,
        room_id: Uuid,
        user_id: Uuid,
    ) -> Result<Option<ChatRoom>, sqlx::Error>;

    async fn list_room_members(&self, room_id: Uuid) -> Result<Vec<Uuid>, sqlx::Error>;

    async fn is_member(&self, room_id: Uuid, user_id: Uuid) -> Result<bool, sqlx::Error>;

    async fn create_message(
        &self,
        room_id: Uuid,
        sender_user_id: Uuid,
        body: String,
    ) -> Result<ChatMessage, sqlx::Error>;

    async fn list_messages(
        &self,
        room_id: Uuid,
        limit: i64,
        offset: i64,
    ) -> Result<Vec<ChatMessage>, sqlx::Error>;
}

#[async_trait]
pub trait EventPublisher: Send + Sync {
    async fn publish(
        &self,
        exchange: &str,
        routing_key: &str,
        payload: serde_json::Value,
    ) -> Result<(), String>;
}

#[async_trait]
pub trait UserDirectory: Send + Sync {
    async fn user_exists(&self, user_id: Uuid) -> Result<bool, String>;

}