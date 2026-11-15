//! How the app looks things up for the documentation (SPEC §7). The page never sends an address or
//! free text: it says which kind of search and gives a short term or a pair of coordinates, and the
//! address is built here. So whatever goes wrong in the page, the author's text can't leave through
//! a search, and a search can only go to the few public services listed below (rule 5).
//!
//! None of them takes a key. Each search is counted against a daily limit by whoever calls `run`.

use std::collections::HashMap;
use std::sync::{Mutex, PoisonError};
use std::time::{Duration, Instant};

use futures_util::StreamExt;
use serde::{Deserialize, Serialize};

const CONNECT_TIMEOUT: Duration = Duration::from_secs(10);
const TOTAL_TIMEOUT: Duration = Duration::from_secs(40);
/// A term is a topic, not a passage: a place, a trade, an object.
pub const MAX_TERM_CHARS: usize = 80;
/// More than any of these answers needs. A longer one is cut off as a failure.
const MAX_BODY_BYTES: usize = 2 * 1024 * 1024;
/// What the public services ask for after they say "too many requests".
const BACK_OFF: Duration = Duration::from_secs(30);
/// Open-Meteo's archive starts here.
const FIRST_CLIMATE_YEAR: u16 = 1940;
const MAX_CLIMATE_YEARS: u16 = 10;

