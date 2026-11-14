//! Connecting OpenRouter by signing in through the browser, so that nobody pastes a key anywhere
//! (SPEC §6). The browser comes back to a port on this machine with a code, and the code is
//! exchanged for a key that never leaves the shell.

use base64::Engine;
use base64::engine::general_purpose::URL_SAFE_NO_PAD;
use sha2::{Digest, Sha256};
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::{TcpListener, TcpStream};
use url::Url;

const CALLBACK_PATH: &str = "/callback";
/// A request line longer than this isn't the one being waited for.
const LONGEST_REQUEST: usize = 16 * 1024;

const DONE_PAGE: &str = "<!doctype html><meta charset=\"utf-8\"><title>Ink Writer</title>\
<p>Listo. Ya puedes cerrar esta pestaña y volver a Ink Writer.</p>\
<p>Done. You can close this tab and go back to Ink Writer.</p>";
const FAILED_PAGE: &str = "<!doctype html><meta charset=\"utf-8\"><title>Ink Writer</title>\
<p>No se pudo completar la conexión. Vuelve a Ink Writer e inténtalo de nuevo.</p>\
<p>The connection couldn't be completed. Go back to Ink Writer and try again.</p>";

/// Why a login didn't end with a key. The page turns these into words for the author.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum LoginError {
    /// Nothing can listen for the browser's answer on this machine.
    Listen(String),
    /// OpenRouter couldn't be reached to exchange the code.
    Unreachable(String),
    /// OpenRouter answered the exchange, and not with a key.
    Refused(u16),
}

impl std::fmt::Display for LoginError {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::Listen(detail) => write!(formatter, "listen: {detail}"),
            Self::Unreachable(detail) => write!(formatter, "unreachable: {detail}"),
            Self::Refused(status) => write!(formatter, "refused: {status}"),
        }
    }
}

fn random(bytes: usize) -> Result<String, LoginError> {
    let mut buffer = vec![0u8; bytes];
    getrandom::fill(&mut buffer).map_err(|error| LoginError::Listen(error.to_string()))?;
    Ok(URL_SAFE_NO_PAD.encode(buffer))
}

/// A login in progress: the port is open, and `auth_url` is where the author's browser must go.
pub struct Login {
    pub auth_url: String,
    listener: TcpListener,
    verifier: String,
    state: String,
}

impl Login {
    /// Opens the port first, so that it's there whenever the browser comes back. New secrets for
    /// each attempt.
    pub async fn begin(openrouter_base: &str) -> Result<Self, LoginError> {
        let listener = TcpListener::bind("127.0.0.1:0")
            .await
            .map_err(|error| LoginError::Listen(error.to_string()))?;
        let port = listener
            .local_addr()
            .map_err(|error| LoginError::Listen(error.to_string()))?
            .port();
        let verifier = random(64)?;
        let state = random(32)?;
        let challenge = URL_SAFE_NO_PAD.encode(Sha256::digest(verifier.as_bytes()));
        let auth_url = Url::parse_with_params(
            &format!("{openrouter_base}/auth"),
            [
                (
                    "callback_url",
                    format!("http://localhost:{port}{CALLBACK_PATH}").as_str(),
                ),
                ("code_challenge", challenge.as_str()),
                ("code_challenge_method", "S256"),
                ("state", state.as_str()),
                ("key_label", "Ink Writer"),
            ],
        )
        .map_err(|error| LoginError::Listen(error.to_string()))?
        .to_string();
        Ok(Self {
            auth_url,
            listener,
            verifier,
            state,
        })
    }

    /// Waits for the browser, for as long as it takes: whoever calls this decides when to give up.
    /// Anything that isn't the answer to this very attempt is turned away and the wait goes on.
    pub async fn finish(
        self,
        http: &reqwest::Client,
        openrouter_base: &str,
    ) -> Result<String, LoginError> {
        loop {
            let Ok((mut socket, _)) = self.listener.accept().await else {
                continue;
            };
            let Some(code) = self.read_code(&mut socket).await else {
                respond(&mut socket, "400 Bad Request", FAILED_PAGE).await;
                continue;
            };
            let key = exchange(http, openrouter_base, &code, &self.verifier).await;
            // Said only now, so that the browser never claims a success that didn't happen.
            match &key {
                Ok(_) => respond(&mut socket, "200 OK", DONE_PAGE).await,
                Err(_) => respond(&mut socket, "502 Bad Gateway", FAILED_PAGE).await,
            }
            // The code is spent either way, so this attempt is over.
            return key;
        }
    }

