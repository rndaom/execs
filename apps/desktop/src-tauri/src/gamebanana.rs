//! GameBanana's public `apiv11`: browsing TF2 mods, and resolving one to a
//! downloadable archive.
//!
//! TF2's GameBanana game id is **297**. (440 is its Steam appid; this API does
//! not know it.) Everything here is read-only and unauthenticated — one request
//! per call, the app's own user agent, and a short in-memory cache so paging
//! back and forth does not hammer the site.

use std::collections::HashMap;
use std::sync::{Mutex, OnceLock};
use std::time::{Duration, Instant};

use serde::{Deserialize, Serialize};

use crate::net::{self, MIB};

pub const TF2_GAME_ID: u64 = 297;

const API: &str = "https://gamebanana.com/apiv11";

/// What the list and search commands ask for. GameBanana honours it on
/// `Mod/Index`; `Util/Search` has its own fixed page size and reports it back.
const PAGE_SIZE: u32 = 20;

const LIST_TTL: Duration = Duration::from_secs(10 * 60);
const CATEGORY_TTL: Duration = Duration::from_secs(24 * 60 * 60);

/// A mod archive ceiling matching the one core enforces on a pack.
pub const MOD_MAX_BYTES: u64 = 512 * MIB;

/// One mod as the browse UI needs it.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GameBananaMod {
    pub id: u64,
    pub name: String,
    pub author: String,
    pub category: String,
    pub category_id: u64,
    pub likes: u64,
    pub views: u64,
    /// `None` from a listing: GameBanana's index records carry likes and views
    /// but not download counts, and only the per-mod profile page has them —
    /// one request per row is not a trade worth making for a sort key.
    pub downloads: Option<u64>,
    pub updated_at: i64,
    pub added_at: i64,
    pub thumb: Option<String>,
    pub url: String,
    /// GameBanana's content-rating flag (nudity, gore, ...). Hidden unless the
    /// user asks for mature content.
    pub mature: bool,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GameBananaPage {
    pub records: Vec<GameBananaMod>,
    pub total: u64,
    pub per_page: u32,
    /// GameBanana's own "there is nothing after this page" flag.
    pub complete: bool,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GameBananaCategory {
    pub id: u64,
    pub name: String,
}

// ---------------------------------------------------------------------------
// Wire shapes
// ---------------------------------------------------------------------------

#[derive(Debug, Deserialize)]
struct IndexResponse {
    #[serde(rename = "_aMetadata", default)]
    metadata: Metadata,
    #[serde(rename = "_aRecords", default)]
    records: Vec<RawRecord>,
}

#[derive(Debug, Default, Deserialize)]
struct Metadata {
    #[serde(rename = "_nRecordCount", default)]
    record_count: u64,
    #[serde(rename = "_nPerpage", default)]
    per_page: u32,
    #[serde(rename = "_bIsComplete", default)]
    complete: bool,
    #[serde(rename = "_aSectionMatchCounts", default)]
    section_counts: Vec<SectionCount>,
}

#[derive(Debug, Deserialize)]
struct SectionCount {
    #[serde(rename = "_sModelName", default)]
    model: String,
    #[serde(rename = "_nMatchCount", default)]
    count: u64,
}

#[derive(Debug, Deserialize)]
struct RawRecord {
    #[serde(rename = "_idRow", default)]
    id: u64,
    #[serde(rename = "_sModelName", default)]
    model: String,
    #[serde(rename = "_sName", default)]
    name: String,
    #[serde(rename = "_sProfileUrl", default)]
    profile_url: String,
    #[serde(rename = "_tsDateAdded", default)]
    added: i64,
    #[serde(rename = "_tsDateModified", default)]
    modified: i64,
    #[serde(rename = "_tsDateUpdated", default)]
    updated: Option<i64>,
    #[serde(rename = "_nLikeCount", default)]
    likes: u64,
    #[serde(rename = "_nViewCount", default)]
    views: u64,
    #[serde(rename = "_nDownloadCount", default)]
    downloads: Option<u64>,
    #[serde(rename = "_aPreviewMedia", default)]
    preview: Option<PreviewMedia>,
    #[serde(rename = "_aSubmitter", default)]
    submitter: Option<NamedRow>,
    #[serde(rename = "_aRootCategory", default)]
    root_category: Option<CategoryRow>,
    #[serde(rename = "_bHasContentRatings", default)]
    has_content_ratings: bool,
}

#[derive(Debug, Default, Deserialize)]
struct PreviewMedia {
    #[serde(rename = "_aImages", default)]
    images: Vec<PreviewImage>,
}

#[derive(Debug, Deserialize)]
struct PreviewImage {
    #[serde(rename = "_sBaseUrl", default)]
    base_url: String,
    #[serde(rename = "_sFile", default)]
    file: String,
    #[serde(rename = "_sFile220", default)]
    file220: Option<String>,
    #[serde(rename = "_sFile100", default)]
    file100: Option<String>,
}

#[derive(Debug, Deserialize)]
struct NamedRow {
    #[serde(rename = "_sName", default)]
    name: String,
}

/// A root category as it rides on a record. Unlike the categories endpoint,
/// this shape carries no `_idRow` — the id has to come out of the URL.
#[derive(Debug, Deserialize)]
struct CategoryRow {
    #[serde(rename = "_sName", default)]
    name: String,
    #[serde(rename = "_sProfileUrl", default)]
    profile_url: String,
}

#[derive(Debug, Deserialize)]
struct RawCategory {
    #[serde(rename = "_idRow", default)]
    id: u64,
    #[serde(rename = "_sName", default)]
    name: String,
}

#[derive(Debug, Deserialize)]
struct ProfilePage {
    #[serde(rename = "_idRow", default)]
    id: u64,
    #[serde(rename = "_sName", default)]
    name: String,
    #[serde(rename = "_sProfileUrl", default)]
    profile_url: String,
}

/// Name and page URL for one mod, for the record a new install writes.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct GameBananaProfile {
    pub id: u64,
    pub name: String,
    pub url: String,
}

