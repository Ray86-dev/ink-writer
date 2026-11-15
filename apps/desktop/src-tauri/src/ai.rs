//! How the page reaches a model. The page says which service and what to send; this adds the
//! credential and passes the answer back as it arrives, so no key ever reaches the WebView (rule 9).
//!
//! The page can only ask for what's listed in `check`. A request that costs money is only let
//! through while the author allows paid requests, and each one is counted against a daily limit
//! kept here, so a fault in the page can't spend past it (ADR 0012 and 0018).

use std::collections::HashMap;
use std::sync::Mutex;
use std::time::Duration;

use base64::Engine;
use base64::engine::general_purpose::STANDARD;
use futures_util::StreamExt;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use tokio::sync::oneshot;

const CONNECT_TIMEOUT: Duration = Duration::from_secs(10);
/// Between two pieces of an answer. A local model can take minutes to load before its first word.
const READ_TIMEOUT: Duration = Duration::from_secs(600);

#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Route {
    Openrouter,
    Ollama,
    Deepseek,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "UPPERCASE")]
pub enum Method {
    Get,
    Post,
}

#[derive(Debug, Deserialize)]
pub struct AiRequest {
    pub route: Route,
    pub method: Method,
    pub path: String,
    #[serde(default)]
    pub body: Option<Value>,
}

/// What the page receives, in order. Exactly one of `End` and `Error` comes, and it comes last.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(
    tag = "type",
    rename_all = "lowercase",
    rename_all_fields = "camelCase"
)]
pub enum AiEvent {
    Head {
        status: u16,
        request_id: Option<String>,
        retry_after_seconds: Option<u64>,
    },
    /// Base64, because a piece can end in the middle of a character.
    Chunk {
        data: String,
    },
    End,
    Error {
        message: String,
    },
}

/// Where each service is. Only a test points these anywhere else.
#[derive(Debug, Clone)]
pub struct Bases {
    pub openrouter: String,
    pub ollama: String,
    pub deepseek: String,
}

impl Default for Bases {
    fn default() -> Self {
        Self {
            openrouter: "https://openrouter.ai".into(),
            ollama: "http://127.0.0.1:11434".into(),
            deepseek: "https://api.deepseek.com".into(),
        }
    }
}

impl Bases {
    /// Both services at one address, for a test with a stand-in server.
    pub fn all_at(base: &str) -> Self {
        Self {
            openrouter: base.into(),
            ollama: base.into(),
            deepseek: base.into(),
        }
    }
}

/// Fields of an OpenRouter request that are billed apart from the model, or that route it to
/// another one. Never allowed: the app has no use for them, and no limit that covers them.
const OPENROUTER_REFUSED_FIELDS: [&str; 4] = ["plugins", "tools", "web_search_options", "models"];

fn openrouter_model(request: &AiRequest) -> &str {
    request
        .body
        .as_ref()
        .and_then(|body| body.get("model"))
        .and_then(Value::as_str)
        .unwrap_or_default()
}

/// True for a request that costs the author money: a model on OpenRouter that isn't free, or
/// anything asked of a service paid by key.
pub fn is_paid(request: &AiRequest) -> bool {
    match (request.route, request.method, request.path.as_str()) {
        (Route::Openrouter, Method::Post, "/api/v1/chat/completions") => {
            !openrouter_model(request).ends_with(":free")
        }
        (Route::Deepseek, Method::Post, "/chat/completions") => true,
        _ => false,
    }
}