    /// The code, only from a request to the callback that carries this attempt's `state`.
    async fn read_code(&self, socket: &mut TcpStream) -> Option<String> {
        let mut received = Vec::new();
        let mut buffer = [0u8; 2048];
        while !received.windows(2).any(|pair| pair == b"\r\n") {
            let read = socket.read(&mut buffer).await.ok()?;
            if read == 0 || received.len() + read > LONGEST_REQUEST {
                return None;
            }
            received.extend_from_slice(&buffer[..read]);
        }
        let text = String::from_utf8_lossy(&received);
        let mut parts = text.lines().next()?.split(' ');
        if parts.next()? != "GET" {
            return None;
        }
        let target = Url::parse(&format!("http://localhost{}", parts.next()?)).ok()?;
        if target.path() != CALLBACK_PATH {
            return None;
        }
        let value = |name: &str| {
            target
                .query_pairs()
                .find(|(key, _)| key == name)
                .map(|(_, value)| value.to_string())
        };
        // Checked before anything else: a code that comes with another `state` wasn't asked for here.
        if value("state")? != self.state {
            return None;
        }
        value("code").filter(|code| !code.is_empty())
    }
}

async fn respond(socket: &mut TcpStream, status: &str, page: &str) {
    let response = format!(
        "HTTP/1.1 {status}\r\nContent-Type: text/html; charset=utf-8\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{page}",
        page.len()
    );
    let _ = socket.write_all(response.as_bytes()).await;
    let _ = socket.shutdown().await;
}

async fn exchange(
    http: &reqwest::Client,
    openrouter_base: &str,
    code: &str,
    verifier: &str,
) -> Result<String, LoginError> {
    let response = http
        .post(format!("{openrouter_base}/api/v1/auth/keys"))
        .json(&serde_json::json!({
            "code": code,
            "code_verifier": verifier,
            "code_challenge_method": "S256",
        }))
        .send()
        .await
        .map_err(|error| LoginError::Unreachable(error.without_url().to_string()))?;
    let status = response.status().as_u16();
    let body: serde_json::Value = response
        .json()
        .await
        .map_err(|_| LoginError::Refused(status))?;
    match body.get("key").and_then(serde_json::Value::as_str) {
        Some(key) if status == 200 && !key.is_empty() => Ok(key.to_string()),
        _ => Err(LoginError::Refused(status)),
    }
}

#[cfg(test)]
mod tests {
    use std::time::Duration;

    use tokio::task::JoinHandle;

    use super::*;

    /// Stands in for OpenRouter's exchange. Resolves to the body it was sent.
    async fn exchange_server(response: &'static str) -> (String, JoinHandle<serde_json::Value>) {
        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let base = format!("http://{}", listener.local_addr().unwrap());
        let handle = tokio::spawn(async move {
            let (mut socket, _) = listener.accept().await.unwrap();
            let mut received = Vec::new();
            let mut buffer = [0u8; 4096];
            let body = loop {
                let read = socket.read(&mut buffer).await.unwrap();
                received.extend_from_slice(&buffer[..read]);
                let text = String::from_utf8_lossy(&received).to_string();
                if let Some((head, body)) = text.split_once("\r\n\r\n") {
                    let length: usize = head
                        .lines()
                        .find_map(|line| {
                            line.to_ascii_lowercase()
                                .strip_prefix("content-length:")
                                .map(|value| value.trim().parse().unwrap())
                        })
                        .unwrap();
                    if body.len() >= length {
                        assert!(head.starts_with("POST /api/v1/auth/keys HTTP/1.1"));
                        break body.to_string();
                    }
                }
            };
            socket.write_all(response.as_bytes()).await.unwrap();
            socket.shutdown().await.ok();
            serde_json::from_str(&body).unwrap()
        });
        (base, handle)
    }

    fn param(login: &Login, name: &str) -> String {
        Url::parse(&login.auth_url)
            .unwrap()
            .query_pairs()
            .find(|(key, _)| key == name)
            .map(|(_, value)| value.to_string())
            .unwrap()
    }

    /// What the browser does when OpenRouter sends it back. Returns the status line it got.
    async fn browser_returns(login_callback: &str, query: &str) -> String {
        let address = login_callback
            .strip_prefix("http://localhost:")
            .and_then(|rest| rest.strip_suffix(CALLBACK_PATH))
            .map(|port| format!("127.0.0.1:{port}"))
            .unwrap();
        let mut socket = TcpStream::connect(address).await.unwrap();
        socket
            .write_all(format!("GET {query} HTTP/1.1\r\nHost: localhost\r\n\r\n").as_bytes())
            .await
            .unwrap();
        let mut answer = String::new();
        socket.read_to_string(&mut answer).await.unwrap();
        answer.lines().next().unwrap_or_default().to_string()
    }

    const KEY_RESPONSE: &str = "HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: 20\r\n\r\n{\"key\":\"sk-or-new1\"}";