// ---------------------------------------------------------------------------
// Browsing
// ---------------------------------------------------------------------------

/// The frontend's sort keys, mapped to the aliases the index endpoint accepts.
///
/// `Generic_LatestAdded` is not one of them — the API answers 400
/// `UNKNOWN_SORT` — so "newest" is `Generic_Newest`, which is verifiably
/// ordered by `_tsDateAdded`.
fn index_sort(sort: &str) -> Result<&'static str, String> {
    Ok(match sort {
        "downloads" => "Generic_MostDownloaded",
        "likes" => "Generic_MostLiked",
        "views" => "Generic_MostViewed",
        "updated" => "Generic_LatestModified",
        "new" => "Generic_Newest",
        other => return Err(format!("Unknown sort: {other}")),
    })
}

/// One page of TF2 mods.
///
/// An empty query browses `Mod/Index`, which sorts server-side. A non-empty one
/// goes through `Util/Search/Results`, which has **no sort parameter at all**:
/// the page comes back in relevance order and is sorted here, so the ordering a
/// search shows is only within the page the user is looking at.
/// GameBanana has no server-side content-rating filter, so with
/// `include_mature` off the flagged records are dropped from the page here
/// and a page can come back shorter than `per_page`.
pub fn search_mods(
    query: &str,
    sort: &str,
    category: Option<u64>,
    page: u32,
    include_mature: bool,
) -> Result<GameBananaPage, String> {
    let sort_alias = index_sort(sort)?;
    let page = page.max(1);
    let query = query.trim();
    if query.is_empty() {
        let mut url = format!(
            "{API}/Mod/Index?_nPage={page}&_nPerpage={PAGE_SIZE}&_aFilters[Generic_Game]={TF2_GAME_ID}&_sSort={sort_alias}"
        );
        if let Some(category) = category {
            url.push_str(&format!("&_aFilters[Generic_Category]={category}"));
        }
        let response: IndexResponse = fetch_json(&url, LIST_TTL)?;
        return Ok(page_from(response, None, sort, false, include_mature));
    }

    let url = format!(
        "{API}/Util/Search/Results?_sSearchString={}&_idGameRow={TF2_GAME_ID}&_nPage={page}&_nPerpage={PAGE_SIZE}&_sModelName=Mod",
        encode_query(query)
    );
    let response: IndexResponse = fetch_json(&url, LIST_TTL)?;
    Ok(page_from(response, category, sort, true, include_mature))
}

