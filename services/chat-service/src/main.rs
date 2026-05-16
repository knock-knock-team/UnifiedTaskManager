use std::{sync::Arc, time::Duration};

use axum::{middleware, Router};
use dotenvy::dotenv;
use lapin::{
    options::ExchangeDeclareOptions,
    types::FieldTable,
    ExchangeKind,
};
use mq_rust::MqClient;
use sqlx::migrate::Migrator;
use tower_http::{
    cors::{Any, CorsLayer},
    trace::TraceLayer,
};
use tracing_subscriber::EnvFilter;

use chat_service::{
    config::Settings,
    infra::{
        postgres::PgChatRepository,
        rabbit::{RabbitPublisher, RabbitUserDirectory, USER_EXISTS_QUEUE},
    },
    service::ChatService,
    metrics, web,
    AppState,
};

static MIGRATOR: Migrator = sqlx::migrate!("./migrations");

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
    dotenv().ok();

    let env_filter = EnvFilter::from_default_env().add_directive("info".parse()?);
    if std::env::var("ENV").is_ok_and(|value| value.eq_ignore_ascii_case("production")) {
        tracing_subscriber::fmt()
            .json()
            .with_env_filter(env_filter)
            .init();
    } else {
        tracing_subscriber::fmt()
            .with_env_filter(env_filter)
            .init();
    }

    let settings = Settings::from_env()?;

    let repo = PgChatRepository::connect(&settings.database_url).await?;
    MIGRATOR.run(repo.pool()).await?;

    let rabbitmq_url = std::env::var("RABBITMQ_URL")
        .unwrap_or_else(|_| "amqp://127.0.0.1:5672/%2f".to_string());

    let mq = MqClient::connect(&rabbitmq_url).await?;
    let mq_channel = mq.channel().await?;
    mq_channel
        .exchange_declare(
            settings.rabbitmq_exchange.as_str().into(),
            ExchangeKind::Topic,
            ExchangeDeclareOptions {
                durable: true,
                ..Default::default()
            },
            FieldTable::default(),
        )
        .await?;

    let chat = ChatService::new(
        Arc::new(repo),
        Arc::new(RabbitPublisher::new(mq.clone())),
        Arc::new(RabbitUserDirectory::new(
            mq,
            USER_EXISTS_QUEUE,
            Duration::from_secs(2),
        )),
        settings.rabbitmq_exchange.clone(),
    );

    let state = AppState::new(chat);

    let app: Router = web::router(state).layer(
        CorsLayer::new()
            .allow_origin(Any)
            .allow_methods(Any)
            .allow_headers(Any),
    )
    .layer(middleware::from_fn(metrics::track_http))
    .layer(TraceLayer::new_for_http());

    let listener = tokio::net::TcpListener::bind(settings.http_addr).await?;
    tracing::info!("chat-service listening on {}", settings.http_addr);

    axum::serve(listener, app).await?;
    Ok(())
}