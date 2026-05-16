use std::sync::Arc;

use axum::Router;
use dotenvy::dotenv;
use sqlx::migrate::Migrator;
use tower_http::{
    cors::{Any, CorsLayer},
    trace::TraceLayer,
};
use tracing_subscriber::EnvFilter;

use chat_service::{
    config::Settings,
    infra::{postgres::PgChatRepository, rabbit::{NoopPublisher, NoopUserDirectory}},
    service::ChatService,
    web,
    AppState,
};

static MIGRATOR: Migrator = sqlx::migrate!("./migrations");

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
    dotenv().ok();

    tracing_subscriber::fmt()
        .with_env_filter(EnvFilter::from_default_env().add_directive("info".parse()?))
        .init();

    let settings = Settings::from_env()?;

    let repo = PgChatRepository::connect(&settings.database_url).await?;
    MIGRATOR.run(repo.pool()).await?;

    let chat = ChatService::new(
        Arc::new(repo),
        Arc::new(NoopPublisher),
        Arc::new(NoopUserDirectory),
        settings.rabbitmq_exchange.clone(),
    );

    let state = AppState::new(chat);

    let app: Router = web::router(state).layer(
        CorsLayer::new()
            .allow_origin(Any)
            .allow_methods(Any)
            .allow_headers(Any),
    )
    .layer(TraceLayer::new_for_http());

    let listener = tokio::net::TcpListener::bind(settings.http_addr).await?;
    tracing::info!("chat-service listening on {}", settings.http_addr);

    axum::serve(listener, app).await?;
    Ok(())
}