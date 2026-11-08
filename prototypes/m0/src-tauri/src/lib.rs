//! Core of the M0 spike. Free of Tauri types so that the GUI, the `probe` CLI
//! and the mock-server tests all exercise the same code.
//!
//! Tokens never leave this crate through a public return value: see
//! `store::TokenSet`, which is only handed to the provider modules.

pub mod chatgpt;
pub mod contract;
pub mod ctx;
pub mod lines;
pub mod loopback;
pub mod ollama;
pub mod openrouter;
pub mod pkce;
pub mod probes;
pub mod report;
pub mod store;
pub mod stream;

#[cfg(test)]
mod flow_tests;

pub fn now_unix() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0)
}
