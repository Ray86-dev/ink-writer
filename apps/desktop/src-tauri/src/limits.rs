//! How many requests of one kind the app may make in a day: the paid ones to a model, and the
//! searches for documentation. It's counted here, in the shell, so that a fault in the page can't go
//! past what the author allowed (rule 10). Zero means that nothing of that kind is ever sent.

use std::path::PathBuf;
use std::sync::{Mutex, MutexGuard, PoisonError};
use std::time::{SystemTime, UNIX_EPOCH};

use serde::{Deserialize, Serialize};

use crate::files::write_atomically;

#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize)]
struct Stored {
    /// The most requests in one day. Zero turns them off.
    daily_requests: u32,
    /// The day `used` belongs to, as days since 1970 in UTC.
    day: u64,
    used: u32,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LimitsView {
    pub daily_requests: u32,
    pub used_today: u32,
}

pub struct DailyLimit {
    path: PathBuf,
    /// What's counted, as the refusals name it.
    what: &'static str,
    state: Mutex<Stored>,
}

/// How many searches a day until the author says otherwise. The public services ask for restraint:
/// Overpass, some hundred queries a day from one user.
pub const DEFAULT_DAILY_SEARCHES: u32 = 60;

/// Days since 1970 in UTC: all a daily count needs to tell one day from the next.
pub fn today() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|elapsed| elapsed.as_secs() / 86_400)
        .unwrap_or(0)
}

impl DailyLimit {
    /// Paid requests to a model. Off until the author sets a limit.
    pub fn paid(path: PathBuf) -> Self {
        Self::open(path, "paid requests", 0)
    }

    /// Searches for documentation. They cost nothing, so they start with a modest limit.
    pub fn searches(path: PathBuf) -> Self {
        Self::open(path, "searches", DEFAULT_DAILY_SEARCHES)
    }

    /// Without a file, `default_daily`. What's stored and can't be read counts as nothing allowed,
    /// never as no limit.
    fn open(path: PathBuf, what: &'static str, default_daily: u32) -> Self {
        let stored = match std::fs::read(&path) {
            Ok(bytes) => serde_json::from_slice(&bytes).unwrap_or_default(),
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => Stored {
                daily_requests: default_daily,
                ..Stored::default()
            },
            Err(_) => Stored::default(),
        };
        Self {
            path,
            what,
            state: Mutex::new(stored),
        }
    }

    pub fn view(&self, today: u64) -> LimitsView {
        let state = self.lock();
        LimitsView {
            daily_requests: state.daily_requests,
            used_today: if state.day == today { state.used } else { 0 },
        }
    }

    pub fn is_on(&self) -> bool {
        self.lock().daily_requests > 0
    }

    /// Only the author changes this, from the settings.
    pub fn set_daily_requests(&self, daily_requests: u32) -> Result<(), String> {
        let mut state = self.lock();
        let next = Stored {
            daily_requests,
            ..*state
        };
        self.save(&next)?;
        *state = next;
        Ok(())
    }

    /// Counts one request, before it's sent. Refuses, counting nothing, once the day's limit
    /// is reached, and also if the count can't be saved: an uncounted request could be the first
    /// of many.
    pub fn spend(&self, today: u64) -> Result<(), String> {
        let mut state = self.lock();
        let used = if state.day == today { state.used } else { 0 };
        if used >= state.daily_requests {
            return Err(if state.daily_requests == 0 {
                format!("limit: {} are off", self.what)
            } else {
                format!(
                    "limit: the {} {} allowed today are used up",
                    state.daily_requests, self.what
                )
            });
        }
        let next = Stored {
            day: today,
            used: used + 1,
            ..*state
        };
        self.save(&next)?;
        *state = next;
        Ok(())
    }

    fn save(&self, stored: &Stored) -> Result<(), String> {
        if let Some(dir) = self.path.parent() {
            std::fs::create_dir_all(dir).map_err(|error| format!("limit: {error}"))?;
        }
        let bytes = serde_json::to_vec(stored).map_err(|error| format!("limit: {error}"))?;
        write_atomically(&self.path, &bytes).map_err(|error| format!("limit: {error}"))
    }

    fn lock(&self) -> MutexGuard<'_, Stored> {
        // A change is one assignment, made only after it's saved: a poisoned lock holds a whole value.
        self.state.lock().unwrap_or_else(PoisonError::into_inner)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn limits() -> (tempfile::TempDir, DailyLimit) {
        let dir = tempfile::tempdir().unwrap();
        let limits = DailyLimit::paid(dir.path().join("ai-limits.json"));
        (dir, limits)
    }

