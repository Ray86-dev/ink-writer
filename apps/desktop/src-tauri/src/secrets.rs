//! Where the keys of the AI services live. They're read here, by the shell, and no command hands
//! one to the page (rule 9). They're never stored in the database either, which the page can query.

use std::path::PathBuf;
use std::sync::{Mutex, MutexGuard, PoisonError};

use crate::files::write_private_atomically;

const SERVICE: &str = "dev.inkwriter.desktop";

pub trait KeyStore: Send + Sync {
    fn get(&self) -> Result<Option<String>, String>;
    fn set(&self, key: &str) -> Result<(), String>;
    fn clear(&self) -> Result<(), String>;
}

/// The operating system's own store. Where there's none, as on a Linux desktop without a secret
/// service, a file that only its owner can read (SPEC §6).
pub struct SystemStore {
    account: &'static str,
    fallback: PathBuf,
}

impl SystemStore {
    /// `account` names the key in the system's store, one per service.
    pub fn new(account: &'static str, fallback: PathBuf) -> Self {
        Self { account, fallback }
    }

    fn entry(&self) -> Result<keyring::Entry, keyring::Error> {
        keyring::Entry::new(SERVICE, self.account)
    }

    fn read_fallback(&self) -> Result<Option<String>, String> {
        match std::fs::read_to_string(&self.fallback) {
            Ok(key) if key.trim().is_empty() => Ok(None),
            Ok(key) => Ok(Some(key.trim().to_string())),
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(None),
            Err(error) => Err(error.to_string()),
        }
    }

    fn clear_fallback(&self) -> Result<(), String> {
        match std::fs::remove_file(&self.fallback) {
            Err(error) if error.kind() != std::io::ErrorKind::NotFound => Err(error.to_string()),
            _ => Ok(()),
        }
    }
}

impl KeyStore for SystemStore {
    fn get(&self) -> Result<Option<String>, String> {
        match self.entry().and_then(|entry| entry.get_password()) {
            Ok(key) => Ok(Some(key)),
            // Not there, or no store at all: either way the file is the other place it can be.
            Err(_) => self.read_fallback(),
        }
    }

    fn set(&self, key: &str) -> Result<(), String> {
        match self.entry().and_then(|entry| entry.set_password(key)) {
            // One copy only: an older one in the file would outlive a later disconnection.
            Ok(()) => self.clear_fallback(),
            Err(_) => {
                if let Some(dir) = self.fallback.parent() {
                    std::fs::create_dir_all(dir).map_err(|error| error.to_string())?;
                }
                write_private_atomically(&self.fallback, key.as_bytes())
                    .map_err(|error| error.to_string())
            }
        }
    }

    fn clear(&self) -> Result<(), String> {
        let stored = match self.entry().and_then(|entry| entry.delete_credential()) {
            Ok(()) | Err(keyring::Error::NoEntry | keyring::Error::NoDefaultStore) => Ok(()),
            Err(error) => Err(error.to_string()),
        };
        self.clear_fallback().and(stored)
    }
}

/// For tests, which must never touch the user's real credentials.
#[derive(Default)]
pub struct MemoryStore {
    key: Mutex<Option<String>>,
}

impl KeyStore for MemoryStore {
    fn get(&self) -> Result<Option<String>, String> {
        Ok(lock(&self.key).clone())
    }

    fn set(&self, key: &str) -> Result<(), String> {
        *lock(&self.key) = Some(key.to_string());
        Ok(())
    }

    fn clear(&self) -> Result<(), String> {
        *lock(&self.key) = None;
        Ok(())
    }
}

/// One service's key, read from its store once, so that each request to a model doesn't go back to
/// the system for it.
pub struct Keys {
    store: Box<dyn KeyStore>,
    /// `None` until the first read.
    cached: Mutex<Option<Option<String>>>,
}

impl Keys {
    pub fn new(store: Box<dyn KeyStore>) -> Self {
        Self {
            store,
            cached: Mutex::new(None),
        }
    }

    pub fn get(&self) -> Result<Option<String>, String> {
        let mut cached = lock(&self.cached);
        if cached.is_none() {
            *cached = Some(self.store.get()?);
        }
        Ok(cached.clone().flatten())
    }

    pub fn set(&self, key: &str) -> Result<(), String> {
        let mut cached = lock(&self.cached);
        self.store.set(key)?;
        *cached = Some(Some(key.to_string()));
        Ok(())
    }

    /// Forgotten here even if the store fails, so that the app stops using it either way.
    pub fn clear(&self) -> Result<(), String> {
        let mut cached = lock(&self.cached);
        *cached = Some(None);
        self.store.clear()
    }
}

fn lock<T>(mutex: &Mutex<T>) -> MutexGuard<'_, T> {
    // Each change is a single assignment, so a poisoned lock still holds a whole value.
    mutex.lock().unwrap_or_else(PoisonError::into_inner)
}

