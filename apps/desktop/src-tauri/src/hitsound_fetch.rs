//! Hold the user's own picked WAVs while they audition and install them.
//! Core stays network-free. Retired remote catalogs have no fetch path.

use std::collections::HashSet;
use std::path::{Path, PathBuf};
use std::time::{Duration, SystemTime};

use crate::net::{self, MIB};

const WAV_MAX_BYTES: u64 = 8 * MIB;

/// Where a picked-and-prepared user file waits between the file dialog and
/// Apply. Tokens are random and the directory is app data, so the frontend
/// never handles a path it could point somewhere else.
fn picked_location() -> Result<(PathBuf, PathBuf), String> {
    let root = execs_core::try_execs_data_dir()?;
    let dir = root.join("hitsound-cache").join("picked");
    Ok((root, dir))
}

fn valid_token(token: &str) -> bool {
    token.len() == 32 && token.bytes().all(|b| b.is_ascii_hexdigit())
}

pub fn stash_picked(wav: &[u8]) -> Result<String, String> {
    let token = execs_core::hash::random_token();
    let (root, dir) = picked_location()?;
    // Atomic: Apply reads the stash back by token, and a file cut off
    // mid-write would install as a truncated WAV.
    execs_core::hash::write_atomic_within(&root, &dir.join(format!("{token}.wav")), wav)
        .map_err(|err| err.to_string())?;
    Ok(token)
}

pub fn read_picked(token: &str) -> Result<Vec<u8>, String> {
    if !valid_token(token) {
        return Err("That picked file is no longer available.".into());
    }
    let (root, dir) = picked_location()?;
    let path = dir.join(format!("{token}.wav"));
    execs_core::hash::validate_file_within(&root, &path)
        .map_err(|_| "That picked file is no longer available — choose it again.".to_string())?;
    net::read_file_capped(&path, WAV_MAX_BYTES)
        .map_err(|_| "That picked file is no longer available — choose it again.".to_string())
}

/// Delete abandoned file-dialog staging WAVs while preserving every token a
/// profile still references. Command/startup code supplies the references so
/// this networking module never needs to read or mutate profile manifests.
pub fn gc_picked(referenced_tokens: &[String], max_age: Duration) -> Result<(), String> {
    let (root, dir) = picked_location()?;
    gc_picked_in(&root, &dir, referenced_tokens, max_age, SystemTime::now())
}

