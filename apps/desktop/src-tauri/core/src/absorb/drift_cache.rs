//! Disposable drift hints. Never use these hashes to authorize a write.

use std::collections::{BTreeMap, HashSet};
use std::fs;
use std::path::{Path, PathBuf};
use std::time::SystemTime;

use serde::{Deserialize, Serialize};

use crate::hash::{
    read_small_file_bounded, sha256_file, validate_file_within, write_atomic_within,
};
use crate::profile::ProfileError;

const MAX_CACHE_BYTES: usize = 16 * 1024 * 1024;
const MAX_CACHE_FILES: usize = 20_000;

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
struct Stamp {
    len: u64,
    modified: SystemTime,
    created: Option<SystemTime>,
    #[cfg(unix)]
    identity: (u64, u64, i64, i64),
}

impl Stamp {
    fn read(path: &Path) -> Option<Self> {
        let metadata = fs::symlink_metadata(path).ok()?;
        if !metadata.is_file() || crate::hash::metadata_is_link(&metadata) {
            return None;
        }
        #[cfg(unix)]
        use std::os::unix::fs::MetadataExt;
        Some(Self {
            len: metadata.len(),
            modified: metadata.modified().ok()?,
            created: metadata.created().ok(),
            #[cfg(unix)]
            identity: (
                metadata.dev(),
                metadata.ino(),
                metadata.ctime(),
                metadata.ctime_nsec(),
            ),
        })
    }
}

#[derive(Serialize, Deserialize)]
struct Entry {
    stamp: Stamp,
    sha256: String,
}

#[derive(Default, Serialize, Deserialize)]
pub(super) struct DriftCache {
    entries: BTreeMap<PathBuf, Entry>,
    #[serde(skip)]
    seen: HashSet<PathBuf>,
    #[cfg(test)]
    #[serde(skip)]
    pub(super) hashes: usize,
}

impl DriftCache {
    pub(super) fn load(profiles: &Path, id: &str) -> Self {
        let path = cache_path(profiles, id);
        let parsed = validate_file_within(profiles, &path)
            .ok()
            .and_then(|()| read_small_file_bounded(&path, MAX_CACHE_BYTES).ok())
            .and_then(|bytes| serde_json::from_slice::<Self>(&bytes).ok());
        parsed
            .filter(|cache| cache.entries.len() <= MAX_CACHE_FILES)
            .unwrap_or_default()
    }

    pub(super) fn hash(&mut self, path: &Path) -> Result<String, ProfileError> {
        self.seen.insert(path.to_path_buf());
        let before = Stamp::read(path);
        if let Some(entry) = self.entries.get(path).filter(|entry| {
            before.as_ref() == Some(&entry.stamp)
                && entry.sha256.len() == 64
                && entry.sha256.bytes().all(|byte| byte.is_ascii_hexdigit())
        }) {
            return Ok(entry.sha256.clone());
        }
        self.entries.remove(path);
        #[cfg(test)]
        {
            self.hashes += 1;
        }
        let hash = sha256_file(path).map_err(|error| ProfileError::Io(error.to_string()))?;
        // Never attach newer metadata to an older hash if a file changed while
        // reading. The next pass must read its bytes again in that case.
        if let Some(stamp) = before.filter(|stamp| Some(stamp) == Stamp::read(path).as_ref()) {
            if self.entries.len() < MAX_CACHE_FILES {
                self.entries.insert(
                    path.to_path_buf(),
                    Entry {
                        stamp,
                        sha256: hash.clone(),
                    },
                );
            }
        }
        Ok(hash)
    }

    pub(super) fn save(mut self, profiles: &Path, id: &str) {
        self.entries.retain(|path, _| self.seen.contains(path));
        // Cache failure must not turn an otherwise successful absorb into an
        // apparent failed profile write. A later pass simply hashes again.
        if let Ok(bytes) = serde_json::to_vec(&self) {
            if bytes.len() <= MAX_CACHE_BYTES {
                let _ = write_atomic_within(profiles, &cache_path(profiles, id), &bytes);
            }
        }
    }
}

fn cache_path(profiles: &Path, id: &str) -> PathBuf {
    crate::profile::profile_dir(profiles, id).join("absorb-cache.json")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn metadata_cache_reuses_only_observed_unchanged_payloads() {
        let dir = tempfile::tempdir().unwrap();
        let payload = dir.path().join("payload");
        fs::write(&payload, b"old").unwrap();
        let mut cache = DriftCache::default();
        let original = cache.hash(&payload).unwrap();
        assert_eq!(cache.hashes, 1);
        assert_eq!(cache.hash(&payload).unwrap(), original);
        assert_eq!(cache.hashes, 1);
        fs::write(&payload, b"different length").unwrap();
        assert_ne!(cache.hash(&payload).unwrap(), original);
        assert_eq!(cache.hashes, 2);
        fs::remove_file(&payload).unwrap();
        assert!(cache.hash(&payload).is_err());
        assert!(!cache.entries.contains_key(&payload));
    }

    #[test]
    fn cache_roundtrip_prunes_missing_paths_and_corruption_is_a_miss() {
        let dir = tempfile::tempdir().unwrap();
        fs::create_dir(dir.path().join("profile")).unwrap();
        let payload = dir.path().join("payload");
        fs::write(&payload, b"bytes").unwrap();
        let mut cache = DriftCache::default();
        cache.hash(&payload).unwrap();
        cache.save(dir.path(), "profile");
        let mut cache = DriftCache::load(dir.path(), "profile");
        cache.hash(&payload).unwrap();
        assert_eq!(cache.hashes, 0);
        cache.seen.clear();
        cache.save(dir.path(), "profile");
        assert!(DriftCache::load(dir.path(), "profile").entries.is_empty());
        fs::write(cache_path(dir.path(), "profile"), b"invalid").unwrap();
        assert!(DriftCache::load(dir.path(), "profile").entries.is_empty());
    }
}
