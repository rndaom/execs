//! The app's one HTTP layer. Core stays network-free; everything that leaves
//! this process goes through here.
//!
//! Five fetch modules used to re-implement the same thing: build a client,
//! GET, check the status, buffer the body, compute a cache path, verify,
//! write the cache. Three of them borrowed `comfig_fetch::download_bytes`, so
//! a mastercomfig-specific module was the de-facto HTTP layer — which is
//! exactly why two GitHub API calls shipped with no timeout at all and no
//! download had a size ceiling. One module, one timeout policy, one cap.

use std::io::Read;
use std::path::Path;
use std::time::Duration;

const USER_AGENT: &str = "execs";

/// Bulk downloads (release VPKs, HUD zips, the 81 MB mod library). Ten
/// minutes covers a slow link; a stalled connection still fails instead of
/// pinning the UI's busy state forever.
const DOWNLOAD_CONNECT_TIMEOUT: Duration = Duration::from_secs(30);
const DOWNLOAD_TIMEOUT: Duration = Duration::from_secs(600);

/// JSON APIs and small text documents. The HUD catalog fans ~200 of these out
/// across 12 workers, so a slow one must give up quickly.
const API_CONNECT_TIMEOUT: Duration = Duration::from_secs(5);
const API_TIMEOUT: Duration = Duration::from_secs(20);

const CHUNK: usize = 64 * 1024;

pub const MIB: u64 = 1024 * 1024;

