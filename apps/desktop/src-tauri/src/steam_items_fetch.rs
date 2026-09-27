//! Valve's own descriptions and rendered images for the signed-in player's
//! public TF2 inventory (context 2, where an asset id is the item id). These
//! show painted weapons, war paints and kits exactly as TF2 renders them. Reads
//! only; images are cached under `<data dir>/inventory-art/` and re-download on
//! use, so Clear downloads may remove them.
use crate::net::{self, RemoteSource, MIB};
use serde::{Deserialize, Serialize};
use std::{
    collections::BTreeMap,
    path::{Path, PathBuf},
    sync::{Mutex, OnceLock},
    time::{Duration, Instant},
};

const PAGE_ITEMS: usize = 2000;
/// A full supported backpack is 4000 slots at most; one spare page.
const MAX_PAGES: usize = 3;
const PAGE_MAX_BYTES: u64 = 8 * MIB;
const IMAGE_MAX_BYTES: u64 = MIB;
/// Descriptions refresh at most this often unless an item is missing.
const FRESH: Duration = Duration::from_secs(10 * 60);
/// Missing items (a new craft, a trade) wait at least this long between reads.
const RETRY: Duration = Duration::from_secs(45);
/// Steam's inventory endpoint rate-limits hard; back off after a 429.
const BUSY_BACKOFF: Duration = Duration::from_secs(3 * 60);
pub const IMAGE_SIZES: [u32; 2] = [192, 360];
const MAX_TEXT: usize = 1024;
const MAX_LINES: usize = 64;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct SteamLine {
    pub text: String,
    pub color: Option<String>,
    /// Player-written text (a description tag).
    pub user: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct SteamItem {
    /// Valve's image name; pass it back to fetch the rendered image.
    pub image: String,
    pub name: String,
    /// The full item name without a Name Tag, such as "Strange Scattergun".
    pub market_name: Option<String>,
    pub name_color: Option<String>,
    /// TF2's "Level 1 Rocket Launcher" line.
    pub type_line: String,
    pub lines: Vec<SteamLine>,
    /// The item's name before a Name Tag, when it was renamed.
    pub original_name: Option<String>,
}

#[derive(Debug, Clone, Copy, Serialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum SteamItemsStatus {
    Ready,
    /// The inventory (or profile) is not public.
    Private,
    /// Steam asked us to slow down; cached data is kept.
    Busy,
    Unavailable,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SteamItems {
    pub status: SteamItemsStatus,
    pub message: Option<String>,
    pub items: BTreeMap<String, SteamItem>,
}

#[derive(Deserialize)]
struct Page {
    success: Option<serde_json::Value>,
    #[serde(default)]
    assets: Vec<Asset>,
    #[serde(default)]
    descriptions: Vec<Description>,
    more_items: Option<serde_json::Value>,
    last_assetid: Option<String>,
}

#[derive(Deserialize)]
struct Asset {
    assetid: String,
    classid: String,
    instanceid: Option<String>,
}

#[derive(Deserialize)]
struct Description {
    classid: String,
    instanceid: Option<String>,
    icon_url: Option<String>,
    icon_url_large: Option<String>,
    #[serde(default)]
    name: String,
    market_name: Option<String>,
    name_color: Option<String>,
    #[serde(default, rename = "type")]
    type_line: String,
    #[serde(default)]
    descriptions: Vec<RawLine>,
    #[serde(default)]
    fraudwarnings: Vec<String>,
}

#[derive(Deserialize)]
struct RawLine {
    #[serde(default)]
    value: String,
    color: Option<String>,
    #[serde(rename = "type")]
    kind: Option<String>,
}

fn truthy(value: &Option<serde_json::Value>) -> bool {
    match value {
        Some(serde_json::Value::Bool(value)) => *value,
        Some(serde_json::Value::Number(value)) => value.as_i64() == Some(1),
        _ => false,
    }
}

fn bounded(text: &str) -> String {
    text.chars()
        .filter(|c| !c.is_control() || *c == '\n')
        .take(MAX_TEXT)
        .collect::<String>()
        .trim_end()
        .to_string()
}

fn color(value: Option<&str>) -> Option<String> {
    let value = value?.trim_start_matches('#');
    (value.len() == 6 && value.bytes().all(|b| b.is_ascii_hexdigit()))
        .then(|| format!("#{}", value.to_ascii_uppercase()))
}

/// Image names are base64url-like tokens that become one URL path segment.
pub fn valid_image(name: &str) -> bool {
    (16..=1024).contains(&name.len())
        && name
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || b == b'-' || b == b'_')
}

