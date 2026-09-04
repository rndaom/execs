//! The app's one HTTP layer. Core stays network-free; everything that leaves
//! this process goes through here.
//!
//! One module, one timeout policy, one cap. Building a client, GETting,
//! checking the status, buffering the body, computing a cache path, verifying
//! and writing the cache all live here; re-implemented per fetch module, that
//! is how an API call ends up with no timeout and a download with no size
//! ceiling.

use std::collections::HashMap;
use std::io::Read;
use std::net::{IpAddr, ToSocketAddrs};
use std::path::{Path, PathBuf};
use std::sync::{Arc, Condvar, Mutex, OnceLock, Weak};
use std::time::{Duration, Instant};

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

/// DNS is checked before a socket is opened so a host supplied by an API or
/// redirect cannot point the desktop client at loopback or the local network.
/// Remembering the result keeps the HUD catalog's hundreds of requests from
/// doing hundreds of duplicate resolver calls.
const DNS_CHECK_TTL: Duration = Duration::from_secs(5 * 60);
const DNS_CHECK_TIMEOUT: Duration = Duration::from_secs(5);
const MAX_REDIRECTS: usize = 10;

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
pub enum Verify<'a> {
    Sha256(&'a str),
    Magic(&'a [u8]),
}

impl Verify<'_> {
    pub fn accepts(&self, bytes: &[u8]) -> bool {
        match self {
            Self::Sha256(expected) => execs_core::hash::sha256_hex(bytes) == *expected,
            Self::Magic(magic) => bytes.starts_with(magic),
        }
    }
}

/// Every remote source the backend is willing to contact. Keeping this list
/// here makes host validation and redirect policy one decision rather than a
/// different string check in each fetcher.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum RemoteSource {
    GitHubApi,
    GitHubRaw,
    GitHubRelease,
    GitHubCodeload,
    Dropbox,
    TeamFortressTv,
    GameBananaApi,
    GameBananaDownload,
    ComfigApp,
    ComfigHits,
    Tf2Huds,
}

impl RemoteSource {
    fn initial_hosts(self) -> &'static [&'static str] {
        match self {
            Self::GitHubApi => &["api.github.com"],
            Self::GitHubRaw => &["raw.githubusercontent.com"],
            Self::GitHubRelease => &["github.com"],
            Self::GitHubCodeload => &["codeload.github.com"],
            Self::Dropbox => &[
                "dropbox.com",
                "www.dropbox.com",
                "dl.dropboxusercontent.com",
            ],
            Self::TeamFortressTv => &["teamfortress.tv", "www.teamfortress.tv"],
            Self::GameBananaApi => &["gamebanana.com", "www.gamebanana.com"],
            Self::GameBananaDownload => &[
                "gamebanana.com",
                "www.gamebanana.com",
                "files.gamebanana.com",
            ],
            Self::ComfigApp => &["comfig.app", "www.comfig.app"],
            Self::ComfigHits => &["hits.comfig.app"],
            Self::Tf2Huds => &["tf2huds.dev", "www.tf2huds.dev"],
        }
    }

    fn redirect_hosts(self) -> &'static [&'static str] {
        match self {
            Self::GitHubRelease => &[
                "github.com",
                "release-assets.githubusercontent.com",
                "objects.githubusercontent.com",
                "github-releases.githubusercontent.com",
            ],
            Self::Dropbox => &[
                "dropbox.com",
                "www.dropbox.com",
                "dl.dropboxusercontent.com",
            ],
            Self::GameBananaDownload => &[
                "gamebanana.com",
                "www.gamebanana.com",
                "files.gamebanana.com",
            ],
            _ => self.initial_hosts(),
        }
    }

    fn initial_path_is_valid(self, url: &reqwest::Url) -> bool {
        let path = url.path();
        match self {
            Self::GitHubApi => path.starts_with("/repos/"),
            Self::GitHubRaw => path.split('/').filter(|part| !part.is_empty()).count() >= 3,
            Self::GitHubRelease => path.contains("/releases/download/"),
            Self::GitHubCodeload => path.contains("/legacy.zip/"),
            Self::Dropbox => !path.trim_matches('/').is_empty(),
            Self::TeamFortressTv => path
                .trim_start_matches('/')
                .split('/')
                .next()
                .is_some_and(|id| !id.is_empty() && id.bytes().all(|b| b.is_ascii_digit())),
            Self::GameBananaApi => path.starts_with("/apiv11/"),
            Self::GameBananaDownload => {
                let host = url.host_str().unwrap_or_default();
                host == "files.gamebanana.com" || path.starts_with("/dl/")
            }
            Self::ComfigApp => path.starts_with("/huds"),
            Self::ComfigHits => path.ends_with(".wav"),
            Self::Tf2Huds => path == "/" || path.starts_with("/huds/") || path.starts_with("/hud/"),
        }
    }
}

