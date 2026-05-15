use std::sync::Arc;

use chrono::Utc;
use serde_json::json;
use uuid::Uuid;

use crate::{
    domain::{ChatRoom, ChatRoomDetails, ChatMessage},
    error::AppError,
    ports::{ChatRepository, EventPublisher, UserDirectory},
};

pub struct ChatService {
    repo: Arc<dyn ChatRepository>,
    publisher: Arc<dyn EventPublisher>,
    users: Arc<dyn UserDirectory>,
    exchange: String,
}

impl ChatService {
    pub fn new(
        repo: Arc<dyn ChatRepository>,
        publisher: Arc<dyn EventPublisher>,
        users: Arc<dyn UserDirectory>,
        exchange: String,
    ) -> Self {
        Self {
            repo,
            publisher,
            users,
            exchange,
        }
    }

    pub async fn create_room(
        &self,
        actor_id: Uuid,
        title: Option<String>,
        mut participant_ids: Vec<Uuid>,
    ) -> Result<ChatRoomDetails, AppError> {
        participant_ids.push(actor_id);
        participant_ids.sort_unstable();
        participant_ids.dedup();

        if participant_ids.len() < 2 {
            return Err(AppError::Validation(
                "room must contain at least one other participant".to_string(),
            ));
        }

        for user_id in &participant_ids {
            let exists = self
                .users
                .user_exists(*user_id)
                .await
                .map_err(AppError::Directory)?;

            if !exists {
                return Err(AppError::NotFound);
            }
        }

        let room_id = Uuid::new_v4();
        let room = self
            .repo
            .create_room(room_id, title, actor_id, &participant_ids)
            .await?;

        let payload = json!({
            "roomId": room.id,
            "createdBy": actor_id,
            "participantIds": participant_ids,
            "createdAt": room.created_at,
        });

        self.publisher
            .publish(&self.exchange, "chat.room.created", payload)
            .await
            .map_err(AppError::Broker)?;

        Ok(ChatRoomDetails {
            room,
            participant_ids,
        })
    }

    pub async fn list_rooms(
        &self,
        actor_id: Uuid,
        limit: i64,
        offset: i64,
    ) -> Result<Vec<ChatRoom>, AppError> {
        self.repo
            .list_rooms_for_user(actor_id, limit, offset)
            .await
            .map_err(AppError::Db)
    }

    pub async fn get_room(
        &self,
        actor_id: Uuid,
        room_id: Uuid,
    ) -> Result<ChatRoomDetails, AppError> {
        let room = self
            .repo
            .get_room_for_user(room_id, actor_id)
            .await
            .map_err(AppError::Db)?
            .ok_or(AppError::NotFound)?;

        let participant_ids = self
            .repo
            .list_room_members(room_id)
            .await
            .map_err(AppError::Db)?;

        Ok(ChatRoomDetails {
            room,
            participant_ids,
        })
    }

    pub async fn send_message(
        &self,
        actor_id: Uuid,
        room_id: Uuid,
        body: String,
    ) -> Result<ChatMessage, AppError> {
        let is_member = self
            .repo
            .is_member(room_id, actor_id)
            .await
            .map_err(AppError::Db)?;

        if !is_member {
            return Err(AppError::NotFound);
        }

        let message = self
            .repo
            .create_message(room_id, actor_id, body)
            .await
            .map_err(AppError::Db)?;

        let payload = json!({
            "messageId": message.id,
            "roomId": message.room_id,
            "senderUserId": message.sender_user_id,
            "body": message.body,
            "createdAt": message.created_at,
        });

        self.publisher
            .publish(&self.exchange, "chat.message.created", payload)
            .await
            .map_err(AppError::Broker)?;

        Ok(message)
    }

    pub async fn list_messages(
        &self,
        actor_id: Uuid,
        room_id: Uuid,
        limit: i64,
        offset: i64,
    ) -> Result<Vec<ChatMessage>, AppError> {
        let is_member = self
            .repo
            .is_member(room_id, actor_id)
            .await
            .map_err(AppError::Db)?;

        if !is_member {
            return Err(AppError::NotFound);
        }

        self.repo
            .list_messages(room_id, limit, offset)
            .await
            .map_err(AppError::Db)
    }
}