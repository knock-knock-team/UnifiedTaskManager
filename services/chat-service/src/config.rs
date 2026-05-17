use std::{env, net::SocketAddr};

#[derive(Debug, Clone)]
pub struct Settings {
    pub http_addr: SocketAddr,
    pub database_url: String,
    pub rabbitmq_exchange: String,
    pub cors_allow_origin: String,
}

impl Settings {
    pub fn from_env() -> Result<Self, Box<dyn std::error::Error + Send + Sync>> {
        let http_addr = env::var("CHAT_SERVICE_HTTP_ADDR")
            .unwrap_or_else(|_| "0.0.0.0:8084".to_string())
            .parse()?;

        let database_url = env::var("CHAT_DATABASE_URL")?;
        let rabbitmq_exchange =
            env::var("CHAT_RABBITMQ_EXCHANGE").unwrap_or_else(|_| "chat.events".to_string());
        let cors_allow_origin =
            env::var("CORS_ALLOW_ORIGIN").unwrap_or_else(|_| "*".to_string());

        Ok(Self {
            http_addr,
            database_url,
            rabbitmq_exchange,
            cors_allow_origin,
        })
    }
}