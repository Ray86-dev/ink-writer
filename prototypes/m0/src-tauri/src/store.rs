//! Local persistence.
//!
//! - `state.json`: non-secret identifiers (host ID, issued client ID).
//! - `vault.bin`: tokens, AES-256-GCM encrypted. Only the 32-byte key lives in
//!   the OS credential store, because a Windows credential blob is capped at
//!   2560 bytes and a token set is larger. Writing one atomically renamed file
//!   also means a rotated refresh token can't be half saved.

use std::path::{Path, PathBuf};
use std::sync::Mutex;

use aes_gcm::aead::{Aead, KeyInit};
use aes_gcm::{Aes256Gcm, Key, Nonce};
use serde::{Deserialize, Serialize};
use serde::de::DeserializeOwned;

const SERVICE: &str = "ink-writer-m0";
const KEY_USER: &str = "vault-key";
const NONCE_LEN: usize = 12;

#[derive(Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct TokenSet {
    pub access_token: String,
    pub refresh_token: String,
    pub id_token: String,
    pub expires_at_unix: u64,
    pub scope: String,
}

impl std::fmt::Debug for TokenSet {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("TokenSet")
            .field("access_token", &"[redacted]")
            .field("refresh_token", &"[redacted]")
            .field("id_token", &"[redacted]")
            .field("expires_at_unix", &self.expires_at_unix)
            .field("scope", &self.scope)
            .finish()
    }
}

#[derive(Default, Serialize, Deserialize)]
pub struct Vault {
    pub chatgpt: Option<TokenSet>,
    pub openrouter_key: Option<String>,
}

impl Vault {
    /// Everything that must never appear in a report or a log.
    pub fn secrets(&self) -> Vec<String> {
        let mut out = Vec::new();
        if let Some(t) = &self.chatgpt {
            out.push(t.access_token.clone());
            out.push(t.refresh_token.clone());
            out.push(t.id_token.clone());
        }
        if let Some(k) = &self.openrouter_key {
            out.push(k.clone());
        }
        out
    }
}

#[derive(Default, Serialize, Deserialize)]
pub struct PublicState {
    pub host_id: Option<String>,
    pub chatgpt_client_id: Option<String>,
}

enum KeySource {
    OsCredentialStore,
    Fixed([u8; 32]),
}

pub struct Store {
    dir: PathBuf,
    key: KeySource,
    io: Mutex<()>,
}

impl Store {
    pub fn production() -> Result<Self, String> {
        let base = dirs::data_local_dir().ok_or("no local data directory")?;
        Ok(Self {
            dir: base.join("ink-writer-m0"),
            key: KeySource::OsCredentialStore,
            io: Mutex::new(()),
        })
    }

    /// Bypasses the OS credential store, for tests.
    pub fn with_key(dir: &Path, key: [u8; 32]) -> Self {
        Self {
            dir: dir.to_path_buf(),
            key: KeySource::Fixed(key),
            io: Mutex::new(()),
        }
    }

    pub fn dir(&self) -> &Path {
        &self.dir
    }

    pub fn reports_dir(&self) -> PathBuf {
        self.dir.join("reports")
    }

    fn state_path(&self) -> PathBuf {
        self.dir.join("state.json")
    }

    fn vault_path(&self) -> PathBuf {
        self.dir.join("vault.bin")
    }

    pub fn state(&self) -> Result<PublicState, String> {
        let _io = self.io.lock().map_err(|_| "store lock poisoned")?;
        read_json(&self.state_path())
    }

    pub fn update_state(&self, f: impl FnOnce(&mut PublicState)) -> Result<(), String> {
        let _io = self.io.lock().map_err(|_| "store lock poisoned")?;
        let mut s: PublicState = read_json(&self.state_path())?;
        f(&mut s);
        let bytes = serde_json::to_vec_pretty(&s).map_err(|e| e.to_string())?;
        atomic_write(&self.state_path(), &bytes)
    }

