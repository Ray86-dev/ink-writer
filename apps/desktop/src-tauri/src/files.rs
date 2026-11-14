//! Writing files the author asked for, without ever leaving a partial one behind.

use std::io::Write;
use std::path::Path;

/// Writes to a temporary file beside the target, syncs it, then renames it over the target. If
/// anything fails or the process dies, the target is either the old file or the new one, whole.
pub fn write_atomically(path: &Path, bytes: &[u8]) -> std::io::Result<()> {
    write(path, bytes, false)
}

/// The same, for a secret: where the system allows it, only its owner can read the file, and from
/// before anything is written to it.
pub fn write_private_atomically(path: &Path, bytes: &[u8]) -> std::io::Result<()> {
    write(path, bytes, true)
}

fn write(path: &Path, bytes: &[u8], private: bool) -> std::io::Result<()> {
    let dir = path
        .parent()
        .filter(|parent| !parent.as_os_str().is_empty())
        .unwrap_or(Path::new("."));
    let name = path
        .file_name()
        .ok_or_else(|| std::io::Error::other("the path has no file name"))?
        .to_string_lossy();
    let temporary = dir.join(format!(".{name}.{}.tmp", std::process::id()));
    let result = (|| {
        let mut options = std::fs::OpenOptions::new();
        options.write(true).create(true).truncate(true);
        #[cfg(unix)]
        if private {
            use std::os::unix::fs::OpenOptionsExt;
            // A leftover from a crash could have other permissions, and `mode` only applies to
            // a file that's created.
            let _ = std::fs::remove_file(&temporary);
            options.mode(0o600);
        }
        #[cfg(not(unix))]
        let _ = private;
        let mut file = options.open(&temporary)?;
        file.write_all(bytes)?;
        file.sync_all()?;
        drop(file);
        std::fs::rename(&temporary, path)
    })();
    if result.is_err() {
        let _ = std::fs::remove_file(&temporary);
    }
    result
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::tempdir;

    #[test]
    fn writes_a_new_file() {
        let dir = tempdir().unwrap();
        let path = dir.path().join("novela.docx");
        write_atomically(&path, b"datos").unwrap();
        assert_eq!(std::fs::read(&path).unwrap(), b"datos");
    }

    #[cfg(unix)]
    #[test]
    fn a_private_file_is_readable_only_by_its_owner() {
        use std::os::unix::fs::PermissionsExt;
        let dir = tempdir().unwrap();
        let path = dir.path().join("key");
        write_private_atomically(&path, b"secret").unwrap();
        let mode = std::fs::metadata(&path).unwrap().permissions().mode();
        assert_eq!(mode & 0o777, 0o600);
    }

    #[test]
    fn writes_a_private_file_and_replaces_it() {
        let dir = tempdir().unwrap();
        let path = dir.path().join("key");
        write_private_atomically(&path, b"one").unwrap();
        write_private_atomically(&path, b"two").unwrap();
        assert_eq!(std::fs::read(&path).unwrap(), b"two");
    }

    #[test]
    fn replaces_an_existing_file_whole() {
        let dir = tempdir().unwrap();
        let path = dir.path().join("novela.docx");
        std::fs::write(&path, b"un texto anterior mucho mas largo").unwrap();
        write_atomically(&path, b"nuevo").unwrap();
        assert_eq!(std::fs::read(&path).unwrap(), b"nuevo");
    }

    #[test]
    fn leaves_no_temporary_file_behind() {
        let dir = tempdir().unwrap();
        write_atomically(&dir.path().join("a.md"), b"x").unwrap();
        let names: Vec<_> = std::fs::read_dir(dir.path())
            .unwrap()
            .map(|entry| entry.unwrap().file_name())
            .collect();
        assert_eq!(names, ["a.md"]);
    }

    #[test]
    fn keeps_the_old_file_when_the_write_fails() {
        let dir = tempdir().unwrap();
        // A directory in the way makes the final rename fail, after the data was written.
        let blocked = dir.path().join("novela.docx");
        std::fs::create_dir(&blocked).unwrap();
        std::fs::write(blocked.join("dentro"), b"intacto").unwrap();

        assert!(write_atomically(&blocked, b"nuevo").is_err());

        assert_eq!(std::fs::read(blocked.join("dentro")).unwrap(), b"intacto");
        let names: Vec<_> = std::fs::read_dir(dir.path())
            .unwrap()
            .map(|entry| entry.unwrap().file_name())
            .collect();
        assert_eq!(names, ["novela.docx"], "no temporary file left");
    }

    #[test]
    fn fails_clearly_when_the_folder_does_not_exist() {
        let dir = tempdir().unwrap();
        let path = dir.path().join("no-existe").join("a.md");
        assert!(write_atomically(&path, b"x").is_err());
    }
}