/// Refuses anything but the few requests the app makes, and a paid one unless paid is allowed.
pub fn check(request: &AiRequest, paid_allowed: bool) -> Result<(), String> {
    let AiRequest {
        route,
        method,
        path,
        body,
    } = request;
    match (method, body) {
        (Method::Get, Some(_)) => return Err("a GET request can't carry a body".into()),
        (Method::Post, None | Some(Value::Null)) => {
            return Err("a POST request needs a body".into());
        }
        (Method::Post, Some(body)) if !body.is_object() => {
            return Err("the body must be an object".into());
        }
        _ => {}
    }
    match (route, method, path.as_str()) {
        (Route::Ollama, Method::Get, "/api/tags")
        | (Route::Ollama, Method::Post, "/api/chat")
        | (Route::Openrouter, Method::Get, "/api/v1/models" | "/api/v1/key")
        | (Route::Deepseek, Method::Get, "/models" | "/user/balance") => Ok(()),
        (Route::Deepseek, Method::Post, "/chat/completions") => {
            if paid_allowed {
                Ok(())
            } else {
                Err("paid: paid requests are off".into())
            }
        }
        (Route::Openrouter, Method::Post, "/api/v1/chat/completions") => {
            let model = openrouter_model(request);
            if model.is_empty() {
                return Err("the request names no model".into());
            }
            if is_paid(request) && !paid_allowed {
                return Err(format!("paid: \"{model}\" isn't a free model"));
            }
            let body = body.as_ref().and_then(Value::as_object);
            match OPENROUTER_REFUSED_FIELDS
                .iter()
                .find(|field| body.is_some_and(|body| body.contains_key(**field)))
            {
                Some(field) => Err(format!("\"{field}\" isn't allowed: it can cost money")),
                None => Ok(()),
            }
        }
        _ => Err(format!(
            "{method:?} {path} isn't something the app asks for"
        )),
    }
}

pub struct AiClient {
    http: reqwest::Client,
    bases: Bases,
}

impl AiClient {
    pub fn new(bases: Bases) -> Result<Self, String> {
        let http = reqwest::Client::builder()
            .connect_timeout(CONNECT_TIMEOUT)
            .read_timeout(READ_TIMEOUT)
            // A redirect could carry the request, and the manuscript in it, somewhere else.
            .redirect(reqwest::redirect::Policy::none())
            .user_agent("ink-writer")
            .build()
            .map_err(|error| error.to_string())?;
        Ok(Self { http, bases })
    }

    pub fn http(&self) -> &reqwest::Client {
        &self.http
    }

    pub fn openrouter_base(&self) -> &str {
        &self.bases.openrouter
    }

    /// Sends one request and hands over the answer as it arrives. `Err` means it ended badly, at
    /// whatever point: nothing after it reaches `sink`.
    pub async fn run(
        &self,
        request: &AiRequest,
        key: Option<&str>,
        paid_allowed: bool,
        mut sink: impl FnMut(AiEvent),
    ) -> Result<(), String> {
        check(request, paid_allowed)?;
        let base = match request.route {
            Route::Openrouter => &self.bases.openrouter,
            Route::Ollama => &self.bases.ollama,
            Route::Deepseek => &self.bases.deepseek,
        };
        let url = format!("{base}{}", request.path);
        let mut builder = match request.method {
            Method::Get => self.http.get(url),
            Method::Post => self.http.post(url),
        };
        if let Some(body) = &request.body {
            builder = builder.json(body);
        }
        // A key goes to its own service and nowhere else: whoever calls passes the one for this
        // route, and a local model never gets any.
        if request.route != Route::Ollama
            && let Some(key) = key
        {
            builder = builder.bearer_auth(key);
        }

        let response = builder.send().await.map_err(describe)?;
        let header = |name: &str| {
            response
                .headers()
                .get(name)
                .and_then(|value| value.to_str().ok())
                .map(str::to_string)
        };
        sink(AiEvent::Head {
            status: response.status().as_u16(),
            request_id: header("x-generation-id").or_else(|| header("x-request-id")),
            retry_after_seconds: header("retry-after")
                .and_then(|value| value.trim().parse().ok())
                .filter(|seconds| *seconds > 0),
        });

        let mut stream = response.bytes_stream();
        while let Some(piece) = stream.next().await {
            let piece = piece.map_err(describe)?;
            if !piece.is_empty() {
                sink(AiEvent::Chunk {
                    data: STANDARD.encode(&piece),
                });
            }
        }
        sink(AiEvent::End);
        Ok(())
    }
}