/// What a pinned download must be before we trust it — checked on a cache hit
/// *and* after a fresh download, so a corrupted or tampered cache file is
/// re-fetched instead of served.
#[derive(Debug, Clone, Copy)]
// `Size` and `None` complete the policy this module is meant to express, and
// both are exercised by its tests; today's pinned assets all happen to want a
// hash or a magic number.
#[allow(dead_code)]
pub enum Verify {
    Sha256(&'static str),
    Size(u64),
    Magic(&'static [u8]),
    None,
}

impl Verify {
    pub fn accepts(&self, bytes: &[u8]) -> bool {
        match self {
            Self::Sha256(expected) => execs_core::hash::sha256_hex(bytes) == *expected,
            Self::Size(expected) => bytes.len() as u64 == *expected,
            Self::Magic(magic) => bytes.starts_with(magic),
            Self::None => true,
        }
    }
}

pub fn client() -> Result<reqwest::blocking::Client, String> {
    build(DOWNLOAD_CONNECT_TIMEOUT, DOWNLOAD_TIMEOUT)
}

pub fn api_client() -> Result<reqwest::blocking::Client, String> {
    build(API_CONNECT_TIMEOUT, API_TIMEOUT)
}

fn build(connect: Duration, total: Duration) -> Result<reqwest::blocking::Client, String> {
    reqwest::blocking::Client::builder()
        .user_agent(USER_AGENT)
        .connect_timeout(connect)
        .timeout(total)
        .build()
        .map_err(|err| err.to_string())
}

pub fn request_error(err: reqwest::Error) -> String {
    if err.is_timeout() {
        "The request timed out. Check your connection and try again.".into()
    } else if err.is_connect() {
        "Could not connect. Check your connection and try again.".into()
    } else {
        format!("The download failed ({err})")
    }
}

/// GET a small text document with the API timeout policy.
pub fn get_text(client: &reqwest::blocking::Client, url: &str) -> Result<String, String> {
    let response = client.get(url).send().map_err(request_error)?;
    if !response.status().is_success() {
        return Err(format!("Could not download {url} ({})", response.status()));
    }
    response.text().map_err(|err| err.to_string())
}

/// GET a JSON document with the API timeout policy.
pub fn get_json<T: serde::de::DeserializeOwned>(
    client: &reqwest::blocking::Client,
    url: &str,
) -> Result<T, String> {
    let response = client.get(url).send().map_err(request_error)?;
    if !response.status().is_success() {
        return Err(format!("Could not read {url} ({})", response.status()));
    }
    response.json().map_err(|err| err.to_string())
}

fn too_large(max_bytes: u64) -> String {
    format!(
        "The download is larger than the {} MB this app will accept.",
        max_bytes / MIB
    )
}

/// Copy a response body with a hard ceiling. Split out from `download_bytes`
/// so the cap is testable without a socket.
fn read_capped(
    reader: &mut impl Read,
    max_bytes: u64,
    hint: Option<u64>,
) -> Result<Vec<u8>, String> {
    if let Some(len) = hint {
        // Content-Length is a claim, not a guarantee — refusing early just
        // saves us the transfer. The running cap below is the real check.
        if len > max_bytes {
            return Err(too_large(max_bytes));
        }
    }
    let reserve = hint.unwrap_or(0).min(max_bytes) as usize;
    let mut out = Vec::with_capacity(reserve);
    let mut chunk = vec![0u8; CHUNK];
    loop {
        let read = reader
            .read(&mut chunk)
            .map_err(|err| format!("The download failed ({err})"))?;
        if read == 0 {
            break;
        }
        if out.len() as u64 + read as u64 > max_bytes {
            return Err(too_large(max_bytes));
        }
        out.extend_from_slice(&chunk[..read]);
    }
    Ok(out)
}

/// Download a body, refusing anything past `max_bytes` — by `Content-Length`
/// when the server sends one, and by a running total either way.
pub fn download_bytes(url: &str, max_bytes: u64) -> Result<Vec<u8>, String> {
    let mut response = client()?.get(url).send().map_err(request_error)?;
    if !response.status().is_success() {
        return Err(format!("Could not download {url} ({})", response.status()));
    }
    let hint = response.content_length();
    read_capped(&mut response, max_bytes, hint)
}

/// A pinned asset, from the cache when it still verifies and from the network
/// otherwise. The cache file is only written once the bytes pass `verify`.
pub fn download_pinned(
    url: &str,
    cache_path: &Path,
    verify: Verify,
    max_bytes: u64,
) -> Result<Vec<u8>, String> {
    download_pinned_with(url, cache_path, verify, max_bytes, download_bytes)
}

fn download_pinned_with(
    url: &str,
    cache_path: &Path,
    verify: Verify,
    max_bytes: u64,
    fetch: impl FnOnce(&str, u64) -> Result<Vec<u8>, String>,
) -> Result<Vec<u8>, String> {
    if let Ok(bytes) = std::fs::read(cache_path) {
        if verify.accepts(&bytes) {
            return Ok(bytes);
        }
    }
    let bytes = fetch(url, max_bytes)?;
    if !verify.accepts(&bytes) {
        return Err("The download failed verification.".into());
    }
    if let Some(parent) = cache_path.parent() {
        let _ = std::fs::create_dir_all(parent);
    }
    let _ = std::fs::write(cache_path, &bytes);
    Ok(bytes)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::cell::Cell;

    fn temp_dir(name: &str) -> std::path::PathBuf {
        let dir = std::env::temp_dir().join(format!("execs-net-{name}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    #[test]
    fn verify_accepts_matching_hash_size_and_magic() {
        let bytes = b"VTF\0hello".to_vec();
        let hash: &'static str = Box::leak(execs_core::hash::sha256_hex(&bytes).into_boxed_str());
        assert!(Verify::Sha256(hash).accepts(&bytes));
        assert!(!Verify::Sha256(
            "0000000000000000000000000000000000000000000000000000000000000000"
        )
        .accepts(&bytes));
        assert!(Verify::Size(9).accepts(&bytes));
        assert!(!Verify::Size(8).accepts(&bytes));
        assert!(Verify::Magic(b"VTF\0").accepts(&bytes));
        assert!(!Verify::Magic(b"VPK\0").accepts(&bytes));
        assert!(Verify::None.accepts(&bytes));
    }

    #[test]
    fn a_verifying_cache_hit_never_touches_the_network() {
        let dir = temp_dir("cache-hit");
        let cache = dir.join("pinned.bin");
        std::fs::write(&cache, b"VTF\0good").unwrap();
        let called = Cell::new(false);

        let bytes = download_pinned_with(
            "https://example.invalid/x",
            &cache,
            Verify::Magic(b"VTF\0"),
            1024,
            |_, _| {
                called.set(true);
                Ok(b"fetched".to_vec())
            },
        )
        .unwrap();

        assert_eq!(bytes, b"VTF\0good");
        assert!(!called.get(), "a valid cache must not re-download");
    }

    #[test]
    fn a_cache_file_with_the_wrong_hash_is_re_downloaded_and_replaced() {
        let dir = temp_dir("cache-miss");
        let cache = dir.join("pinned.bin");
        std::fs::write(&cache, b"corrupted").unwrap();
        let good = b"the real bytes".to_vec();
        let hash: &'static str = Box::leak(execs_core::hash::sha256_hex(&good).into_boxed_str());
        let called = Cell::new(false);

        let bytes = download_pinned_with(
            "https://example.invalid/x",
            &cache,
            Verify::Sha256(hash),
            1024,
            |_, _| {
                called.set(true);
                Ok(good.clone())
            },
        )
        .unwrap();

        assert!(called.get(), "a failing cache must re-download");
        assert_eq!(bytes, good);
        // ...and the bad file is gone, so the next run is a cache hit.
        assert_eq!(std::fs::read(&cache).unwrap(), good);
    }

    #[test]
    fn a_download_that_fails_verification_is_refused_and_not_cached() {
        let dir = temp_dir("bad-download");
        let cache = dir.join("pinned.bin");

        let err = download_pinned_with(
            "https://example.invalid/x",
            &cache,
            Verify::Magic(b"VTF\0"),
            1024,
            |_, _| Ok(b"not a vtf".to_vec()),
        )
        .unwrap_err();

        assert!(err.contains("verification"), "{err}");
        assert!(!cache.exists(), "unverified bytes must not be cached");
    }

    #[test]
    fn oversize_is_refused_by_the_running_cap_even_with_no_content_length() {
        let body = vec![7u8; 4096];
        let err = read_capped(&mut body.as_slice(), 1024, None).unwrap_err();
        assert!(err.contains("larger than"), "{err}");
    }

    #[test]
    fn oversize_is_refused_up_front_when_content_length_says_so() {
        let body = vec![7u8; 8];
        let err = read_capped(&mut body.as_slice(), 1024, Some(4096)).unwrap_err();
        assert!(err.contains("larger than"), "{err}");
    }

    #[test]
    fn a_body_within_the_cap_reads_through_whole() {
        let body = vec![3u8; CHUNK * 2 + 17];
        let read = read_capped(&mut body.as_slice(), MIB, Some(body.len() as u64)).unwrap();
        assert_eq!(read, body);
    }
}