fn valid_asset(id: &str) -> bool {
    (1..=20).contains(&id.len()) && id.bytes().all(|b| b.is_ascii_digit()) && !id.starts_with('0')
}

pub fn valid_steam_id(id: &str) -> bool {
    id.len() == 17 && id.starts_with("7656119") && id.bytes().all(|b| b.is_ascii_digit())
}

fn original_name(warnings: &[String]) -> Option<String> {
    warnings.iter().find_map(|warning| {
        let rest = warning.split_once("Original name: \"")?.1;
        let name = rest.rsplit_once('"')?.0;
        (!name.is_empty()).then(|| bounded(name))
    })
}

fn item(description: &Description) -> Option<SteamItem> {
    let image = description
        .icon_url_large
        .as_deref()
        .filter(|name| valid_image(name))
        .or(description.icon_url.as_deref())
        .filter(|name| valid_image(name))?
        .to_string();
    let lines = description
        .descriptions
        .iter()
        // TF2 descriptions are plain text; skip markup rather than render it.
        .filter(|line| line.kind.as_deref() != Some("html"))
        .take(MAX_LINES)
        .map(|line| SteamLine {
            text: bounded(&line.value),
            color: color(line.color.as_deref()),
            user: line.kind.as_deref() == Some("usertext"),
        })
        .collect();
    Some(SteamItem {
        image,
        name: bounded(&description.name),
        market_name: description
            .market_name
            .as_deref()
            .map(bounded)
            .filter(|name| !name.is_empty()),
        name_color: color(description.name_color.as_deref()),
        type_line: bounded(&description.type_line),
        lines,
        original_name: original_name(&description.fraudwarnings),
    })
}

/// Join a page's assets with its class descriptions.
fn parse_page(bytes: &[u8]) -> Result<(BTreeMap<String, SteamItem>, Option<String>), String> {
    let page: Page =
        serde_json::from_slice(bytes).map_err(|_| "Steam returned an unreadable inventory.")?;
    if page.success.is_some() && !truthy(&page.success) {
        return Err("Steam did not return this inventory.".into());
    }
    let classes: BTreeMap<(String, String), &Description> = page
        .descriptions
        .iter()
        .map(|d| {
            (
                (d.classid.clone(), d.instanceid.clone().unwrap_or_default()),
                d,
            )
        })
        .collect();
    let mut items = BTreeMap::new();
    for asset in &page.assets {
        if !valid_asset(&asset.assetid) {
            continue;
        }
        let key = (
            asset.classid.clone(),
            asset.instanceid.clone().unwrap_or_default(),
        );
        if let Some(parsed) = classes.get(&key).and_then(|d| item(d)) {
            items.insert(asset.assetid.clone(), parsed);
        }
    }
    let next = truthy(&page.more_items)
        .then_some(page.last_assetid)
        .flatten()
        .filter(|id| valid_asset(id));
    Ok((items, next))
}

enum Fetched {
    Items(BTreeMap<String, SteamItem>),
    Status(SteamItemsStatus, String),
}