/// Without the address, which says nothing the page doesn't know.
fn describe(error: reqwest::Error) -> String {
    let kind = if error.is_connect() {
        "can't reach the service"
    } else if error.is_timeout() {
        "the service took too long"
    } else {
        "the connection failed"
    };
    format!("{kind}: {}", error.without_url())
}

/// Requests in progress, so that the page can cancel one by the name it gave it.
#[derive(Default)]
pub struct Cancellations {
    waiting: Mutex<HashMap<String, oneshot::Sender<()>>>,
}

impl Cancellations {
    /// The receiver resolves if `cancel` is called with this id.
    pub fn register(&self, id: &str) -> oneshot::Receiver<()> {
        let (sender, receiver) = oneshot::channel();
        self.lock().insert(id.to_string(), sender);
        receiver
    }

    /// Does nothing for a request that's over or was never there.
    pub fn cancel(&self, id: &str) {
        if let Some(sender) = self.lock().remove(id) {
            let _ = sender.send(());
        }
    }

    pub fn finish(&self, id: &str) {
        self.lock().remove(id);
    }

    fn lock(&self) -> std::sync::MutexGuard<'_, HashMap<String, oneshot::Sender<()>>> {
        // Nothing here can leave the map half changed, so a poisoned lock is still good.
        self.waiting
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner)
    }
}

#[cfg(test)]
mod tests {
    use serde_json::json;
    use tokio::io::{AsyncReadExt, AsyncWriteExt};
    use tokio::net::TcpListener;
    use tokio::task::JoinHandle;

    use super::*;

    fn request(route: Route, method: Method, path: &str, body: Option<Value>) -> AiRequest {
        AiRequest {
            route,
            method,
            path: path.into(),
            body,
        }
    }

    fn free_chat() -> AiRequest {
        request(
            Route::Openrouter,
            Method::Post,
            "/api/v1/chat/completions",
            Some(json!({ "model": "some/model:free", "messages": [] })),
        )
    }

    /// A server for one request. Answers with `parts`, sent apart, and resolves to what it was sent.
    async fn serve_once(parts: Vec<&'static [u8]>) -> (String, JoinHandle<String>) {
        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let base = format!("http://{}", listener.local_addr().unwrap());
        let handle = tokio::spawn(async move {
            let (mut socket, _) = listener.accept().await.unwrap();
            let mut received = Vec::new();
            let mut buffer = [0u8; 4096];
            loop {
                let read = socket.read(&mut buffer).await.unwrap();
                received.extend_from_slice(&buffer[..read]);
                let text = String::from_utf8_lossy(&received).to_string();
                if let Some(end) = text.find("\r\n\r\n") {
                    let length = text
                        .lines()
                        .find_map(|line| {
                            line.to_ascii_lowercase()
                                .strip_prefix("content-length:")
                                .map(|value| value.trim().parse::<usize>().unwrap())
                        })
                        .unwrap_or(0);
                    if received.len() >= end + 4 + length {
                        break;
                    }
                }
                if read == 0 {
                    break;
                }
            }
            for part in parts {
                socket.write_all(part).await.unwrap();
                socket.flush().await.unwrap();
                tokio::time::sleep(Duration::from_millis(20)).await;
            }
            socket.shutdown().await.ok();
            String::from_utf8_lossy(&received).to_string()
        });
        (base, handle)
    }

    async fn run(
        base: &str,
        request: &AiRequest,
        key: Option<&str>,
    ) -> (Vec<AiEvent>, Result<(), String>) {
        let client = AiClient::new(Bases::all_at(base)).unwrap();
        let mut events = Vec::new();
        let result = client
            .run(request, key, false, |event| events.push(event))
            .await;
        (events, result)
    }

