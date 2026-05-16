use axum::{
    extract::{Path, Query, State},
    http::{HeaderMap, HeaderValue, StatusCode},
    response::IntoResponse,
    routing::{get, post},
    Json, Router,
};
use serde::{Deserialize, Serialize};
use uuid::Uuid;
use validator::Validate;

use crate::{
    domain::{ChatMessage, ChatRoom, ChatRoomDetails},
    error::AppError,
    AppState,
};

pub fn router(state: AppState) -> Router {
    Router::new()
        .route("/health", get(health))
        .route("/v1/chats/rooms", post(create_room).get(list_rooms))
        .route("/v1/chats/rooms/:room_id", get(get_room))
        .route(
            "/v1/chats/rooms/:room_id/messages",
            post(send_message).get(list_messages),
        )
        .with_state(state)
}

async fn health() -> impl IntoResponse {
    (StatusCode::OK, Json(serde_json::json!({ "status": "ok" })))
}

fn current_user_id(headers: &HeaderMap) -> Result<Uuid, AppError> {
    let value: &HeaderValue = headers.get("x-user-id").ok_or(AppError::Unauthorized)?;
    let raw = value.to_str().map_err(|_| AppError::Unauthorized)?;
    Uuid::parse_str(raw).map_err(|_| AppError::Unauthorized)
}

#[derive(Debug, Deserialize, Validate)]
#[serde(rename_all = "camelCase")]
pub struct CreateRoomRequest {
    #[validate(length(min = 1, max = 120))]
    pub title: Option<String>,

    #[validate(length(min = 1))]
    pub participant_ids: Vec<Uuid>,
}

#[derive(Debug, Deserialize, Validate)]
#[serde(rename_all = "camelCase")]
pub struct SendMessageRequest {
    #[validate(length(min = 1, max = 4000))]
    pub body: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PagingQuery {
    pub limit: Option<u32>,
    pub offset: Option<u32>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RoomSummaryResponse {
    pub id: Uuid,
    pub title: Option<String>,
    pub created_by: Uuid,
    pub created_at: chrono::DateTime<chrono::Utc>,
    pub updated_at: chrono::DateTime<chrono::Utc>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RoomDetailsResponse {
    pub id: Uuid,
    pub title: Option<String>,
    pub created_by: Uuid,
    pub participant_ids: Vec<Uuid>,
    pub created_at: chrono::DateTime<chrono::Utc>,
    pub updated_at: chrono::DateTime<chrono::Utc>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MessageResponse {
    pub id: Uuid,
    pub room_id: Uuid,
    pub sender_user_id: Uuid,
    pub body: String,
    pub created_at: chrono::DateTime<chrono::Utc>,
    pub updated_at: chrono::DateTime<chrono::Utc>,
    pub edited_at: Option<chrono::DateTime<chrono::Utc>>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RoomListResponse {
    pub items: Vec<RoomSummaryResponse>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MessageListResponse {
    pub items: Vec<MessageResponse>,
}

impl From<ChatRoom> for RoomSummaryResponse {
    fn from(value: ChatRoom) -> Self {
        Self {
            id: value.id,
            title: value.title,
            created_by: value.created_by,
            created_at: value.created_at,
            updated_at: value.updated_at,
        }
    }
}

impl From<ChatMessage> for MessageResponse {
    fn from(value: ChatMessage) -> Self {
        Self {
            id: value.id,
            room_id: value.room_id,
            sender_user_id: value.sender_user_id,
            body: value.body,
            created_at: value.created_at,
            updated_at: value.updated_at,
            edited_at: value.edited_at,
        }
    }
}

impl From<ChatRoomDetails> for RoomDetailsResponse {
    fn from(value: ChatRoomDetails) -> Self {
        Self {
            id: value.room.id,
            title: value.room.title,
            created_by: value.room.created_by,
            participant_ids: value.participant_ids,
            created_at: value.room.created_at,
            updated_at: value.room.updated_at,
        }
    }
}

pub async fn create_room(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(payload): Json<CreateRoomRequest>,
) -> Result<(StatusCode, Json<RoomDetailsResponse>), AppError> {
    payload
        .validate()
        .map_err(|err| AppError::Validation(err.to_string()))?;

    let actor_id = current_user_id(&headers)?;
    let room = state
        .chat
        .create_room(actor_id, payload.title, payload.participant_ids)
        .await?;

    Ok((StatusCode::CREATED, Json(room.into())))
}

pub async fn list_rooms(
    State(state): State<AppState>,
    headers: HeaderMap,
    Query(query): Query<PagingQuery>,
) -> Result<Json<RoomListResponse>, AppError> {
    let actor_id = current_user_id(&headers)?;
    let limit = query.limit.unwrap_or(20).min(100) as i64;
    let offset = query.offset.unwrap_or(0) as i64;

    let items = state
        .chat
        .list_rooms(actor_id, limit, offset)
        .await?
        .into_iter()
        .map(Into::into)
        .collect();

    Ok(Json(RoomListResponse { items }))
}

pub async fn get_room(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(room_id): Path<Uuid>,
) -> Result<Json<RoomDetailsResponse>, AppError> {
    let actor_id = current_user_id(&headers)?;
    let room = state.chat.get_room(actor_id, room_id).await?;
    Ok(Json(room.into()))
}

pub async fn send_message(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(room_id): Path<Uuid>,
    Json(payload): Json<SendMessageRequest>,
) -> Result<(StatusCode, Json<MessageResponse>), AppError> {
    payload
        .validate()
        .map_err(|err| AppError::Validation(err.to_string()))?;

    let actor_id = current_user_id(&headers)?;
    let message = state
        .chat
        .send_message(actor_id, room_id, payload.body)
        .await?;

    Ok((StatusCode::CREATED, Json(message.into())))
}

pub async fn list_messages(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(room_id): Path<Uuid>,
    Query(query): Query<PagingQuery>,
) -> Result<Json<MessageListResponse>, AppError> {
    let actor_id = current_user_id(&headers)?;
    let limit = query.limit.unwrap_or(50).min(100) as i64;
    let offset = query.offset.unwrap_or(0) as i64;

    let items = state
        .chat
        .list_messages(actor_id, room_id, limit, offset)
        .await?
        .into_iter()
        .map(Into::into)
        .collect();

    Ok(Json(MessageListResponse { items }))
}