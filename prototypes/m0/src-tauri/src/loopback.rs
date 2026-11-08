//! Single-purpose HTTP listener for OAuth callbacks on 127.0.0.1.

use std::time::Duration;

use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::{TcpListener, TcpStream};

const MAX_REQUEST: usize = 8192;
const READ_TIMEOUT: Duration = Duration::from_secs(5);

/// What the caller decides after seeing a callback query.
pub enum Decision<T> {
    Done(T),
    /// Not for this attempt, such as a wrong `state`: keep listening, so a
    /// stray local request can't abort a sign-in in progress.
    KeepWaiting,
}

#[derive(Debug, PartialEq, Eq)]
pub enum WaitError {
    Timeout,
    Io(String),
}

pub struct Loopback {
    listener: TcpListener,
    pub port: u16,
}

impl Loopback {
    /// Binds before the browser opens, as the sign-in docs require.
    /// `port = 0` asks the OS for a free port.
    pub async fn bind(port: u16) -> std::io::Result<Self> {
        let listener = TcpListener::bind(("127.0.0.1", port)).await?;
        let port = listener.local_addr()?.port();
        Ok(Self { listener, port })
    }

    pub async fn wait<T>(
        self,
        path: &str,
        timeout: Duration,
        mut decide: impl FnMut(&str) -> Decision<T>,
    ) -> Result<T, WaitError> {
        let serve = async {
            loop {
                let (mut stream, _) = self
                    .listener
                    .accept()
                    .await
                    .map_err(|e| WaitError::Io(e.to_string()))?;
                let Some(target) = read_target(&mut stream).await else {
                    continue;
                };
                let (req_path, query) = target.split_once('?').unwrap_or((target.as_str(), ""));
                if req_path != path {
                    respond(&mut stream, "404 Not Found", "No encontrado.").await;
                    continue;
                }
                match decide(query) {
                    Decision::Done(value) => {
                        respond(
                            &mut stream,
                            "200 OK",
                            "Puedes cerrar esta pestaña y volver a la aplicación.",
                        )
                        .await;
                        return Ok(value);
                    }
                    Decision::KeepWaiting => {
                        respond(&mut stream, "400 Bad Request", "Petición no válida.").await;
                    }
                }
            }
        };
        tokio::time::timeout(timeout, serve)
            .await
            .unwrap_or(Err(WaitError::Timeout))
    }
}

/// Returns the request target of a GET, or `None` for anything else.
async fn read_target(stream: &mut TcpStream) -> Option<String> {
    let mut buf = Vec::with_capacity(1024);
    let mut chunk = [0u8; 1024];
    let read = async {
        loop {
            let n = stream.read(&mut chunk).await.ok()?;
            if n == 0 {
                return Some(());
            }
            buf.extend_from_slice(&chunk[..n]);
            if buf.windows(4).any(|w| w == b"\r\n\r\n") || buf.len() > MAX_REQUEST {
                return Some(());
            }
        }
    };
    tokio::time::timeout(READ_TIMEOUT, read).await.ok()??;
    let head = String::from_utf8_lossy(&buf);
    let mut parts = head.lines().next()?.split_whitespace();
    if parts.next()? != "GET" {
        return None;
    }
    parts.next().map(str::to_string)
}

/// The body is a fixed string: nothing from the query is ever reflected.
async fn respond(stream: &mut TcpStream, status: &str, message: &str) {
    let body = format!(
        "<!doctype html><html lang=\"es\"><meta charset=\"utf-8\"><title>Ink Writer</title><p>{message}</p></html>"
    );
    let reply = format!(
        "HTTP/1.1 {status}\r\nContent-Type: text/html; charset=utf-8\r\nContent-Length: {}\r\nConnection: close\r\nCache-Control: no-store\r\n\r\n{body}",
        body.len()
    );
    let _ = stream.write_all(reply.as_bytes()).await;
    let _ = stream.shutdown().await;
}

#[cfg(test)]
mod tests {
    use super::*;

    async fn get(port: u16, target: &str) -> String {
        let mut s = TcpStream::connect(("127.0.0.1", port)).await.unwrap();
        s.write_all(format!("GET {target} HTTP/1.1\r\nHost: x\r\n\r\n").as_bytes())
            .await
            .unwrap();
        let mut out = String::new();
        s.read_to_string(&mut out).await.unwrap();
        out
    }

    #[tokio::test]
    async fn only_listens_on_ipv4_loopback() {
        let l = Loopback::bind(0).await.unwrap();
        assert!(l.listener.local_addr().unwrap().ip().is_loopback());
        assert_ne!(l.port, 0);
    }

    #[tokio::test]
    async fn ignores_other_paths_and_rejected_queries_until_a_valid_one() {
        let l = Loopback::bind(0).await.unwrap();
        let port = l.port;
        let client = tokio::spawn(async move {
            let a = get(port, "/favicon.ico").await;
            let b = get(port, "/auth/callback?state=wrong").await;
            let c = get(port, "/auth/callback?state=good").await;
            (a, b, c)
        });
        let got = l
            .wait("/auth/callback", Duration::from_secs(5), |q| {
                if q == "state=good" {
                    Decision::Done(q.to_string())
                } else {
                    Decision::KeepWaiting
                }
            })
            .await
            .unwrap();
        assert_eq!(got, "state=good");
        let (a, b, c) = client.await.unwrap();
        assert!(a.starts_with("HTTP/1.1 404"));
        assert!(b.starts_with("HTTP/1.1 400"));
        assert!(c.starts_with("HTTP/1.1 200"));
    }

    #[tokio::test]
    async fn does_not_reflect_the_query() {
        let l = Loopback::bind(0).await.unwrap();
        let port = l.port;
        let client =
            tokio::spawn(async move { get(port, "/auth/callback?x=<script>alert(1)</script>").await });
        l.wait("/auth/callback", Duration::from_secs(5), |_| Decision::Done(()))
            .await
            .unwrap();
        assert!(!client.await.unwrap().contains("<script>"));
    }

    #[tokio::test]
    async fn times_out_without_a_callback() {
        let l = Loopback::bind(0).await.unwrap();
        let r = l
            .wait("/auth/callback", Duration::from_millis(50), |_| Decision::Done(()))
            .await;
        assert_eq!(r, Err(WaitError::Timeout));
    }
}