    /// Opaque, per installation, created once. Not derived from the user.
    pub fn host_id(&self) -> Result<String, String> {
        if let Some(id) = self.state()?.host_id {
            return Ok(id);
        }
        let id = format!("urn:uuid:{}", uuid::Uuid::new_v4().hyphenated());
        let stored = id.clone();
        self.update_state(|s| s.host_id = Some(stored))?;
        Ok(id)
    }

    pub fn vault(&self) -> Result<Vault, String> {
        let _io = self.io.lock().map_err(|_| "store lock poisoned")?;
        self.read_vault()
    }

    pub fn update_vault(&self, f: impl FnOnce(&mut Vault)) -> Result<(), String> {
        let _io = self.io.lock().map_err(|_| "store lock poisoned")?;
        let mut v = self.read_vault()?;
        f(&mut v);
        let plain = serde_json::to_vec(&v).map_err(|e| e.to_string())?;
        let cipher = Aes256Gcm::new(&Key::<Aes256Gcm>::from(self.key()?));
        let mut nonce = [0u8; NONCE_LEN];
        getrandom::fill(&mut nonce).map_err(|e| e.to_string())?;
        let sealed = cipher
            .encrypt(&Nonce::from(nonce), plain.as_slice())
            .map_err(|_| "vault encryption failed")?;
        let mut out = nonce.to_vec();
        out.extend_from_slice(&sealed);
        atomic_write(&self.vault_path(), &out)
    }

    fn read_vault(&self) -> Result<Vault, String> {
        let bytes = match std::fs::read(self.vault_path()) {
            Ok(b) => b,
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(Vault::default()),
            Err(e) => return Err(e.to_string()),
        };
        if bytes.len() < NONCE_LEN {
            return Err("vault file is truncated".into());
        }
        let (nonce, sealed) = bytes.split_at(NONCE_LEN);
        let nonce: [u8; NONCE_LEN] = nonce.try_into().map_err(|_| "bad vault nonce")?;
        let cipher = Aes256Gcm::new(&Key::<Aes256Gcm>::from(self.key()?));
        let plain = cipher
            .decrypt(&Nonce::from(nonce), sealed)
            .map_err(|_| "vault can't be decrypted: wrong key or modified file")?;
        serde_json::from_slice(&plain).map_err(|e| e.to_string())
    }

    fn key(&self) -> Result<[u8; 32], String> {
        match &self.key {
            KeySource::Fixed(k) => Ok(*k),
            KeySource::OsCredentialStore => os_store_key(),
        }
    }
}

fn os_store_key() -> Result<[u8; 32], String> {
    let entry = keyring::Entry::new(SERVICE, KEY_USER).map_err(|e| e.to_string())?;
    match entry.get_secret() {
        Ok(bytes) => bytes
            .try_into()
            .map_err(|_| "vault key in the credential store has the wrong length".to_string()),
        Err(keyring::Error::NoEntry) => {
            let mut key = [0u8; 32];
            getrandom::fill(&mut key).map_err(|e| e.to_string())?;
            entry.set_secret(&key).map_err(|e| e.to_string())?;
            Ok(key)
        }
        Err(e) => Err(e.to_string()),
    }
}

fn read_json<T: DeserializeOwned + Default>(path: &Path) -> Result<T, String> {
    match std::fs::read(path) {
        Ok(b) => serde_json::from_slice(&b).map_err(|e| format!("{}: {e}", path.display())),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(T::default()),
        Err(e) => Err(e.to_string()),
    }
}

/// Writes to a sibling temp file, syncs it, then renames over the target. A
/// crash leaves either the old file or the new one, never a partial one.
pub fn atomic_write(path: &Path, bytes: &[u8]) -> Result<(), String> {
    use std::io::Write;
    let dir = path.parent().ok_or("path has no parent")?;
    std::fs::create_dir_all(dir).map_err(|e| e.to_string())?;
    let name = path.file_name().ok_or("path has no file name")?.to_string_lossy();
    let tmp = dir.join(format!(".{name}.{}.tmp", uuid::Uuid::new_v4().simple()));
    let write = || -> std::io::Result<()> {
        let mut f = std::fs::File::create(&tmp)?;
        restrict_to_owner(&f)?;
        f.write_all(bytes)?;
        f.sync_all()?;
        drop(f);
        std::fs::rename(&tmp, path)
    };
    write().map_err(|e| {
        let _ = std::fs::remove_file(&tmp);
        e.to_string()
    })
}