fn page_from(
    response: IndexResponse,
    category: Option<u64>,
    sort: &str,
    client_sorted: bool,
    include_mature: bool,
) -> GameBananaPage {
    // A search answers with every model GameBanana matched; only submissions
    // that are actually mods can be installed.
    let mut records: Vec<GameBananaMod> = response
        .records
        .iter()
        .filter(|record| record.model.is_empty() || record.model == "Mod")
        .map(record_to_mod)
        .filter(|record| category.is_none_or_matches(record))
        .filter(|record| include_mature || !record.mature)
        .collect();
    // A search narrowed to one model reports `_nRecordCount` as GameBanana's own
    // 1,000-result search cap rather than a match count, and drops the
    // per-section counts; when those counts are present the mod section is the
    // honest total.
    let total = response
        .metadata
        .section_counts
        .iter()
        .find(|section| section.model == "Mod")
        .map(|section| section.count)
        .unwrap_or(response.metadata.record_count);
    if client_sorted {
        sort_records(&mut records, sort);
    }
    let per_page = if response.metadata.per_page == 0 {
        PAGE_SIZE
    } else {
        response.metadata.per_page
    };
    GameBananaPage {
        records,
        total,
        per_page,
        complete: response.metadata.complete,
    }
}

/// Search takes no category filter, so a chosen category narrows the page here.
trait CategoryFilter {
    fn is_none_or_matches(&self, record: &GameBananaMod) -> bool;
}

impl CategoryFilter for Option<u64> {
    fn is_none_or_matches(&self, record: &GameBananaMod) -> bool {
        match self {
            None => true,
            Some(id) => record.category_id == *id,
        }
    }
}

fn sort_records(records: &mut [GameBananaMod], sort: &str) {
    match sort {
        "downloads" => {
            records.sort_by_key(|record| std::cmp::Reverse(record.downloads.unwrap_or(0)))
        }
        "likes" => records.sort_by_key(|record| std::cmp::Reverse(record.likes)),
        "views" => records.sort_by_key(|record| std::cmp::Reverse(record.views)),
        "updated" => records.sort_by_key(|record| std::cmp::Reverse(record.updated_at)),
        "new" => records.sort_by_key(|record| std::cmp::Reverse(record.added_at)),
        _ => {}
    }
}

fn record_to_mod(record: &RawRecord) -> GameBananaMod {
    let category = record.root_category.as_ref();
    GameBananaMod {
        id: record.id,
        name: record.name.clone(),
        author: record
            .submitter
            .as_ref()
            .map(|row| row.name.clone())
            .unwrap_or_default(),
        category: category.map(|row| row.name.clone()).unwrap_or_default(),
        category_id: category
            .and_then(|row| category_id_from_url(&row.profile_url))
            .unwrap_or(0),
        likes: record.likes,
        views: record.views,
        downloads: record.downloads,
        updated_at: record.updated.unwrap_or(record.modified),
        added_at: record.added,
        thumb: record.preview.as_ref().and_then(thumb_url),
        url: if record.profile_url.is_empty() {
            format!("https://gamebanana.com/mods/{}", record.id)
        } else {
            record.profile_url.clone()
        },
        mature: record.has_content_ratings,
    }
}

/// `https://gamebanana.com/mods/cats/7951` → `7951`.
fn category_id_from_url(url: &str) -> Option<u64> {
    url.trim_end_matches('/').rsplit('/').next()?.parse().ok()
}

fn thumb_url(preview: &PreviewMedia) -> Option<String> {
    let image = preview.images.first()?;
    if image.base_url.is_empty() {
        return None;
    }
    let file = image
        .file220
        .as_deref()
        .or(image.file100.as_deref())
        .unwrap_or(image.file.as_str());
    if file.is_empty() {
        return None;
    }
    Some(format!("{}/{file}", image.base_url.trim_end_matches('/')))
}

/// TF2's root categories, minus the ones that are not a `tf/custom` pack this
/// app can install. GameBanana's TF2 list is Castaways, Decal Tool, Effects,
/// Game files, GUIs, Maps, Prefabs, Serverside Weapons, Skins and Textures —
/// Maps and GUIs are the brief's exclusions, Decal Tool is where sprays live,
/// and Prefabs (Hammer content) and Serverside Weapons (server plugins) install
/// nowhere near `tf/custom` either.
const EXCLUDED_CATEGORIES: [&str; 5] = [
    "maps",
    "guis",
    "decal tool",
    "prefabs",
    "serverside weapons",
];

/// The installable root categories, cached for a day.
///
/// The endpoint refuses a request with no `_sSort`, so `a_to_z` is passed
/// explicitly rather than left to a default that does not exist.
pub fn categories() -> Result<Vec<GameBananaCategory>, String> {
    let url = format!("{API}/Mod/Categories?_idGameRow={TF2_GAME_ID}&_sSort=a_to_z");
    let raw: Vec<RawCategory> = fetch_json(&url, CATEGORY_TTL)?;
    Ok(raw
        .into_iter()
        .filter(|category| !is_excluded_category(&category.name))
        .map(|category| GameBananaCategory {
            id: category.id,
            name: category.name,
        })
        .collect())
}

