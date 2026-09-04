//! Content-addressed store for files that may be shared across profiles.
//!
//! Only `mastercomfig-base.vpk` is allowed to live here. Everything else is
//! exclusive to a profile directory.

use std::collections::HashSet;
use std::fs;
use std::path::{Path, PathBuf};

use crate::hash::{
    copy_and_sha256_exact_within, copy_and_sha256_within, move_file_within, random_token,
    remove_dir_within, remove_file_force_within, sha256_file, sha256_hex, validate_dir_within,
    validate_file_within, write_atomic_within,
};
use crate::profile::ProfileError;

pub fn blobs_dir(profiles_dir: &Path) -> PathBuf {
    profiles_dir.join("blobs").join("sha256")
}

pub fn blob_path(profiles_dir: &Path, hash: &str) -> PathBuf {
    let prefix = hash.get(..2).unwrap_or("00");
    blobs_dir(profiles_dir).join(prefix).join(hash)
}

/// True when the blob at `dest` really has the content its name claims. A
/// blob is shared by every profile that references the hash, so a stored
/// copy that does not hash back to its own name (an older non-atomic write
/// cut short) must be rewritten rather than trusted on `is_file()` alone.
fn blob_is_intact(profiles_dir: &Path, dest: &Path, hash: &str) -> bool {
    validate_file_within(profiles_dir, dest).is_ok()
        && sha256_file(dest).map(|have| have == hash).unwrap_or(false)
}

pub fn put_blob(profiles_dir: &Path, bytes: &[u8]) -> Result<String, ProfileError> {
    let hash = sha256_hex(bytes);
    let dest = blob_path(profiles_dir, &hash);
    if blob_is_intact(profiles_dir, &dest, &hash) {
        return Ok(hash);
    }
    write_atomic_within(profiles_dir, &dest, bytes).map_err(|e| ProfileError::Io(e.to_string()))?;
    Ok(hash)
}

pub fn put_blob_from_path(profiles_dir: &Path, src: &Path) -> Result<String, ProfileError> {
    let incoming_dir = blobs_dir(profiles_dir).join(".incoming");
    let staged = incoming_dir.join(random_token());
    let hash = copy_and_sha256_within(profiles_dir, src, &staged)
        .map_err(|e| ProfileError::Io(e.to_string()))?;
    let dest = blob_path(profiles_dir, &hash);
    if blob_is_intact(profiles_dir, &dest, &hash) {
        let _ = remove_file_force_within(profiles_dir, &staged);
        return Ok(hash);
    }
    if let Err(err) = move_file_within(profiles_dir, &staged, &dest) {
        let _ = remove_file_force_within(profiles_dir, &staged);
        return Err(ProfileError::Io(err.to_string()));
    }
    Ok(hash)
}

pub fn put_blob_from_path_exact(
    profiles_dir: &Path,
    src: &Path,
    expected_len: u64,
) -> Result<String, ProfileError> {
    let incoming_dir = blobs_dir(profiles_dir).join(".incoming");
    let staged = incoming_dir.join(random_token());
    let hash = copy_and_sha256_exact_within(profiles_dir, src, &staged, expected_len)
        .map_err(|e| ProfileError::Io(e.to_string()))?;
    let dest = blob_path(profiles_dir, &hash);
    if blob_is_intact(profiles_dir, &dest, &hash) {
        let _ = remove_file_force_within(profiles_dir, &staged);
        return Ok(hash);
    }
    if let Err(err) = move_file_within(profiles_dir, &staged, &dest) {
        let _ = remove_file_force_within(profiles_dir, &staged);
        return Err(ProfileError::Io(err.to_string()));
    }
    Ok(hash)
}