fn source_for_url(url: &reqwest::Url) -> Option<RemoteSource> {
    let host = url.host_str()?;
    Some(match host {
        "api.github.com" => RemoteSource::GitHubApi,
        "raw.githubusercontent.com" => RemoteSource::GitHubRaw,
        "github.com" => RemoteSource::GitHubRelease,
        "codeload.github.com" => RemoteSource::GitHubCodeload,
        "dropbox.com" | "www.dropbox.com" | "dl.dropboxusercontent.com" => RemoteSource::Dropbox,
        "teamfortress.tv" | "www.teamfortress.tv" => RemoteSource::TeamFortressTv,
        "gamebanana.com" | "www.gamebanana.com" => {
            if url.path().starts_with("/apiv11/") {
                RemoteSource::GameBananaApi
            } else {
                RemoteSource::GameBananaDownload
            }
        }
        "files.gamebanana.com" => RemoteSource::GameBananaDownload,
        "comfig.app" | "www.comfig.app" => RemoteSource::ComfigApp,
        "hits.comfig.app" => RemoteSource::ComfigHits,
        "tf2huds.dev" | "www.tf2huds.dev" => RemoteSource::Tf2Huds,
        _ => return None,
    })
}

fn host_matches(url: &reqwest::Url, allowed: &[&str]) -> bool {
    url.host_str().is_some_and(|host| allowed.contains(&host))
}

fn validate_url_shape(
    url: &reqwest::Url,
    source: RemoteSource,
    redirect: bool,
) -> Result<(), String> {
    if url.scheme() != "https" {
        return Err("The download was refused because it is not HTTPS.".into());
    }
    if !url.username().is_empty() || url.password().is_some() {
        return Err("The download URL must not contain credentials.".into());
    }
    if url.port().is_some_and(|port| port != 443) {
        return Err("The download URL uses an unexpected port.".into());
    }
    let allowed = if redirect {
        source.redirect_hosts()
    } else {
        source.initial_hosts()
    };
    if !host_matches(url, allowed) {
        return Err("The download redirected to an untrusted host.".into());
    }
    if !redirect && !source.initial_path_is_valid(url) {
        return Err("The download URL has an unexpected path.".into());
    }
    Ok(())
}

/// Parse and validate an API-supplied URL for the source that published it.
/// DNS is checked immediately before the actual request, not in this pure
/// helper, so callers and unit tests can validate records without networking.
pub fn validate_url_for(url: &str, source: RemoteSource) -> Result<reqwest::Url, String> {
    let parsed = reqwest::Url::parse(url.trim())
        .map_err(|_| "The download URL is not valid.".to_string())?;
    validate_url_shape(&parsed, source, false)?;
    Ok(parsed)
}

fn ip_is_private_or_special(ip: IpAddr) -> bool {
    match ip {
        IpAddr::V4(ip) => {
            let [a, b, c, _] = ip.octets();
            a == 0
                || a == 10
                || a == 127
                || (a == 100 && (64..=127).contains(&b))
                || (a == 169 && b == 254)
                || (a == 172 && (16..=31).contains(&b))
                || (a == 192 && b == 0 && c == 0)
                || (a == 192 && b == 168)
                || (a == 192 && b == 0 && c == 2)
                || (a == 198 && (b == 18 || b == 19))
                || (a == 198 && b == 51 && c == 100)
                || (a == 203 && b == 0 && c == 113)
                || a >= 224
        }
        IpAddr::V6(ip) => {
            let octets = ip.octets();
            ip.is_unspecified()
                || ip.is_loopback()
                || ip.is_multicast()
                || (octets[0] & 0xfe) == 0xfc
                || (octets[0] == 0xfe && (octets[1] & 0xc0) == 0x80)
                || ip.segments()[..2] == [0x2001, 0x0db8]
                || ip
                    .to_ipv4_mapped()
                    .is_some_and(|ip| ip_is_private_or_special(IpAddr::V4(ip)))
        }
    }
}