pub fn is_excluded_category(name: &str) -> bool {
    let lower = name.trim().to_ascii_lowercase();
    EXCLUDED_CATEGORIES.contains(&lower.as_str())
}

/// Name and page URL, so an install can record what the user actually chose
/// rather than trusting a name passed across the bridge.
pub fn mod_profile(id: u64) -> Result<GameBananaProfile, String> {
    let url = format!("{API}/Mod/{id}/ProfilePage");
    let page: ProfilePage = net::get_json(&net::api_client()?, &url)
        .map_err(|err| format!("Could not read that GameBanana mod ({err})"))?;
    let id = if page.id == 0 { id } else { page.id };
    Ok(GameBananaProfile {
        name: if page.name.is_empty() {
            format!("GameBanana mod {id}")
        } else {
            page.name
        },
        url: if page.profile_url.is_empty() {
            format!("https://gamebanana.com/mods/{id}")
        } else {
            page.profile_url
        },
        id,
    })
}

// ---------------------------------------------------------------------------
// Downloads
// ---------------------------------------------------------------------------

#[derive(Debug, Deserialize)]
struct DownloadPage {
    #[serde(rename = "_aFiles", default)]
    files: Vec<DownloadFile>,
}

#[derive(Debug, Deserialize)]
pub struct DownloadFile {
    #[serde(rename = "_sFile", default)]
    pub file: String,
    #[serde(rename = "_sDownloadUrl", default)]
    pub download_url: String,
    #[serde(rename = "_tsDateAdded", default)]
    pub added: u64,
}

/// `https://gamebanana.com/mods/461758` → `461758`.
pub fn mod_id_from_url(url: &str) -> Option<u64> {
    let rest = url.trim().trim_end_matches('/').rsplit("/mods/").next()?;
    rest.split(['/', '?', '#']).next()?.parse().ok()
}

/// The newest file on a mod's download page that this app can unpack.
pub fn download_url(id: u64) -> Result<String, String> {
    let url = format!("{API}/Mod/{id}/DownloadPage");
    let page: DownloadPage = net::get_json(&net::api_client()?, &url)
        .map_err(|err| format!("Could not read the GameBanana listing ({err})"))?;
    pick_file(page.files)
}

/// Same, from a mod page URL (how hud-db spells a GameBanana entry).
pub fn download_url_for_page(page_url: &str) -> Result<String, String> {
    let id = mod_id_from_url(page_url).ok_or("That GameBanana link has no mod id.")?;
    download_url(id)
}

/// Prefer the newest archive this app can open — zip, 7z, or a bare VPK. A RAR
/// is only chosen when nothing else exists, and is refused with its own message
/// at extraction.
pub fn pick_file(mut files: Vec<DownloadFile>) -> Result<String, String> {
    files.retain(|file| !file.download_url.is_empty());
    files.sort_by_key(|file| std::cmp::Reverse(file.added));
    let unpackable = |name: &str| {
        let lower = name.to_ascii_lowercase();
        lower.ends_with(".zip") || lower.ends_with(".7z") || lower.ends_with(".vpk")
    };
    let chosen = files
        .iter()
        .find(|file| unpackable(&file.file))
        .or_else(|| files.first())
        .ok_or("That GameBanana page lists no files.")?;
    Ok(chosen.download_url.clone())
}

/// The chosen file's name, so the caller can tell a bare VPK from an archive.
pub fn download_file_name(url: &str) -> String {
    url.split(['?', '#'])
        .next()
        .unwrap_or(url)
        .rsplit('/')
        .next()
        .unwrap_or("")
        .to_string()
}

// ---------------------------------------------------------------------------
// Cache
// ---------------------------------------------------------------------------

struct CacheEntry {
    fetched: Instant,
    body: String,
}

fn cache() -> &'static Mutex<HashMap<String, CacheEntry>> {
    static CACHE: OnceLock<Mutex<HashMap<String, CacheEntry>>> = OnceLock::new();
    CACHE.get_or_init(|| Mutex::new(HashMap::new()))
}

