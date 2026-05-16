pub mod config;
pub mod domain;
pub mod error;
pub mod infra;
pub mod metrics;
pub mod ports;
pub mod service;
pub mod web;

use std::sync::Arc;

use service::ChatService;

#[derive(Clone)]
pub struct AppState {
    pub chat: Arc<ChatService>,
}

impl AppState {
    pub fn new(chat: ChatService) -> Self {
        Self {
            chat: Arc::new(chat),
        }
    }
}