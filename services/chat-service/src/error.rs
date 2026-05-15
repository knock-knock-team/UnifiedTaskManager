use axum::{
    http::StatusCode,
    response::{IntoResponse, Response},
    Json,
};
use serde::Serialize;
use serde_json::json;
use thiserror::Error;

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ApiErrorResponse {
    pub code: String,
    pub message: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub details: Option<serde_json::Value>,
}

#[derive(Debug, Error)]
pub enum AppError {
    #[error("unauthorized")]
    Unauthorized,

    #[error("forbidden")]
    Forbidden,

    #[error("not found")]
    NotFound,

    #[error("validation failed: {0}")]
    Validation(String),

    #[error("database error: {0}")]
    Db(#[from] sqlx::Error),

    #[error("broker error: {0}")]
    Broker(String),

    #[error("user directory error: {0}")]
    Directory(String),

    #[error("serialization error: {0}")]
    Serialization(#[from] serde_json::Error),
}

impl IntoResponse for AppError {
    fn into_response(self) -> Response {
        let (status, code, message, details) = match self {
            AppError::Unauthorized => (
                StatusCode::UNAUTHORIZED,
                "UNAUTHORIZED",
                "Authentication required",
                None,
            ),
            AppError::Forbidden => (
                StatusCode::FORBIDDEN,
                "FORBIDDEN",
                "Not enough permissions",
                None,
            ),
            AppError::NotFound => (
                StatusCode::NOT_FOUND,
                "NOT_FOUND",
                "Resource not found",
                None,
            ),
            AppError::Validation(msg) => (
                StatusCode::BAD_REQUEST,
                "VALIDATION_ERROR",
                "Validation failed",
                Some(json!({ "error": msg })),
            ),
            AppError::Db(err) => (
                StatusCode::INTERNAL_SERVER_ERROR,
                "DATABASE_ERROR",
                "Database error",
                Some(json!({ "error": err.to_string() })),
            ),
            AppError::Broker(err) => (
                StatusCode::BAD_GATEWAY,
                "BROKER_ERROR",
                "Broker error",
                Some(json!({ "error": err })),
            ),
            AppError::Directory(err) => (
                StatusCode::BAD_GATEWAY,
                "USER_DIRECTORY_ERROR",
                "User directory error",
                Some(json!({ "error": err })),
            ),
            AppError::Serialization(err) => (
                StatusCode::INTERNAL_SERVER_ERROR,
                "SERIALIZATION_ERROR",
                "Serialization error",
                Some(json!({ "error": err.to_string() })),
            ),
        };

        let body = ApiErrorResponse {
            code: code.to_string(),
            message: message.to_string(),
            details,
        };

        (status, Json(body)).into_response()
    }
}