/// A GET whose body is remembered by URL for `ttl`. Paging back to a page the
/// user just left, or re-opening the browser, then costs no request at all.
fn fetch_json<T: serde::de::DeserializeOwned>(url: &str, ttl: Duration) -> Result<T, String> {
    if let Some(body) = cached(url, ttl) {
        if let Ok(parsed) = serde_json::from_str(&body) {
            return Ok(parsed);
        }
    }
    let body = net::get_text(&net::api_client()?, url)
        .map_err(|err| format!("Could not read GameBanana ({err})"))?;
    let parsed = serde_json::from_str(&body)
        .map_err(|err| format!("GameBanana returned something unexpected ({err})"))?;
    if let Ok(mut map) = cache().lock() {
        // The map is keyed by URL and only ever holds list pages; a session that
        // browses for hours would otherwise grow it without bound.
        if map.len() > 128 {
            map.clear();
        }
        map.insert(
            url.to_string(),
            CacheEntry {
                fetched: Instant::now(),
                body,
            },
        );
    }
    Ok(parsed)
}

fn cached(url: &str, ttl: Duration) -> Option<String> {
    let map = cache().lock().ok()?;
    let entry = map.get(url)?;
    (entry.fetched.elapsed() < ttl).then(|| entry.body.clone())
}

