use thiserror::Error;

#[derive(Debug, Error)]
pub enum MqError {
    #[error("lapin error: {0}")]
    Lapin(#[from] lapin::Error),

    #[error("json error: {0}")]
    Json(#[from] serde_json::Error),

    #[error("request timed out")]
    Timeout,

    #[error("{0}")]
    Other(String),
}

pub type Result<T> = std::result::Result<T, MqError>;