type DnsKey = (String, u16);
type DnsLookupRegistry = HashMap<DnsKey, Weak<DnsLookup>>;

fn dns_cache() -> &'static Mutex<HashMap<DnsKey, Instant>> {
    static CACHE: OnceLock<Mutex<HashMap<DnsKey, Instant>>> = OnceLock::new();
    CACHE.get_or_init(|| Mutex::new(HashMap::new()))
}

struct DnsLookup {
    result: Mutex<Option<Result<(), String>>>,
    ready: Condvar,
}

fn dns_lookups() -> &'static Mutex<DnsLookupRegistry> {
    static LOOKUPS: OnceLock<Mutex<DnsLookupRegistry>> = OnceLock::new();
    LOOKUPS.get_or_init(|| Mutex::new(HashMap::new()))
}

fn validate_public_resolution(url: &reqwest::Url) -> Result<(), String> {
    let host = url
        .host_str()
        .ok_or_else(|| "The download URL has no host.".to_string())?;
    let port = url.port_or_known_default().unwrap_or(443);
    let key = (host.to_string(), port);
    if dns_cache()
        .lock()
        .ok()
        .and_then(|cache| cache.get(&key).copied())
        .is_some_and(|checked| checked.elapsed() < DNS_CHECK_TTL)
    {
        return Ok(());
    }

    let (lookup, start) = {
        let mut lookups = dns_lookups()
            .lock()
            .map_err(|_| "The DNS lookup registry was poisoned.".to_string())?;
        lookups.retain(|_, lookup| lookup.strong_count() > 0);
        if let Some(lookup) = lookups.get(&key).and_then(Weak::upgrade) {
            (lookup, false)
        } else {
            let lookup = Arc::new(DnsLookup {
                result: Mutex::new(None),
                ready: Condvar::new(),
            });
            lookups.insert(key.clone(), Arc::downgrade(&lookup));
            (lookup, true)
        }
    };
    if start {
        let lookup = Arc::clone(&lookup);
        let lookup_key = key.clone();
        std::thread::spawn(move || {
            let result = (lookup_key.0.as_str(), lookup_key.1)
                .to_socket_addrs()
                .map_err(|_| "Could not resolve the download host.".to_string())
                .and_then(|addresses| {
                    let addresses = addresses.collect::<Vec<_>>();
                    if addresses.is_empty()
                        || addresses
                            .iter()
                            .any(|address| ip_is_private_or_special(address.ip()))
                    {
                        Err("The download host resolves to a private or reserved address.".into())
                    } else {
                        Ok(())
                    }
                });
            if result.is_ok() {
                if let Ok(mut cache) = dns_cache().lock() {
                    cache.insert(lookup_key, Instant::now());
                }
            }
            if let Ok(mut slot) = lookup.result.lock() {
                *slot = Some(result);
                lookup.ready.notify_all();
            }
        });
    }
    let deadline = Instant::now() + DNS_CHECK_TIMEOUT;
    let mut slot = lookup
        .result
        .lock()
        .map_err(|_| "The DNS lookup result was poisoned.".to_string())?;
    loop {
        if let Some(result) = slot.as_ref() {
            return result.clone();
        }
        let remaining = deadline.saturating_duration_since(Instant::now());
        if remaining.is_zero() {
            return Err("Resolving the download host timed out.".into());
        }
        let (next, timeout) = lookup
            .ready
            .wait_timeout(slot, remaining)
            .map_err(|_| "The DNS lookup result was poisoned.".to_string())?;
        slot = next;
        if timeout.timed_out() && slot.is_none() {
            return Err("Resolving the download host timed out.".into());
        }
    }
}

