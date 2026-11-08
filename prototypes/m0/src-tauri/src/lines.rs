//! Incremental line and SSE parsing over arbitrary network chunks.
//!
//! Bytes are buffered until a full line is available, so a multi-byte character
//! split between chunks is never corrupted. Spanish prose makes that common.

#[derive(Default)]
pub struct LineBuffer {
    buf: Vec<u8>,
}

impl LineBuffer {
    pub fn push(&mut self, chunk: &[u8]) -> Vec<String> {
        self.buf.extend_from_slice(chunk);
        let mut lines = Vec::new();
        while let Some(pos) = self.buf.iter().position(|b| *b == b'\n') {
            let mut line: Vec<u8> = self.buf.drain(..=pos).collect();
            line.pop();
            if line.last() == Some(&b'\r') {
                line.pop();
            }
            lines.push(String::from_utf8_lossy(&line).into_owned());
        }
        lines
    }

    /// What is left after the stream ends: a final line with no terminator.
    pub fn finish(&mut self) -> Option<String> {
        if self.buf.is_empty() {
            return None;
        }
        let rest = std::mem::take(&mut self.buf);
        Some(String::from_utf8_lossy(&rest).into_owned())
    }
}

#[derive(Debug, PartialEq, Eq)]
pub struct SseEvent {
    pub event: Option<String>,
    pub data: String,
}

#[derive(Default)]
pub struct SseParser {
    lines: LineBuffer,
    event: Option<String>,
    data: Vec<String>,
}

impl SseParser {
    pub fn push(&mut self, chunk: &[u8]) -> Vec<SseEvent> {
        let lines = self.lines.push(chunk);
        let mut out = Vec::new();
        for line in lines {
            self.line(line, &mut out);
        }
        out
    }

    /// Dispatches an unterminated last event, so a cut stream loses as little
    /// as possible. It does not make the stream a success: only a terminal
    /// event does.
    pub fn finish(&mut self) -> Vec<SseEvent> {
        let mut out = Vec::new();
        if let Some(line) = self.lines.finish() {
            self.line(line, &mut out);
        }
        self.dispatch(&mut out);
        out
    }

    fn line(&mut self, line: String, out: &mut Vec<SseEvent>) {
        if line.is_empty() {
            self.dispatch(out);
        } else if line.starts_with(':') {
            // Comment, such as OpenRouter's ": OPENROUTER PROCESSING".
        } else if let Some(v) = line.strip_prefix("data:") {
            self.data.push(v.strip_prefix(' ').unwrap_or(v).to_string());
        } else if let Some(v) = line.strip_prefix("event:") {
            self.event = Some(v.strip_prefix(' ').unwrap_or(v).to_string());
        }
    }

    fn dispatch(&mut self, out: &mut Vec<SseEvent>) {
        if self.data.is_empty() {
            self.event = None;
            return;
        }
        out.push(SseEvent {
            event: self.event.take(),
            data: std::mem::take(&mut self.data).join("\n"),
        });
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const STREAM: &str = "event: a\ndata: {\"x\":\"añó\"}\n\n: comment\r\ndata: uno\r\ndata: dos\r\n\r\ndata:sin espacio\n\n";

    fn expected() -> Vec<SseEvent> {
        vec![
            SseEvent {
                event: Some("a".into()),
                data: "{\"x\":\"añó\"}".into(),
            },
            SseEvent {
                event: None,
                data: "uno\ndos".into(),
            },
            SseEvent {
                event: None,
                data: "sin espacio".into(),
            },
        ]
    }

    #[test]
    fn parses_a_whole_buffer() {
        let mut p = SseParser::default();
        let mut got = p.push(STREAM.as_bytes());
        got.extend(p.finish());
        assert_eq!(got, expected());
    }

    #[test]
    fn survives_a_split_at_every_byte_boundary() {
        // Includes splits inside the two-byte "ñ" and "ó".
        let bytes = STREAM.as_bytes();
        for cut in 0..=bytes.len() {
            let mut p = SseParser::default();
            let mut got = p.push(&bytes[..cut]);
            got.extend(p.push(&bytes[cut..]));
            got.extend(p.finish());
            assert_eq!(got, expected(), "cut at byte {cut}");
        }
    }

    #[test]
    fn survives_one_byte_at_a_time() {
        let mut p = SseParser::default();
        let mut got = Vec::new();
        for b in STREAM.as_bytes() {
            got.extend(p.push(std::slice::from_ref(b)));
        }
        got.extend(p.finish());
        assert_eq!(got, expected());
    }

    #[test]
    fn flushes_an_unterminated_last_event() {
        let mut p = SseParser::default();
        assert!(p.push(b"data: partial").is_empty());
        assert_eq!(p.finish()[0].data, "partial");
    }

    #[test]
    fn line_buffer_returns_the_unterminated_tail() {
        let mut b = LineBuffer::default();
        assert_eq!(b.push(b"{\"a\":1}\n{\"b\""), vec!["{\"a\":1}".to_string()]);
        assert_eq!(b.finish().as_deref(), Some("{\"b\""));
        assert_eq!(b.finish(), None);
    }
}