#[derive(Debug, Clone, PartialEq, Deserialize)]
#[serde(
    tag = "kind",
    rename_all = "lowercase",
    rename_all_fields = "camelCase"
)]
pub enum ResearchRequest {
    /// Where a real place is, by its name.
    Geocode { term: String, language: String },
    /// Named streets and premises around a point, as they are today.
    Nearby { lat: f64, lon: f64 },
    /// Daily temperatures and rain at a point, over whole years.
    Climate {
        lat: f64,
        lon: f64,
        first_year: u16,
        last_year: u16,
    },
    /// Encyclopedia articles about a topic.
    Wiki { term: String, language: String },
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
enum Service {
    Nominatim,
    Overpass,
    OpenMeteo,
    Wikipedia,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct ResearchAnswer {
    pub status: u16,
    pub body: String,
}

/// Where each service is. Only a test points these anywhere else.
#[derive(Debug, Clone)]
pub struct ResearchBases {
    pub nominatim: String,
    pub overpass: String,
    pub open_meteo: String,
    /// `None` for the real one, which has an address per language.
    pub wikipedia: Option<String>,
}

impl Default for ResearchBases {
    fn default() -> Self {
        Self {
            nominatim: "https://nominatim.openstreetmap.org".into(),
            overpass: "https://overpass-api.de".into(),
            open_meteo: "https://archive-api.open-meteo.com".into(),
            wikipedia: None,
        }
    }
}

impl ResearchBases {
    /// Every service at one address, for a test with a stand-in server.
    pub fn all_at(base: &str) -> Self {
        Self {
            nominatim: base.into(),
            overpass: base.into(),
            open_meteo: base.into(),
            wikipedia: Some(base.into()),
        }
    }
}

#[derive(Debug, PartialEq)]
struct Prepared {
    service: Service,
    url: String,
    /// Sent as a form, for the one service that wants a POST.
    form: Option<(&'static str, String)>,
}

fn checked_term(term: &str) -> Result<&str, String> {
    let term = term.trim();
    if term.is_empty() {
        return Err("term: there's nothing to search for".into());
    }
    if term.chars().count() > MAX_TERM_CHARS {
        return Err(format!(
            "term: a search term can't be longer than {MAX_TERM_CHARS} characters"
        ));
    }
    if term.chars().any(char::is_control) {
        return Err("term: a search term is a single line".into());
    }
    Ok(term)
}

fn checked_language(language: &str) -> Result<&str, String> {
    let fine =
        (2..=3).contains(&language.len()) && language.bytes().all(|b| b.is_ascii_lowercase());
    if fine {
        Ok(language)
    } else {
        Err(format!("\"{language}\" isn't a language code"))
    }
}

fn checked_point(lat: f64, lon: f64) -> Result<(), String> {
    if lat.is_finite() && lon.is_finite() && lat.abs() <= 90.0 && lon.abs() <= 180.0 {
        Ok(())
    } else {
        Err("that isn't a point on the map".into())
    }
}

fn with_query(base: &str, path: &str, pairs: &[(&str, &str)]) -> Result<String, String> {
    let mut url = url::Url::parse(&format!("{base}{path}")).map_err(|error| error.to_string())?;
    url.query_pairs_mut().extend_pairs(pairs);
    Ok(url.into())
}

/// The whole of what may be asked. Anything else in the request is refused before it leaves.
fn prepare(request: &ResearchRequest, bases: &ResearchBases) -> Result<Prepared, String> {
    match request {
        ResearchRequest::Geocode { term, language } => Ok(Prepared {
            service: Service::Nominatim,
            url: with_query(
                &bases.nominatim,
                "/search",
                &[
                    ("q", checked_term(term)?),
                    ("format", "jsonv2"),
                    ("limit", "5"),
                    ("accept-language", checked_language(language)?),
                ],
            )?,
            form: None,
        }),
        ResearchRequest::Nearby { lat, lon } => {
            checked_point(*lat, *lon)?;
            let at = format!("{lat:.4},{lon:.4}");
            let query = format!(
                "[out:json][timeout:20];\
                 way(around:250,{at})[\"highway\"][\"name\"];out tags 60;\
                 (nwr(around:350,{at})[\"amenity\"~\"^(cafe|bar|pub|restaurant|pharmacy|library|marketplace|theatre|cinema|place_of_worship)$\"][\"name\"];\
                 nwr(around:350,{at})[\"shop\"~\"^(bakery|books)$\"][\"name\"];);out tags center 40;"
            );
            Ok(Prepared {
                service: Service::Overpass,
                url: format!("{}/api/interpreter", bases.overpass),
                form: Some(("data", query)),
            })
        }
        ResearchRequest::Climate {
            lat,
            lon,
            first_year,
            last_year,
        } => {
            checked_point(*lat, *lon)?;
            let fine = *first_year >= FIRST_CLIMATE_YEAR
                && first_year <= last_year
                && last_year - first_year < MAX_CLIMATE_YEARS
                && *last_year <= 2200;
            if !fine {
                return Err("those years can't be asked for".into());
            }
            Ok(Prepared {
                service: Service::OpenMeteo,
                url: with_query(
                    &bases.open_meteo,
                    "/v1/archive",
                    &[
                        ("latitude", &format!("{lat:.4}")),
                        ("longitude", &format!("{lon:.4}")),
                        ("start_date", &format!("{first_year}-01-01")),
                        ("end_date", &format!("{last_year}-12-31")),
                        (
                            "daily",
                            "temperature_2m_max,temperature_2m_min,precipitation_sum",
                        ),
                        ("timezone", "UTC"),
                    ],
                )?,
                form: None,
            })
        }
        ResearchRequest::Wiki { term, language } => {
            let language = checked_language(language)?;
            let base = match &bases.wikipedia {
                Some(base) => base.clone(),
                None => format!("https://{language}.wikipedia.org"),
            };
            Ok(Prepared {
                service: Service::Wikipedia,
                url: with_query(
                    &base,
                    "/w/api.php",
                    &[
                        ("action", "query"),
                        ("format", "json"),
                        ("formatversion", "2"),
                        ("generator", "search"),
                        ("gsrsearch", checked_term(term)?),
                        ("gsrlimit", "3"),
                        ("prop", "extracts|info|pageprops"),
                        ("exintro", "1"),
                        ("explaintext", "1"),
                        ("exlimit", "3"),
                        ("exchars", "500"),
                        ("inprop", "url"),
                        ("ppprop", "disambiguation"),
                        ("redirects", "1"),
                    ],
                )?,
                form: None,
            })
        }
    }
}

pub struct ResearchClient {
    http: reqwest::Client,
    bases: ResearchBases,
    /// Until when each service asked to be left alone.
    resting: Mutex<HashMap<Service, Instant>>,
}

impl ResearchClient {
    pub fn new(bases: ResearchBases) -> Result<Self, String> {
        let http = reqwest::Client::builder()
            .connect_timeout(CONNECT_TIMEOUT)
            .timeout(TOTAL_TIMEOUT)
            // The services are named here: an answer can't send the search anywhere else.
            .redirect(reqwest::redirect::Policy::none())
            // These services ask every program to say what it is.
            .user_agent(concat!("ink-writer/", env!("CARGO_PKG_VERSION")))
            .build()
            .map_err(|error| error.to_string())?;
        Ok(Self {
            http,
            bases,
            resting: Mutex::default(),
        })
    }