    #[test]
    fn nothing_paid_is_allowed_until_the_author_says_so() {
        let (_dir, limits) = limits();

        assert!(!limits.is_on());
        assert_eq!(
            limits.spend(100),
            Err("limit: paid requests are off".into())
        );
        assert_eq!(
            limits.view(100),
            LimitsView {
                daily_requests: 0,
                used_today: 0
            }
        );
    }

    #[test]
    fn counts_up_to_the_limit_and_then_refuses_without_counting() {
        let (_dir, limits) = limits();
        limits.set_daily_requests(2).unwrap();

        assert_eq!(limits.spend(100), Ok(()));
        assert_eq!(limits.spend(100), Ok(()));
        let refused = limits.spend(100).unwrap_err();

        assert!(
            refused.starts_with("limit: the 2 paid requests"),
            "{refused}"
        );
        assert_eq!(limits.view(100).used_today, 2);
    }

    #[test]
    fn starts_again_the_next_day() {
        let (_dir, limits) = limits();
        limits.set_daily_requests(1).unwrap();
        limits.spend(100).unwrap();
        assert!(limits.spend(100).is_err());

        assert_eq!(limits.view(101).used_today, 0);
        assert_eq!(limits.spend(101), Ok(()));
        assert_eq!(limits.view(101).used_today, 1);
    }

    #[test]
    fn remembers_the_limit_and_the_count_after_a_restart() {
        let (dir, limits) = limits();
        limits.set_daily_requests(3).unwrap();
        limits.spend(100).unwrap();
        limits.spend(100).unwrap();
        drop(limits);

        let reopened = DailyLimit::paid(dir.path().join("ai-limits.json"));

        assert_eq!(
            reopened.view(100),
            LimitsView {
                daily_requests: 3,
                used_today: 2
            }
        );
        assert_eq!(reopened.spend(100), Ok(()));
        assert!(reopened.spend(100).is_err());
    }

    #[test]
    fn lowering_the_limit_takes_effect_at_once_and_zero_turns_paid_off() {
        let (_dir, limits) = limits();
        limits.set_daily_requests(5).unwrap();
        limits.spend(100).unwrap();
        limits.spend(100).unwrap();

        limits.set_daily_requests(2).unwrap();
        assert!(limits.spend(100).is_err());

        limits.set_daily_requests(0).unwrap();
        assert!(!limits.is_on());
        assert_eq!(
            limits.spend(101),
            Err("limit: paid requests are off".into())
        );
    }

    #[test]
    fn a_file_that_cannot_be_read_means_nothing_allowed() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("ai-limits.json");
        std::fs::write(&path, b"{ not json").unwrap();

        let limits = DailyLimit::paid(path);

        assert!(!limits.is_on());
    }

    #[test]
    fn refuses_rather_than_send_a_request_it_could_not_count() {
        let dir = tempfile::tempdir().unwrap();
        // A folder where the file should be: saving fails.
        let path = dir.path().join("ai-limits.json");
        std::fs::create_dir(&path).unwrap();
        let limits = DailyLimit::paid(path);
        // The limit itself can't be saved either, so it's set as a restart would have left it.
        *limits.lock() = Stored {
            daily_requests: 5,
            day: 100,
            used: 0,
        };

        assert!(limits.spend(100).is_err());
        assert_eq!(limits.view(100).used_today, 0);
    }

    #[test]
    fn searches_start_with_a_limit_of_their_own_and_say_what_ran_out() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("search-limits.json");
        let searches = DailyLimit::searches(path.clone());

        assert_eq!(searches.view(100).daily_requests, DEFAULT_DAILY_SEARCHES);
        assert_eq!(searches.spend(100), Ok(()));

        searches.set_daily_requests(1).unwrap();
        let refused = searches.spend(100).unwrap_err();
        assert!(refused.starts_with("limit: the 1 searches"), "{refused}");

        // Turned off by the author, it stays off after a restart: the default is only for no file.
        searches.set_daily_requests(0).unwrap();
        drop(searches);
        let reopened = DailyLimit::searches(path.clone());
        assert!(!reopened.is_on());
        assert_eq!(reopened.spend(101), Err("limit: searches are off".into()));

        std::fs::write(&path, b"{ not json").unwrap();
        assert!(!DailyLimit::searches(path).is_on());
    }
}
