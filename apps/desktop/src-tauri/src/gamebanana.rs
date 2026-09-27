//! GameBanana's public `apiv11`: browsing TF2 mods, and resolving one to a
//! downloadable archive.
//!
//! TF2's GameBanana game id is **297**. (440 is its Steam appid; this API does
//! not know it.) Everything here is read-only and unauthenticated — one request
//! per call, the app's own user agent, and a short in-memory cache so paging
//! back and forth does not hammer the site.

use std::collections::{BTreeSet, HashMap};
use std::sync::{Mutex, OnceLock};
use std::time::{Duration, Instant};

use serde::{Deserialize, Serialize};

use crate::net::{self, RemoteSource, MIB};

pub const TF2_GAME_ID: u64 = 297;

const API: &str = "https://gamebanana.com/apiv11";

/// What the list command asks for. Search is a `Generic_Name=contains,...`
/// filter on the same endpoint, so filtering, sorting, totals and pagination
/// all describe the complete result set rather than one locally filtered page.
const PAGE_SIZE: u32 = 20;

const LIST_TTL: Duration = Duration::from_secs(10 * 60);
const CATEGORY_TTL: Duration = Duration::from_secs(10 * 60);
const CACHE_MAX_ENTRIES: usize = 128;
const CACHE_MAX_BYTES: usize = 16 * MIB as usize;
const MAX_DOWNLOAD_VARIANTS: usize = 128;

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
    pub sub_category: Option<String>,
    pub route: GameBananaModRoute,
    /// GameBanana omits metrics from some listing modes. Missing source data is
    /// kept missing rather than being presented as a zero.
    pub likes: Option<u64>,
    pub views: Option<u64>,
    pub downloads: Option<u64>,
    pub added_at: Option<i64>,
    pub updated_at: Option<i64>,
    pub modified_at: Option<i64>,
    pub thumb: Option<String>,
    pub url: String,
    /// GameBanana's content-rating flag (nudity, gore, ...). Hidden unless the
    /// user asks for mature content.
    pub mature: bool,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum GameBananaModRoute {
    Mod,
    Hud,
    Manual,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum GameBananaTotal {
    Exact { value: u64 },
    Estimated { value: u64 },
    Capped { value: u64 },
    Unknown,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum GameBananaOrdering {
    Server,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum GameBananaFilterScope {
    Global,
    Page,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GameBananaFilterScopes {
    pub query: GameBananaFilterScope,
    pub category: GameBananaFilterScope,
    pub content_rating: GameBananaFilterScope,
    pub installability: GameBananaFilterScope,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum GameBananaCacheSource {
    Network,
    Memory,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GameBananaCacheInfo {
    pub source: GameBananaCacheSource,
    pub fresh_for_ms: u64,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GameBananaPage {
    pub records: Vec<GameBananaMod>,
    pub total: GameBananaTotal,
    pub per_page: u32,
    /// GameBanana's own "there is nothing after this page" flag.
    pub complete: bool,
    pub ordering: GameBananaOrdering,
    pub filters: GameBananaFilterScopes,
    pub cache: GameBananaCacheInfo,
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
    #[serde(rename = "_nRecordCount")]
    record_count: Option<u64>,
    #[serde(rename = "_nPerpage", default)]
    per_page: u32,
    #[serde(rename = "_bIsComplete", default)]
    complete: bool,
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
    #[serde(rename = "_tsDateAdded")]
    added: Option<i64>,
    #[serde(rename = "_tsDateModified")]
    modified: Option<i64>,
    #[serde(rename = "_tsDateUpdated")]
    updated: Option<i64>,
    #[serde(rename = "_nLikeCount")]
    likes: Option<u64>,
    #[serde(rename = "_nViewCount")]
    views: Option<u64>,
    #[serde(rename = "_nDownloadCount")]
    downloads: Option<u64>,
    #[serde(rename = "_aPreviewMedia", default)]
    preview: Option<PreviewMedia>,
    #[serde(rename = "_aSubmitter", default)]
    submitter: Option<NamedRow>,
    #[serde(rename = "_aRootCategory", default)]
    root_category: Option<CategoryRow>,
    #[serde(rename = "_aSubCategory", default)]
    sub_category: Option<CategoryRow>,
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
    #[serde(rename = "_aRootCategory", default)]
    root_category: Option<CategoryRow>,
    #[serde(rename = "_aGame", default)]
    game: Option<GameRow>,
}

#[derive(Debug, Deserialize)]
struct GameRow {
    #[serde(rename = "_idRow")]
    id: u64,
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

/// The frontend's five browse modes, mapped to aliases advertised by
/// `Mod/ListFilterConfig`. "Updated" is based on `_tsDateUpdated`, not the
/// unrelated site-maintenance timestamp in `_tsDateModified`.
fn index_sort(sort: &str) -> Result<&'static str, String> {
    Ok(match sort {
        "new" => "Generic_Newest",
        "updated" => "Generic_LatestUpdated",
        "downloads" => "Generic_MostDownloaded",
        "likes" => "Generic_MostLiked",
        "views" => "Generic_MostViewed",
        other => return Err(format!("Unknown sort: {other}")),
    })
}

/// One page of TF2 mods.
///
/// Browse and search both use `Mod/Index`. `Generic_Name=contains,...`, the
/// optional category and the unrated sentinel are server-side filters, so the
/// returned total and order describe the whole filtered result set. The
/// installability allow-list still has to be checked page by page when no one
/// installable category is selected because the API rejects a multi-category
/// filter.
pub fn search_mods(
    query: &str,
    sort: &str,
    category: Option<u64>,
    page: u32,
    include_mature: bool,
    refresh: bool,
) -> Result<GameBananaPage, String> {
    let url = search_url(query, sort, category, page, include_mature)?;
    let (response, cache): (IndexResponse, _) = fetch_json(&url, LIST_TTL, refresh)?;
    Ok(page_from(response, category, include_mature, cache))
}

fn search_url(
    query: &str,
    sort: &str,
    category: Option<u64>,
    page: u32,
    include_mature: bool,
) -> Result<String, String> {
    if page == 0 {
        return Err("GameBanana pages start at 1.".into());
    }
    let mut url = format!(
        "{API}/Mod/Index?_nPage={}&_nPerpage={PAGE_SIZE}&_aFilters[Generic_Game]={TF2_GAME_ID}&_sSort={}",
        page,
        index_sort(sort)?
    );
    let query = query.trim();
    if !query.is_empty() {
        if query.chars().count() > 128 {
            return Err("Search terms must be 128 characters or fewer.".into());
        }
        if query.contains(',') {
            return Err("Search terms cannot contain commas.".into());
        }
        url.push_str("&_aFilters[Generic_Name]=");
        url.push_str(&encode_query(&format!("contains,{query}")));
    }
    if let Some(category) = category {
        url.push_str(&format!("&_aFilters[Generic_Category]={category}"));
    }
    if !include_mature {
        url.push_str("&_aFilters[Generic_ContentRatings]=-");
    }
    Ok(url)
}

fn page_from(
    response: IndexResponse,
    category: Option<u64>,
    include_mature: bool,
    cache: GameBananaCacheInfo,
) -> GameBananaPage {
    // Repeat the server filters defensively, without changing the server's
    // authoritative order. Only submissions that are actually mods and safe
    // for this install surface reach the UI.
    let records = response
        .records
        .iter()
        .filter(|record| record.model.is_empty() || record.model == "Mod")
        .map(record_to_mod)
        .filter(|record| category.is_none_or_matches(record))
        .filter(|record| is_browsable_category(&record.category))
        .filter(|record| include_mature || !record.mature)
        .collect();
    let per_page = if response.metadata.per_page == 0 {
        PAGE_SIZE
    } else {
        response.metadata.per_page
    };
    GameBananaPage {
        records,
        total: match (response.metadata.record_count, category.is_some()) {
            (Some(value), true) => GameBananaTotal::Exact { value },
            (Some(value), false) => GameBananaTotal::Estimated { value },
            (None, _) => GameBananaTotal::Unknown,
        },
        per_page,
        complete: response.metadata.complete,
        ordering: GameBananaOrdering::Server,
        filters: GameBananaFilterScopes {
            query: GameBananaFilterScope::Global,
            category: if category.is_some() {
                GameBananaFilterScope::Global
            } else {
                GameBananaFilterScope::Page
            },
            content_rating: GameBananaFilterScope::Global,
            installability: if category.is_some() {
                GameBananaFilterScope::Global
            } else {
                GameBananaFilterScope::Page
            },
        },
        cache,
    }
}

/// The server applies a selected category globally. This repeated check stops a
/// malformed response from leaking a record from another category.
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

fn record_to_mod(record: &RawRecord) -> GameBananaMod {
    let category = record.root_category.as_ref();
    let sub_category = record.sub_category.as_ref();
    let category_id = category
        .and_then(|row| category_id_from_url(&row.profile_url))
        .unwrap_or(0);
    let is_gui =
        category_id == 1644 || category.is_some_and(|row| row.name.eq_ignore_ascii_case("GUIs"));
    GameBananaMod {
        id: record.id,
        name: record.name.clone(),
        author: record
            .submitter
            .as_ref()
            .map(|row| row.name.clone())
            .unwrap_or_default(),
        category: category.map(|row| row.name.clone()).unwrap_or_default(),
        category_id,
        sub_category: sub_category.map(|row| row.name.clone()),
        route: if is_gui {
            if sub_category.is_some_and(|row| {
                row.name.eq_ignore_ascii_case("HUDs")
                    || category_id_from_url(&row.profile_url) == Some(1649)
            }) {
                GameBananaModRoute::Hud
            } else {
                GameBananaModRoute::Manual
            }
        } else {
            GameBananaModRoute::Mod
        },
        likes: record.likes,
        views: record.views,
        downloads: record.downloads,
        added_at: valid_timestamp(record.added),
        updated_at: valid_timestamp(record.updated),
        modified_at: valid_timestamp(record.modified),
        thumb: record.preview.as_ref().and_then(thumb_url),
        url: validated_mod_page(&record.profile_url, record.id)
            .unwrap_or_else(|| format!("https://gamebanana.com/mods/{}", record.id)),
        mature: record.has_content_ratings,
    }
}

fn valid_timestamp(value: Option<i64>) -> Option<i64> {
    value.filter(|timestamp| *timestamp > 0)
}

/// `https://gamebanana.com/mods/cats/7951` → `7951`.
fn category_id_from_url(url: &str) -> Option<u64> {
    let parsed = reqwest::Url::parse(url.trim()).ok()?;
    if parsed.scheme() != "https"
        || !matches!(
            parsed.host_str(),
            Some("gamebanana.com" | "www.gamebanana.com")
        )
        || parsed.port().is_some()
        || !parsed.username().is_empty()
        || parsed.password().is_some()
    {
        return None;
    }
    let parts: Vec<_> = parsed
        .path_segments()?
        .filter(|part| !part.is_empty())
        .collect();
    match parts.as_slice() {
        ["mods", "cats", id] => id.parse().ok(),
        _ => None,
    }
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
    if file.contains(['\\', '\0']) {
        return None;
    }
    let url = reqwest::Url::parse(&format!(
        "{}/{}",
        image.base_url.trim_end_matches('/'),
        file.trim_start_matches('/')
    ))
    .ok()?;
    (url.scheme() == "https"
        && url.host_str() == Some("images.gamebanana.com")
        && url.port().is_none()
        && url.username().is_empty()
        && url.password().is_none())
    .then(|| url.to_string())
}

fn validated_mod_page(candidate: &str, expected_id: u64) -> Option<String> {
    let parsed = reqwest::Url::parse(candidate.trim()).ok()?;
    if parsed.scheme() != "https"
        || !matches!(
            parsed.host_str(),
            Some("gamebanana.com" | "www.gamebanana.com")
        )
        || parsed.port().is_some()
        || !parsed.username().is_empty()
        || parsed.password().is_some()
    {
        return None;
    }
    let mut segments = parsed.path_segments()?;
    if segments.next()? != "mods" || segments.next()?.parse::<u64>().ok()? != expected_id {
        return None;
    }
    if segments.any(|part| !part.is_empty()) {
        return None;
    }
    Some(parsed.to_string())
}

/// Browse can show GUI submissions, but those need a HUD or author-guided
/// import route rather than the generic Mods installer. These other roots do
/// not belong on the product's TF2 customization surfaces.
const EXCLUDED_CATEGORIES: [&str; 4] = ["maps", "decal tool", "prefabs", "serverside weapons"];

/// The installable root categories, cached for ten minutes.
///
/// The endpoint refuses a request with no `_sSort`, so `a_to_z` is passed
/// explicitly rather than left to a default that does not exist.
pub fn categories(refresh: bool) -> Result<Vec<GameBananaCategory>, String> {
    let url = format!("{API}/Mod/Categories?_idGameRow={TF2_GAME_ID}&_sSort=a_to_z");
    let (raw, _): (Vec<RawCategory>, _) = fetch_json(&url, CATEGORY_TTL, refresh)?;
    Ok(raw
        .into_iter()
        .filter(|category| is_browsable_category(&category.name))
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

fn is_browsable_category(name: &str) -> bool {
    !name.trim().is_empty() && !is_excluded_category(name)
}

fn is_mod_install_category(category: &CategoryRow) -> bool {
    is_browsable_category(&category.name)
        && !category.name.eq_ignore_ascii_case("GUIs")
        && category_id_from_url(&category.profile_url) != Some(1644)
}

/// Name and page URL, so an install can record what the user actually chose
/// rather than trusting a name passed across the bridge.
pub fn mod_profile(id: u64) -> Result<GameBananaProfile, String> {
    // ProfilePage exposes the immediate category (e.g. Training or HUDs),
    // not its root. Request the root explicitly so descendants cannot bypass
    // the same install policy applied to All and search results.
    let url =
        format!("{API}/Mod/{id}?_csvProperties=_idRow,_sName,_sProfileUrl,_aRootCategory,_aGame");
    let page: ProfilePage =
        net::get_json_for(&net::api_client()?, &url, RemoteSource::GameBananaApi)
            .map_err(|err| format!("Could not read that GameBanana mod ({err})"))?;
    profile_from(page, id)
}

fn profile_from(page: ProfilePage, id: u64) -> Result<GameBananaProfile, String> {
    if page.id != id {
        return Err("GameBanana returned a different mod than the one requested.".into());
    }
    if page.game.as_ref().map(|game| game.id) != Some(TF2_GAME_ID) {
        return Err("That GameBanana mod is not listed for Team Fortress 2.".into());
    }
    let category = page
        .root_category
        .as_ref()
        .ok_or("Could not verify that mod's GameBanana category. Try again later.")?;
    if !is_mod_install_category(category) {
        return Err(
            "That GameBanana category needs HUD or manual import; it cannot be installed from Mods."
                .into(),
        );
    }
    Ok(GameBananaProfile {
        name: if page.name.is_empty() {
            format!("GameBanana mod {id}")
        } else {
            page.name
        },
        url: validated_mod_page(&page.profile_url, id)
            .unwrap_or_else(|| format!("https://gamebanana.com/mods/{id}")),
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

#[derive(Debug, Clone, Deserialize)]
pub struct DownloadFile {
    #[serde(rename = "_idRow", default)]
    pub id: u64,
    #[serde(rename = "_sFile", default)]
    pub file: String,
    #[serde(rename = "_sDownloadUrl", default)]
    pub download_url: String,
    #[serde(rename = "_tsDateAdded", default)]
    pub added: u64,
    #[serde(rename = "_nFilesize")]
    pub size_bytes: Option<u64>,
    #[serde(rename = "_sDescription", default)]
    pub description: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GameBananaDownloadVariant {
    pub id: u64,
    pub file_name: String,
    pub description: String,
    pub size_bytes: Option<u64>,
    pub added_at: Option<u64>,
    pub supported: bool,
    /// One piece of a split upload. execs never guesses how to join parts.
    pub split_part: bool,
}

/// The file chosen off a mod's download page. `_sDownloadUrl` is an opaque
/// `https://gamebanana.com/dl/<id>` with no extension in it, so the name the
/// author uploaded rides alongside — it is the only way to tell a bare VPK
/// from an archive before the bytes arrive.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct DownloadPick {
    pub url: String,
    pub file_name: String,
}

/// The first four bytes of every VPK, v1 or v2: `0x55AA1234` little-endian.
const VPK_MAGIC: [u8; 4] = [0x34, 0x12, 0xAA, 0x55];

/// `https://gamebanana.com/mods/461758` → `461758`.
pub fn mod_id_from_url(url: &str) -> Option<u64> {
    let parsed = reqwest::Url::parse(url.trim()).ok()?;
    if parsed.scheme() != "https"
        || !matches!(
            parsed.host_str(),
            Some("gamebanana.com" | "www.gamebanana.com")
        )
        || parsed.port().is_some()
        || !parsed.username().is_empty()
        || parsed.password().is_some()
    {
        return None;
    }
    let mut segments = parsed.path_segments()?;
    if segments.next()? != "mods" {
        return None;
    }
    let id = segments.next()?.parse().ok()?;
    (!segments.any(|part| !part.is_empty())).then_some(id)
}

fn download_files(id: u64) -> Result<Vec<DownloadFile>, String> {
    let url = format!("{API}/Mod/{id}/DownloadPage");
    let page: DownloadPage =
        net::get_json_for(&net::api_client()?, &url, RemoteSource::GameBananaApi)
            .map_err(|err| format!("Could not read the GameBanana listing ({err})"))?;
    Ok(page.files)
}

/// Author names and descriptions are shown before choosing a file. The
/// download URL stays native-side and is rechecked when the selection is used.
pub fn download_variants(id: u64) -> Result<Vec<GameBananaDownloadVariant>, String> {
    variants_from_files(download_files(id)?)
}

fn variants_from_files(
    mut files: Vec<DownloadFile>,
) -> Result<Vec<GameBananaDownloadVariant>, String> {
    if files.len() > MAX_DOWNLOAD_VARIANTS {
        return Err(
            "That GameBanana listing has too many files. Review it on the author's page.".into(),
        );
    }
    let mut ids = BTreeSet::new();
    files.retain(|file| {
        validated_download_url(file).is_some()
            && !file.file.is_empty()
            && file.file.len() <= 256
            && !file.file.chars().any(char::is_control)
    });
    if files.iter().any(|file| !ids.insert(file.id)) {
        return Err("GameBanana returned duplicate download file identities.".into());
    }
    files.sort_by_key(|file| std::cmp::Reverse(file.added));
    if files.is_empty() {
        return Err("That GameBanana page lists no trusted files.".into());
    }
    Ok(files
        .into_iter()
        .map(|file| GameBananaDownloadVariant {
            id: file.id,
            file_name: file.file.clone(),
            description: file.description.trim().chars().take(1000).collect(),
            size_bytes: file.size_bytes,
            added_at: (file.added > 0).then_some(file.added),
            supported: mod_file_is_supported(&file) && !is_split_part(&file),
            split_part: is_split_part(&file),
        })
        .collect())
}

pub fn download_file(id: u64, file_id: u64) -> Result<DownloadPick, String> {
    pick_file_by_id(download_files(id)?, file_id)
}

/// hud-db's GameBanana entries have no file-choice UI. Only a single listed
/// ZIP or 7z is safe to choose automatically; any alternatives require the
/// author page and an explicit manual HUD import.
pub fn download_url_for_page(page_url: &str) -> Result<String, String> {
    let id = mod_id_from_url(page_url).ok_or("That GameBanana link has no mod id.")?;
    pick_hud_archive(download_files(id)?)
}

fn pick_file_by_id(files: Vec<DownloadFile>, file_id: u64) -> Result<DownloadPick, String> {
    // Recheck the page rather than accepting a stale or caller-supplied URL.
    variants_from_files(files.clone())?;
    let chosen = files
        .iter()
        .find(|file| file.id == file_id && validated_download_url(file).is_some())
        .ok_or("That GameBanana file is no longer listed. Choose a file again.")?;
    if is_split_part(chosen) {
        return Err(SPLIT_PART_REFUSAL.into());
    }
    if !mod_file_is_supported(chosen) {
        return Err(
            "That GameBanana file is not a supported VPK, ZIP, or 7z within the size limit.".into(),
        );
    }
    Ok(DownloadPick {
        url: validated_download_url(chosen).expect("validated above"),
        file_name: chosen.file.clone(),
    })
}

fn pick_hud_archive(files: Vec<DownloadFile>) -> Result<String, String> {
    variants_from_files(files.clone())?;
    if files.len() > 1 {
        return Err(
            "That HUD offers multiple files. Choose one on the author's page, then import it in HUD."
                .into(),
        );
    }
    let only = &files[0];
    if !is_archive_file(&only.file) || only.size_bytes.is_some_and(|size| size > MOD_MAX_BYTES) {
        return Err(
            "That HUD has no supported ZIP or 7z. Open the author's page and import a compatible HUD archive."
                .into(),
        );
    }
    Ok(validated_download_url(only).expect("validated above"))
}

fn validated_download_url(file: &DownloadFile) -> Option<String> {
    if file.id == 0 {
        return None;
    }
    let url = net::validate_url_for(&file.download_url, RemoteSource::GameBananaDownload).ok()?;
    (matches!(
        url.host_str(),
        Some("gamebanana.com" | "www.gamebanana.com")
    ) && url.path() == format!("/dl/{}", file.id)
        && url.query().is_none()
        && url.fragment().is_none())
    .then(|| url.to_string())
}

fn is_archive_file(name: &str) -> bool {
    let lower = name.to_ascii_lowercase();
    lower.ends_with(".zip") || lower.ends_with(".7z")
}

const SPLIT_PART_REFUSAL: &str = "That file is one part of a split download. execs can't combine parts; follow the author's instructions, then use Import mod.";

/// Authors split large uploads into parts: "PART 1" descriptions,
/// `mod_part_2.zip`, `mod.part2.rar`, `mod.7z.001` or `mod.z01`.
fn is_split_part(file: &DownloadFile) -> bool {
    let name = file.file.to_ascii_lowercase();
    let (stem, extension) = name.rsplit_once('.').unwrap_or((&name, ""));
    let numbered = |text: &str| !text.is_empty() && text.bytes().all(|b| b.is_ascii_digit());
    if (extension.len() == 3 && numbered(extension))
        || extension.strip_prefix('z').is_some_and(numbered)
    {
        return true;
    }
    let names_a_part = |text: &str| {
        let lower = text.to_ascii_lowercase();
        let words: Vec<&str> = lower
            .split(|c: char| !c.is_ascii_alphanumeric())
            .filter(|word| !word.is_empty())
            .collect();
        words.iter().enumerate().any(|(index, word)| {
            (*word == "part" && words.get(index + 1).is_some_and(|next| numbered(next)))
                || word
                    .strip_prefix("part")
                    .and_then(|rest| rest.split("of").next())
                    .is_some_and(numbered)
        })
    };
    names_a_part(stem) || names_a_part(&file.description)
}

/// Downloads the chosen file. GameBanana can keep listing a file whose storage
/// is gone, so a missing file gets its own message instead of a bare status.
pub fn download_pick(pick: &DownloadPick) -> Result<Vec<u8>, String> {
    net::download_bytes_or_status(&pick.url, MOD_MAX_BYTES)?
        .map_err(|status| download_failure(&pick.file_name, status))
}

fn download_failure(file_name: &str, status: reqwest::StatusCode) -> String {
    if matches!(status.as_u16(), 404 | 410) {
        format!(
            "GameBanana no longer has {file_name}. Choose another file, or check the author's page."
        )
    } else {
        format!("Could not download {file_name} from GameBanana ({status}).")
    }
}

fn mod_file_is_supported(file: &DownloadFile) -> bool {
    (is_archive_file(&file.file) || file.file.to_ascii_lowercase().ends_with(".vpk"))
        && file.size_bytes.is_none_or(|size| size <= MOD_MAX_BYTES)
}

/// Whether a downloaded file is a bare VPK rather than an archive: by the
/// uploaded name, or by the VPK signature when the name says nothing (an
/// upload renamed by its author, or a listing with the extension stripped).
pub fn is_bare_vpk(file_name: &str, bytes: &[u8]) -> bool {
    bytes.starts_with(&VPK_MAGIC) || file_name.to_ascii_lowercase().ends_with(".vpk")
}

// ---------------------------------------------------------------------------
// Cache
// ---------------------------------------------------------------------------

struct CacheEntry {
    fetched: Instant,
    body: String,
}

struct CachedBody {
    body: String,
    fresh_for_ms: u64,
}

fn cache() -> &'static Mutex<HashMap<String, CacheEntry>> {
    static CACHE: OnceLock<Mutex<HashMap<String, CacheEntry>>> = OnceLock::new();
    CACHE.get_or_init(|| Mutex::new(HashMap::new()))
}

/// A GET whose body is remembered by URL for `ttl`. Paging back to a page the
/// user just left, or re-opening the browser, then costs no request at all.
fn fetch_json<T: serde::de::DeserializeOwned>(
    url: &str,
    ttl: Duration,
    refresh: bool,
) -> Result<(T, GameBananaCacheInfo), String> {
    fetch_json_with(cache(), url, ttl, refresh, Instant::now(), || {
        net::get_text_for(&net::api_client()?, url, RemoteSource::GameBananaApi)
            .map_err(|err| format!("Could not read GameBanana ({err})"))
    })
}

fn fetch_json_with<T, F>(
    store: &Mutex<HashMap<String, CacheEntry>>,
    url: &str,
    ttl: Duration,
    refresh: bool,
    now: Instant,
    fetch: F,
) -> Result<(T, GameBananaCacheInfo), String>
where
    T: serde::de::DeserializeOwned,
    F: FnOnce() -> Result<String, String>,
{
    if !refresh {
        if let Some(hit) = cached_at(store, url, ttl, now) {
            if let Ok(parsed) = serde_json::from_str(&hit.body) {
                return Ok((
                    parsed,
                    GameBananaCacheInfo {
                        source: GameBananaCacheSource::Memory,
                        fresh_for_ms: hit.fresh_for_ms,
                    },
                ));
            }
        }
    }
    let body = fetch()?;
    let parsed = serde_json::from_str(&body)
        .map_err(|err| format!("GameBanana returned something unexpected ({err})"))?;
    if let Ok(mut map) = store.lock() {
        insert_cached_at(&mut map, url, body, now);
    }
    Ok((
        parsed,
        GameBananaCacheInfo {
            source: GameBananaCacheSource::Network,
            fresh_for_ms: duration_ms(ttl),
        },
    ))
}

fn cached_at(
    store: &Mutex<HashMap<String, CacheEntry>>,
    url: &str,
    ttl: Duration,
    now: Instant,
) -> Option<CachedBody> {
    let map = store.lock().ok()?;
    let entry = map.get(url)?;
    let elapsed = now
        .checked_duration_since(entry.fetched)
        .unwrap_or_default();
    let remaining = ttl.checked_sub(elapsed)?;
    (!remaining.is_zero()).then(|| CachedBody {
        body: entry.body.clone(),
        fresh_for_ms: duration_ms(remaining),
    })
}

fn insert_cached_at(map: &mut HashMap<String, CacheEntry>, url: &str, body: String, now: Instant) {
    // Two refreshes for the same identity can overlap. A response from the
    // older request may still be returned to its caller, but it must not
    // replace the cache entry published by a newer request.
    if map.get(url).is_some_and(|entry| entry.fetched > now) {
        return;
    }
    // Replacing the same URL must not evict an unrelated entry just because
    // the old body is still counted during the capacity check.
    map.remove(url);
    // Keep both entry count and owned string bytes bounded. Evicting the
    // oldest entry preserves recent back/forward navigation without a single
    // oversized page or a long session retaining arbitrary memory.
    while !map.is_empty()
        && (map.len() >= CACHE_MAX_ENTRIES
            || map.values().map(|entry| entry.body.len()).sum::<usize>() + body.len()
                > CACHE_MAX_BYTES)
    {
        if let Some(oldest) = map
            .iter()
            .min_by_key(|(_, entry)| entry.fetched)
            .map(|(key, _)| key.clone())
        {
            map.remove(&oldest);
        } else {
            break;
        }
    }
    if body.len() <= CACHE_MAX_BYTES {
        map.insert(url.to_string(), CacheEntry { fetched: now, body });
    }
}

fn duration_ms(duration: Duration) -> u64 {
    duration.as_millis().min(u64::MAX as u128) as u64
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

    fn network_cache_info() -> GameBananaCacheInfo {
        GameBananaCacheInfo {
            source: GameBananaCacheSource::Network,
            fresh_for_ms: duration_ms(LIST_TTL),
        }
    }

    #[test]
    fn the_frontends_sort_keys_map_to_aliases_the_api_accepts() {
        assert_eq!(index_sort("new").unwrap(), "Generic_Newest");
        assert_eq!(index_sort("updated").unwrap(), "Generic_LatestUpdated");
        assert_eq!(index_sort("downloads").unwrap(), "Generic_MostDownloaded");
        assert_eq!(index_sort("likes").unwrap(), "Generic_MostLiked");
        assert_eq!(index_sort("views").unwrap(), "Generic_MostViewed");
        assert!(index_sort("recent").is_err());
        assert!(index_sort("relevance").is_err());
    }

    #[test]
    fn index_urls_apply_search_and_supported_filters_globally() {
        let url = search_url(" blue scout ", "likes", Some(1090), 1, false).unwrap();
        assert!(url.starts_with("https://gamebanana.com/apiv11/Mod/Index?"));
        assert!(url.contains("_nPage=1&_nPerpage=20"));
        assert!(url.contains("_aFilters[Generic_Game]=297"));
        assert!(url.contains("_sSort=Generic_MostLiked"));
        assert!(url.contains("_aFilters[Generic_Name]=contains%2Cblue%20scout"));
        assert!(url.contains("_aFilters[Generic_Category]=1090"));
        assert!(url.contains("_aFilters[Generic_ContentRatings]=-"));

        let mature = search_url("", "new", None, 2, true).unwrap();
        assert!(mature.contains("_nPage=2"));
        assert!(!mature.contains("Generic_Name"));
        assert!(!mature.contains("Generic_Category"));
        assert!(!mature.contains("Generic_ContentRatings"));
        assert_eq!(encode_query("uber ü"), "uber%20%C3%BC");

        assert!(search_url("", "new", None, 0, false).is_err());
        assert!(search_url("comma,term", "new", None, 1, false).is_err());
        assert!(search_url(&"é".repeat(128), "new", None, 1, false).is_ok());
        assert!(search_url(&"é".repeat(129), "new", None, 1, false).is_err());
    }

    #[test]
    fn index_order_and_missing_source_fields_are_preserved() {
        let raw = r#"{
            "_aMetadata": { "_nRecordCount": 1000, "_nPerpage": 20, "_bIsComplete": false },
            "_aRecords": [
              { "_idRow": 1, "_sModelName": "Mod", "_sName": "A", "_nLikeCount": 5,
                "_nViewCount": 10, "_tsDateAdded": 100, "_tsDateModified": 200,
                "_aSubmitter": { "_sName": "ann" },
                "_aRootCategory": { "_sName": "Skins", "_sProfileUrl": "https://gamebanana.com/mods/cats/7951" },
                "_aPreviewMedia": { "_aImages": [{ "_sBaseUrl": "https://images.gamebanana.com/img/ss/mods",
                  "_sFile": "a.jpg", "_sFile220": "220-90_a.jpg" }] } },
              { "_idRow": 2, "_sModelName": "Thread", "_sName": "help" },
              { "_idRow": 3, "_sModelName": "Mod", "_sName": "B", "_nLikeCount": 99,
                "_tsDateAdded": 0, "_tsDateModified": 0, "_tsDateUpdated": 0,
                "_aRootCategory": { "_sName": "Effects", "_sProfileUrl": "https://gamebanana.com/mods/cats/1090" } }
            ] }"#;
        let response: IndexResponse = serde_json::from_str(raw).unwrap();
        let page = page_from(response, None, true, network_cache_info());
        assert_eq!(page.per_page, 20);
        assert_eq!(page.total, GameBananaTotal::Estimated { value: 1000 });
        assert!(!page.complete);
        assert_eq!(
            page.records.iter().map(|r| r.id).collect::<Vec<_>>(),
            vec![1, 3],
            "non-mods are dropped without disturbing GameBanana's order"
        );
        let first = page.records.iter().find(|r| r.id == 1).unwrap();
        assert_eq!(first.author, "ann");
        assert_eq!(first.category, "Skins");
        assert_eq!(first.category_id, 7951);
        assert_eq!(first.downloads, None);
        assert_eq!(first.likes, Some(5));
        assert_eq!(first.views, Some(10));
        assert_eq!(first.added_at, Some(100));
        assert_eq!(first.updated_at, None);
        assert_eq!(first.modified_at, Some(200));
        assert_eq!(
            first.thumb.as_deref(),
            Some("https://images.gamebanana.com/img/ss/mods/220-90_a.jpg")
        );
        assert_eq!(first.url, "https://gamebanana.com/mods/1");
        let second = page.records.iter().find(|r| r.id == 3).unwrap();
        assert_eq!(second.views, None);
        assert_eq!(second.downloads, None);
        assert_eq!(second.added_at, None);
        assert_eq!(second.updated_at, None);
        assert_eq!(second.modified_at, None);
        assert_eq!(page.ordering, GameBananaOrdering::Server);
        assert_eq!(page.filters.query, GameBananaFilterScope::Global);
        assert_eq!(page.filters.category, GameBananaFilterScope::Page);
        assert_eq!(page.filters.content_rating, GameBananaFilterScope::Global);
        assert_eq!(page.filters.installability, GameBananaFilterScope::Page);
    }

    #[test]
    fn a_selected_category_has_exact_total_and_global_filter_scopes() {
        let raw = r#"{ "_aMetadata": { "_nRecordCount": 2 }, "_aRecords": [
            { "_idRow": 1, "_sModelName": "Mod", "_aRootCategory": { "_sName": "Skins", "_sProfileUrl": "https://gamebanana.com/mods/cats/7951" } },
            { "_idRow": 2, "_sModelName": "Mod", "_aRootCategory": { "_sName": "Effects", "_sProfileUrl": "https://gamebanana.com/mods/cats/1090" } }
        ] }"#;
        let response: IndexResponse = serde_json::from_str(raw).unwrap();
        let page = page_from(response, Some(1090), true, network_cache_info());
        assert_eq!(
            page.records.iter().map(|r| r.id).collect::<Vec<_>>(),
            vec![2]
        );
        assert_eq!(page.total, GameBananaTotal::Exact { value: 2 });
        assert_eq!(page.filters.category, GameBananaFilterScope::Global);
        assert_eq!(page.filters.installability, GameBananaFilterScope::Global);
    }

    #[test]
    fn totals_have_explicit_semantics_and_missing_counts_stay_unknown() {
        let response: IndexResponse = serde_json::from_str(r#"{"_aRecords": []}"#).unwrap();
        let page = page_from(response, Some(1090), false, network_cache_info());
        assert_eq!(page.total, GameBananaTotal::Unknown);
        assert_eq!(page.per_page, PAGE_SIZE);

        assert_eq!(
            serde_json::to_value(GameBananaTotal::Exact { value: 7 }).unwrap(),
            serde_json::json!({ "kind": "exact", "value": 7 })
        );
        assert_eq!(
            serde_json::to_value(GameBananaTotal::Estimated { value: 8 }).unwrap(),
            serde_json::json!({ "kind": "estimated", "value": 8 })
        );
        assert_eq!(
            serde_json::to_value(GameBananaTotal::Capped { value: 1000 }).unwrap(),
            serde_json::json!({ "kind": "capped", "value": 1000 })
        );
        assert_eq!(
            serde_json::to_value(GameBananaTotal::Unknown).unwrap(),
            serde_json::json!({ "kind": "unknown" })
        );
    }

    #[test]
    fn browse_includes_guis_but_direct_mod_install_does_not() {
        assert!(is_excluded_category("Maps"));
        assert!(!is_excluded_category("GUIs"));
        assert!(is_browsable_category("GUIs"));
        assert!(!is_mod_install_category(&CategoryRow {
            name: "GUIs".into(),
            profile_url: "https://gamebanana.com/mods/cats/1644".into(),
        }));
        assert!(is_excluded_category("Decal Tool"));
        assert!(is_excluded_category("Prefabs"));
        assert!(is_excluded_category("Serverside Weapons"));
        assert!(!is_excluded_category("Skins"));
        assert!(!is_excluded_category("Effects"));
        assert!(!is_excluded_category("Sounds"));
    }

    #[test]
    fn all_results_hide_excluded_roots_without_shortening_pagination() {
        let mut records = Vec::new();
        for (i, root) in [
            "Maps",
            "GUIs",
            "Decal Tool",
            "Prefabs",
            "Serverside Weapons",
            "Skins",
            "Effects",
            "",
        ]
        .iter()
        .enumerate()
        {
            records.push(serde_json::json!({
                "_idRow": i + 1,
                "_sModelName": "Mod",
                "_aRootCategory": { "_sName": root },
                "_aCategory": { "_sName": "Child category" },
                "_bHasContentRatings": i == 6
            }));
        }
        let response = serde_json::json!({
            "_aMetadata": { "_nRecordCount": 100, "_nPerpage": 20, "_bIsComplete": false },
            "_aRecords": records
        });
        for mature in [false, true] {
            let page = page_from(
                serde_json::from_value(response.clone()).unwrap(),
                None,
                mature,
                network_cache_info(),
            );
            assert_eq!(
                page.records.iter().map(|r| r.id).collect::<Vec<_>>(),
                if mature { vec![2, 6, 7] } else { vec![2, 6] }
            );
            assert_eq!(page.total, GameBananaTotal::Estimated { value: 100 });
            assert_eq!(page.per_page, 20);
            assert!(
                !page.complete,
                "filtered rows do not mean the next API page is empty"
            );
        }
    }

    #[test]
    fn gui_huds_are_discovered_without_offering_a_mod_install() {
        let response: IndexResponse = serde_json::from_value(serde_json::json!({
            "_aRecords": [
                { "_idRow": 1, "_sModelName": "Mod", "_sName": "A HUD",
                  "_aRootCategory": { "_sName": "GUIs", "_sProfileUrl": "https://gamebanana.com/mods/cats/1644" },
                  "_aSubCategory": { "_sName": "HUDs", "_sProfileUrl": "https://gamebanana.com/mods/cats/1649" } },
                { "_idRow": 2, "_sModelName": "Mod", "_sName": "A menu",
                  "_aRootCategory": { "_sName": "GUIs", "_sProfileUrl": "https://gamebanana.com/mods/cats/1644" },
                  "_aSubCategory": { "_sName": "Menus" } }
            ]
        }))
        .unwrap();
        let page = page_from(response, Some(1644), false, network_cache_info());
        assert_eq!(page.records.len(), 2);
        assert_eq!(page.records[0].route, GameBananaModRoute::Hud);
        assert_eq!(page.records[0].sub_category.as_deref(), Some("HUDs"));
        assert_eq!(page.records[1].route, GameBananaModRoute::Manual);
        assert_eq!(page.records[1].sub_category.as_deref(), Some("Menus"));
    }

    #[test]
    fn direct_installs_validate_the_root_category_and_game() {
        let valid = serde_json::json!({
            "_idRow": 7, "_sName": "A skin", "_aGame": { "_idRow": 297 },
            "_aCategory": { "_sName": "Child category" },
            "_aRootCategory": { "_sName": "Skins" }
        });
        let profile = profile_from(serde_json::from_value(valid.clone()).unwrap(), 7).unwrap();
        assert_eq!(profile.name, "A skin");
        assert_eq!(profile.url, "https://gamebanana.com/mods/7");
        for name in EXCLUDED_CATEGORIES.into_iter().chain(["", "GUIs"]) {
            let mut page = valid.clone();
            page["_aRootCategory"]["_sName"] = name.into();
            assert!(
                profile_from(serde_json::from_value(page).unwrap(), 7).is_err(),
                "{name}"
            );
        }
        let mut renamed_gui = valid.clone();
        renamed_gui["_aRootCategory"] = serde_json::json!({
            "_sName": "Interface",
            "_sProfileUrl": "https://gamebanana.com/mods/cats/1644"
        });
        assert!(profile_from(serde_json::from_value(renamed_gui).unwrap(), 7).is_err());
        for field in ["_aRootCategory", "_aGame"] {
            let mut page = valid.clone();
            page.as_object_mut().unwrap().remove(field);
            assert!(profile_from(serde_json::from_value(page).unwrap(), 7).is_err());
        }
        let mut other_game = valid.clone();
        other_game["_aGame"]["_idRow"] = 1.into();
        assert!(profile_from(serde_json::from_value(other_game).unwrap(), 7).is_err());
        assert!(profile_from(serde_json::from_value(valid).unwrap(), 8).is_err());
    }

    #[test]
    fn file_choices_keep_author_descriptions_and_bind_selected_ids() {
        assert_eq!(
            mod_id_from_url("https://gamebanana.com/mods/461758"),
            Some(461758)
        );
        assert_eq!(
            mod_id_from_url("https://gamebanana.com/mods/461758/"),
            Some(461758)
        );
        assert_eq!(mod_id_from_url("https://gamebanana.com/guis/25711"), None);
        assert_eq!(mod_id_from_url("http://gamebanana.com/mods/461758"), None);
        assert_eq!(
            mod_id_from_url("https://gamebanana.com.evil.test/mods/461758"),
            None
        );

        let files: Vec<DownloadFile> = serde_json::from_value(serde_json::json!([
            { "_idRow": 1, "_sFile": "old.rar", "_sDownloadUrl": "https://gamebanana.com/dl/1", "_tsDateAdded": 10 },
            { "_idRow": 3, "_sFile": "new.zip", "_sDownloadUrl": "https://gamebanana.com/dl/3", "_tsDateAdded": 30,
              "_sDescription": "Class select remake", "_nFilesize": 1234 },
            { "_idRow": 2, "_sFile": "middle.vpk", "_sDownloadUrl": "https://gamebanana.com/dl/2", "_tsDateAdded": 20 }
        ]))
        .unwrap();
        let variants = variants_from_files(files.clone()).unwrap();
        assert_eq!(
            variants.iter().map(|file| file.id).collect::<Vec<_>>(),
            vec![3, 2, 1]
        );
        assert_eq!(variants[0].description, "Class select remake");
        assert_eq!(variants[0].size_bytes, Some(1234));
        assert!(variants[0].supported);
        assert!(variants[1].supported);
        assert!(!variants[2].supported);
        assert_eq!(
            pick_file_by_id(files.clone(), 2).unwrap(),
            DownloadPick {
                url: "https://gamebanana.com/dl/2".into(),
                file_name: "middle.vpk".into(),
            }
        );
        assert!(pick_file_by_id(files.clone(), 1).is_err());
        assert!(pick_file_by_id(files, 999).is_err());

        let hostile: Vec<DownloadFile> = serde_json::from_value(serde_json::json!([
            { "_idRow": 4, "_sFile": "looks-safe.zip", "_sDownloadUrl": "https://127.0.0.1/private.zip" },
            { "_idRow": 5, "_sFile": "mismatch.zip", "_sDownloadUrl": "https://gamebanana.com/dl/6" }
        ]))
        .unwrap();
        assert!(variants_from_files(hostile).is_err());
    }

    #[test]
    fn split_uploads_are_shown_but_never_installed_as_one_part() {
        let files: Vec<DownloadFile> = serde_json::from_value(serde_json::json!([
            // Mod 37013's listing: two parts plus an optional addon.
            { "_idRow": 1559476, "_sFile": "bot_overhaul_-_part_1.zip", "_sDescription": "PART 1",
              "_sDownloadUrl": "https://gamebanana.com/dl/1559476", "_tsDateAdded": 30 },
            { "_idRow": 1558931, "_sFile": "bot_overhaul_-_part_2_03ece.zip", "_sDescription": "PART 2",
              "_sDownloadUrl": "https://gamebanana.com/dl/1558931", "_tsDateAdded": 20 },
            { "_idRow": 597824, "_sFile": "bot_mod_workshop_navs_.7z",
              "_sDescription": "Community Map Navigation Meshes",
              "_sDownloadUrl": "https://gamebanana.com/dl/597824", "_tsDateAdded": 10 }
        ]))
        .unwrap();
        let variants = variants_from_files(files.clone()).unwrap();
        assert!(variants[0].split_part && !variants[0].supported);
        assert!(variants[1].split_part && !variants[1].supported);
        assert!(!variants[2].split_part && variants[2].supported);
        assert!(pick_file_by_id(files.clone(), 1559476)
            .unwrap_err()
            .contains("split download"));
        assert!(pick_file_by_id(files, 597824).is_ok());

        let named = |file: &str, description: &str| {
            is_split_part(&DownloadFile {
                id: 1,
                file: file.into(),
                download_url: String::new(),
                added: 0,
                size_bytes: None,
                description: description.into(),
            })
        };
        assert!(named("skin.part2.rar", ""));
        assert!(named("skin.7z.001", ""));
        assert!(named("skin.z01", ""));
        assert!(named("skin.zip", "Part 1 of 2"));
        assert!(named("skin_part1of3.zip", ""));
        // Ordinary names and prose stay installable.
        assert!(!named("skin.7z", ""));
        assert!(!named("counterpart.zip", "Part of the Scout pack"));
        assert!(!named("engy.zip", "V.4b"));
        assert!(!named("hud-v2.zip", "Version 2"));
    }

    #[test]
    fn a_listed_file_that_is_gone_gets_its_own_message() {
        let gone = download_failure("mod.zip", reqwest::StatusCode::NOT_FOUND);
        assert!(gone.contains("no longer has mod.zip"));
        assert_eq!(download_failure("mod.zip", reqwest::StatusCode::GONE), gone);
        assert!(
            download_failure("mod.zip", reqwest::StatusCode::SERVICE_UNAVAILABLE).contains("503")
        );
    }

    #[test]
    fn hud_downloads_require_one_compatible_archive() {
        let files: Vec<DownloadFile> = serde_json::from_value(serde_json::json!([
            { "_idRow": 1, "_sFile": "hud.vpk", "_sDownloadUrl": "https://gamebanana.com/dl/1" },
            { "_idRow": 2, "_sFile": "hud.zip", "_sDownloadUrl": "https://gamebanana.com/dl/2" }
        ]))
        .unwrap();
        assert!(pick_hud_archive(files.clone())
            .unwrap_err()
            .contains("multiple files"));
        assert_eq!(
            pick_hud_archive(files.iter().skip(1).cloned().collect()).unwrap(),
            "https://gamebanana.com/dl/2"
        );
        let another: DownloadFile = serde_json::from_value(serde_json::json!({
            "_idRow": 3, "_sFile": "hud-alt.7z", "_sDownloadUrl": "https://gamebanana.com/dl/3",
            "_sDescription": "Alternative layout"
        }))
        .unwrap();
        assert!(pick_hud_archive([files.clone(), vec![another]].concat())
            .unwrap_err()
            .contains("multiple files"));
        assert!(pick_hud_archive(files.into_iter().take(1).collect())
            .unwrap_err()
            .contains("no supported ZIP or 7z"));
    }

    #[test]
    fn untrusted_profile_and_thumbnail_metadata_is_not_exposed_to_the_ui() {
        assert!(validated_mod_page("https://gamebanana.com/mods/7", 7).is_some());
        assert!(validated_mod_page("https://gamebanana.com.evil.test/mods/7", 7).is_none());
        assert!(validated_mod_page("http://gamebanana.com/mods/7", 7).is_none());
        assert!(validated_mod_page("https://gamebanana.com/mods/8", 7).is_none());
        assert_eq!(
            category_id_from_url("https://gamebanana.com/mods/cats/7951"),
            Some(7951)
        );
        assert_eq!(
            category_id_from_url("https://gamebanana.com.evil.test/mods/cats/7951"),
            None
        );

        let hostile = PreviewMedia {
            images: vec![PreviewImage {
                base_url: "https://evil.test/images".into(),
                file: "x.jpg".into(),
                file220: None,
                file100: None,
            }],
        };
        assert_eq!(thumb_url(&hostile), None);
    }

    #[test]
    fn a_bare_vpk_is_told_apart_by_name_or_by_signature() {
        let vpk = [0x34, 0x12, 0xAA, 0x55, 2, 0, 0, 0];
        let zip = b"PK\x03\x04rest";
        assert!(is_bare_vpk("Cool.VPK", zip), "the name alone is enough");
        assert!(is_bare_vpk("1234", &vpk), "the signature alone is enough");
        assert!(is_bare_vpk("", &vpk));
        assert!(!is_bare_vpk("1234", zip));
        assert!(!is_bare_vpk("mod.zip", b"PK"));
        assert!(
            !is_bare_vpk("x", &[0x34, 0x12]),
            "a short body is not a VPK"
        );
    }

    #[test]
    fn a_search_string_cannot_break_out_of_its_query_parameter() {
        assert_eq!(encode_query("blue scout"), "blue%20scout");
        assert_eq!(encode_query("a&_sSort=x#f"), "a%26_sSort%3Dx%23f");
    }

    #[test]
    fn cache_reports_remaining_freshness_and_refresh_bypasses_it() {
        let store = Mutex::new(HashMap::new());
        let now = Instant::now();
        let ttl = Duration::from_secs(10);
        let (first, first_cache) =
            fetch_json_with::<serde_json::Value, _>(&store, "test://page", ttl, false, now, || {
                Ok(r#"{"value":1}"#.into())
            })
            .unwrap();
        assert_eq!(first["value"], 1);
        assert_eq!(first_cache.source, GameBananaCacheSource::Network);
        assert_eq!(first_cache.fresh_for_ms, 10_000);

        let (cached, cached_info) = fetch_json_with::<serde_json::Value, _>(
            &store,
            "test://page",
            ttl,
            false,
            now + Duration::from_millis(2_500),
            || panic!("a fresh cache hit must not fetch"),
        )
        .unwrap();
        assert_eq!(cached["value"], 1);
        assert_eq!(cached_info.source, GameBananaCacheSource::Memory);
        assert_eq!(cached_info.fresh_for_ms, 7_500);

        let (refreshed, refreshed_info) = fetch_json_with::<serde_json::Value, _>(
            &store,
            "test://page",
            ttl,
            true,
            now + Duration::from_secs(3),
            || Ok(r#"{"value":2}"#.into()),
        )
        .unwrap();
        assert_eq!(refreshed["value"], 2);
        assert_eq!(refreshed_info.source, GameBananaCacheSource::Network);

        let (replacement, replacement_info) = fetch_json_with::<serde_json::Value, _>(
            &store,
            "test://page",
            ttl,
            false,
            now + Duration::from_secs(4),
            || panic!("the refreshed response should replace the old entry"),
        )
        .unwrap();
        assert_eq!(replacement["value"], 2);
        assert_eq!(replacement_info.fresh_for_ms, 9_000);
    }

    #[test]
    fn cache_expiry_and_failed_refresh_do_not_publish_bad_data() {
        let store = Mutex::new(HashMap::new());
        let now = Instant::now();
        let ttl = Duration::from_secs(1);
        fetch_json_with::<serde_json::Value, _>(&store, "test://page", ttl, false, now, || {
            Ok(r#"{"value":"old"}"#.into())
        })
        .unwrap();

        let failed = fetch_json_with::<serde_json::Value, _>(
            &store,
            "test://page",
            ttl,
            true,
            now + Duration::from_millis(100),
            || Ok("not json".into()),
        );
        assert!(failed.is_err());
        let (still_old, _) = fetch_json_with::<serde_json::Value, _>(
            &store,
            "test://page",
            ttl,
            false,
            now + Duration::from_millis(200),
            || panic!("a failed refresh must leave the old entry intact"),
        )
        .unwrap();
        assert_eq!(still_old["value"], "old");

        let (after_expiry, info) = fetch_json_with::<serde_json::Value, _>(
            &store,
            "test://page",
            ttl,
            false,
            now + Duration::from_secs(1),
            || Ok(r#"{"value":"new"}"#.into()),
        )
        .unwrap();
        assert_eq!(after_expiry["value"], "new");
        assert_eq!(info.source, GameBananaCacheSource::Network);
    }

    #[test]
    fn cache_entry_bound_evicts_the_oldest_response() {
        let mut map = HashMap::new();
        let now = Instant::now();
        for index in 0..=CACHE_MAX_ENTRIES {
            insert_cached_at(
                &mut map,
                &format!("test://{index}"),
                "null".into(),
                now + Duration::from_nanos(index as u64),
            );
        }
        assert_eq!(map.len(), CACHE_MAX_ENTRIES);
        assert!(!map.contains_key("test://0"));
        assert!(map.contains_key(&format!("test://{CACHE_MAX_ENTRIES}")));
    }

    #[test]
    fn an_older_overlapping_response_cannot_poison_the_cache() {
        let mut map = HashMap::new();
        let started = Instant::now();
        insert_cached_at(
            &mut map,
            "test://same-request",
            r#"{"value":"newer"}"#.into(),
            started + Duration::from_secs(1),
        );
        insert_cached_at(
            &mut map,
            "test://same-request",
            r#"{"value":"older"}"#.into(),
            started,
        );
        assert_eq!(
            map.get("test://same-request").unwrap().body,
            r#"{"value":"newer"}"#
        );
    }

    /// Hits the live API. Ignored so CI stays offline:
    /// `cargo test -p execs -- --ignored gamebanana`.
    #[test]
    #[ignore]
    fn smoke_the_live_api() {
        let mut pages = Vec::new();
        for sort in ["new", "updated", "downloads", "likes", "views"] {
            let page = search_mods("", sort, None, 1, false, true).unwrap();
            assert!(!page.records.is_empty(), "{sort}");
            assert_eq!(page.ordering, GameBananaOrdering::Server);
            pages.push(page);
        }
        let page = &pages[0];
        assert!(!page.records.is_empty());
        assert!(page
            .records
            .iter()
            .all(|r| is_browsable_category(&r.category)));
        for record in page.records.iter().take(3) {
            println!(
                "#{} {:?} by {:?} [{} / {}] likes={:?} views={:?} downloads={:?} thumb={:?} url={}",
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
            "total={:?} perPage={} complete={}",
            page.total, page.per_page, page.complete
        );

        let categories = categories(true).unwrap();
        println!("categories: {categories:?}");
        assert!(categories.iter().any(|category| category.name == "Skins"));
        assert!(!categories.iter().any(|category| category.name == "Maps"));

        let found = search_mods("scout", "likes", None, 1, false, true).unwrap();
        println!(
            "search perPage={} total={:?} first={:?}",
            found.per_page,
            found.total,
            found.records.first().map(|record| &record.name)
        );

        let mod_record = page
            .records
            .iter()
            .find(|record| record.route == GameBananaModRoute::Mod)
            .unwrap();
        let profile = mod_profile(mod_record.id).unwrap();
        println!("profile: {profile:?}");
        // A Training map and HUD cannot enter the generic Mods installer.
        assert!(mod_profile(74812).unwrap_err().contains("category"));
        assert!(mod_profile(26852).unwrap_err().contains("category"));
    }
}