    fn body_of(events: &[AiEvent]) -> String {
        let bytes: Vec<u8> = events
            .iter()
            .filter_map(|event| match event {
                AiEvent::Chunk { data } => Some(STANDARD.decode(data).unwrap()),
                _ => None,
            })
            .flatten()
            .collect();
        String::from_utf8(bytes).unwrap()
    }

    #[test]
    fn allows_only_what_the_app_asks_for() {
        for allowed in [
            request(Route::Ollama, Method::Get, "/api/tags", None),
            request(Route::Ollama, Method::Post, "/api/chat", Some(json!({}))),
            request(Route::Openrouter, Method::Get, "/api/v1/models", None),
            request(Route::Openrouter, Method::Get, "/api/v1/key", None),
            free_chat(),
        ] {
            assert_eq!(check(&allowed, false), Ok(()), "{allowed:?}");
        }
        for refused in [
            request(Route::Ollama, Method::Post, "/api/pull", Some(json!({}))),
            request(Route::Ollama, Method::Get, "/api/chat", None),
            request(Route::Openrouter, Method::Get, "/api/v1/credits", None),
            request(
                Route::Openrouter,
                Method::Post,
                "/api/v1/responses",
                Some(json!({ "model": "some/model:free" })),
            ),
            // A path that only starts like an allowed one.
            request(
                Route::Openrouter,
                Method::Get,
                "/api/v1/models/../auth/keys",
                None,
            ),
            request(Route::Ollama, Method::Get, "/api/tags", Some(json!({}))),
            request(Route::Ollama, Method::Post, "/api/chat", None),
            request(Route::Ollama, Method::Post, "/api/chat", Some(json!([1]))),
        ] {
            assert!(check(&refused, true).is_err(), "{refused:?}");
        }
    }

    #[test]
    fn through_openrouter_only_a_free_model_and_nothing_billed_apart() {
        let chat = |body: Value| {
            check(
                &request(
                    Route::Openrouter,
                    Method::Post,
                    "/api/v1/chat/completions",
                    Some(body),
                ),
                false,
            )
        };

        assert!(chat(json!({ "model": "some/model" })).is_err());
        assert!(chat(json!({ "messages": [] })).is_err());
        assert!(chat(json!({ "model": ["some/model:free"] })).is_err());
        for field in OPENROUTER_REFUSED_FIELDS {
            let mut body = json!({ "model": "some/model:free" });
            body[field] = json!([]);
            assert!(chat(body).is_err(), "{field}");
        }
    }

    #[test]
    fn a_paid_request_is_let_through_only_while_paid_is_allowed() {
        let paid_model = request(
            Route::Openrouter,
            Method::Post,
            "/api/v1/chat/completions",
            Some(json!({ "model": "some/model", "messages": [] })),
        );
        let by_key = request(
            Route::Deepseek,
            Method::Post,
            "/chat/completions",
            Some(json!({ "model": "deepseek-flash", "messages": [] })),
        );

        for paid in [&paid_model, &by_key] {
            assert!(is_paid(paid), "{paid:?}");
            assert!(check(paid, false).unwrap_err().starts_with("paid: "));
            assert_eq!(check(paid, true), Ok(()));
        }
        assert!(!is_paid(&free_chat()));
        assert_eq!(check(&free_chat(), false), Ok(()));
        // Looking at models or at the balance costs nothing.
        for free in [
            request(Route::Deepseek, Method::Get, "/models", None),
            request(Route::Deepseek, Method::Get, "/user/balance", None),
            request(Route::Openrouter, Method::Get, "/api/v1/models", None),
        ] {
            assert!(!is_paid(&free));
            assert_eq!(check(&free, false), Ok(()));
        }
    }

    #[test]
    fn what_is_billed_apart_is_refused_even_with_paid_allowed() {
        for field in OPENROUTER_REFUSED_FIELDS {
            let mut body = json!({ "model": "some/model" });
            body[field] = json!([]);
            let asked = request(
                Route::Openrouter,
                Method::Post,
                "/api/v1/chat/completions",
                Some(body),
            );
            assert!(check(&asked, true).is_err(), "{field}");
        }
        let elsewhere = request(
            Route::Deepseek,
            Method::Post,
            "/beta/completions",
            Some(json!({})),
        );
        assert!(check(&elsewhere, true).is_err());
    }