#[cfg(unix)]
fn restrict_to_owner(f: &std::fs::File) -> std::io::Result<()> {
    use std::os::unix::fs::PermissionsExt;
    f.set_permissions(std::fs::Permissions::from_mode(0o600))
}

/// On Windows the file inherits the ACL of %LOCALAPPDATA%, private to the user.
#[cfg(not(unix))]
fn restrict_to_owner(_f: &std::fs::File) -> std::io::Result<()> {
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn tokens() -> TokenSet {
        TokenSet {
            access_token: "ACCESS-SECRET".into(),
            refresh_token: "REFRESH-SECRET".into(),
            id_token: "ID-SECRET".into(),
            expires_at_unix: 123,
            scope: "openid".into(),
        }
    }

    fn store(dir: &Path) -> Store {
        Store::with_key(dir, [7u8; 32])
    }

    #[test]
    fn vault_round_trips_and_is_encrypted_at_rest() {
        let d = tempfile::tempdir().unwrap();
        let s = store(d.path());
        s.update_vault(|v| v.chatgpt = Some(tokens())).unwrap();
        assert_eq!(s.vault().unwrap().chatgpt, Some(tokens()));
        let raw = std::fs::read(d.path().join("vault.bin")).unwrap();
        for secret in ["ACCESS-SECRET", "REFRESH-SECRET", "ID-SECRET"] {
            assert!(!raw.windows(secret.len()).any(|w| w == secret.as_bytes()));
        }
    }

    #[test]
    fn each_save_uses_a_new_nonce() {
        let d = tempfile::tempdir().unwrap();
        let s = store(d.path());
        s.update_vault(|v| v.chatgpt = Some(tokens())).unwrap();
        let a = std::fs::read(d.path().join("vault.bin")).unwrap();
        s.update_vault(|v| v.chatgpt = Some(tokens())).unwrap();
        let b = std::fs::read(d.path().join("vault.bin")).unwrap();
        assert_ne!(a[..NONCE_LEN], b[..NONCE_LEN]);
    }

    #[test]
    fn a_modified_vault_is_refused_not_silently_reset() {
        let d = tempfile::tempdir().unwrap();
        let s = store(d.path());
        s.update_vault(|v| v.chatgpt = Some(tokens())).unwrap();
        let p = d.path().join("vault.bin");
        let mut raw = std::fs::read(&p).unwrap();
        let last = raw.len() - 1;
        raw[last] ^= 1;
        std::fs::write(&p, raw).unwrap();
        assert!(s.vault().is_err());
        assert!(s.update_vault(|v| v.openrouter_key = Some("k".into())).is_err());
    }

    #[test]
    fn a_leftover_temp_file_does_not_affect_the_vault() {
        // What a crash between write and rename leaves behind.
        let d = tempfile::tempdir().unwrap();
        let s = store(d.path());
        s.update_vault(|v| v.chatgpt = Some(tokens())).unwrap();
        std::fs::write(d.path().join(".vault.bin.dead.tmp"), b"partial").unwrap();
        assert_eq!(s.vault().unwrap().chatgpt, Some(tokens()));
    }

    #[test]
    fn host_id_is_created_once_in_a_documented_format() {
        let d = tempfile::tempdir().unwrap();
        let s = store(d.path());
        let id = s.host_id().unwrap();
        assert!(id.starts_with("urn:uuid:"));
        assert_eq!(id.len(), "urn:uuid:".len() + 36);
        assert_eq!(s.host_id().unwrap(), id);
    }

    #[test]
    fn debug_output_hides_tokens() {
        let shown = format!("{:?}", tokens());
        assert!(!shown.contains("SECRET"));
    }
}