fn fetch(steam_id: &str) -> Result<Fetched, String> {
    let client = net::api_client()?;
    let mut items = BTreeMap::new();
    let mut start: Option<String> = None;
    for _ in 0..MAX_PAGES {
        let mut url = format!(
            "https://steamcommunity.com/inventory/{steam_id}/440/2?l=english&count={PAGE_ITEMS}"
        );
        if let Some(start) = &start {
            url.push_str(&format!("&start_assetid={start}"));
        }
        let bytes = match net::get_bytes_or_status_for(
            &client,
            &url,
            RemoteSource::SteamInventory,
            PAGE_MAX_BYTES,
        )? {
            Ok(bytes) => bytes,
            Err(status) if status.as_u16() == 403 || status.as_u16() == 401 => {
                return Ok(Fetched::Status(
                    SteamItemsStatus::Private,
                    "Set your Steam inventory to public to show TF2's own item art and descriptions.".into(),
                ))
            }
            Err(status) if status.as_u16() == 429 => {
                return Ok(Fetched::Status(
                    SteamItemsStatus::Busy,
                    "Steam is limiting inventory reads; item art will update shortly.".into(),
                ))
            }
            Err(status) => return Err(format!("Steam returned {status} for the inventory.")),
        };
        // A private inventory can also be a 200 with a JSON null.
        if bytes.trim_ascii() == b"null" {
            return Ok(Fetched::Status(
                SteamItemsStatus::Private,
                "Set your Steam inventory to public to show TF2's own item art and descriptions."
                    .into(),
            ));
        }
        let (page, next) = parse_page(&bytes)?;
        items.extend(page);
        match next {
            Some(next) if Some(&next) != start.as_ref() => start = Some(next),
            _ => break,
        }
    }
    Ok(Fetched::Items(items))
}

struct Cached {
    items: BTreeMap<String, SteamItem>,
    fetched: Option<Instant>,
    attempted: Option<Instant>,
    status: SteamItemsStatus,
    message: Option<String>,
}

fn cache() -> &'static Mutex<BTreeMap<String, Cached>> {
    static CACHE: OnceLock<Mutex<BTreeMap<String, Cached>>> = OnceLock::new();
    CACHE.get_or_init(Default::default)
}

fn art_dir(data: &Path) -> PathBuf {
    data.join("inventory-art")
}

fn descriptions_path(data: &Path, steam_id: &str) -> PathBuf {
    art_dir(data).join(format!("{steam_id}.json"))
}

fn read_saved(data: &Path, steam_id: &str) -> BTreeMap<String, SteamItem> {
    net::read_file_capped(&descriptions_path(data, steam_id), 4 * PAGE_MAX_BYTES)
        .ok()
        .and_then(|bytes| serde_json::from_slice(&bytes).ok())
        .unwrap_or_default()
}

fn save(data: &Path, steam_id: &str, items: &BTreeMap<String, SteamItem>) {
    // Presentation cache only: a failed write just means a later re-download.
    if let Ok(bytes) = serde_json::to_vec(items) {
        let path = descriptions_path(data, steam_id);
        if std::fs::create_dir_all(art_dir(data)).is_ok() {
            let _ = execs_core::hash::write_atomic(&path, &bytes);
        }
    }
}