/// Delete blob objects that no remaining profile manifest references.
pub fn gc_unreferenced_blobs(
    profiles_dir: &Path,
    referenced: &HashSet<String>,
) -> Result<Vec<String>, ProfileError> {
    let root = blobs_dir(profiles_dir);
    if !root.is_dir() {
        return Ok(Vec::new());
    }
    validate_dir_within(profiles_dir, &root).map_err(|e| ProfileError::Io(e.to_string()))?;

    let mut removed = Vec::new();
    let prefixes = fs::read_dir(&root).map_err(|e| ProfileError::Io(e.to_string()))?;
    for prefix in prefixes {
        let prefix = prefix.map_err(|e| ProfileError::Io(e.to_string()))?;
        let prefix_path = prefix.path();
        let prefix_meta =
            fs::symlink_metadata(&prefix_path).map_err(|e| ProfileError::Io(e.to_string()))?;
        if crate::hash::metadata_is_link(&prefix_meta) || !prefix_meta.is_dir() {
            continue;
        }
        let prefix_name = prefix.file_name();
        let Some(prefix_name) = prefix_name.to_str() else {
            continue;
        };
        if prefix_name == ".incoming" {
            validate_dir_within(profiles_dir, &prefix_path)
                .map_err(|e| ProfileError::Io(e.to_string()))?;
            for file in fs::read_dir(&prefix_path).map_err(|e| ProfileError::Io(e.to_string()))? {
                let file = file.map_err(|e| ProfileError::Io(e.to_string()))?;
                let path = file.path();
                let meta =
                    fs::symlink_metadata(&path).map_err(|e| ProfileError::Io(e.to_string()))?;
                let disposable = meta.is_file()
                    && !crate::hash::metadata_is_link(&meta)
                    && file.file_name().to_str().is_some_and(|name| {
                        let token = name.strip_suffix(crate::hash::PART_SUFFIX).unwrap_or(name);
                        token.len() == 32 && token.bytes().all(|byte| byte.is_ascii_hexdigit())
                    });
                if disposable {
                    remove_file_force_within(profiles_dir, &path)
                        .map_err(|e| ProfileError::Io(e.to_string()))?;
                }
            }
            if fs::read_dir(&prefix_path)
                .map_err(|e| ProfileError::Io(e.to_string()))?
                .next()
                .is_none()
            {
                let _ = remove_dir_within(profiles_dir, &prefix_path);
            }
            continue;
        }
        if prefix_name.len() != 2 || !prefix_name.bytes().all(|byte| byte.is_ascii_hexdigit()) {
            continue;
        }
        validate_dir_within(profiles_dir, &prefix_path)
            .map_err(|e| ProfileError::Io(e.to_string()))?;
        let files = fs::read_dir(&prefix_path).map_err(|e| ProfileError::Io(e.to_string()))?;
        for file in files {
            let file = file.map_err(|e| ProfileError::Io(e.to_string()))?;
            let path = file.path();
            let meta = fs::symlink_metadata(&path).map_err(|e| ProfileError::Io(e.to_string()))?;
            if crate::hash::metadata_is_link(&meta) || !meta.is_file() {
                continue;
            }
            let name = file.file_name().to_string_lossy().into_owned();
            if name.len() == 64
                && name.bytes().all(|byte| byte.is_ascii_hexdigit())
                && !referenced.contains(&name)
            {
                remove_file_force_within(profiles_dir, &path)
                    .map_err(|e| ProfileError::Io(e.to_string()))?;
                removed.push(name);
            }
        }
        if fs::read_dir(&prefix_path)
            .map_err(|e| ProfileError::Io(e.to_string()))?
            .next()
            .is_none()
        {
            let _ = remove_dir_within(profiles_dir, &prefix_path);
        }
    }
    Ok(removed)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn writes_once_under_hash_prefix() {
        let dir = crate::test_temp_dir();
        let hash = put_blob(&dir, b"shared-vpk").unwrap();
        let path = blob_path(&dir, &hash);
        assert!(path.starts_with(blobs_dir(&dir)));
        assert_eq!(path.file_name().unwrap().to_string_lossy(), hash.as_str());
        assert_eq!(
            path.parent()
                .unwrap()
                .file_name()
                .unwrap()
                .to_string_lossy(),
            &hash[..2]
        );
        assert_eq!(fs::read(&path).unwrap(), b"shared-vpk");

        let again = put_blob(&dir, b"shared-vpk").unwrap();
        assert_eq!(again, hash);
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn a_corrupt_stored_blob_is_rewritten_not_trusted() {
        // An older build wrote blobs with a plain `fs::write`; one cut short
        // sits under the right name with the wrong bytes, shared by every
        // profile that references the hash.
        let dir = crate::test_temp_dir();
        let hash = put_blob(&dir, b"the-real-vpk").unwrap();
        let path = blob_path(&dir, &hash);
        fs::write(&path, b"the-re").unwrap();

        assert_eq!(put_blob(&dir, b"the-real-vpk").unwrap(), hash);
        assert_eq!(fs::read(&path).unwrap(), b"the-real-vpk");

        fs::write(&path, b"").unwrap();
        let src = dir.join("src.vpk");
        fs::write(&src, b"the-real-vpk").unwrap();
        assert_eq!(put_blob_from_path(&dir, &src).unwrap(), hash);
        assert_eq!(fs::read(&path).unwrap(), b"the-real-vpk");
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn path_ingest_names_the_exact_published_bytes() {
        let dir = crate::test_temp_dir();
        let source = dir.join("source.vpk");
        fs::write(&source, b"one-pass-content").unwrap();

        let hash = put_blob_from_path(&dir, &source).unwrap();
        let stored = fs::read(blob_path(&dir, &hash)).unwrap();
        assert_eq!(hash, sha256_hex(&stored));
        assert_eq!(stored, b"one-pass-content");
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn gc_removes_interrupted_incoming_objects() {
        let dir = crate::test_temp_dir();
        let incoming = blobs_dir(&dir).join(".incoming");
        fs::create_dir_all(&incoming).unwrap();
        let token = "0123456789abcdef0123456789abcdef";
        fs::write(incoming.join(token), b"staged").unwrap();
        fs::write(
            incoming.join(format!("{token}{}", crate::hash::PART_SUFFIX)),
            b"partial",
        )
        .unwrap();

        gc_unreferenced_blobs(&dir, &HashSet::new()).unwrap();
        assert!(!incoming.exists());
        let _ = fs::remove_dir_all(&dir);
    }

    #[cfg(unix)]
    #[test]
    fn gc_does_not_follow_a_linked_hash_prefix() {
        use std::os::unix::fs::symlink;

        let dir = crate::test_temp_dir();
        let outside = dir.join("outside");
        fs::create_dir_all(blobs_dir(&dir)).unwrap();
        fs::create_dir_all(&outside).unwrap();
        let victim =
            outside.join("aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa");
        fs::write(&victim, b"outside").unwrap();
        symlink(&outside, blobs_dir(&dir).join("aa")).unwrap();

        gc_unreferenced_blobs(&dir, &HashSet::new()).unwrap();
        assert_eq!(fs::read(&victim).unwrap(), b"outside");
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn gc_keeps_referenced_hashes() {
        let dir = crate::test_temp_dir();
        let keep = put_blob(&dir, b"keep-me").unwrap();
        let drop = put_blob(&dir, b"drop-me").unwrap();
        let mut referenced = HashSet::new();
        referenced.insert(keep.clone());

        let removed = gc_unreferenced_blobs(&dir, &referenced).unwrap();
        assert!(removed.contains(&drop));
        assert!(blob_path(&dir, &keep).is_file());
        assert!(!blob_path(&dir, &drop).is_file());
        let _ = fs::remove_dir_all(&dir);
    }
}