#[cfg(test)]
mod tests {
    use std::sync::Arc;
    use std::sync::atomic::{AtomicUsize, Ordering};

    use super::*;

    /// Counts the reads, and fails whatever it's told to.
    #[derive(Default)]
    struct Probe {
        inner: MemoryStore,
        reads: Arc<AtomicUsize>,
        broken: bool,
    }

    impl KeyStore for Probe {
        fn get(&self) -> Result<Option<String>, String> {
            self.reads.fetch_add(1, Ordering::SeqCst);
            if self.broken {
                return Err("the store is locked".into());
            }
            self.inner.get()
        }

        fn set(&self, key: &str) -> Result<(), String> {
            if self.broken {
                return Err("the store is locked".into());
            }
            self.inner.set(key)
        }

        fn clear(&self) -> Result<(), String> {
            if self.broken {
                return Err("the store is locked".into());
            }
            self.inner.clear()
        }
    }

    #[test]
    fn keeps_a_key_until_it_is_cleared() {
        let keys = Keys::new(Box::new(MemoryStore::default()));
        assert_eq!(keys.get(), Ok(None));

        keys.set("sk-one").unwrap();
        assert_eq!(keys.get(), Ok(Some("sk-one".into())));

        keys.clear().unwrap();
        assert_eq!(keys.get(), Ok(None));
    }

    #[test]
    fn reads_the_store_only_once() {
        let reads = Arc::new(AtomicUsize::new(0));
        let probe = Probe {
            reads: reads.clone(),
            ..Probe::default()
        };
        probe.inner.set("sk-stored").unwrap();
        let keys = Keys::new(Box::new(probe));

        for _ in 0..3 {
            assert_eq!(keys.get(), Ok(Some("sk-stored".into())));
        }
        assert_eq!(reads.load(Ordering::SeqCst), 1);
    }

    #[test]
    fn a_key_that_could_not_be_stored_is_not_used() {
        let keys = Keys::new(Box::new(Probe {
            broken: true,
            ..Probe::default()
        }));

        assert!(keys.set("sk-lost").is_err());
        // The read fails too, rather than answering with a key that won't be there next time.
        assert!(keys.get().is_err());
    }

    #[test]
    fn stops_using_a_key_even_if_the_store_cannot_forget_it() {
        let reads = Arc::new(AtomicUsize::new(0));
        let probe = Probe {
            reads,
            ..Probe::default()
        };
        probe.inner.set("sk-stored").unwrap();
        let keys = Keys::new(Box::new(BrokenClear(probe)));
        assert_eq!(keys.get(), Ok(Some("sk-stored".into())));

        assert!(keys.clear().is_err());
        assert_eq!(keys.get(), Ok(None));
    }

    struct BrokenClear(Probe);

    impl KeyStore for BrokenClear {
        fn get(&self) -> Result<Option<String>, String> {
            self.0.get()
        }
        fn set(&self, key: &str) -> Result<(), String> {
            self.0.set(key)
        }
        fn clear(&self) -> Result<(), String> {
            Err("the store is locked".into())
        }
    }

    /// Goes through the real store of whoever runs it, under a name of its own, so it's run by
    /// hand: `cargo test --lib system_store -- --ignored`.
    #[test]
    #[ignore = "writes to the real credential store of this machine"]
    fn the_system_store_keeps_a_key_until_it_is_cleared() {
        let dir = tempfile::tempdir().unwrap();
        let store = SystemStore {
            account: "test-entry",
            fallback: dir.path().join("key"),
        };
        store.clear().unwrap();
        assert_eq!(store.get(), Ok(None));

        store.set("sk-test-ñ").unwrap();
        assert_eq!(store.get(), Ok(Some("sk-test-ñ".into())));
        // It went to the system's store, not to the file.
        assert!(!store.fallback.exists());

        store.clear().unwrap();
        store.clear().unwrap();
        assert_eq!(store.get(), Ok(None));
    }

    #[test]
    fn the_file_keeps_a_key_where_there_is_no_system_store() {
        let dir = tempfile::tempdir().unwrap();
        let store = SystemStore::new("openrouter-key", dir.path().join("keys").join("openrouter"));
        assert_eq!(store.read_fallback(), Ok(None));
        assert_eq!(store.account, "openrouter-key");

        std::fs::create_dir_all(dir.path().join("keys")).unwrap();
        write_private_atomically(&store.fallback, b"sk-in-a-file\n").unwrap();
        assert_eq!(store.read_fallback(), Ok(Some("sk-in-a-file".into())));

        store.clear_fallback().unwrap();
        store.clear_fallback().unwrap();
        assert_eq!(store.read_fallback(), Ok(None));
    }
}
