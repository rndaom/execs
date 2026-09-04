//! The app's one HTTP layer. Core stays network-free; everything that leaves
//! this process goes through here.
//!
//! One module, one timeout policy, one cap. Building a client, GETting,
//! checking the status, buffering the body, computing a cache path, verifying
//! and writing the cache all live here; re-implemented per fetch module, that
//! is how an API call ends up with no timeout and a download with no size
//! ceiling.

use std::io::Read;
use std::path::Path;
use std::time::Duration;

/// Honest product identification. Some hosts (comfig.app's sound CDN) hand a
/// bot challenge to empty or bare-library user agents; a product token with
/// a contact URL is what they ask of well-behaved clients.
const USER_AGENT: &str = concat!(
    "execs/",
    env!("CARGO_PKG_VERSION"),
    " (+https://github.com/rndaom/execs)"
);

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

/// Ceiling on a text or JSON document. The largest one the app reads is
/// GitHub's recursive hud-db tree (a few hundred KB); a listing page or an
/// API answer that runs past this is not what we asked for.
const API_MAX_BYTES: u64 = 8 * MIB;

/// The most a `Content-Length` claim is allowed to reserve up front. The
/// header is unauthenticated input: a server saying "512 MiB" must not have
/// the app allocate that before a byte arrives.
const RESERVE_MAX: usize = 16 * MIB as usize;

/// What a pinned download must be before we trust it — checked on a cache hit
/// *and* after a fresh download, so a corrupted or tampered cache file is
/// re-fetched instead of served.
#[derive(Debug, Clone, Copy)]
pub enum Verify {
    Sha256(&'static str),
    Magic(&'static [u8]),
}

impl Verify {
    pub fn accepts(&self, bytes: &[u8]) -> bool {
        match self {
            Self::Sha256(expected) => execs_core::hash::sha256_hex(bytes) == *expected,
            Self::Magic(magic) => bytes.starts_with(magic),
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

/// GET a small text document with the API timeout policy. The body is read
/// under `API_MAX_BYTES`, never buffered whole on the server's say-so.
pub fn get_text(client: &reqwest::blocking::Client, url: &str) -> Result<String, String> {
    let mut response = client.get(url).send().map_err(request_error)?;
    if !response.status().is_success() {
        return Err(format!("Could not download {url} ({})", response.status()));
    }
    let hint = response.content_length();
    let bytes = read_capped(&mut response, API_MAX_BYTES, hint)?;
    Ok(text_from_bytes(bytes))
}

/// GET a JSON document with the API timeout policy, under the same ceiling.
pub fn get_json<T: serde::de::DeserializeOwned>(
    client: &reqwest::blocking::Client,
    url: &str,
) -> Result<T, String> {
    let mut response = client.get(url).send().map_err(request_error)?;
    if !response.status().is_success() {
        return Err(format!("Could not read {url} ({})", response.status()));
    }
    let hint = response.content_length();
    let bytes = read_capped(&mut response, API_MAX_BYTES, hint)?;
    serde_json::from_slice(&bytes).map_err(|err| err.to_string())
}

/// Every host this app reads text from serves UTF-8; a stray byte becomes
/// U+FFFD rather than failing a whole catalog document.
fn text_from_bytes(bytes: Vec<u8>) -> String {
    match String::from_utf8(bytes) {
        Ok(text) => text,
        Err(err) => String::from_utf8_lossy(err.as_bytes()).into_owned(),
    }
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
    let reserve = (hint.unwrap_or(0).min(max_bytes) as usize).min(RESERVE_MAX);
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
    // Atomic, so a crash mid-write leaves the old cache file (or none) rather
    // than a truncated one that fails verification on every later start.
    let _ = execs_core::hash::write_atomic(cache_path, &bytes);
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
    fn verify_accepts_matching_hash_and_magic() {
        let bytes = b"VTF\0hello".to_vec();
        let hash: &'static str = Box::leak(execs_core::hash::sha256_hex(&bytes).into_boxed_str());
        assert!(Verify::Sha256(hash).accepts(&bytes));
        assert!(!Verify::Sha256(
            "0000000000000000000000000000000000000000000000000000000000000000"
        )
        .accepts(&bytes));
        assert!(Verify::Magic(b"VTF\0").accepts(&bytes));
        assert!(!Verify::Magic(b"VPK\0").accepts(&bytes));
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
        // ...and the bad file has been replaced, so the next run is a cache hit.
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

    #[test]
    fn a_content_length_claim_cannot_reserve_past_the_ceiling() {
        // A server claiming 400 MiB under a 512 MiB cap must not have the
        // app allocate 400 MiB before the first byte arrives.
        let body = vec![1u8; 64];
        let read = read_capped(&mut body.as_slice(), 512 * MIB, Some(400 * MIB)).unwrap();
        assert_eq!(read, body);
        assert!(
            read.capacity() <= RESERVE_MAX,
            "reserved {} bytes",
            read.capacity()
        );
    }

    #[test]
    fn text_documents_are_capped_like_downloads() {
        let body = vec![b'a'; (API_MAX_BYTES + 1) as usize];
        let err = read_capped(&mut body.as_slice(), API_MAX_BYTES, None).unwrap_err();
        assert!(err.contains("larger than"), "{err}");
        assert_eq!(text_from_bytes(b"caf\xc3\xa9".to_vec()), "café");
        assert_eq!(text_from_bytes(b"caf\xe9".to_vec()), "caf\u{FFFD}");
    }

    #[test]
    fn the_download_cache_is_written_through_a_part_file() {
        let dir = temp_dir("atomic-cache");
        let cache = dir.join("nested").join("pinned.bin");
        let bytes = download_pinned_with(
            "https://example.invalid/x",
            &cache,
            Verify::Magic(b"VTF\0"),
            1024,
            |_, _| Ok(b"VTF\0fresh".to_vec()),
        )
        .unwrap();
        assert_eq!(bytes, b"VTF\0fresh");
        assert_eq!(std::fs::read(&cache).unwrap(), b"VTF\0fresh");
        let left: Vec<_> = std::fs::read_dir(cache.parent().unwrap())
            .unwrap()
            .map(|entry| entry.unwrap().file_name())
            .collect();
        assert_eq!(left, vec!["pinned.bin"], "no part file may be left behind");
    }
}
