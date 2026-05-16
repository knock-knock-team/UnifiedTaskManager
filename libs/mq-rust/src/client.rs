use std::{sync::{Arc, atomic::{AtomicU64, Ordering}}, time::Duration};

use futures_util::StreamExt;
use lapin::{
    BasicProperties, Channel, Connection, ConnectionProperties, Queue, message::Delivery, options::*, types::FieldTable
};
use serde::{de::DeserializeOwned, Serialize};

use crate::error::MqError;

use crate::{decode_json, encode_json, types::PublishOptions, Result};

static SEQ: AtomicU64 = AtomicU64::new(1);

fn next_id(prefix: &str) -> String {
    let n = SEQ.fetch_add(1, Ordering::Relaxed);
    let ts = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or(Duration::from_secs(0))
        .as_nanos();
    format!("{prefix}-{ts}-{n}")
}

fn apply_publish_options(mut props: BasicProperties, opts: &PublishOptions) -> BasicProperties {
    props = props.with_content_type(
        opts.content_type
            .clone()
            .unwrap_or_else(|| "application/json".to_string())
            .into(),
    );

    if let Some(v) = &opts.content_encoding {
        props = props.with_content_encoding(v.clone().into());
    }
    if let Some(v) = &opts.message_type {
        props = props.with_type(v.clone().into());
    }
    if let Some(v) = &opts.correlation_id {
        props = props.with_correlation_id(v.clone().into());
    }
    if let Some(v) = &opts.reply_to {
        props = props.with_reply_to(v.clone().into());
    }
    if opts.persistent {
        props = props.with_delivery_mode(2);
    }
    props
}

#[derive(Clone)]
pub struct MqClient {
    connection: Arc<Connection>,
}

impl MqClient {
    pub async fn connect(uri: &str) -> Result<Self> {
        let conn = Connection::connect(uri, ConnectionProperties::default()).await?;
        Ok(Self {connection: Arc::new(conn)})
    }

    pub async fn channel(&self) -> Result<Channel> {
        Ok(self.connection.create_channel().await?)
    }

    pub async fn declare_queue(
        &self,
        channel: &Channel,
        name: &str,
        durable: bool,
        exclusive: bool,
        auto_delete: bool,
    ) -> Result<Queue> {
        Ok(channel
            .queue_declare(
                name.into(),
                QueueDeclareOptions {
                    durable,
                    exclusive,
                    auto_delete,
                    ..Default::default()
                },
                FieldTable::default(),
            )
            .await?)
    }

    pub async fn publish_json<T: Serialize>(
        &self,
        channel: &Channel,
        exchange: &str,
        routing_key: &str,
        payload: &T,
        opts: PublishOptions,
    ) -> Result<()> {
        let body = encode_json(payload)?;
        let props = apply_publish_options(BasicProperties::default(), &opts);

        let confirm = channel
            .basic_publish(
                exchange.into(),
                routing_key.into(),
                BasicPublishOptions::default(),
                &body,
                props,
            )
            .await?;

        confirm.await?;
        Ok(())
    }

    pub async fn request_json<Req, Resp>(
        &self,
        channel: &Channel,
        queue: &str,
        request: &Req,
        timeout: Option<Duration>,
    ) -> Result<Resp>
    where
        Req: Serialize,
        Resp: DeserializeOwned,
    {
        let reply_queue_name = next_id("reply");
        channel
            .queue_declare(
                reply_queue_name.clone().into(),
                QueueDeclareOptions {
                    durable: false,
                    exclusive: true,
                    auto_delete: true,
                    ..Default::default()
                },
                FieldTable::default(),
            )
            .await?;

        let consumer_tag = next_id("rpc-reply");
        let mut replies = channel
            .basic_consume(
                reply_queue_name.clone().into(),
                consumer_tag.into(),
                BasicConsumeOptions::default(),
                FieldTable::default(),
            )
            .await?;

        let correlation_id = next_id("corr");

        self.publish_json(
            channel,
            "",
            queue,
            request,
            PublishOptions {
                content_type: Some("application/json".to_string()),
                correlation_id: Some(correlation_id.clone()),
                reply_to: Some(reply_queue_name),
                ..Default::default()
            },
        )
        .await?;

        let deadline = timeout.map(|t| tokio::time::Instant::now() + t);

        while let Some(delivery) = replies.next().await {
            let delivery = delivery?;
            if delivery
                .properties
                .correlation_id()
                .as_ref()
                .map(|s| s.as_str())
                != Some(correlation_id.as_str())
            {
                continue;
            }

            if let Some(deadline) = deadline {
                if tokio::time::Instant::now() > deadline {
                    return Err(MqError::Timeout);
                }
            }

            let resp = decode_json::<Resp>(&delivery.data)?;
            delivery.ack(BasicAckOptions::default()).await?;
            return Ok(resp);
        }

        Err(MqError::Timeout)
    }

    pub async fn serve_rpc<Req, Resp, F, Fut>(
        &self,
        channel: &Channel,
        queue: &str,
        handler: F,
    ) -> Result<()>
    where
        Req: DeserializeOwned + Send + 'static,
        Resp: Serialize + Send + 'static,
        F: Fn(Req) -> Fut + Send + Sync + 'static,
        Fut: std::future::Future<Output = Result<Resp>> + Send,
    {
        let consumer_tag = next_id("rpc-server");
        let mut consumer = channel
            .basic_consume(
                queue.into(),
                consumer_tag.into(),
                BasicConsumeOptions::default(),
                FieldTable::default(),
            )
            .await?;

        while let Some(item) = consumer.next().await {
            let delivery: Delivery = match item {
                Ok(delivery) => delivery,
                Err(err) => return Err(err.into()),
            };

            let req = match decode_json::<Req>(&delivery.data) {
                Ok(req) => req,
                Err(_) => {
                    delivery.nack(BasicNackOptions::default()).await?;
                    continue;
                }
            };

            let reply_to = match delivery.properties.reply_to().as_ref() {
                Some(v) => v.as_str().to_string(),
                None => {
                    delivery.ack(BasicAckOptions::default()).await?;
                    continue;
                }
            };

            let correlation_id = delivery
                .properties
                .correlation_id()
                .as_ref()
                .map(|v| v.as_str().to_string())
                .unwrap_or_default();

            let resp = match handler(req).await {
                Ok(resp) => resp,
                Err(_) => {
                    delivery.nack(BasicNackOptions::default()).await?;
                    continue;
                }
            };

            let body = encode_json(&resp)?;
            let confirm = channel
                .basic_publish(
                    "".into(),
                    reply_to.into(),
                    BasicPublishOptions::default(),
                    &body,
                    BasicProperties::default()
                        .with_content_type("application/json".into())
                        .with_correlation_id(correlation_id.clone().into()),
                )
                .await?;

            confirm.await?;
            delivery.ack(BasicAckOptions::default()).await?;
        }

        Ok(())
    }
}
