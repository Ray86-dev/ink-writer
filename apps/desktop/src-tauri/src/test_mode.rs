//! Test modes run the real app, with a database that isn't the user's, to check things only the
//! whole app can show: that it starts on each system, and that a forced close loses nothing.

use std::path::PathBuf;
use std::time::Duration;

use crate::ai::Bases;
use crate::research::ResearchBases;

const DEFAULT_TIMEOUT: Duration = Duration::from_secs(120);

#[derive(Debug, PartialEq, Eq)]
pub struct TestMode {
    /// Which check the page runs.
    pub name: String,
    /// Where the database goes. Without one, a fixed temporary folder that's emptied first.
    pub dir: Option<PathBuf>,
    /// A value for the check.
    pub arg: Option<String>,
    /// Where a stand-in for the AI services listens. A test never reaches the real ones.
    pub ai_base: Option<String>,
    pub timeout: Duration,
}

impl TestMode {
    /// `None` unless the app was started with `--test-mode=<name>`.
    pub fn from_args(args: impl IntoIterator<Item = String>) -> Option<Self> {
        let mut mode = None;
        let mut dir = None;
        let mut arg = None;
        let mut ai_base = None;
        let mut timeout = DEFAULT_TIMEOUT;
        for value in args {
            if let Some(name) = value.strip_prefix("--test-mode=") {
                mode = Some(name.to_string());
            } else if let Some(path) = value.strip_prefix("--test-dir=") {
                dir = Some(PathBuf::from(path));
            } else if let Some(text) = value.strip_prefix("--test-arg=") {
                arg = Some(text.to_string());
            } else if let Some(base) = value.strip_prefix("--test-ai=") {
                ai_base = Some(base.to_string());
            } else if let Some(seconds) = value.strip_prefix("--test-timeout=")
                && let Ok(seconds) = seconds.parse()
            {
                timeout = Duration::from_secs(seconds);
            }
        }
        mode.map(|name| Self {
            name,
            dir,
            arg,
            ai_base,
            timeout,
        })
    }

    /// The stand-in if there's one. Otherwise an address where nothing listens.
    pub fn ai_bases(&self) -> Bases {
        Bases::all_at(self.ai_base.as_deref().unwrap_or("http://127.0.0.1:1"))
    }

    /// The same stand-in answers the searches for documentation, each at its own path.
    pub fn research_bases(&self) -> ResearchBases {
        ResearchBases::all_at(self.ai_base.as_deref().unwrap_or("http://127.0.0.1:1"))
    }

    /// Where a test asks whether there's a newer version: the same stand-in, never GitHub.
    pub fn update_endpoint(&self) -> String {
        format!(
            "{}/update/latest.json",
            self.ai_base.as_deref().unwrap_or("http://127.0.0.1:1")
        )
    }

    /// Where this run's database folder is. It can never be the user's own data folder.
    pub fn data_dir(&self) -> PathBuf {
        match &self.dir {
            Some(dir) => dir.clone(),
            None => {
                let dir = std::env::temp_dir().join("ink-writer-test");
                let _ = std::fs::remove_dir_all(&dir);
                dir
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn parse(args: &[&str]) -> Option<TestMode> {
        TestMode::from_args(args.iter().map(|arg| arg.to_string()))
    }

    #[test]
    fn a_normal_start_has_no_test_mode() {
        assert_eq!(parse(&["ink-writer"]), None);
        // Other flags alone don't turn it on.
        assert_eq!(parse(&["ink-writer", "--test-dir=/tmp/x"]), None);
    }

    #[test]
    fn reads_every_option() {
        let mode = parse(&[
            "ink-writer",
            "--test-mode=crash-writer",
            "--test-dir=/tmp/x",
            "--test-arg=42",
            "--test-ai=http://127.0.0.1:4000",
            "--test-timeout=600",
        ])
        .unwrap();
        assert_eq!(mode.name, "crash-writer");
        assert_eq!(mode.dir, Some(PathBuf::from("/tmp/x")));
        assert_eq!(mode.arg.as_deref(), Some("42"));
        assert_eq!(mode.ai_bases().ollama, "http://127.0.0.1:4000");
        assert_eq!(mode.timeout, Duration::from_secs(600));
    }

    #[test]
    fn has_a_default_timeout_even_when_given_nonsense() {
        let mode = parse(&["--test-mode=smoke", "--test-timeout=soon"]).unwrap();
        assert_eq!(mode.timeout, DEFAULT_TIMEOUT);
    }

    #[test]
    fn without_a_stand_in_the_ai_services_are_out_of_reach() {
        let bases = parse(&["--test-mode=smoke"]).unwrap().ai_bases();
        assert_eq!(bases.openrouter, "http://127.0.0.1:1");
        assert_eq!(bases.ollama, "http://127.0.0.1:1");
        let research = parse(&["--test-mode=smoke"]).unwrap().research_bases();
        assert_eq!(research.overpass, "http://127.0.0.1:1");
        assert_eq!(research.wikipedia.as_deref(), Some("http://127.0.0.1:1"));
    }

    #[test]
    fn without_a_folder_it_uses_a_temporary_one() {
        let mode = parse(&["--test-mode=smoke"]).unwrap();
        assert!(mode.data_dir().starts_with(std::env::temp_dir()));
    }
}