/// Descriptions for the requested items. Reads Steam only when the cache is
/// stale, an item is missing, or `refresh` is set, never more often than the
/// retry and rate-limit intervals allow.
pub fn items(
    data: &Path,
    steam_id: &str,
    asset_ids: &[String],
    refresh: bool,
) -> Result<SteamItems, String> {
    if !valid_steam_id(steam_id) || asset_ids.len() > 10_000 {
        return Err("Invalid Steam inventory request.".into());
    }
    let now = Instant::now();
    let mut guard = cache()
        .lock()
        .map_err(|_| "Item art cache is unavailable.")?;
    let entry = guard.entry(steam_id.to_string()).or_insert_with(|| Cached {
        items: read_saved(data, steam_id),
        fetched: None,
        attempted: None,
        status: SteamItemsStatus::Ready,
        message: None,
    });
    let missing = asset_ids.iter().any(|id| !entry.items.contains_key(id));
    let stale = entry
        .fetched
        .is_none_or(|at| now.duration_since(at) > FRESH);
    let wait = if entry.status == SteamItemsStatus::Busy {
        BUSY_BACKOFF
    } else {
        RETRY
    };
    if (refresh || missing || stale)
        && entry
            .attempted
            .is_none_or(|at| now.duration_since(at) >= wait)
    {
        entry.attempted = Some(now);
        // Holding the lock serializes reads for one account; Steam limits them anyway.
        match fetch(steam_id) {
            Ok(Fetched::Items(items)) => {
                save(data, steam_id, &items);
                entry.items = items;
                entry.fetched = Some(now);
                entry.status = SteamItemsStatus::Ready;
                entry.message = None;
            }
            Ok(Fetched::Status(status, message)) => {
                entry.status = status;
                entry.message = Some(message);
            }
            Err(message) => {
                entry.status = SteamItemsStatus::Unavailable;
                entry.message = Some(message);
            }
        }
    }
    Ok(SteamItems {
        status: entry.status,
        message: entry.message.clone(),
        items: asset_ids
            .iter()
            .filter_map(|id| entry.items.get(id).map(|item| (id.clone(), item.clone())))
            .collect(),
    })
}

fn image_path(data: &Path, name: &str, size: u32) -> PathBuf {
    let digest = execs_core::hash::sha256_hex(name.as_bytes());
    art_dir(data)
        .join("images")
        .join(format!("{}-{size}.png", &digest[..32]))
}

fn is_png(bytes: &[u8]) -> bool {
    bytes.starts_with(b"\x89PNG\r\n\x1a\n")
}

/// One rendered item image, from disk when cached.
pub fn image(data: &Path, name: &str, size: u32) -> Result<Vec<u8>, String> {
    if !valid_image(name) || !IMAGE_SIZES.contains(&size) {
        return Err("Invalid item image request.".into());
    }
    let path = image_path(data, name, size);
    if let Ok(bytes) = net::read_file_capped(&path, IMAGE_MAX_BYTES) {
        if is_png(&bytes) {
            return Ok(bytes);
        }
    }
    let url =
        format!("https://community.akamai.steamstatic.com/economy/image/{name}/{size}fx{size}f");
    let bytes = net::download_bytes_for_timeout(
        &url,
        IMAGE_MAX_BYTES,
        RemoteSource::SteamItemImage,
        Some(Duration::from_secs(30)),
    )?;
    if !is_png(&bytes) {
        return Err("Steam returned an item image in an unexpected format.".into());
    }
    if let Some(parent) = path.parent() {
        if std::fs::create_dir_all(parent).is_ok() {
            let _ = execs_core::hash::write_atomic(&path, &bytes);
        }
    }
    Ok(bytes)
}

#[cfg(test)]
mod tests {
    use super::*;

    const ICON: &str = "fWFc82js0fmoRAP-qOIPu5THSWqfSmTELLqcUywGkijVjZULUrsm1j";

    #[test]
    fn joins_assets_to_descriptions_and_bounds_fields() {
        let page = serde_json::json!({
            "success": 1,
            "assets": [
                {"assetid": "14475960074", "classid": "1", "instanceid": "2"},
                {"assetid": "0123", "classid": "1", "instanceid": "2"},
                {"assetid": "15", "classid": "9", "instanceid": "0"}
            ],
            "descriptions": [{
                "classid": "1", "instanceid": "2",
                "icon_url": ICON,
                "name": "''brat.''",
                "market_name": "Strange Scattergun",
                "name_color": "CF6A32",
                "type": "Strange Scattergun - Kills: 4",
                "descriptions": [
                    {"type": "usertext", "value": "''A description tag.''"},
                    {"value": "+15% damage", "color": "7ea9d1"},
                    {"type": "html", "value": "<b>markup</b>"}
                ],
                "fraudwarnings": ["This item has been renamed.\nOriginal name: \"Scattergun\""]
            }],
            "more_items": 1,
            "last_assetid": "14475960074"
        });
        let (items, next) = parse_page(&serde_json::to_vec(&page).unwrap()).unwrap();
        assert_eq!(next.as_deref(), Some("14475960074"));
        assert_eq!(
            items.len(),
            1,
            "invalid ids and unknown classes are skipped"
        );
        let item = &items["14475960074"];
        assert_eq!(item.image, ICON);
        assert_eq!(item.name_color.as_deref(), Some("#CF6A32"));
        assert_eq!(item.original_name.as_deref(), Some("Scattergun"));
        assert_eq!(item.market_name.as_deref(), Some("Strange Scattergun"));
        assert_eq!(item.lines.len(), 2);
        assert!(item.lines[0].user);
        assert_eq!(item.lines[1].color.as_deref(), Some("#7EA9D1"));
    }

