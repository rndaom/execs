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

/// The GameBanana sections Browse reads. Each numbers its submissions on its
/// own, so Sound 21865 and Mod 21865 are unrelated: every id travels with the
/// section it belongs to.
#[derive(
    Debug, Clone, Copy, Default, PartialEq, Eq, PartialOrd, Ord, Hash, Serialize, Deserialize,
)]
#[serde(rename_all = "camelCase")]
pub enum GameBananaSection {
    #[default]
    Mod,
    Sound,
}

impl GameBananaSection {
    /// The API model name (`Mod/Index`, `Sound/Index`).
    fn model(self) -> &'static str {
        match self {
            Self::Mod => "Mod",
            Self::Sound => "Sound",
        }
    }

    /// The site path segment (`/mods/7`, `/sounds/cats/381`).
    fn path(self) -> &'static str {
        match self {
            Self::Mod => "mods",
            Self::Sound => "sounds",
        }
    }

    /// `"mod"` or `"sound"` from the bridge; anything else is refused.
    pub fn parse(value: Option<&str>) -> Result<Self, String> {
        match value {
            None | Some("mod") => Ok(Self::Mod),
            Some("sound") => Ok(Self::Sound),
            Some(other) => Err(format!("Unknown GameBanana section: {other}")),
        }
    }

    /// The section a saved record's page URL names. Records written before
    /// sounds existed always name `/mods/`.
    pub fn of_page_url(url: &str) -> Self {
        match reqwest::Url::parse(url.trim()) {
            Ok(parsed) if parsed.path().starts_with("/sounds/") => Self::Sound,
            _ => Self::Mod,
        }
    }

    pub fn page_url(self, id: u64) -> String {
        format!("https://gamebanana.com/{}/{id}", self.path())
    }
}

/// Sound categories whose uploads are TF2's hit or kill sound. They belong to
/// the Sounds pane, which owns `sound/ui/hitsound.wav` and `killsound.wav`.
const HITSOUND_CATEGORY: u64 = 381;
const KILLSOUND_CATEGORY: u64 = 2630;

/// One mod as the browse UI needs it.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GameBananaMod {
    pub id: u64,
    pub section: GameBananaSection,
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
    /// A hit or kill sound upload: chosen in the Sounds pane, never installed
    /// as a custom pack.
    HitSound,
    KillSound,
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
    /// The immediate category, which tells a HUD apart from other GUI mods.
    #[serde(rename = "_aCategory", default)]
    category: Option<CategoryRow>,
    #[serde(rename = "_aGame", default)]
    game: Option<GameRow>,
    #[serde(rename = "_tsDateUpdated", default)]
    updated: Option<i64>,
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
    pub updated_at: Option<i64>,
    /// `Mod`, or the Sounds slot a hit or kill sound upload is made for.
    pub route: GameBananaModRoute,
}