    /// `Err` starts with `wait:` while the service asked for a pause, and with `term:` for a term
    /// that can't be searched. In both cases nothing was sent.
    pub fn check(&self, request: &ResearchRequest) -> Result<(), String> {
        let prepared = prepare(request, &self.bases)?;
        self.rested(prepared.service, Instant::now())
    }

    /// Sends one search and returns the whole answer, whatever its status.
    pub async fn run(&self, request: &ResearchRequest) -> Result<ResearchAnswer, String> {
        let prepared = prepare(request, &self.bases)?;
        self.rested(prepared.service, Instant::now())?;
        let builder = match &prepared.form {
            Some((name, value)) => self
                .http
                .post(&prepared.url)
                .header("content-type", "application/x-www-form-urlencoded")
                .body(
                    url::form_urlencoded::Serializer::new(String::new())
                        .append_pair(name, value)
                        .finish(),
                ),
            None => self.http.get(&prepared.url),
        };
        let response = builder.send().await.map_err(describe)?;
        let status = response.status().as_u16();
        self.note(prepared.service, status, Instant::now());

        let mut body = Vec::new();
        let mut stream = response.bytes_stream();
        while let Some(piece) = stream.next().await {
            body.extend_from_slice(&piece.map_err(describe)?);
            if body.len() > MAX_BODY_BYTES {
                return Err("the answer is too long".into());
            }
        }
        Ok(ResearchAnswer {
            status,
            body: String::from_utf8_lossy(&body).into_owned(),
        })
    }

    fn rested(&self, service: Service, now: Instant) -> Result<(), String> {
        match self.lock().get(&service) {
            Some(until) if *until > now => Err(format!(
                "wait: the service asked for a pause of {} s",
                until.duration_since(now).as_secs().max(1)
            )),
            _ => Ok(()),
        }
    }

    fn note(&self, service: Service, status: u16, now: Instant) {
        if matches!(status, 406 | 429 | 503 | 504) {
            self.lock().insert(service, now + BACK_OFF);
        }
    }

    fn lock(&self) -> std::sync::MutexGuard<'_, HashMap<Service, Instant>> {
        self.resting.lock().unwrap_or_else(PoisonError::into_inner)
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

#[cfg(test)]
mod tests {
    use tokio::io::{AsyncReadExt, AsyncWriteExt};
    use tokio::net::TcpListener;
    use tokio::task::JoinHandle;

    use super::*;

    fn real() -> ResearchBases {
        ResearchBases::default()
    }

    fn wiki(term: &str) -> ResearchRequest {
        ResearchRequest::Wiki {
            term: term.into(),
            language: "es".into(),
        }
    }

    /// Answers one request with `reply` and returns what it received.
    async fn serve_once(reply: &'static [u8]) -> (String, JoinHandle<String>) {
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
            socket.write_all(reply).await.unwrap();
            socket.shutdown().await.ok();
            String::from_utf8_lossy(&received).to_string()
        });
        (base, handle)
    }