    #[test]
    fn refuses_unsafe_image_names_and_sizes() {
        assert!(valid_image(ICON));
        for bad in [
            "short",
            "../../etc/passwd/aaaaaaaaaaaa",
            "a/b-aaaaaaaaaaaaaaaaaaa",
            "a?b=aaaaaaaaaaaaaaaaa",
        ] {
            assert!(!valid_image(bad), "{bad}");
        }
        let dir = std::env::temp_dir();
        assert!(image(&dir, ICON, 64).is_err());
        assert!(image(&dir, "bad/name", 192).is_err());
        assert!(!valid_steam_id("12345678901234567"));
        assert!(valid_steam_id("76561198000000000"));
    }

    #[test]
    fn remote_sources_pin_host_and_path() {
        assert!(net::validate_url_for(
            "https://steamcommunity.com/inventory/76561198000000000/440/2?l=english",
            RemoteSource::SteamInventory
        )
        .is_ok());
        for bad in [
            "https://steamcommunity.com/inventory/76561198000000000/730/2",
            "https://steamcommunity.com/id/someone/inventory",
            "http://steamcommunity.com/inventory/76561198000000000/440/2",
        ] {
            assert!(
                net::validate_url_for(bad, RemoteSource::SteamInventory).is_err(),
                "{bad}"
            );
        }
        assert!(net::validate_url_for(
            &format!("https://community.akamai.steamstatic.com/economy/image/{ICON}/192fx192f"),
            RemoteSource::SteamItemImage
        )
        .is_ok());
        assert!(net::validate_url_for(
            "https://community.akamai.steamstatic.com/public/images/avatar.png",
            RemoteSource::SteamItemImage
        )
        .is_err());
    }

    /// Opt-in live read of a public inventory: `EXECS_TEST_STEAM_ID=<id>`.
    #[test]
    fn optional_live_public_inventory_read() {
        let Some(steam_id) = std::env::var_os("EXECS_TEST_STEAM_ID") else {
            return;
        };
        let steam_id = steam_id.to_string_lossy().to_string();
        let data = std::env::temp_dir().join(format!("execs-steam-art-{}", std::process::id()));
        let fetched = match fetch(&steam_id).unwrap() {
            Fetched::Items(items) => items,
            Fetched::Status(status, message) => panic!("{status:?}: {message}"),
        };
        assert!(!fetched.is_empty());
        let ids: Vec<String> = fetched.keys().take(3).cloned().collect();
        let result = items(&data, &steam_id, &ids, false).unwrap();
        assert_eq!(result.status, SteamItemsStatus::Ready);
        assert_eq!(result.items.len(), ids.len());
        let first = &result.items[&ids[0]];
        for size in IMAGE_SIZES {
            assert!(is_png(&image(&data, &first.image, size).unwrap()));
        }
        // The second read comes from disk.
        assert!(image_path(&data, &first.image, 192).is_file());
        let _ = std::fs::remove_dir_all(&data);
    }

    #[test]
    fn unreadable_or_unsuccessful_pages_are_errors() {
        assert!(parse_page(b"{\"success\": false}").is_err());
        assert!(parse_page(b"not json").is_err());
    }
}