    #[tokio::test]
    async fn a_key_by_route_goes_to_its_own_service() {
        let ok: &[u8] = b"HTTP/1.1 200 OK\r\nContent-Length: 2\r\n\r\n{}";
        let (base, server) = serve_once(vec![ok]).await;
        let client = AiClient::new(Bases::all_at(&base)).unwrap();
        let asked = request(
            Route::Deepseek,
            Method::Post,
            "/chat/completions",
            Some(json!({ "model": "deepseek-flash", "messages": [] })),
        );

        let result = client.run(&asked, Some("sk-deep"), true, |_| {}).await;

        assert_eq!(result, Ok(()));
        let sent = server.await.unwrap().to_ascii_lowercase();
        assert!(sent.starts_with("post /chat/completions http/1.1\r\n"));
        assert!(sent.contains("authorization: bearer sk-deep\r\n"));
    }

    #[tokio::test]
    async fn a_refused_request_never_leaves() {
        let (base, server) = serve_once(vec![]).await;
        let paid = request(
            Route::Openrouter,
            Method::Post,
            "/api/v1/chat/completions",
            Some(json!({ "model": "some/model" })),
        );

        let (events, result) = run(&base, &paid, Some("sk-secret")).await;

        assert!(result.unwrap_err().starts_with("paid: "));
        assert_eq!(events, []);
        assert!(!server.is_finished());
        server.abort();
    }