fn send_get(
    client: &reqwest::blocking::Client,
    url: &str,
    source: RemoteSource,
    timeout: Option<Duration>,
) -> Result<reqwest::blocking::Response, String> {
    let mut current = validate_url_for(url, source)?;
    let deadline = timeout.map(|timeout| Instant::now() + timeout);
    for redirects in 0..=MAX_REDIRECTS {
        validate_public_resolution(&current)?;
        let mut request = client.get(current.clone());
        if let Some(deadline) = deadline {
            let remaining = deadline.saturating_duration_since(Instant::now());
            if remaining.is_zero() {
                return Err("The download timed out.".into());
            }
            request = request.timeout(remaining);
        }
        let response = request.send().map_err(request_error)?;
        if !response.status().is_redirection() {
            return Ok(response);
        }
        if redirects == MAX_REDIRECTS {
            return Err("The download redirected too many times.".into());
        }
        let location = response
            .headers()
            .get(reqwest::header::LOCATION)
            .ok_or_else(|| "The download returned a redirect with no destination.".to_string())?
            .to_str()
            .map_err(|_| "The download returned an invalid redirect.".to_string())?;
        let next = current
            .join(location)
            .map_err(|_| "The download returned an invalid redirect.".to_string())?;
        validate_url_shape(&next, source, true)?;
        current = next;
    }
    Err("The download redirected too many times.".into())
}

pub fn client() -> Result<reqwest::blocking::Client, String> {
    static CLIENT: OnceLock<Result<reqwest::blocking::Client, String>> = OnceLock::new();
    CLIENT
        .get_or_init(|| build(DOWNLOAD_CONNECT_TIMEOUT, DOWNLOAD_TIMEOUT))
        .clone()
}

pub fn api_client() -> Result<reqwest::blocking::Client, String> {
    static CLIENT: OnceLock<Result<reqwest::blocking::Client, String>> = OnceLock::new();
    CLIENT
        .get_or_init(|| build(API_CONNECT_TIMEOUT, API_TIMEOUT))
        .clone()
}

