//! Shared handles. Endpoints are injected so tests can point at a mock server.

use std::time::Duration;

use crate::store::Store;

pub struct Endpoints {
    pub auth_base: String,
    pub api_base: String,
    pub openrouter_base: String,
    pub ollama_base: String,
}

impl Endpoints {
    pub fn production() -> Self {
        Self {
            auth_base: "https://auth.openai.com".into(),
            api_base: "https://api.openai.com/v1".into(),
            openrouter_base: "https://openrouter.ai".into(),
            ollama_base: "http://127.0.0.1:11434".into(),
        }
    }
}

pub struct Ctx {
    pub http: reqwest::Client,
    pub store: Store,
    pub endpoints: Endpoints,
    /// Refreshes rotate the token: two at once would invalidate each other.
    pub refresh_lock: tokio::sync::Mutex<()>,
}

impl Ctx {
    pub fn new(store: Store, endpoints: Endpoints) -> Result<Self, String> {
        let http = reqwest::Client::builder()
            .user_agent("ink-writer-m0/0.0")
            .connect_timeout(Duration::from_secs(15))
            // Per read, not total: a long stream must not be cut.
            .read_timeout(Duration::from_secs(180))
            .build()
            .map_err(|e| e.to_string())?;
        Ok(Self {
            http,
            store,
            endpoints,
            refresh_lock: tokio::sync::Mutex::new(()),
        })
    }

    pub fn production() -> Result<Self, String> {
        Self::new(Store::production()?, Endpoints::production())
    }
}