impl GameBananaProfile {
    /// Mods installs refuse hit and kill sounds: those files belong to the
    /// Sounds pane, which owns TF2's two canonical sound paths.
    pub fn require_pack(&self) -> Result<(), String> {
        match self.route {
            GameBananaModRoute::HitSound | GameBananaModRoute::KillSound => Err(
                "That GameBanana upload is a hit or kill sound. Use it in Sounds instead.".into(),
            ),
            GameBananaModRoute::Mod | GameBananaModRoute::Hud => Ok(()),
        }
    }
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

/// One page of TF2 mods or sounds.
///
/// Browse and search both use `<Section>/Index`. `Generic_Name=contains,...`, the
/// optional category and the unrated sentinel are server-side filters, so the
/// returned total and order describe the whole filtered result set. The
/// installability allow-list still has to be checked page by page when no one
/// installable category is selected because the API rejects a multi-category
/// filter.
pub fn search_mods(
    section: GameBananaSection,
    query: &str,
    sort: &str,
    category: Option<u64>,
    page: u32,
    include_mature: bool,
    refresh: bool,
) -> Result<GameBananaPage, String> {
    let url = search_url(section, query, sort, category, page, include_mature)?;
    let (response, cache): (IndexResponse, _) = fetch_json(&url, LIST_TTL, refresh)?;
    Ok(page_from(
        section,
        response,
        category,
        include_mature,
        cache,
    ))
}

fn search_url(
    section: GameBananaSection,
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
        "{API}/{}/Index?_nPage={}&_nPerpage={PAGE_SIZE}&_aFilters[Generic_Game]={TF2_GAME_ID}&_sSort={}",
        section.model(),
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
    section: GameBananaSection,
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
        .filter(|record| record.model.is_empty() || record.model == section.model())
        .map(|record| record_to_mod(section, record))
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

fn record_to_mod(section: GameBananaSection, record: &RawRecord) -> GameBananaMod {
    let category = record.root_category.as_ref();
    let sub_category = record.sub_category.as_ref();
    let category_id = category
        .and_then(|row| category_id_from_url(&row.profile_url, section))
        .unwrap_or(0);
    let is_gui = section == GameBananaSection::Mod
        && (category_id == 1644
            || category.is_some_and(|row| row.name.eq_ignore_ascii_case("GUIs")));
    GameBananaMod {
        id: record.id,
        section,
        name: record.name.clone(),
        author: record
            .submitter
            .as_ref()
            .map(|row| row.name.clone())
            .unwrap_or_default(),
        category: category.map(|row| row.name.clone()).unwrap_or_default(),
        category_id,
        sub_category: sub_category.map(|row| row.name.clone()),
        // Other GUI mods (menus, icons, fonts, scoreboards) are ordinary
        // custom packs; the installer still refuses a payload that is a HUD.
        route: if is_gui && sub_category.is_some_and(is_hud_category) {
            GameBananaModRoute::Hud
        } else {
            sound_slot_route(section, category_id).unwrap_or(GameBananaModRoute::Mod)
        },
        likes: record.likes,
        views: record.views,
        downloads: record.downloads,
        added_at: valid_timestamp(record.added),
        updated_at: valid_timestamp(record.updated),
        modified_at: valid_timestamp(record.modified),
        thumb: record.preview.as_ref().and_then(thumb_url),
        url: validated_mod_page(&record.profile_url, record.id, section)
            .unwrap_or_else(|| section.page_url(record.id)),
        mature: record.has_content_ratings,
    }
}

/// Hit and kill sound uploads go to the Sounds pane.
fn sound_slot_route(section: GameBananaSection, category_id: u64) -> Option<GameBananaModRoute> {
    match (section, category_id) {
        (GameBananaSection::Sound, HITSOUND_CATEGORY) => Some(GameBananaModRoute::HitSound),
        (GameBananaSection::Sound, KILLSOUND_CATEGORY) => Some(GameBananaModRoute::KillSound),
        _ => None,
    }
}

fn valid_timestamp(value: Option<i64>) -> Option<i64> {
    value.filter(|timestamp| *timestamp > 0)
}

/// `https://gamebanana.com/mods/cats/7951` → `7951` (or `/sounds/cats/381`
/// for the Sound section).
fn category_id_from_url(url: &str, section: GameBananaSection) -> Option<u64> {
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
        [path, "cats", id] if *path == section.path() => id.parse().ok(),
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

fn validated_mod_page(
    candidate: &str,
    expected_id: u64,
    section: GameBananaSection,
) -> Option<String> {
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
    if segments.next()? != section.path() || segments.next()?.parse::<u64>().ok()? != expected_id {
        return None;
    }
    if segments.any(|part| !part.is_empty()) {
        return None;
    }
    Some(parsed.to_string())
}

/// HUD submissions (under GUIs) go to the HUD pane; every other GUI mod installs
/// like any other mod, and maps install into a pack's `maps` folder. These other
/// roots are Hammer or server material, not something a player's game loads.
const EXCLUDED_CATEGORIES: [&str; 3] = ["decal tool", "prefabs", "serverside weapons"];

/// The installable root categories of one section, cached for ten minutes.
///
/// The endpoint refuses a request with no `_sSort`, so `a_to_z` is passed
/// explicitly rather than left to a default that does not exist.
pub fn categories(
    section: GameBananaSection,
    refresh: bool,
) -> Result<Vec<GameBananaCategory>, String> {
    let url = format!(
        "{API}/{}/Categories?_idGameRow={TF2_GAME_ID}&_sSort=a_to_z",
        section.model()
    );
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

fn is_gui_category(category: &CategoryRow) -> bool {
    category.name.eq_ignore_ascii_case("GUIs")
        || category_id_from_url(&category.profile_url, GameBananaSection::Mod) == Some(1644)
}

fn is_hud_category(category: &CategoryRow) -> bool {
    category.name.eq_ignore_ascii_case("HUDs")
        || category_id_from_url(&category.profile_url, GameBananaSection::Mod) == Some(1649)
}

/// Name and page URL, so an install can record what the user actually chose
/// rather than trusting a name passed across the bridge.
pub fn mod_profile(id: u64) -> Result<GameBananaProfile, String> {
    submission_profile(GameBananaSection::Mod, id)
}

/// [`mod_profile`] for either section. The route says whether the submission
/// is a hit or kill sound, which only the Sounds pane uses.
pub fn submission_profile(
    section: GameBananaSection,
    id: u64,
) -> Result<GameBananaProfile, String> {
    // ProfilePage exposes the immediate category (e.g. Training or HUDs),
    // not its root. Request the root explicitly so descendants cannot bypass
    // the same install policy applied to All and search results.
    let url = format!(
        "{API}/{}/{id}?_csvProperties=_idRow,_sName,_sProfileUrl,_aRootCategory,_aCategory,_aGame,_tsDateUpdated",
        section.model()
    );
    let page: ProfilePage =
        net::get_json_for(&net::api_client()?, &url, RemoteSource::GameBananaApi)
            .map_err(|err| format!("Could not read that GameBanana mod ({err})"))?;
    profile_from(page, id, section)
}

fn profile_from(
    page: ProfilePage,
    id: u64,
    section: GameBananaSection,
) -> Result<GameBananaProfile, String> {
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
    if !is_browsable_category(&category.name) {
        return Err("That GameBanana category cannot be installed from Mods.".into());
    }
    if is_gui_category(category) {
        let immediate = page
            .category
            .as_ref()
            .ok_or("Could not verify that mod's GameBanana category. Try again later.")?;
        if is_hud_category(immediate) {
            return Err("That GameBanana mod is a HUD. Install it from the HUD pane.".into());
        }
    }
    let route = match category_id_from_url(&category.profile_url, section) {
        Some(category_id) => {
            sound_slot_route(section, category_id).unwrap_or(GameBananaModRoute::Mod)
        }
        // A sound whose category cannot be verified might be a hit or kill
        // sound, so it is neither installed as a pack nor offered to Sounds.
        None if section == GameBananaSection::Sound => {
            return Err(
                "Could not verify that sound's GameBanana category. Try again later.".into(),
            )
        }
        None => GameBananaModRoute::Mod,
    };
    Ok(GameBananaProfile {
        updated_at: valid_timestamp(page.updated),
        name: if page.name.is_empty() {
            format!("GameBanana {} {id}", section.model().to_ascii_lowercase())
        } else {
            page.name
        },
        url: validated_mod_page(&page.profile_url, id, section)
            .unwrap_or_else(|| section.page_url(id)),
        id,
        route,
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

/// What a downloaded file is for: a custom pack (VPK or archive), or a hit
/// or kill sound the Sounds pane prepares (an archive or one audio file).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum FileUse {
    Pack,
    Sound,
}

fn download_files(section: GameBananaSection, id: u64) -> Result<Vec<DownloadFile>, String> {
    let url = format!("{API}/{}/{id}/DownloadPage", section.model());
    let page: DownloadPage =
        net::get_json_for(&net::api_client()?, &url, RemoteSource::GameBananaApi)
            .map_err(|err| format!("Could not read the GameBanana listing ({err})"))?;
    Ok(page.files)
}

/// Author names and descriptions are shown before choosing a file. The
/// download URL stays native-side and is rechecked when the selection is used.
pub fn download_variants(id: u64) -> Result<Vec<GameBananaDownloadVariant>, String> {
    download_variants_in(GameBananaSection::Mod, id, FileUse::Pack)
}

pub fn download_variants_in(
    section: GameBananaSection,
    id: u64,
    file_use: FileUse,
) -> Result<Vec<GameBananaDownloadVariant>, String> {
    variants_from_files(download_files(section, id)?, file_use)
}

fn variants_from_files(
    mut files: Vec<DownloadFile>,
    file_use: FileUse,
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
            supported: file_is_supported(&file, file_use) && !is_split_part(&file),
            split_part: is_split_part(&file),
        })
        .collect())
}

pub fn download_file(id: u64, file_id: u64) -> Result<DownloadPick, String> {
    download_file_in(GameBananaSection::Mod, id, file_id, FileUse::Pack)
}

pub fn download_file_in(
    section: GameBananaSection,
    id: u64,
    file_id: u64,
    file_use: FileUse,
) -> Result<DownloadPick, String> {
    pick_file_by_id(download_files(section, id)?, file_id, file_use)
}

/// hud-db's GameBanana entries have no file-choice UI. Only a single listed
/// ZIP, 7z or RAR is safe to choose automatically; any alternatives require
/// the author page and an explicit manual HUD import.
pub fn download_url_for_page(page_url: &str) -> Result<String, String> {
    let id = mod_id_from_url(page_url).ok_or("That GameBanana link has no mod id.")?;
    pick_hud_archive(download_files(GameBananaSection::Mod, id)?)
}

fn pick_file_by_id(
    files: Vec<DownloadFile>,
    file_id: u64,
    file_use: FileUse,
) -> Result<DownloadPick, String> {
    // Recheck the page rather than accepting a stale or caller-supplied URL.
    variants_from_files(files.clone(), file_use)?;
    let chosen = files
        .iter()
        .find(|file| file.id == file_id && validated_download_url(file).is_some())
        .ok_or("That GameBanana file is no longer listed. Choose a file again.")?;
    if is_split_part(chosen) {
        return Err(SPLIT_PART_REFUSAL.into());
    }
    if chosen.size_bytes.is_some_and(|size| size > MOD_MAX_BYTES) {
        return Err(execs_core::mods::oversized_mod_message(chosen.size_bytes));
    }
    if !file_is_supported(chosen, file_use) {
        return Err(match file_use {
            FileUse::Pack => "That GameBanana file is not a VPK, ZIP, 7z or RAR.",
            FileUse::Sound => "That GameBanana file is not a ZIP, 7z, RAR, WAV, MP3 or Ogg file.",
        }
        .into());
    }
    Ok(DownloadPick {
        url: validated_download_url(chosen).expect("validated above"),
        file_name: chosen.file.clone(),
    })
}

fn pick_hud_archive(files: Vec<DownloadFile>) -> Result<String, String> {
    variants_from_files(files.clone(), FileUse::Pack)?;
    if files.len() > 1 {
        return Err(
            "That HUD offers multiple files. Choose one on the author's page, then import it in HUD."
                .into(),
        );
    }
    let only = &files[0];
    if !is_archive_file(&only.file)
        || is_split_part(only)
        || only.size_bytes.is_some_and(|size| size > MOD_MAX_BYTES)
    {
        return Err(
            "That HUD has no supported ZIP, 7z or RAR. Open the author's page and import a compatible HUD archive."
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
    lower.ends_with(".zip") || lower.ends_with(".7z") || lower.ends_with(".rar")
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
        format!(
            "Could not download {file_name}. {}",
            crate::net::status_failure(file_name, RemoteSource::GameBananaDownload, status)
        )
    }
}

fn file_is_supported(file: &DownloadFile, file_use: FileUse) -> bool {
    let lower = file.file.to_ascii_lowercase();
    let kind = match file_use {
        FileUse::Pack => is_archive_file(&lower) || lower.ends_with(".vpk"),
        FileUse::Sound => is_archive_file(&lower) || is_audio_file(&lower),
    };
    kind && file.size_bytes.is_none_or(|size| size <= MOD_MAX_BYTES)
}

/// A sound file the Sounds pane can prepare: WAV, MP3 or Ogg Vorbis.
pub fn is_audio_file(name: &str) -> bool {
    let lower = name.to_ascii_lowercase();
    [".wav", ".mp3", ".ogg", ".oga"]
        .iter()
        .any(|extension| lower.ends_with(extension))
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
        let url = search_url(
            GameBananaSection::Mod,
            " blue scout ",
            "likes",
            Some(1090),
            1,
            false,
        )
        .unwrap();
        assert!(url.starts_with("https://gamebanana.com/apiv11/Mod/Index?"));
        assert!(url.contains("_nPage=1&_nPerpage=20"));
        assert!(url.contains("_aFilters[Generic_Game]=297"));
        assert!(url.contains("_sSort=Generic_MostLiked"));
        assert!(url.contains("_aFilters[Generic_Name]=contains%2Cblue%20scout"));
        assert!(url.contains("_aFilters[Generic_Category]=1090"));
        assert!(url.contains("_aFilters[Generic_ContentRatings]=-"));

        let mature = search_url(GameBananaSection::Mod, "", "new", None, 2, true).unwrap();
        assert!(mature.contains("_nPage=2"));
        assert!(!mature.contains("Generic_Name"));
        assert!(!mature.contains("Generic_Category"));
        assert!(!mature.contains("Generic_ContentRatings"));
        assert_eq!(encode_query("uber ü"), "uber%20%C3%BC");

        assert!(search_url(GameBananaSection::Mod, "", "new", None, 0, false).is_err());
        assert!(search_url(GameBananaSection::Mod, "comma,term", "new", None, 1, false).is_err());
        assert!(search_url(
            GameBananaSection::Mod,
            &"é".repeat(128),
            "new",
            None,
            1,
            false
        )
        .is_ok());
        assert!(search_url(
            GameBananaSection::Mod,
            &"é".repeat(129),
            "new",
            None,
            1,
            false
        )
        .is_err());
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
        let page = page_from(
            GameBananaSection::Mod,
            response,
            None,
            true,
            network_cache_info(),
        );
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
        let page = page_from(
            GameBananaSection::Mod,
            response,
            Some(1090),
            true,
            network_cache_info(),
        );
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
        let page = page_from(
            GameBananaSection::Mod,
            response,
            Some(1090),
            false,
            network_cache_info(),
        );
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
    fn browse_includes_guis_and_maps_and_tells_huds_apart() {
        assert!(!is_excluded_category("Maps"));
        assert!(!is_excluded_category("GUIs"));
        assert!(is_browsable_category("GUIs"));
        assert!(is_gui_category(&CategoryRow {
            name: "Interface".into(),
            profile_url: "https://gamebanana.com/mods/cats/1644".into(),
        }));
        assert!(is_hud_category(&CategoryRow {
            name: "HUDs".into(),
            profile_url: String::new(),
        }));
        assert!(!is_hud_category(&CategoryRow {
            name: "Icons".into(),
            profile_url: "https://gamebanana.com/mods/cats/1648".into(),
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
                GameBananaSection::Mod,
                serde_json::from_value(response.clone()).unwrap(),
                None,
                mature,
                network_cache_info(),
            );
            assert_eq!(
                page.records.iter().map(|r| r.id).collect::<Vec<_>>(),
                if mature {
                    vec![1, 2, 6, 7]
                } else {
                    vec![1, 2, 6]
                }
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
    fn gui_huds_route_to_hud_and_other_gui_mods_install() {
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
        let page = page_from(
            GameBananaSection::Mod,
            response,
            Some(1644),
            false,
            network_cache_info(),
        );
        assert_eq!(page.records.len(), 2);
        assert_eq!(page.records[0].route, GameBananaModRoute::Hud);
        assert_eq!(page.records[0].sub_category.as_deref(), Some("HUDs"));
        assert_eq!(page.records[1].route, GameBananaModRoute::Mod);
        assert_eq!(page.records[1].sub_category.as_deref(), Some("Menus"));
    }

    #[test]
    fn direct_installs_validate_the_root_category_and_game() {
        let valid = serde_json::json!({
            "_idRow": 7, "_sName": "A skin", "_aGame": { "_idRow": 297 },
            "_aCategory": { "_sName": "Child category" },
            "_aRootCategory": { "_sName": "Skins" }
        });
        let profile = profile_from(
            serde_json::from_value(valid.clone()).unwrap(),
            7,
            GameBananaSection::Mod,
        )
        .unwrap();
        assert_eq!(profile.name, "A skin");
        assert_eq!(profile.url, "https://gamebanana.com/mods/7");
        assert_eq!(profile.updated_at, None);
        let mut dated = valid.clone();
        dated["_tsDateModified"] = 1_900_000_000.into();
        assert_eq!(
            profile_from(
                serde_json::from_value(dated.clone()).unwrap(),
                7,
                GameBananaSection::Mod
            )
            .unwrap()
            .updated_at,
            None
        );
        dated["_tsDateUpdated"] = 1_700_000_000.into();
        assert_eq!(
            profile_from(
                serde_json::from_value(dated.clone()).unwrap(),
                7,
                GameBananaSection::Mod
            )
            .unwrap()
            .updated_at,
            Some(1_700_000_000)
        );
        dated["_tsDateUpdated"] = (-1).into();
        assert_eq!(
            profile_from(
                serde_json::from_value(dated).unwrap(),
                7,
                GameBananaSection::Mod
            )
            .unwrap()
            .updated_at,
            None
        );
        for name in EXCLUDED_CATEGORIES.into_iter().chain([""]) {
            let mut page = valid.clone();
            page["_aRootCategory"]["_sName"] = name.into();
            assert!(
                profile_from(
                    serde_json::from_value(page).unwrap(),
                    7,
                    GameBananaSection::Mod
                )
                .is_err(),
                "{name}"
            );
        }
        // A GUI mod installs unless its own category is HUDs (by name or id),
        // or GameBanana does not say which GUI category it is.
        let mut menu = valid.clone();
        menu["_aRootCategory"] = serde_json::json!({
            "_sName": "Interface",
            "_sProfileUrl": "https://gamebanana.com/mods/cats/1644"
        });
        menu["_aCategory"] = serde_json::json!({ "_sName": "Icons" });
        assert!(profile_from(
            serde_json::from_value(menu.clone()).unwrap(),
            7,
            GameBananaSection::Mod
        )
        .is_ok());
        for hud in [
            serde_json::json!({ "_sName": "HUDs" }),
            serde_json::json!({ "_sName": "Renamed", "_sProfileUrl": "https://gamebanana.com/mods/cats/1649" }),
        ] {
            let mut page = menu.clone();
            page["_aCategory"] = hud;
            let err = profile_from(
                serde_json::from_value(page).unwrap(),
                7,
                GameBananaSection::Mod,
            )
            .unwrap_err();
            assert!(err.contains("HUD pane"), "{err}");
        }
        let mut unknown = menu.clone();
        unknown.as_object_mut().unwrap().remove("_aCategory");
        assert!(profile_from(
            serde_json::from_value(unknown).unwrap(),
            7,
            GameBananaSection::Mod
        )
        .is_err());
        for field in ["_aRootCategory", "_aGame"] {
            let mut page = valid.clone();
            page.as_object_mut().unwrap().remove(field);
            assert!(profile_from(
                serde_json::from_value(page).unwrap(),
                7,
                GameBananaSection::Mod
            )
            .is_err());
        }
        let mut other_game = valid.clone();
        other_game["_aGame"]["_idRow"] = 1.into();
        assert!(profile_from(
            serde_json::from_value(other_game).unwrap(),
            7,
            GameBananaSection::Mod
        )
        .is_err());
        assert!(profile_from(
            serde_json::from_value(valid).unwrap(),
            8,
            GameBananaSection::Mod
        )
        .is_err());
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
        let variants = variants_from_files(files.clone(), FileUse::Pack).unwrap();
        assert_eq!(
            variants.iter().map(|file| file.id).collect::<Vec<_>>(),
            vec![3, 2, 1]
        );
        assert_eq!(variants[0].description, "Class select remake");
        assert_eq!(variants[0].size_bytes, Some(1234));
        assert!(variants[0].supported);
        assert!(variants[1].supported);
        assert!(variants[2].supported);
        assert_eq!(
            pick_file_by_id(files.clone(), 2, FileUse::Pack).unwrap(),
            DownloadPick {
                url: "https://gamebanana.com/dl/2".into(),
                file_name: "middle.vpk".into(),
            }
        );
        assert!(pick_file_by_id(files.clone(), 1, FileUse::Pack).is_ok());
        assert!(pick_file_by_id(files, 999, FileUse::Pack).is_err());

        let hostile: Vec<DownloadFile> = serde_json::from_value(serde_json::json!([
            { "_idRow": 4, "_sFile": "looks-safe.zip", "_sDownloadUrl": "https://127.0.0.1/private.zip" },
            { "_idRow": 5, "_sFile": "mismatch.zip", "_sDownloadUrl": "https://gamebanana.com/dl/6" }
        ]))
        .unwrap();
        assert!(variants_from_files(hostile, FileUse::Pack).is_err());
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
        let variants = variants_from_files(files.clone(), FileUse::Pack).unwrap();
        assert!(variants[0].split_part && !variants[0].supported);
        assert!(variants[1].split_part && !variants[1].supported);
        assert!(!variants[2].split_part && variants[2].supported);
        assert!(pick_file_by_id(files.clone(), 1559476, FileUse::Pack)
            .unwrap_err()
            .contains("split download"));
        assert!(pick_file_by_id(files, 597824, FileUse::Pack).is_ok());

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
        assert_eq!(
            download_failure("mod.zip", reqwest::StatusCode::SERVICE_UNAVAILABLE),
            "Could not download mod.zip. GameBanana is having problems right now. Try again later."
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
            .contains("no supported ZIP, 7z or RAR"));
        let rar: DownloadFile = serde_json::from_value(serde_json::json!({
            "_idRow": 4, "_sFile": "hud.rar", "_sDownloadUrl": "https://gamebanana.com/dl/4"
        }))
        .unwrap();
        assert_eq!(
            pick_hud_archive(vec![rar]).unwrap(),
            "https://gamebanana.com/dl/4"
        );
        let part: DownloadFile = serde_json::from_value(serde_json::json!({
            "_idRow": 5, "_sFile": "hud.part2.rar", "_sDownloadUrl": "https://gamebanana.com/dl/5"
        }))
        .unwrap();
        assert!(pick_hud_archive(vec![part]).is_err());
    }

    #[test]
    fn untrusted_profile_and_thumbnail_metadata_is_not_exposed_to_the_ui() {
        assert!(
            validated_mod_page("https://gamebanana.com/mods/7", 7, GameBananaSection::Mod)
                .is_some()
        );
        assert!(validated_mod_page(
            "https://gamebanana.com.evil.test/mods/7",
            7,
            GameBananaSection::Mod
        )
        .is_none());
        assert!(
            validated_mod_page("http://gamebanana.com/mods/7", 7, GameBananaSection::Mod).is_none()
        );
        assert!(
            validated_mod_page("https://gamebanana.com/mods/8", 7, GameBananaSection::Mod)
                .is_none()
        );
        assert_eq!(
            category_id_from_url(
                "https://gamebanana.com/mods/cats/7951",
                GameBananaSection::Mod
            ),
            Some(7951)
        );
        assert_eq!(
            category_id_from_url(
                "https://gamebanana.com.evil.test/mods/cats/7951",
                GameBananaSection::Mod
            ),
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

    #[test]
    fn sections_keep_their_own_ids_urls_and_categories() {
        assert_eq!(GameBananaSection::parse(None), Ok(GameBananaSection::Mod));
        assert_eq!(
            GameBananaSection::parse(Some("mod")),
            Ok(GameBananaSection::Mod)
        );
        assert_eq!(
            GameBananaSection::parse(Some("sound")),
            Ok(GameBananaSection::Sound)
        );
        assert!(GameBananaSection::parse(Some("spray")).is_err());

        // Saved records name their section in the page URL; older records
        // and anything unreadable stay mods.
        for (url, section) in [
            (
                "https://gamebanana.com/sounds/21865",
                GameBananaSection::Sound,
            ),
            ("https://gamebanana.com/mods/21865", GameBananaSection::Mod),
            ("not a url", GameBananaSection::Mod),
        ] {
            assert_eq!(GameBananaSection::of_page_url(url), section, "{url}");
        }
        assert_eq!(
            GameBananaSection::Sound.page_url(7),
            "https://gamebanana.com/sounds/7"
        );

        let url = search_url(
            GameBananaSection::Sound,
            "quake",
            "views",
            Some(381),
            1,
            false,
        )
        .unwrap();
        assert!(url.starts_with("https://gamebanana.com/apiv11/Sound/Index?"));
        assert!(url.contains("_aFilters[Generic_Category]=381"));

        // A category or page URL from the other section is not this section's.
        let sounds = GameBananaSection::Sound;
        assert_eq!(
            category_id_from_url("https://gamebanana.com/sounds/cats/381", sounds),
            Some(381)
        );
        assert_eq!(
            category_id_from_url("https://gamebanana.com/mods/cats/381", sounds),
            None
        );
        assert!(validated_mod_page("https://gamebanana.com/sounds/7", 7, sounds).is_some());
        assert!(validated_mod_page("https://gamebanana.com/mods/7", 7, sounds).is_none());
    }

    #[test]
    fn hit_and_kill_sound_uploads_route_to_sounds_and_other_sounds_install() {
        let raw = r#"{ "_aMetadata": { "_nRecordCount": 4 }, "_aRecords": [
            { "_idRow": 1, "_sModelName": "Sound", "_sName": "Quake hit",
              "_sProfileUrl": "https://gamebanana.com/sounds/1",
              "_aRootCategory": { "_sName": "Hitsound", "_sProfileUrl": "https://gamebanana.com/sounds/cats/381" } },
            { "_idRow": 2, "_sModelName": "Sound", "_sName": "Roblox death",
              "_aRootCategory": { "_sName": "Killsound", "_sProfileUrl": "https://gamebanana.com/sounds/cats/2630" } },
            { "_idRow": 3, "_sModelName": "Sound", "_sName": "Announcer pack",
              "_aRootCategory": { "_sName": "Sound Packs", "_sProfileUrl": "https://gamebanana.com/sounds/cats/1947" } },
            { "_idRow": 4, "_sModelName": "Mod", "_sName": "Not a sound",
              "_aRootCategory": { "_sName": "Skins", "_sProfileUrl": "https://gamebanana.com/mods/cats/7951" } }
        ] }"#;
        let response: IndexResponse = serde_json::from_str(raw).unwrap();
        let page = page_from(
            GameBananaSection::Sound,
            response,
            None,
            false,
            network_cache_info(),
        );
        let routes: Vec<_> = page
            .records
            .iter()
            .map(|record| (record.id, record.route, record.section))
            .collect();
        assert_eq!(
            routes,
            [
                (1, GameBananaModRoute::HitSound, GameBananaSection::Sound),
                (2, GameBananaModRoute::KillSound, GameBananaSection::Sound),
                (3, GameBananaModRoute::Mod, GameBananaSection::Sound),
            ],
            "a Mod record cannot appear in the Sound section"
        );
        assert_eq!(page.records[0].url, "https://gamebanana.com/sounds/1");
        assert_eq!(page.records[1].url, "https://gamebanana.com/sounds/2");
        assert_eq!(page.records[2].category_id, 1947);

        let profile = |category: serde_json::Value| -> Result<GameBananaProfile, String> {
            profile_from(
                serde_json::from_value(serde_json::json!({
                    "_idRow": 7,
                    "_sName": "A sound",
                    "_sProfileUrl": "https://gamebanana.com/sounds/7",
                    "_aRootCategory": category,
                    "_aGame": { "_idRow": 297 }
                }))
                .unwrap(),
                7,
                GameBananaSection::Sound,
            )
        };
        let hit = profile(serde_json::json!({
            "_sName": "Hitsound", "_sProfileUrl": "https://gamebanana.com/sounds/cats/381"
        }))
        .unwrap();
        assert_eq!(hit.route, GameBananaModRoute::HitSound);
        assert_eq!(hit.url, "https://gamebanana.com/sounds/7");
        assert!(hit.require_pack().unwrap_err().contains("Sounds"));
        let pack = profile(serde_json::json!({
            "_sName": "Announcer", "_sProfileUrl": "https://gamebanana.com/sounds/cats/3532"
        }))
        .unwrap();
        assert_eq!(pack.route, GameBananaModRoute::Mod);
        assert!(pack.require_pack().is_ok());
        // An unverifiable sound category could be a hit sound: refused.
        assert!(profile(serde_json::json!({
            "_sName": "Hitsound", "_sProfileUrl": "https://gamebanana.com/mods/cats/381"
        }))
        .is_err());
    }

    #[test]
    fn sound_files_accept_loose_audio_but_packs_do_not() {
        let files: Vec<DownloadFile> = serde_json::from_value(serde_json::json!([
            { "_idRow": 1, "_sFile": "hit.wav", "_sDownloadUrl": "https://gamebanana.com/dl/1" },
            { "_idRow": 2, "_sFile": "hits.zip", "_sDownloadUrl": "https://gamebanana.com/dl/2" },
            { "_idRow": 3, "_sFile": "pack.vpk", "_sDownloadUrl": "https://gamebanana.com/dl/3" },
            { "_idRow": 4, "_sFile": "kill.MP3", "_sDownloadUrl": "https://gamebanana.com/dl/4" }
        ]))
        .unwrap();
        let supported = |file_use| {
            let mut ids: Vec<_> = variants_from_files(files.clone(), file_use)
                .unwrap()
                .into_iter()
                .filter(|variant| variant.supported)
                .map(|variant| variant.id)
                .collect();
            ids.sort();
            ids
        };
        assert_eq!(supported(FileUse::Pack), [2, 3]);
        assert_eq!(supported(FileUse::Sound), [1, 2, 4]);
        assert!(pick_file_by_id(files.clone(), 1, FileUse::Sound).is_ok());
        assert!(pick_file_by_id(files.clone(), 1, FileUse::Pack)
            .unwrap_err()
            .contains("VPK"));
        assert!(pick_file_by_id(files, 3, FileUse::Sound)
            .unwrap_err()
            .contains("WAV"));
    }

    /// Hits the live API. Ignored so CI stays offline:
    /// `cargo test -p execs -- --ignored gamebanana`.
    #[test]
    #[ignore]
    fn smoke_the_live_api() {
        let mut pages = Vec::new();
        for sort in ["new", "updated", "downloads", "likes", "views"] {
            let page = search_mods(GameBananaSection::Mod, "", sort, None, 1, false, true).unwrap();
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

        let categories = categories(GameBananaSection::Mod, true).unwrap();
        println!("categories: {categories:?}");
        assert!(categories.iter().any(|category| category.name == "Skins"));
        assert!(categories.iter().any(|category| category.name == "Maps"));
        assert!(!categories.iter().any(|category| category.name == "Prefabs"));

        let found = search_mods(
            GameBananaSection::Mod,
            "scout",
            "likes",
            None,
            1,
            false,
            true,
        )
        .unwrap();
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
        // Maps install like other mods (tr_walkway); a HUD goes to the HUD pane.
        assert!(mod_profile(74812).is_ok());
        assert!(mod_profile(26852).unwrap_err().contains("HUD"));

        let sounds =
            search_mods(GameBananaSection::Sound, "", "views", None, 1, false, true).unwrap();
        assert!(!sounds.records.is_empty());
        assert!(sounds
            .records
            .iter()
            .all(|record| record.section == GameBananaSection::Sound
                && record.url.starts_with("https://gamebanana.com/sounds/")));
        let sound_categories = super::categories(GameBananaSection::Sound, true).unwrap();
        assert!(sound_categories
            .iter()
            .any(|category| category.id == HITSOUND_CATEGORY));
        assert!(sound_categories
            .iter()
            .any(|category| category.id == KILLSOUND_CATEGORY));
        // Quake III Arena hit indicator: a hit sound with one RAR.
        let quake = submission_profile(GameBananaSection::Sound, 21865).unwrap();
        assert_eq!(quake.route, GameBananaModRoute::HitSound);
        let files = download_variants_in(GameBananaSection::Sound, 21865, FileUse::Sound).unwrap();
        assert!(files.iter().any(|file| file.supported));
    }
}