fn build(connect: Duration, total: Duration) -> Result<reqwest::blocking::Client, String> {
    reqwest::blocking::Client::builder()
        .user_agent(USER_AGENT)
        .connect_timeout(connect)
        .timeout(total)
        .https_only(true)
        // Redirects are followed manually so every hop receives the same host,
        // scheme and private-address checks as the initial request.
        .redirect(reqwest::redirect::Policy::none())
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
pub fn get_text_for(
    client: &reqwest::blocking::Client,
    url: &str,
    source: RemoteSource,
) -> Result<String, String> {
    get_text_for_limit(client, url, source, API_MAX_BYTES)
}

pub fn get_text_for_limit(
    client: &reqwest::blocking::Client,
    url: &str,
    source: RemoteSource,
    max_bytes: u64,
) -> Result<String, String> {
    let mut response = send_get(client, url, source, Some(API_TIMEOUT))?;
    if !response.status().is_success() {
        return Err(format!("Could not download {url} ({})", response.status()));
    }
    let hint = response.content_length();
    let bytes = read_capped(&mut response, max_bytes.min(API_MAX_BYTES), hint)?;
    Ok(text_from_bytes(bytes))
}

/// GET a JSON document with the API timeout policy, under the same ceiling.
pub fn get_json_for<T: serde::de::DeserializeOwned>(
    client: &reqwest::blocking::Client,
    url: &str,
    source: RemoteSource,
) -> Result<T, String> {
    let mut response = send_get(client, url, source, Some(API_TIMEOUT))?;
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

/// Read a local cache file through the same ceiling as its network source.
/// Metadata is only an early refusal; the running cap handles a file growing
/// between `metadata` and `read`.
pub fn read_file_capped(path: &Path, max_bytes: u64) -> Result<Vec<u8>, String> {
    let mut file = std::fs::File::open(path).map_err(|err| err.to_string())?;
    let hint = file.metadata().ok().map(|metadata| metadata.len());
    read_capped(&mut file, max_bytes, hint)
}

/// Download a body, refusing anything past `max_bytes` — by `Content-Length`
/// when the server sends one, and by a running total either way.
pub fn download_bytes(url: &str, max_bytes: u64) -> Result<Vec<u8>, String> {
    let parsed = reqwest::Url::parse(url.trim())
        .map_err(|_| "The download URL is not valid.".to_string())?;
    let source = source_for_url(&parsed)
        .ok_or_else(|| "The download host is not on the app's allowlist.".to_string())?;
    download_bytes_for(url, max_bytes, source)
}

pub fn download_bytes_for(
    url: &str,
    max_bytes: u64,
    source: RemoteSource,
) -> Result<Vec<u8>, String> {
    download_bytes_for_timeout(url, max_bytes, source, None)
}

pub fn download_bytes_for_timeout(
    url: &str,
    max_bytes: u64,
    source: RemoteSource,
    timeout: Option<Duration>,
) -> Result<Vec<u8>, String> {
    let mut response = send_get(
        &client()?,
        url,
        source,
        Some(timeout.unwrap_or(DOWNLOAD_TIMEOUT)),
    )?;
    if !response.status().is_success() {
        return Err(format!("Could not download {url} ({})", response.status()));
    }
    let hint = response.content_length();
    read_capped(&mut response, max_bytes, hint)
}

/// A pinned asset, from the cache when it still verifies and from the network
/// otherwise. The cache file is only written once the bytes pass `verify`.
pub fn download_pinned_for(
    url: &str,
    cache_path: &Path,
    verify: Verify<'_>,
    max_bytes: u64,
    source: RemoteSource,
) -> Result<Vec<u8>, String> {
    download_pinned_validated_for(url, cache_path, verify, max_bytes, source, |_| Ok(()))
}

pub fn download_pinned_validated_for(
    url: &str,
    cache_path: &Path,
    verify: Verify<'_>,
    max_bytes: u64,
    source: RemoteSource,
    validate: impl Fn(&[u8]) -> Result<(), String>,
) -> Result<Vec<u8>, String> {
    download_pinned_validated_for_timeout(
        url, cache_path, verify, max_bytes, source, None, validate,
    )
}

pub fn download_pinned_validated_for_timeout(
    url: &str,
    cache_path: &Path,
    verify: Verify<'_>,
    max_bytes: u64,
    source: RemoteSource,
    timeout: Option<Duration>,
    validate: impl Fn(&[u8]) -> Result<(), String>,
) -> Result<Vec<u8>, String> {
    let cache_root = execs_core::try_execs_data_dir()?;
    download_pinned_with(
        &cache_root,
        url,
        cache_path,
        verify,
        max_bytes,
        validate,
        |url, max_bytes| download_bytes_for_timeout(url, max_bytes, source, timeout),
    )
}

fn download_pinned_with(
    cache_root: &Path,
    url: &str,
    cache_path: &Path,
    verify: Verify<'_>,
    max_bytes: u64,
    validate: impl Fn(&[u8]) -> Result<(), String>,
    fetch: impl FnOnce(&str, u64) -> Result<Vec<u8>, String>,
) -> Result<Vec<u8>, String> {
    // `write_atomic_within` deliberately uses a deterministic recovery part
    // name. Serialize one cache key from validation through publication so
    // concurrent callers cannot unlink or publish each other's in-flight
    // part file.
    let path_lock = cache_path_lock(cache_path)?;
    let _path_guard = path_lock
        .lock()
        .map_err(|_| "The download cache lock was poisoned.".to_string())?;
    match read_cache_file_capped(cache_root, cache_path, max_bytes) {
        Ok(bytes) if verify.accepts(&bytes) && validate(&bytes).is_ok() => return Ok(bytes),
        Ok(_) | Err(_) if std::fs::symlink_metadata(cache_path).is_ok() => {
            // Do not leave an oversized, valid-prefix but malformed, or
            // unreadable file looking like a usable offline cache. A failed
            // re-fetch will try again next time.
            execs_core::hash::remove_file_force_within(cache_root, cache_path).map_err(|err| {
                format!("Could not safely replace the invalid cached download ({err}).")
            })?;
        }
        Ok(_) | Err(_) => {}
    }
    let bytes = fetch(url, max_bytes)?;
    if !verify.accepts(&bytes) {
        return Err("The download failed verification.".into());
    }
    validate(&bytes)?;
    // Atomic, so a crash mid-write leaves the old cache file (or none) rather
    // than a truncated one that fails verification on every later start.
    execs_core::hash::write_atomic_within(cache_root, cache_path, &bytes)
        .map_err(|err| format!("Could not save the verified download ({err})."))?;
    Ok(bytes)
}

pub(crate) fn read_cache_file_capped(
    cache_root: &Path,
    path: &Path,
    max_bytes: u64,
) -> Result<Vec<u8>, String> {
    execs_core::hash::validate_file_within(cache_root, path).map_err(|err| err.to_string())?;
    read_file_capped(path, max_bytes)
}

fn cache_path_lock(path: &Path) -> Result<Arc<Mutex<()>>, String> {
    static LOCKS: OnceLock<Mutex<HashMap<PathBuf, Weak<Mutex<()>>>>> = OnceLock::new();
    let mut locks = LOCKS
        .get_or_init(|| Mutex::new(HashMap::new()))
        .lock()
        .map_err(|_| "The download cache registry was poisoned.".to_string())?;
    locks.retain(|_, lock| lock.strong_count() > 0);
    if let Some(lock) = locks.get(path).and_then(Weak::upgrade) {
        return Ok(lock);
    }
    let lock = Arc::new(Mutex::new(()));
    locks.insert(path.to_path_buf(), Arc::downgrade(&lock));
    Ok(lock)
}

pub(crate) fn write_cache_file_within(
    root: &Path,
    path: &Path,
    bytes: &[u8],
) -> Result<(), String> {
    let path_lock = cache_path_lock(path)?;
    let _path_guard = path_lock
        .lock()
        .map_err(|_| "The download cache lock was poisoned.".to_string())?;
    execs_core::hash::write_atomic_within(root, path, bytes).map_err(|err| err.to_string())
}

/// Verify a cache path without loading a large SHA-addressed file into memory.
pub fn cached_file_accepts(path: &Path, verify: Verify<'_>, max_bytes: u64) -> bool {
    let Ok(cache_root) = execs_core::try_execs_data_dir() else {
        return false;
    };
    cached_file_accepts_within(&cache_root, path, verify, max_bytes)
}

fn cached_file_accepts_within(
    cache_root: &Path,
    path: &Path,
    verify: Verify<'_>,
    max_bytes: u64,
) -> bool {
    if execs_core::hash::validate_file_within(cache_root, path).is_err() {
        return false;
    }
    let Ok(metadata) = std::fs::symlink_metadata(path) else {
        return false;
    };
    if !metadata.is_file() || metadata.len() > max_bytes {
        return false;
    }
    match verify {
        Verify::Sha256(expected) => {
            execs_core::hash::sha256_file(path).is_ok_and(|actual| actual == expected)
        }
        Verify::Magic(_) => read_cache_file_capped(cache_root, path, max_bytes)
            .is_ok_and(|bytes| verify.accepts(&bytes)),
    }
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
            &dir,
            "https://example.invalid/x",
            &cache,
            Verify::Magic(b"VTF\0"),
            1024,
            |_| Ok(()),
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
    fn concurrent_pinned_fetches_publish_one_complete_cache_file() {
        use std::sync::atomic::{AtomicUsize, Ordering};

        let dir = temp_dir("cache-single-flight");
        let cache = dir.join("pinned.bin");
        let calls = AtomicUsize::new(0);
        std::thread::scope(|scope| {
            let handles: Vec<_> = (0..2)
                .map(|_| {
                    scope.spawn(|| {
                        download_pinned_with(
                            &dir,
                            "https://example.invalid/x",
                            &cache,
                            Verify::Magic(b"VTF\0"),
                            1024,
                            |_| Ok(()),
                            |_, _| {
                                calls.fetch_add(1, Ordering::SeqCst);
                                std::thread::sleep(Duration::from_millis(50));
                                Ok(b"VTF\0complete".to_vec())
                            },
                        )
                        .unwrap()
                    })
                })
                .collect();
            for handle in handles {
                assert_eq!(handle.join().unwrap(), b"VTF\0complete");
            }
        });
        assert_eq!(calls.load(Ordering::SeqCst), 1);
        assert_eq!(std::fs::read(cache).unwrap(), b"VTF\0complete");
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
            &dir,
            "https://example.invalid/x",
            &cache,
            Verify::Sha256(hash),
            1024,
            |_| Ok(()),
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
            &dir,
            "https://example.invalid/x",
            &cache,
            Verify::Magic(b"VTF\0"),
            1024,
            |_| Ok(()),
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
            &dir,
            "https://example.invalid/x",
            &cache,
            Verify::Magic(b"VTF\0"),
            1024,
            |_| Ok(()),
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

    #[test]
    fn source_urls_require_https_exact_hosts_and_expected_paths() {
        assert!(validate_url_for(
            "https://api.github.com/repos/o/r/releases/latest",
            RemoteSource::GitHubApi
        )
        .is_ok());
        assert!(validate_url_for(
            "http://api.github.com/repos/o/r/releases/latest",
            RemoteSource::GitHubApi
        )
        .is_err());
        assert!(validate_url_for(
            "https://api.github.com.evil.test/repos/o/r/releases/latest",
            RemoteSource::GitHubApi
        )
        .is_err());
        assert!(validate_url_for(
            "https://gamebanana.com/apiv11/Mod/1/DownloadPage",
            RemoteSource::GameBananaDownload
        )
        .is_err());
        assert!(validate_url_for(
            "https://gamebanana.com/dl/1",
            RemoteSource::GameBananaDownload
        )
        .is_ok());
    }

    #[test]
    fn redirects_cannot_downgrade_or_leave_the_source_host_set() {
        let private = reqwest::Url::parse("https://127.0.0.1/archive.zip").unwrap();
        assert!(validate_url_shape(&private, RemoteSource::Dropbox, true).is_err());
        let downgrade = reqwest::Url::parse("http://dl.dropboxusercontent.com/a.zip").unwrap();
        assert!(validate_url_shape(&downgrade, RemoteSource::Dropbox, true).is_err());
        let expected = reqwest::Url::parse("https://dl.dropboxusercontent.com/a.zip").unwrap();
        assert!(validate_url_shape(&expected, RemoteSource::Dropbox, true).is_ok());
        assert!(ip_is_private_or_special("169.254.169.254".parse().unwrap()));
        assert!(ip_is_private_or_special("::1".parse().unwrap()));
        assert!(!ip_is_private_or_special("1.1.1.1".parse().unwrap()));
    }

    #[test]
    fn an_oversize_cache_is_not_read_or_trusted() {
        let dir = temp_dir("oversize-cache");
        let cache = dir.join("pinned.bin");
        std::fs::write(&cache, vec![0u8; 2048]).unwrap();
        assert!(read_file_capped(&cache, 1024).is_err());
        assert!(!cached_file_accepts_within(
            &dir,
            &cache,
            Verify::Magic(&[0]),
            1024
        ));
    }

    #[test]
    fn semantic_validation_evicts_a_valid_prefix_cache_and_refetches() {
        let dir = temp_dir("semantic-cache");
        let cache = dir.join("pinned.bin");
        std::fs::write(&cache, b"RIFFbroken").unwrap();
        let called = Cell::new(false);
        let bytes = download_pinned_with(
            &dir,
            "https://example.invalid/x",
            &cache,
            Verify::Magic(b"RIFF"),
            1024,
            |bytes| {
                (bytes == b"RIFFvalid")
                    .then_some(())
                    .ok_or_else(|| "bad wave".to_string())
            },
            |_, _| {
                called.set(true);
                Ok(b"RIFFvalid".to_vec())
            },
        )
        .unwrap();
        assert!(called.get());
        assert_eq!(bytes, b"RIFFvalid");
        assert_eq!(std::fs::read(cache).unwrap(), b"RIFFvalid");
    }

    #[test]
    fn a_verified_download_is_not_reported_successful_when_caching_fails() {
        let dir = temp_dir("cache-write-error");
        let parent_file = dir.join("not-a-directory");
        std::fs::write(&parent_file, b"occupied").unwrap();
        let cache = parent_file.join("pinned.bin");
        let err = download_pinned_with(
            &dir,
            "https://example.invalid/x",
            &cache,
            Verify::Magic(b"VTF\0"),
            1024,
            |_| Ok(()),
            |_, _| Ok(b"VTF\0fresh".to_vec()),
        )
        .unwrap_err();
        assert!(err.contains("Could not save"), "{err}");
    }

    #[test]
    fn a_linked_cache_directory_cannot_delete_or_replace_external_bytes() {
        let root = temp_dir("linked-cache-root");
        let victim = temp_dir("linked-cache-victim");
        let victim_file = victim.join("pinned.bin");
        std::fs::write(&victim_file, b"external bytes").unwrap();
        let linked_cache = root.join("cache");
        link_dir(&victim, &linked_cache);
        let cache = linked_cache.join("pinned.bin");

        let error = download_pinned_with(
            &root,
            "https://example.invalid/x",
            &cache,
            Verify::Magic(b"VTF\0"),
            1024,
            |_| Ok(()),
            |_, _| Ok(b"VTF\0fresh".to_vec()),
        )
        .unwrap_err();

        assert!(error.contains("safely replace"), "{error}");
        assert_eq!(std::fs::read(&victim_file).unwrap(), b"external bytes");
        unlink_dir(&linked_cache);
        std::fs::remove_dir_all(root).unwrap();
        std::fs::remove_dir_all(victim).unwrap();
    }
}