    #[tokio::test]
    async fn passes_on_the_answer_as_it_arrives() {
        let (base, server) = serve_once(vec![
            b"HTTP/1.1 200 OK\r\nx-generation-id: gen-1\r\nTransfer-Encoding: chunked\r\n\r\n",
            b"6\r\n{\"a\":1\r\n",
            // A character cut in two between pieces.
            b"3\r\n}\n\xc3\r\n",
            b"1\r\n\xb1\r\n0\r\n\r\n",
        ])
        .await;

        let (events, result) = run(&base, &free_chat(), None).await;

        assert_eq!(result, Ok(()));
        assert_eq!(
            events.first(),
            Some(&AiEvent::Head {
                status: 200,
                request_id: Some("gen-1".into()),
                retry_after_seconds: None,
            })
        );
        assert_eq!(events.last(), Some(&AiEvent::End));
        assert_eq!(body_of(&events), "{\"a\":1}\nñ");
        let sent = server.await.unwrap();
        assert!(sent.starts_with("POST /api/v1/chat/completions HTTP/1.1\r\n"));
        assert!(sent.ends_with(r#"{"messages":[],"model":"some/model:free"}"#));
    }

    #[tokio::test]
    async fn a_failure_from_the_service_is_passed_on_whole() {
        let (base, _server) = serve_once(vec![
            b"HTTP/1.1 429 Too Many Requests\r\nRetry-After: 30\r\nx-request-id: req-9\r\nContent-Length: 9\r\n\r\nslow down",
        ])
        .await;

        let (events, result) = run(&base, &free_chat(), None).await;

        assert_eq!(result, Ok(()));
        assert_eq!(
            events.first(),
            Some(&AiEvent::Head {
                status: 429,
                request_id: Some("req-9".into()),
                retry_after_seconds: Some(30),
            })
        );
        assert_eq!(body_of(&events), "slow down");
    }

    #[tokio::test]
    async fn the_key_goes_to_openrouter_and_never_to_ollama() {
        let ok: &[u8] = b"HTTP/1.1 200 OK\r\nContent-Length: 2\r\n\r\n{}";
        let (base, server) = serve_once(vec![ok]).await;
        let _ = run(&base, &free_chat(), Some("sk-secret")).await;
        let sent = server.await.unwrap().to_ascii_lowercase();
        assert!(sent.contains("authorization: bearer sk-secret\r\n"));

        let (base, server) = serve_once(vec![ok]).await;
        let local = request(Route::Ollama, Method::Get, "/api/tags", None);
        let _ = run(&base, &local, Some("sk-secret")).await;
        let sent = server.await.unwrap().to_ascii_lowercase();
        assert!(!sent.contains("authorization"));
        assert!(!sent.contains("sk-secret"));
    }

    #[tokio::test]
    async fn does_not_follow_a_redirect() {
        let (base, _server) = serve_once(vec![
            b"HTTP/1.1 302 Found\r\nLocation: http://127.0.0.1:1/elsewhere\r\nContent-Length: 0\r\n\r\n",
        ])
        .await;

        let (events, result) = run(&base, &free_chat(), Some("sk-secret")).await;

        assert_eq!(result, Ok(()));
        assert!(matches!(
            events.first(),
            Some(AiEvent::Head { status: 302, .. })
        ));
    }

    #[tokio::test]
    async fn says_so_when_the_service_cannot_be_reached() {
        // A port that was free a moment ago, with nothing listening now.
        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let base = format!("http://{}", listener.local_addr().unwrap());
        drop(listener);

        let local = request(Route::Ollama, Method::Get, "/api/tags", None);
        let (events, result) = run(&base, &local, None).await;

        let message = result.unwrap_err();
        assert!(message.starts_with("can't reach the service"), "{message}");
        assert!(!message.contains("127.0.0.1"), "{message}");
        assert_eq!(events, []);
    }

    #[tokio::test]
    async fn an_answer_cut_short_ends_in_an_error_and_not_in_an_end() {
        let (base, _server) = serve_once(vec![
            b"HTTP/1.1 200 OK\r\nContent-Length: 100\r\n\r\nonly this",
        ])
        .await;

        let (events, result) = run(&base, &free_chat(), None).await;

        assert!(result.is_err());
        assert!(!events.contains(&AiEvent::End));
    }

    #[tokio::test]
    async fn cancelling_reaches_the_request_it_names() {
        let calls = Cancellations::default();
        let first = calls.register("a");
        let mut second = calls.register("b");

        calls.cancel("a");
        calls.cancel("never there");

        assert_eq!(first.await, Ok(()));
        assert!(second.try_recv().is_err());
        calls.finish("b");
        calls.cancel("b");
        assert!(calls.lock().is_empty());
    }

    #[test]
    fn events_have_the_shape_the_page_is_tested_against() {
        let head = AiEvent::Head {
            status: 200,
            request_id: None,
            retry_after_seconds: Some(5),
        };
        assert_eq!(
            serde_json::to_value(head).unwrap(),
            json!({ "type": "head", "status": 200, "requestId": null, "retryAfterSeconds": 5 })
        );
        assert_eq!(
            serde_json::to_value(AiEvent::Chunk {
                data: "AAEC/w==".into()
            })
            .unwrap(),
            json!({ "type": "chunk", "data": "AAEC/w==" })
        );
        assert_eq!(
            serde_json::to_value(AiEvent::End).unwrap(),
            json!({ "type": "end" })
        );
        assert_eq!(
            serde_json::to_value(AiEvent::Error {
                message: "no".into()
            })
            .unwrap(),
            json!({ "type": "error", "message": "no" })
        );
    }

    #[test]
    fn reads_a_request_as_the_page_sends_it() {
        let request: AiRequest = serde_json::from_value(
            json!({ "route": "ollama", "method": "GET", "path": "/api/tags" }),
        )
        .unwrap();
        assert_eq!(request.route, Route::Ollama);
        assert_eq!(request.method, Method::Get);
        assert_eq!(request.body, None);

        // A route the shell doesn't serve.
        let unknown = json!({ "route": "chatgpt", "method": "GET", "path": "/models" });
        assert!(serde_json::from_value::<AiRequest>(unknown).is_err());
    }
}
