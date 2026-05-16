use std::time::Duration;

#[derive(Debug, Clone, Default)]
pub struct PublishOptions {
    pub content_type: Option<String>,
    pub content_encoding: Option<String>,
    pub message_type: Option<String>,
    pub correlation_id: Option<String>,
    pub reply_to: Option<String>,
    pub persistent: bool,
}

#[derive(Debug, Clone, Copy)]
pub struct RequestTimeout(pub Duration);
