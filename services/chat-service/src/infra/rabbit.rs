use std::time::Duration;

use async_trait::async_trait;
use mq_rust::{MqClient, MqError, PublishOptions};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use uuid::Uuid;

use crate::ports::{EventPublisher, UserDirectory};

pub const USER_EXISTS_QUEUE: &str = "user-service.user-exists";

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
struct UserExistsRequest {
    user_id: Uuid,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
struct UserExistsResponse {
    exists: bool,
}

#[derive(Clone)]
pub struct RabbitPublisher {
    mq: MqClient,
}

impl RabbitPublisher {
    pub fn new(mq: MqClient) -> Self {
        Self { mq }
    }
}

#[async_trait]
impl EventPublisher for RabbitPublisher {
    async fn publish(
        &self,
        exchange: &str,
        routing_key: &str,
        payload: Value,
    ) -> Result<(), String> {
        let channel = self
            .mq
            .channel()
            .await
            .map_err(|e| e.to_string())?;

        self.mq
            .publish_json(
                &channel,
                exchange,
                routing_key,
                &payload,
                PublishOptions {
                    content_type: Some("application/json".to_string()),
                    persistent: false,
                    ..Default::default()
                },
            )
            .await
            .map_err(|e| e.to_string())
    }
}

#[derive(Clone)]
pub struct RabbitUserDirectory {
    mq: MqClient,
    queue: String,
    timeout: Duration,
}

impl RabbitUserDirectory {
    pub fn new(mq: MqClient, queue: impl Into<String>, timeout: Duration) -> Self {
        Self {
            mq,
            queue: queue.into(),
            timeout,
        }
    }
}

#[async_trait]
impl UserDirectory for RabbitUserDirectory {
    async fn user_exists(&self, user_id: Uuid) -> Result<bool, String> {
        let channel = self
            .mq
            .channel()
            .await
            .map_err(|e| e.to_string())?;

        let request = UserExistsRequest { user_id };

        let future = self
            .mq
            .request_json::<UserExistsRequest, UserExistsResponse>(
                &channel,
                &self.queue,
                &request,
                None,
            );

        let response = tokio::time::timeout(self.timeout, future)
            .await
            .map_err(|_| MqError::Timeout.to_string())?
            .map_err(|e| e.to_string())?;

        Ok(response.exists)
    }
}