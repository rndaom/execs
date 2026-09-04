//! Content-addressed store for files that may be shared across profiles.
//!
//! Only `mastercomfig-base.vpk` is allowed to live here. Everything else is
//! exclusive to a profile directory.

use std::collections::HashSet;
use std::fs;
use std::path::{Path, PathBuf};

use crate::hash::{copy_and_sha256, sha256_file, sha256_hex, write_atomic};
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
fn blob_is_intact(dest: &Path, hash: &str) -> bool {
    dest.is_file() && sha256_file(dest).map(|have| have == hash).unwrap_or(false)
}

pub fn put_blob(profiles_dir: &Path, bytes: &[u8]) -> Result<String, ProfileError> {
    let hash = sha256_hex(bytes);
    let dest = blob_path(profiles_dir, &hash);
    if blob_is_intact(&dest, &hash) {
        return Ok(hash);
    }
    write_atomic(&dest, bytes).map_err(|e| ProfileError::Io(e.to_string()))?;
    Ok(hash)
}

pub fn put_blob_from_path(profiles_dir: &Path, src: &Path) -> Result<String, ProfileError> {
    let hash = sha256_file(src).map_err(|e| ProfileError::Io(e.to_string()))?;
    let dest = blob_path(profiles_dir, &hash);
    if blob_is_intact(&dest, &hash) {
        return Ok(hash);
    }
    copy_and_sha256(src, &dest).map_err(|e| ProfileError::Io(e.to_string()))?;
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

    let mut removed = Vec::new();
    let prefixes = fs::read_dir(&root).map_err(|e| ProfileError::Io(e.to_string()))?;
    for prefix in prefixes {
        let prefix = prefix.map_err(|e| ProfileError::Io(e.to_string()))?;
        let prefix_path = prefix.path();
        if !prefix_path.is_dir() {
            continue;
        }
        let files = fs::read_dir(&prefix_path).map_err(|e| ProfileError::Io(e.to_string()))?;
        for file in files {
            let file = file.map_err(|e| ProfileError::Io(e.to_string()))?;
            let path = file.path();
            if !path.is_file() {
                continue;
            }
            let name = file.file_name().to_string_lossy().into_owned();
            if name.len() == 64 && !referenced.contains(&name) {
                fs::remove_file(&path).map_err(|e| ProfileError::Io(e.to_string()))?;
                removed.push(name);
            }
        }
        if fs::read_dir(&prefix_path)
            .map_err(|e| ProfileError::Io(e.to_string()))?
            .next()
            .is_none()
        {
            let _ = fs::remove_dir(&prefix_path);
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