    #[tokio::test]
    async fn sends_the_browser_with_a_challenge_and_new_secrets_each_time() {
        let first = Login::begin("https://openrouter.example").await.unwrap();
        let second = Login::begin("https://openrouter.example").await.unwrap();

        assert!(
            first
                .auth_url
                .starts_with("https://openrouter.example/auth?")
        );
        assert!(param(&first, "callback_url").starts_with("http://localhost:"));
        assert_eq!(param(&first, "code_challenge_method"), "S256");
        assert_eq!(
            param(&first, "code_challenge"),
            URL_SAFE_NO_PAD.encode(Sha256::digest(first.verifier.as_bytes()))
        );
        assert_eq!(param(&first, "state"), first.state);
        assert_ne!(first.state, second.state);
        assert_ne!(first.verifier, second.verifier);
        // The verifier itself never goes through the browser.
        assert!(!first.auth_url.contains(&first.verifier));
    }

    #[tokio::test]
    async fn exchanges_the_code_for_a_key() {
        let (base, server) = exchange_server(KEY_RESPONSE).await;
        let login = Login::begin(&base).await.unwrap();
        let callback = param(&login, "callback_url");
        let (state, verifier) = (login.state.clone(), login.verifier.clone());
        let http = reqwest::Client::new();

        let browser = tokio::spawn(async move {
            browser_returns(&callback, &format!("/callback?code=the-code&state={state}")).await
        });
        let key = login.finish(&http, &base).await;

        assert_eq!(key, Ok("sk-or-new1".into()));
        assert_eq!(browser.await.unwrap(), "HTTP/1.1 200 OK");
        assert_eq!(
            server.await.unwrap(),
            serde_json::json!({
                "code": "the-code",
                "code_verifier": verifier,
                "code_challenge_method": "S256",
            })
        );
    }

    #[tokio::test]
    async fn turns_away_what_is_not_the_answer_and_keeps_waiting() {
        let (base, server) = exchange_server(KEY_RESPONSE).await;
        let login = Login::begin(&base).await.unwrap();
        let callback = param(&login, "callback_url");
        let state = login.state.clone();
        let http = reqwest::Client::new();

        let browser = tokio::spawn(async move {
            let mut answers = Vec::new();
            for query in [
                "/favicon.ico".to_string(),
                "/callback?code=stolen&state=another".to_string(),
                "/callback?code=no-state".to_string(),
                format!("/callback?state={state}"),
                format!("/elsewhere?code=x&state={state}"),
                format!("/callback?code=good&state={state}"),
            ] {
                answers.push(browser_returns(&callback, &query).await);
            }
            answers
        });
        let key = login.finish(&http, &base).await;

        assert_eq!(key, Ok("sk-or-new1".into()));
        let answers = browser.await.unwrap();
        assert_eq!(answers[..5], ["HTTP/1.1 400 Bad Request"; 5]);
        assert_eq!(answers[5], "HTTP/1.1 200 OK");
        // Only the good code was ever exchanged.
        assert_eq!(server.await.unwrap()["code"], "good");
    }

    #[tokio::test]
    async fn a_refused_exchange_is_a_failure_and_the_browser_says_so() {
        let (base, _server) = exchange_server(
            "HTTP/1.1 403 Forbidden\r\nContent-Type: application/json\r\nContent-Length: 22\r\n\r\n{\"error\":\"bad code\"}  ",
        )
        .await;
        let login = Login::begin(&base).await.unwrap();
        let callback = param(&login, "callback_url");
        let state = login.state.clone();
        let http = reqwest::Client::new();

        let browser = tokio::spawn(async move {
            browser_returns(&callback, &format!("/callback?code=c&state={state}")).await
        });
        let key = login.finish(&http, &base).await;

        assert_eq!(key, Err(LoginError::Refused(403)));
        assert_eq!(browser.await.unwrap(), "HTTP/1.1 502 Bad Gateway");
    }

    #[tokio::test]
    async fn a_success_without_a_key_is_a_failure() {
        let (base, _server) = exchange_server(
            "HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: 2\r\n\r\n{}",
        )
        .await;
        let login = Login::begin(&base).await.unwrap();
        let callback = param(&login, "callback_url");
        let state = login.state.clone();
        let http = reqwest::Client::new();

        tokio::spawn(async move {
            browser_returns(&callback, &format!("/callback?code=c&state={state}")).await
        });

        assert_eq!(
            login.finish(&http, &base).await,
            Err(LoginError::Refused(200))
        );
    }

    #[tokio::test]
    async fn keeps_waiting_while_the_browser_does_not_come_back() {
        let login = Login::begin("http://127.0.0.1:1").await.unwrap();
        let http = reqwest::Client::new();

        let waited =
            tokio::time::timeout(Duration::from_millis(200), login.finish(&http, "")).await;

        assert!(waited.is_err());
    }
}
