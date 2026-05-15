mod client;
mod error;
mod types;

pub use client::MqClient;
pub use error::{MqError, Result};
pub use types::{PublishOptions, RequestTimeout};

use serde::{de::DeserializeOwned, Serialize};

/// Serialize/deserialize helper used by the higher-level RPC functions.
pub(crate) fn encode_json<T: Serialize>(value: &T) -> Result<Vec<u8>> {
    Ok(serde_json::to_vec(value)?)
}

pub(crate) fn decode_json<T: DeserializeOwned>(body: &[u8]) -> Result<T> {
    Ok(serde_json::from_slice(body)?)
}