/// Percent-encode a search string. Only the characters that would break the
/// query out of its parameter are escaped; everything else rides through.
fn encode_query(query: &str) -> String {
    let mut out = String::with_capacity(query.len());
    for byte in query.bytes() {
        match byte {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'~' => {
                out.push(byte as char)
            }
            b' ' => out.push_str("%20"),
            other => out.push_str(&format!("%{other:02X}")),
        }
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_frontends_sort_keys_map_to_aliases_the_api_accepts() {
        assert_eq!(index_sort("downloads").unwrap(), "Generic_MostDownloaded");
        assert_eq!(index_sort("likes").unwrap(), "Generic_MostLiked");
        assert_eq!(index_sort("views").unwrap(), "Generic_MostViewed");
        assert_eq!(index_sort("updated").unwrap(), "Generic_LatestModified");
        assert_eq!(index_sort("new").unwrap(), "Generic_Newest");
        assert!(index_sort("relevance").is_err());
    }

    #[test]
    fn a_search_page_keeps_only_mods_and_sorts_them_here() {
        let raw = r#"{
            "_aMetadata": { "_nRecordCount": 1000, "_nPerpage": 15, "_bIsComplete": false,
              "_aSectionMatchCounts": [{ "_sModelName": "Mod", "_nMatchCount": 42 }] },
            "_aRecords": [
              { "_idRow": 1, "_sModelName": "Mod", "_sName": "A", "_nLikeCount": 5,
                "_nViewCount": 10, "_tsDateAdded": 100, "_tsDateModified": 200,
                "_aSubmitter": { "_sName": "ann" },
                "_aRootCategory": { "_sName": "Skins", "_sProfileUrl": "https://gamebanana.com/mods/cats/7951" },
                "_aPreviewMedia": { "_aImages": [{ "_sBaseUrl": "https://images.gamebanana.com/img/ss/mods",
                  "_sFile": "a.jpg", "_sFile220": "220-90_a.jpg" }] } },
              { "_idRow": 2, "_sModelName": "Thread", "_sName": "help" },
              { "_idRow": 3, "_sModelName": "Mod", "_sName": "B", "_nLikeCount": 99,
                "_tsDateAdded": 1, "_tsDateModified": 2,
                "_aRootCategory": { "_sName": "Effects", "_sProfileUrl": "https://gamebanana.com/mods/cats/1090" } }
            ] }"#;
        let response: IndexResponse = serde_json::from_str(raw).unwrap();
        let page = page_from(response, None, "likes", true, true);
        assert_eq!(page.per_page, 15);
        assert_eq!(page.total, 42);
        assert!(!page.complete);
        assert_eq!(
            page.records.iter().map(|r| r.id).collect::<Vec<_>>(),
            vec![3, 1],
            "threads are dropped and the page is sorted by likes"
        );
        let first = page.records.iter().find(|r| r.id == 1).unwrap();
        assert_eq!(first.author, "ann");
        assert_eq!(first.category, "Skins");
        assert_eq!(first.category_id, 7951);
        assert_eq!(first.downloads, None);
        assert_eq!(first.updated_at, 200);
        assert_eq!(
            first.thumb.as_deref(),
            Some("https://images.gamebanana.com/img/ss/mods/220-90_a.jpg")
        );
        assert_eq!(first.url, "https://gamebanana.com/mods/1");
    }

    #[test]
    fn a_category_filter_narrows_a_search_page_that_the_api_cannot_filter() {
        let raw = r#"{ "_aMetadata": { "_nRecordCount": 2 }, "_aRecords": [
            { "_idRow": 1, "_sModelName": "Mod", "_aRootCategory": { "_sName": "Skins", "_sProfileUrl": "https://gamebanana.com/mods/cats/7951" } },
            { "_idRow": 2, "_sModelName": "Mod", "_aRootCategory": { "_sName": "Effects", "_sProfileUrl": "https://gamebanana.com/mods/cats/1090" } }
        ] }"#;
        let response: IndexResponse = serde_json::from_str(raw).unwrap();
        let page = page_from(response, Some(1090), "likes", true, true);
        assert_eq!(
            page.records.iter().map(|r| r.id).collect::<Vec<_>>(),
            vec![2]
        );
    }

    #[test]
    fn only_installable_root_categories_are_offered() {
        assert!(is_excluded_category("Maps"));
        assert!(is_excluded_category("GUIs"));
        assert!(is_excluded_category("Decal Tool"));
        assert!(is_excluded_category("Prefabs"));
        assert!(is_excluded_category("Serverside Weapons"));
        assert!(!is_excluded_category("Skins"));
        assert!(!is_excluded_category("Effects"));
        assert!(!is_excluded_category("Sounds"));
    }

    #[test]
    fn the_newest_unpackable_file_wins_and_a_vpk_counts() {
        assert_eq!(
            mod_id_from_url("https://gamebanana.com/mods/461758"),
            Some(461758)
        );
        assert_eq!(
            mod_id_from_url("https://gamebanana.com/mods/461758/"),
            Some(461758)
        );
        assert_eq!(mod_id_from_url("https://gamebanana.com/guis/25711"), None);

        let files = vec![
            DownloadFile {
                file: "old.rar".into(),
                download_url: "https://gamebanana.com/dl/1".into(),
                added: 10,
            },
            DownloadFile {
                file: "newest.rar".into(),
                download_url: "https://gamebanana.com/dl/3".into(),
                added: 30,
            },
            DownloadFile {
                file: "middle.vpk".into(),
                download_url: "https://gamebanana.com/dl/2".into(),
                added: 20,
            },
        ];
        assert_eq!(pick_file(files).unwrap(), "https://gamebanana.com/dl/2");

        let only_rar = vec![DownloadFile {
            file: "x.rar".into(),
            download_url: "https://gamebanana.com/dl/9".into(),
            added: 1,
        }];
        assert_eq!(pick_file(only_rar).unwrap(), "https://gamebanana.com/dl/9");
        assert!(pick_file(Vec::new()).is_err());

        assert_eq!(
            download_file_name("https://gamebanana.com/dl/1234?x=1"),
            "1234"
        );
        assert_eq!(
            download_file_name("https://files.example/Cool.vpk"),
            "Cool.vpk"
        );
    }

    #[test]
    fn a_search_string_cannot_break_out_of_its_query_parameter() {
        assert_eq!(encode_query("blue scout"), "blue%20scout");
        assert_eq!(encode_query("a&_sSort=x#f"), "a%26_sSort%3Dx%23f");
    }

    /// Hits the live API. Ignored so CI stays offline:
    /// `cargo test -p execs -- --ignored gamebanana`.
    #[test]
    #[ignore]
    fn smoke_the_live_api() {
        let page = search_mods("", "downloads", None, 1, false).unwrap();
        assert!(!page.records.is_empty());
        for record in page.records.iter().take(3) {
            println!(
                "#{} {:?} by {:?} [{} / {}] likes={} views={} downloads={:?} thumb={:?} url={}",
                record.id,
                record.name,
                record.author,
                record.category,
                record.category_id,
                record.likes,
                record.views,
                record.downloads,
                record.thumb,
                record.url
            );
        }
        println!(
            "total={} perPage={} complete={}",
            page.total, page.per_page, page.complete
        );

        let categories = categories().unwrap();
        println!("categories: {categories:?}");
        assert!(categories.iter().any(|category| category.name == "Skins"));
        assert!(!categories.iter().any(|category| category.name == "Maps"));

        let found = search_mods("scout", "likes", None, 1, false).unwrap();
        println!(
            "search perPage={} total={} first={:?}",
            found.per_page,
            found.total,
            found.records.first().map(|record| &record.name)
        );

        let profile = mod_profile(page.records[0].id).unwrap();
        println!("profile: {profile:?}");
    }
}