    #[test]
    fn reads_what_the_page_sends() {
        let climate: ResearchRequest = serde_json::from_str(
            r#"{"kind":"climate","lat":40.4,"lon":-3.7,"firstYear":2021,"lastYear":2025}"#,
        )
        .unwrap();
        assert_eq!(
            climate,
            ResearchRequest::Climate {
                lat: 40.4,
                lon: -3.7,
                first_year: 2021,
                last_year: 2025
            }
        );
        // The page can't name an address: there's no kind that takes one.
        assert!(
            serde_json::from_str::<ResearchRequest>(r#"{"kind":"fetch","url":"https://x"}"#)
                .is_err()
        );
    }

    #[test]
    fn each_search_goes_to_its_own_service_and_carries_only_the_term() {
        let geocode = prepare(
            &ResearchRequest::Geocode {
                term: " Lavapiés, Madrid ".into(),
                language: "es".into(),
            },
            &real(),
        )
        .unwrap();
        assert_eq!(
            geocode.url,
            "https://nominatim.openstreetmap.org/search?q=Lavapi%C3%A9s%2C+Madrid&format=jsonv2&limit=5&accept-language=es"
        );

        let article = prepare(&wiki("relojero"), &real()).unwrap();
        assert!(
            article
                .url
                .starts_with("https://es.wikipedia.org/w/api.php?action=query&"),
            "{}",
            article.url
        );
        assert!(article.url.contains("&gsrsearch=relojero&"));
        assert_eq!(article.form, None);
    }

    #[test]
    fn a_search_around_a_point_carries_only_the_point() {
        let nearby = prepare(
            &ResearchRequest::Nearby {
                lat: 40.408_453_9,
                lon: -3.700_661_3,
            },
            &real(),
        )
        .unwrap();
        assert_eq!(nearby.url, "https://overpass-api.de/api/interpreter");
        let (name, query) = nearby.form.unwrap();
        assert_eq!(name, "data");
        // Rounded: some ten metres is all a neighbourhood needs.
        assert!(query.contains("around:250,40.4085,-3.7007"), "{query}");

        let climate = prepare(
            &ResearchRequest::Climate {
                lat: 40.408_453_9,
                lon: -3.700_661_3,
                first_year: 2021,
                last_year: 2025,
            },
            &real(),
        )
        .unwrap();
        assert_eq!(
            climate.url,
            "https://archive-api.open-meteo.com/v1/archive?latitude=40.4085&longitude=-3.7007&start_date=2021-01-01&end_date=2025-12-31&daily=temperature_2m_max%2Ctemperature_2m_min%2Cprecipitation_sum&timezone=UTC"
        );
    }

    #[test]
    fn a_passage_of_the_novel_is_not_a_search_term() {
        let passage = "—¿Qué ocurrió? —preguntó Tomás, con los ojos verdes de su madre, \
                       mientras la lluvia caía sobre la plaza.";
        for term in [passage, "", "   ", "dos\nlíneas"] {
            for request in [
                wiki(term),
                ResearchRequest::Geocode {
                    term: term.into(),
                    language: "es".into(),
                },
            ] {
                let refused = prepare(&request, &real()).unwrap_err();
                assert!(refused.starts_with("term: "), "{refused}");
            }
        }
        // Eighty characters, counted as characters and not as bytes.
        assert!(prepare(&wiki(&"ñ".repeat(MAX_TERM_CHARS)), &real()).is_ok());
        assert!(prepare(&wiki(&"ñ".repeat(MAX_TERM_CHARS + 1)), &real()).is_err());
    }

    #[test]
    fn the_language_cannot_name_another_site() {
        for language in ["", "e", "evil.example/", "ES", "es.x", "abcd"] {
            let request = ResearchRequest::Wiki {
                term: "relojero".into(),
                language: language.into(),
            };
            assert!(prepare(&request, &real()).is_err(), "{language}");
        }
    }

    #[test]
    fn refuses_points_and_years_that_make_no_sense() {
        for (lat, lon) in [
            (91.0, 0.0),
            (0.0, 181.0),
            (f64::NAN, 0.0),
            (0.0, f64::INFINITY),
        ] {
            assert!(prepare(&ResearchRequest::Nearby { lat, lon }, &real()).is_err());
        }
        for (first_year, last_year) in [(1900, 1901), (2025, 2021), (2000, 2025), (2199, 2201)] {
            let request = ResearchRequest::Climate {
                lat: 0.0,
                lon: 0.0,
                first_year,
                last_year,
            };
            assert!(prepare(&request, &real()).is_err(), "{first_year}");
        }
    }

    #[tokio::test]
    async fn returns_the_whole_answer_and_sends_no_credential() {
        let (base, server) =
            serve_once(b"HTTP/1.1 200 OK\r\nContent-Length: 13\r\n\r\n{\"query\":{}}\n").await;
        let client = ResearchClient::new(ResearchBases::all_at(&base)).unwrap();

        let answer = client.run(&wiki("relojero")).await.unwrap();

        assert_eq!(answer.status, 200);
        assert_eq!(answer.body, "{\"query\":{}}\n");
        let sent = server.await.unwrap().to_ascii_lowercase();
        assert!(sent.starts_with("get /w/api.php?action=query&"), "{sent}");
        assert!(sent.contains("user-agent: ink-writer/"));
        assert!(!sent.contains("authorization"));
        assert!(!sent.contains("cookie"));
    }

    #[tokio::test]
    async fn the_search_around_a_point_is_posted_as_a_form() {
        let (base, server) = serve_once(b"HTTP/1.1 200 OK\r\nContent-Length: 2\r\n\r\n{}").await;
        let client = ResearchClient::new(ResearchBases::all_at(&base)).unwrap();

        let answer = client
            .run(&ResearchRequest::Nearby {
                lat: 40.0,
                lon: -3.0,
            })
            .await
            .unwrap();

        assert_eq!(answer.status, 200);
        let sent = server.await.unwrap();
        assert!(
            sent.starts_with("POST /api/interpreter HTTP/1.1\r\n"),
            "{sent}"
        );
        assert!(sent.contains("data=%5Bout%3Ajson%5D"), "{sent}");
    }

    #[tokio::test]
    async fn after_too_many_requests_it_leaves_that_service_alone_for_a_while() {
        let (base, server) =
            serve_once(b"HTTP/1.1 429 Too Many Requests\r\nContent-Length: 0\r\n\r\n").await;
        let client = ResearchClient::new(ResearchBases::all_at(&base)).unwrap();

        let answer = client.run(&wiki("relojero")).await.unwrap();
        assert_eq!(answer.status, 429);
        server.await.unwrap();

        // Nothing listens any more: a second request would fail to connect, not be told to wait.
        let refused = client.run(&wiki("tranvía")).await.unwrap_err();
        assert!(refused.starts_with("wait: "), "{refused}");
        assert!(client.check(&wiki("tranvía")).is_err());
        // The other services didn't complain.
        assert_eq!(
            client.check(&ResearchRequest::Nearby { lat: 0.0, lon: 0.0 }),
            Ok(())
        );
        // And the pause ends.
        assert_eq!(
            client.rested(Service::Wikipedia, Instant::now() + BACK_OFF),
            Ok(())
        );
    }

    #[tokio::test]
    async fn a_redirect_is_not_followed() {
        let (base, server) = serve_once(
            b"HTTP/1.1 302 Found\r\nLocation: http://127.0.0.1:1/elsewhere\r\nContent-Length: 0\r\n\r\n",
        )
        .await;
        let client = ResearchClient::new(ResearchBases::all_at(&base)).unwrap();

        let answer = client.run(&wiki("relojero")).await.unwrap();

        assert_eq!(answer.status, 302);
        server.await.unwrap();
    }
}