fn gc_picked_in(
    root: &Path,
    dir: &Path,
    referenced_tokens: &[String],
    max_age: Duration,
    now: SystemTime,
) -> Result<(), String> {
    let referenced: HashSet<&str> = referenced_tokens
        .iter()
        .map(String::as_str)
        .filter(|token| valid_token(token))
        .collect();
    match std::fs::symlink_metadata(dir) {
        Err(err) if err.kind() == std::io::ErrorKind::NotFound => return Ok(()),
        Err(err) => return Err(err.to_string()),
        Ok(_) => execs_core::hash::validate_dir_within(root, dir).map_err(|err| err.to_string())?,
    }
    let entries = match std::fs::read_dir(dir) {
        Ok(entries) => entries,
        Err(err) if err.kind() == std::io::ErrorKind::NotFound => return Ok(()),
        Err(err) => return Err(err.to_string()),
    };
    for entry in entries {
        let entry = entry.map_err(|err| err.to_string())?;
        let path = entry.path();
        if !entry.file_type().map_err(|err| err.to_string())?.is_file() {
            continue;
        }
        let Some(name) = path.file_name().and_then(|name| name.to_str()) else {
            continue;
        };
        let Some(token) = name.strip_suffix(".wav") else {
            continue;
        };
        if !valid_token(token) || referenced.contains(token) {
            continue;
        }
        execs_core::hash::validate_file_within(root, &path).map_err(|err| err.to_string())?;
        let modified = entry
            .metadata()
            .and_then(|metadata| metadata.modified())
            .map_err(|err| err.to_string())?;
        if now.duration_since(modified).unwrap_or_default() < max_age {
            continue;
        }
        execs_core::hash::remove_file_force_within(root, &path).map_err(|err| err.to_string())?;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[cfg(unix)]
    fn link_dir(target: &Path, link: &Path) {
        std::os::unix::fs::symlink(target, link).unwrap();
    }

    #[cfg(windows)]
    fn link_dir(target: &Path, link: &Path) {
        let status = std::process::Command::new("cmd")
            .args(["/d", "/c", "mklink", "/j"])
            .arg(link)
            .arg(target)
            .status()
            .unwrap();
        assert!(status.success(), "could not create test junction");
    }

    #[cfg(unix)]
    fn unlink_dir(link: &Path) {
        std::fs::remove_file(link).unwrap();
    }

    #[cfg(windows)]
    fn unlink_dir(link: &Path) {
        std::fs::remove_dir(link).unwrap();
    }

    #[test]
    fn tokens_are_32_hex_and_unknown_ones_are_refused() {
        let token = execs_core::hash::random_token();
        assert!(valid_token(&token), "{token}");
        assert_eq!(token, token.to_ascii_lowercase());
        assert_ne!(token, execs_core::hash::random_token());
        assert!(read_picked("../../etc/passwd").is_err());
        assert!(read_picked("0123456789abcdef0123456789abcdef").is_err());
    }

    #[test]
    fn picked_gc_preserves_references_and_young_files() {
        let dir = std::env::temp_dir().join(format!(
            "execs-picked-gc-{}-{}",
            std::process::id(),
            execs_core::hash::random_token()
        ));
        std::fs::create_dir_all(&dir).unwrap();
        let old = "0".repeat(32);
        let kept = "1".repeat(32);
        let young = "2".repeat(32);
        std::fs::write(dir.join(format!("{old}.wav")), b"old").unwrap();
        std::fs::write(dir.join(format!("{kept}.wav")), b"kept").unwrap();
        std::fs::write(dir.join(format!("{young}.wav")), b"young").unwrap();

        gc_picked_in(
            &dir,
            &dir,
            std::slice::from_ref(&kept),
            Duration::from_secs(24 * 60 * 60),
            SystemTime::now(),
        )
        .unwrap();
        assert!(dir.join(format!("{old}.wav")).exists());
        assert!(dir.join(format!("{kept}.wav")).exists());
        assert!(dir.join(format!("{young}.wav")).exists());

        let future = SystemTime::now() + Duration::from_secs(2 * 24 * 60 * 60);
        gc_picked_in(
            &dir,
            &dir,
            std::slice::from_ref(&kept),
            Duration::from_secs(24 * 60 * 60),
            future,
        )
        .unwrap();

        assert!(!dir.join(format!("{old}.wav")).exists());
        assert!(dir.join(format!("{kept}.wav")).exists());
        assert!(!dir.join(format!("{young}.wav")).exists());
        let _ = std::fs::remove_dir_all(dir);
    }

    #[test]
    fn picked_gc_refuses_a_linked_directory_without_touching_the_victim() {
        let root = std::env::temp_dir().join(format!(
            "execs-picked-link-root-{}-{}",
            std::process::id(),
            execs_core::hash::random_token()
        ));
        let victim = std::env::temp_dir().join(format!(
            "execs-picked-link-victim-{}-{}",
            std::process::id(),
            execs_core::hash::random_token()
        ));
        std::fs::create_dir_all(root.join("hitsound-cache")).unwrap();
        std::fs::create_dir_all(&victim).unwrap();
        let token = "3".repeat(32);
        let victim_file = victim.join(format!("{token}.wav"));
        std::fs::write(&victim_file, b"victim bytes").unwrap();
        let linked = root.join("hitsound-cache").join("picked");
        link_dir(&victim, &linked);

        let result = gc_picked_in(
            &root,
            &linked,
            &[],
            Duration::ZERO,
            SystemTime::now() + Duration::from_secs(1),
        );

        assert!(result.is_err());
        assert_eq!(std::fs::read(&victim_file).unwrap(), b"victim bytes");
        unlink_dir(&linked);
        std::fs::remove_dir_all(root).unwrap();
        std::fs::remove_dir_all(victim).unwrap();
    }
}
