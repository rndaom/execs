//! Popularity and site activity for the HUD catalog. tf2huds.dev exposes
//! per-HUD download and view counts and a listing update timestamp through
//! its SvelteKit data endpoint. The timestamp describes TF2 HUDs' listing,
//! not the version installed from hud-db. Values are cached for a day.

use std::collections::{BTreeMap, HashSet};
use std::path::PathBuf;
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

use serde::de::{self, SeqAccess, Visitor};
use serde::{Deserialize, Deserializer, Serialize};

use crate::net::{self, RemoteSource, MIB};

const TF2HUDS_BASE: &str = "https://tf2huds.dev";
const TF2HUDS_MAX_PAGES: usize = 40;
const STATS_IDS_PER_PAGE_LIMIT: usize = 256;
const STATS_IDS_TOTAL_LIMIT: usize = 1024;
const TF2HUDS_RESPONSE_MAX_BYTES: u64 = 512 * 1024;
const TF2HUDS_MAX_DATA_NODES: usize = 32;
const TF2HUDS_MAX_VALUES_PER_NODE: usize = 8192;
const STATS_WORKERS: usize = 8;
/// How long a read that reached the end of the listing is served.
const STATS_TTL: Duration = Duration::from_secs(24 * 60 * 60);
/// How long a read the deadline cut short, or one whose source was down, is
/// served before the next HUD pane load tries again. Never caching it meant
/// every pane load re-walked ~200 requests for up to 90 s while the source
/// was down or its markup had moved.
const PARTIAL_STATS_TTL: Duration = Duration::from_secs(60 * 60);
/// Wall clock for one whole refresh. Both walks are paginated and tf2huds.dev
/// adds a call per HUD, so a slow day could otherwise run for many minutes.
/// Past it the walks stop and hand back what they have, which is cached only
/// briefly.
const STATS_DEADLINE: Duration = Duration::from_secs(90);
const STATS_CACHE_MAX_BYTES: u64 = 16 * MIB;
const STATS_SOURCE_VERSION: u32 = 3;

#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HudStat {
    /// ISO date (`YYYY-MM-DD`) when the tf2huds.dev listing last changed.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub updated: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub downloads: Option<u64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub views: Option<u64>,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HudStatsCache {
    pub fetched_at: u64,
    pub stats: BTreeMap<String, HudStat>,
    /// The source walk reached the end of its listing. Previous source
    /// versions are rejected before this field is used.
    #[serde(default = "default_true")]
    pub complete: bool,
    #[serde(default)]
    pub source_version: u32,
    #[serde(default)]
    pub warnings: Vec<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HudStatsPayload {
    pub stats: BTreeMap<String, HudStat>,
    pub warning: Option<String>,
}

fn default_true() -> bool {
    true
}

impl HudStatsCache {
    fn payload(&self) -> HudStatsPayload {
        HudStatsPayload {
            stats: self.stats.clone(),
            warning: if !self.warnings.is_empty() {
                Some(self.warnings.join(" "))
            } else if !self.complete {
                Some(
                    "The cached HUD activity is incomplete. Retry Refresh to load the rest.".into(),
                )
            } else {
                None
            },
        }
    }

    /// Whether the cache is young enough to serve: a day for a whole read,
    /// an hour for a partial one.
    fn is_fresh(&self, now: u64) -> bool {
        let ttl = if self.complete {
            STATS_TTL
        } else {
            PARTIAL_STATS_TTL
        };
        self.source_version == STATS_SOURCE_VERSION
            && now.saturating_sub(self.fetched_at) < ttl.as_secs()
    }
}

/// What one source's walk gathered, and whether it reached the end of the
/// listing. A walk the deadline cut short is still worth showing; it is not
/// worth freezing into the cache for a day.
struct Walk<T> {
    found: T,
    complete: bool,
}

/// `(downloads, views, listing date)` per hud-db id; None invalidates an
/// ambiguous cached match.
type Counts = BTreeMap<String, Option<(u64, u64, Option<String>)>>;
/// Catalog id, downloads, views, and optional TF2 HUDs listing activity date.
type Tf2HudsMatch = (String, u64, u64, Option<String>);

fn cache_file(root: &std::path::Path) -> PathBuf {
    root.join("hud-catalog").join("stats-v1.json")
}

fn now_secs() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0)
}

/// The cached map when it is fresh, otherwise a new bounded source read.
/// A failure keeps stale values rather than blanking every sort.
pub fn load_or_fetch_stats(refresh: bool) -> Result<HudStatsPayload, String> {
    let now = now_secs();
    let root = execs_core::try_execs_data_dir()?;
    let cached = load_stats_cache(&root, now)?;
    if !refresh {
        if let Some(cache) = &cached {
            if cache.is_fresh(now) {
                return Ok(cache.payload());
            }
        }
    }
    let client = net::api_client()?;
    let catalog = crate::hud_fetch::load_cached_catalog();
    let repositories = catalog
        .as_ref()
        .ok()
        .and_then(|entries| entries.as_deref())
        .map(catalog_repository_ids)
        .unwrap_or_default();
    let deadline = Instant::now() + STATS_DEADLINE;
    let mut counts = fetch_tf2huds_counts(&client, deadline, &repositories);
    if !matches!(catalog, Ok(Some(_))) {
        if let Ok(walk) = &mut counts {
            walk.complete = false;
        }
    }
    finish_stats_refresh(&root, now, cached.as_ref(), counts)
}

fn source_warning<T>(source: &Result<Walk<T>, String>, name: &str) -> Option<String> {
    match source {
        Err(_) => Some(format!("{name} could not be refreshed.")),
        Ok(walk) if !walk.complete => Some(format!("{name} could only be partly refreshed; some values may be stale or missing. Retry Refresh to load the rest.")),
        Ok(_) => None,
    }
}

fn finish_stats_refresh(
    root: &std::path::Path,
    now: u64,
    cached: Option<&HudStatsCache>,
    counts: Result<Walk<Counts>, String>,
) -> Result<HudStatsPayload, String> {
    let warnings: Vec<_> = source_warning(&counts, "HUD activity from tf2huds.dev")
        .into_iter()
        .collect();
    let complete = matches!(&counts, Ok(walk) if walk.complete);
    if counts.is_err() {
        if let Some(cache) = cached {
            // Keep its original age. A failed Refresh must not renew the TTL.
            return Ok(HudStatsPayload {
                stats: cache.stats.clone(),
                warning: Some(warnings.join(" ")),
            });
        }
        return Err(warnings.join(" "));
    }
    let mut stats = cached
        .as_ref()
        .map(|cache| cache.stats.clone())
        .unwrap_or_default();
    merge_counts(&mut stats, counts);
    stats.retain(|_, stat| {
        stat.updated.is_some() || stat.downloads.is_some() || stat.views.is_some()
    });
    // Only a refresh that read the source to the end earns a day of TTL:
    // caching a walk the deadline cut short, or one whose source was down,
    // for that long would hold half the numbers back until tomorrow. It is
    // still cached for an hour, so a dead source costs one walk per hour
    // rather than one per pane load.
    let cache = HudStatsCache {
        fetched_at: now,
        stats: stats.clone(),
        complete,
        source_version: STATS_SOURCE_VERSION,
        warnings,
    };
    let text = serde_json::to_string(&cache).map_err(|err| err.to_string())?;
    net::write_cache_file_within(root, &cache_file(root), text.as_bytes())
        .map_err(|err| format!("Could not save HUD statistics ({err})."))?;
    Ok(cache.payload())
}

fn load_stats_cache(root: &std::path::Path, now: u64) -> Result<Option<HudStatsCache>, String> {
    let path = cache_file(root);
    match std::fs::symlink_metadata(&path) {
        Err(err) if err.kind() == std::io::ErrorKind::NotFound => return Ok(None),
        Err(err) => return Err(err.to_string()),
        Ok(_) => {}
    }
    execs_core::hash::validate_file_within(root, &path).map_err(|err| err.to_string())?;
    let cache = net::read_cache_file_capped(root, &path, STATS_CACHE_MAX_BYTES)
        .ok()
        .and_then(|bytes| serde_json::from_slice::<HudStatsCache>(&bytes).ok());
    let Some(cache) = cache else {
        return Ok(None);
    };
    // Old matching rules cannot supply stale fallback values or be promoted
    // to the current source version by a partial refresh.
    let valid = cache.source_version == STATS_SOURCE_VERSION
        && cache.fetched_at <= now.saturating_add(60 * 60)
        && cache.stats.len() <= 4096
        && cache.stats.iter().all(|(id, stat)| {
            valid_stat_id(id)
                && stat.updated.as_deref().is_none_or(|date| {
                    date.len() == 10
                        && date.bytes().enumerate().all(|(index, byte)| {
                            if index == 4 || index == 7 {
                                byte == b'-'
                            } else {
                                byte.is_ascii_digit()
                            }
                        })
                })
        });
    if !valid {
        return Ok(None);
    }
    Ok(Some(cache))
}

fn valid_stat_id(id: &str) -> bool {
    !id.is_empty()
        && id.len() <= 128
        && id.bytes().all(|byte| {
            byte.is_ascii_lowercase() || byte.is_ascii_digit() || byte == b'-' || byte == b'_'
        })
}

fn merge_counts(stats: &mut BTreeMap<String, HudStat>, source: Result<Walk<Counts>, String>) {
    let Ok(walk) = source else { return };
    if walk.complete {
        for stat in stats.values_mut() {
            stat.updated = None;
            stat.downloads = None;
            stat.views = None;
        }
    }
    for (id, counts) in walk.found {
        let stat = stats.entry(id).or_default();
        stat.updated = counts.as_ref().and_then(|(_, _, date)| date.clone());
        stat.downloads = counts.as_ref().map(|(downloads, _, _)| *downloads);
        stat.views = counts.map(|(_, views, _)| views);
    }
}

// ---------------------------------------------------------------------------
// tf2huds.dev: download and view counts
// ---------------------------------------------------------------------------

/// SvelteKit's `__data.json`: `{ nodes: [{ type: "data", data: [...] }] }`
/// where `data` is a devalue array — objects are `{key: index}` maps whose
/// values live at that index of the same array.
#[derive(Debug, Deserialize)]
struct SvelteData {
    #[serde(default, deserialize_with = "deserialize_svelte_nodes")]
    nodes: Vec<Option<SvelteNode>>,
}

#[derive(Debug, Deserialize)]
struct SvelteNode {
    #[serde(default, deserialize_with = "deserialize_svelte_values")]
    data: Vec<serde_json::Value>,
}

fn deserialize_svelte_nodes<'de, D>(deserializer: D) -> Result<Vec<Option<SvelteNode>>, D::Error>
where
    D: Deserializer<'de>,
{
    struct NodesVisitor;
    impl<'de> Visitor<'de> for NodesVisitor {
        type Value = Vec<Option<SvelteNode>>;

        fn expecting(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
            formatter.write_str("a bounded SvelteKit nodes array")
        }

        fn visit_seq<A>(self, mut sequence: A) -> Result<Self::Value, A::Error>
        where
            A: SeqAccess<'de>,
        {
            let mut out = Vec::new();
            while let Some(node) = sequence.next_element()? {
                if out.len() >= TF2HUDS_MAX_DATA_NODES {
                    return Err(de::Error::custom("too many SvelteKit data nodes"));
                }
                out.push(node);
            }
            Ok(out)
        }
    }
    deserializer.deserialize_seq(NodesVisitor)
}

fn deserialize_svelte_values<'de, D>(deserializer: D) -> Result<Vec<serde_json::Value>, D::Error>
where
    D: Deserializer<'de>,
{
    struct ValuesVisitor;
    impl<'de> Visitor<'de> for ValuesVisitor {
        type Value = Vec<serde_json::Value>;

        fn expecting(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
            formatter.write_str("a bounded SvelteKit devalue array")
        }

        fn visit_seq<A>(self, mut sequence: A) -> Result<Self::Value, A::Error>
        where
            A: SeqAccess<'de>,
        {
            let mut out = Vec::new();
            while let Some(value) = sequence.next_element()? {
                if out.len() >= TF2HUDS_MAX_VALUES_PER_NODE {
                    return Err(de::Error::custom("too many SvelteKit devalue entries"));
                }
                out.push(value);
            }
            Ok(out)
        }
    }
    deserializer.deserialize_seq(ValuesVisitor)
}

fn fetch_tf2huds_counts(
    client: &reqwest::blocking::Client,
    deadline: Instant,
    repositories: &BTreeMap<String, String>,
) -> Result<Walk<Counts>, String> {
    // 1. The listing pages give the site's own ids.
    let mut ids = std::collections::BTreeSet::new();
    let mut complete = true;
    let mut reached_end = false;
    for page in 1..=TF2HUDS_MAX_PAGES {
        if Instant::now() >= deadline {
            complete = false;
            break;
        }
        let url = format!("{TF2HUDS_BASE}/huds/__data.json?page={page}");
        let text = match net::get_text_for_limit(
            client,
            &url,
            RemoteSource::Tf2Huds,
            TF2HUDS_RESPONSE_MAX_BYTES,
        ) {
            Ok(text) => text,
            Err(err) if page == 1 => return Err(err),
            Err(_) => {
                complete = false;
                break;
            }
        };
        let Some(found) = tf2huds_list_ids(&text) else {
            complete = false;
            break;
        };
        if found.len() > STATS_IDS_PER_PAGE_LIMIT {
            return Err("tf2huds.dev returned too many HUDs on one page.".into());
        }
        if found.is_empty() {
            reached_end = true;
            break;
        }
        let before = ids.len();
        ids.extend(found);
        if ids.len() > STATS_IDS_TOTAL_LIMIT {
            return Err("tf2huds.dev returned too many HUDs.".into());
        }
        if ids.len() == before {
            complete = false;
            break;
        }
    }
    if ids.is_empty() {
        return Err("tf2huds.dev listed no HUDs.".into());
    }
    let ids: Vec<_> = ids.into_iter().collect();
    // 2. One data call per HUD, in parallel; each carries its comfig id.
    let worker_count = STATS_WORKERS.min(ids.len().max(1));
    let chunk_size = ids.len().div_ceil(worker_count).max(1);
    let (out, walked_all) = std::thread::scope(|scope| {
        let handles: Vec<_> = ids
            .chunks(chunk_size)
            .map(|chunk| {
                let client = client.clone();
                scope.spawn(move || {
                    let mut found = Vec::new();
                    let mut complete = true;
                    for id in chunk {
                        if Instant::now() >= deadline {
                            complete = false;
                            break;
                        }
                        let url = format!("{TF2HUDS_BASE}/hud/{id}/__data.json");
                        match net::get_text_for_limit(
                            &client,
                            &url,
                            RemoteSource::Tf2Huds,
                            TF2HUDS_RESPONSE_MAX_BYTES,
                        )
                        .ok()
                        .and_then(|text| tf2huds_counts(&text, repositories))
                        {
                            Some(Some(entry)) => found.push(entry),
                            // The site also lists HUDs outside hud-db. A
                            // valid unmatched record is not a fetch failure.
                            Some(None) => {}
                            None => complete = false,
                        }
                    }
                    (found, complete)
                })
            })
            .collect();
        let mut out = BTreeMap::new();
        let mut duplicate_ids = HashSet::new();
        let mut walked_all = true;
        for handle in handles {
            match handle.join() {
                Ok((batch, complete)) => {
                    walked_all &= complete;
                    for (id, downloads, views, updated) in batch {
                        walked_all &= insert_unique_counts(
                            &mut out,
                            &mut duplicate_ids,
                            id,
                            (downloads, views, updated),
                        );
                    }
                }
                Err(_) => walked_all = false,
            }
        }
        (out, walked_all)
    });
    Ok(Walk {
        found: out,
        complete: complete && reached_end && walked_all,
    })
}

fn insert_unique_counts(
    counts: &mut Counts,
    duplicate_ids: &mut HashSet<String>,
    id: String,
    value: (u64, u64, Option<String>),
) -> bool {
    if duplicate_ids.contains(&id) {
        return false;
    }
    if counts.insert(id.clone(), Some(value)).is_some() {
        counts.insert(id.clone(), None);
        duplicate_ids.insert(id);
        return false;
    }
    true
}

fn devalue_nodes(text: &str) -> Vec<Vec<serde_json::Value>> {
    serde_json::from_str::<SvelteData>(text)
        .map(|parsed| {
            parsed
                .nodes
                .into_iter()
                .flatten()
                .map(|node| node.data)
                .collect()
        })
        .unwrap_or_default()
}

fn devalue_lookup<'a>(
    data: &'a [serde_json::Value],
    object: &serde_json::Map<String, serde_json::Value>,
    key: &str,
) -> Option<&'a serde_json::Value> {
    let index = object.get(key)?.as_u64()? as usize;
    data.get(index)
}

/// Follow the root's HUD list, rather than scanning every devalue object:
/// cover images also have id/name fields and are not HUD detail routes.
fn tf2huds_list_ids(text: &str) -> Option<Vec<String>> {
    let mut ids = Vec::new();
    let mut seen = HashSet::new();
    for data in devalue_nodes(text) {
        let Some(root) = data.first().and_then(serde_json::Value::as_object) else {
            continue;
        };
        let Some(huds) = devalue_lookup(&data, root, "huds") else {
            continue;
        };
        for index in huds.as_array()? {
            let object = data.get(index.as_u64()? as usize)?.as_object()?;
            let id = devalue_lookup(&data, object, "id")?.as_str()?;
            if id.is_empty()
                || id.len() > 128
                || matches!(id, "." | "..")
                || !id.bytes().all(|byte| {
                    byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'_' | b'!' | b'.')
                })
            {
                return None;
            }
            if seen.insert(id.to_string()) {
                ids.push(id.to_string());
                if ids.len() > STATS_IDS_PER_PAGE_LIMIT {
                    break;
                }
            }
        }
        return Some(ids);
    }
    None
}

/// A valid document may have no catalog match. Prefer its explicit comfig
/// link; otherwise join its exact GitHub repository only when hud-db has
/// one entry for it. Display names and site slugs are not stable identities.
fn tf2huds_counts(
    text: &str,
    repositories: &BTreeMap<String, String>,
) -> Option<Option<Tf2HudsMatch>> {
    for data in devalue_nodes(text) {
        for value in &data {
            let Some(object) = value.as_object() else {
                continue;
            };
            if !object.contains_key("viewCount") || !object.contains_key("downloadCount") {
                continue;
            }
            let views = devalue_lookup(&data, object, "viewCount")?.as_u64()?;
            let downloads = devalue_lookup(&data, object, "downloadCount")?.as_u64()?;
            let updated =
                devalue_lookup(&data, object, "updatedDatetime").and_then(parse_svelte_date);
            let url = devalue_lookup(&data, object, "comfigHudsUrl")
                .and_then(serde_json::Value::as_str)
                .unwrap_or_default();
            let id = if !url.trim().is_empty() {
                comfig_page_id(url)
            } else {
                tf2huds_repository(&data, object)
                    .and_then(|repository| repositories.get(&repository).cloned())
            };
            return Some(id.map(|id| (id, downloads, views, updated)));
        }
    }
    None
}

fn parse_svelte_date(value: &serde_json::Value) -> Option<String> {
    let tagged = value.as_array()?;
    let [kind, value] = tagged.as_slice() else {
        return None;
    };
    if kind.as_str()? != "Date" {
        return None;
    }
    let timestamp = value.as_str()?;
    if !timestamp.ends_with('Z') || timestamp.as_bytes().get(10) != Some(&b'T') {
        return None;
    }
    let date = timestamp.get(..10)?;
    let year: u32 = date.get(..4)?.parse().ok()?;
    let month: u32 = date.get(5..7)?.parse().ok()?;
    let day: u32 = date.get(8..10)?.parse().ok()?;
    if date.as_bytes().get(4) != Some(&b'-') || date.as_bytes().get(7) != Some(&b'-') {
        return None;
    }
    let leap = year.is_multiple_of(4) && (!year.is_multiple_of(100) || year.is_multiple_of(400));
    let days = match month {
        1 | 3 | 5 | 7 | 8 | 10 | 12 => 31,
        4 | 6 | 9 | 11 => 30,
        2 if leap => 29,
        2 => 28,
        _ => return None,
    };
    if !(2000..=9999).contains(&year) || !(1..=days).contains(&day) {
        return None;
    }
    Some(date.to_string())
}

fn catalog_repository_ids(entries: &[execs_core::HudCatalogEntry]) -> BTreeMap<String, String> {
    let mut repositories = BTreeMap::new();
    let mut ambiguous = HashSet::new();
    for entry in entries {
        let Some(repository) = canonical_github_repository(&entry.repo) else {
            continue;
        };
        if repositories
            .insert(repository.clone(), entry.id.clone())
            .is_some_and(|previous| previous != entry.id)
        {
            ambiguous.insert(repository);
        }
    }
    repositories.retain(|repository, _| !ambiguous.contains(repository));
    repositories
}

fn canonical_github_repository(url: &str) -> Option<String> {
    let url = reqwest::Url::parse(url.trim()).ok()?;
    if url.scheme() != "https"
        || url.host_str() != Some("github.com")
        || !url.username().is_empty()
        || url.password().is_some()
        || url.port().is_some()
        || url.query().is_some()
        || url.fragment().is_some()
    {
        return None;
    }
    let parts: Vec<_> = url.path().trim_matches('/').split('/').collect();
    let [owner, repository] = parts.as_slice() else {
        return None;
    };
    let repository = repository.strip_suffix(".git").unwrap_or(repository);
    if owner.is_empty()
        || repository.is_empty()
        || [*owner, repository].iter().any(|part| {
            matches!(*part, "." | "..")
                || !part
                    .bytes()
                    .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'_' | b'.'))
        })
    {
        return None;
    }
    Some(format!("{owner}/{repository}").to_ascii_lowercase())
}

fn tf2huds_repository(
    data: &[serde_json::Value],
    object: &serde_json::Map<String, serde_json::Value>,
) -> Option<String> {
    if let Some(url) = devalue_lookup(data, object, "githubUrl")
        .and_then(serde_json::Value::as_str)
        .filter(|url| !url.trim().is_empty())
    {
        return canonical_github_repository(url);
    }
    let repository = devalue_lookup(data, object, "githubRepository")?.as_object()?;
    let name = devalue_lookup(data, repository, "name")?.as_str()?;
    let owner = devalue_lookup(data, repository, "githubUser")?.as_object()?;
    let owner = devalue_lookup(data, owner, "name")?.as_str()?;
    canonical_github_repository(&format!("https://github.com/{owner}/{name}"))
}

fn comfig_page_id(url: &str) -> Option<String> {
    let parsed = reqwest::Url::parse(url).ok()?;
    if parsed.scheme() != "https"
        || !matches!(parsed.host_str(), Some("comfig.app" | "www.comfig.app"))
        || parsed.port().is_some()
        || !parsed.username().is_empty()
        || parsed.password().is_some()
    {
        return None;
    }
    let mut path = parsed.path_segments()?;
    if path.next()? != "huds" || path.next()? != "page" {
        return None;
    }
    let id = path.next()?.trim().to_ascii_lowercase();
    if id.is_empty()
        || path.any(|part| !part.is_empty())
        || !id
            .bytes()
            .all(|byte| byte.is_ascii_lowercase() || byte.is_ascii_digit() || byte == b'-')
    {
        None
    } else {
        Some(id)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn refresh_result_discloses_partial_and_failed_source_without_losing_cached_values() {
        let root =
            std::env::temp_dir().join(format!("execs-stats-refresh-result-{}", std::process::id()));
        std::fs::create_dir_all(root.join("hud-catalog")).unwrap();
        let cached = HudStatsCache {
            fetched_at: 1,
            stats: BTreeMap::from([(
                "old".into(),
                HudStat {
                    updated: Some("2026-01-01".into()),
                    downloads: Some(10),
                    views: Some(20),
                },
            )]),
            complete: true,
            source_version: STATS_SOURCE_VERSION,
            warnings: Vec::new(),
        };
        std::fs::write(cache_file(&root), serde_json::to_vec(&cached).unwrap()).unwrap();
        let failed = || Err("fixture source offline".into());
        let stale = finish_stats_refresh(&root, 50, Some(&cached), failed()).unwrap();
        assert_eq!(stale.stats, cached.stats);
        assert!(stale.warning.unwrap().contains("tf2huds.dev"));
        assert_eq!(load_stats_cache(&root, 50).unwrap().unwrap().fetched_at, 1);
        assert!(finish_stats_refresh(&root, 50, None, failed()).is_err());

        let partial = finish_stats_refresh(
            &root,
            60,
            Some(&cached),
            Ok(Walk {
                found: BTreeMap::from([("new".into(), Some((30, 40, Some("2026-09-14".into()))))]),
                complete: false,
            }),
        )
        .unwrap();
        assert_eq!(partial.stats["old"].updated.as_deref(), Some("2026-01-01"));
        assert_eq!(partial.stats["new"].updated.as_deref(), Some("2026-09-14"));
        assert!(partial.warning.unwrap().contains("partly refreshed"));
        assert!(!load_stats_cache(&root, 60).unwrap().unwrap().complete);

        let whole = finish_stats_refresh(
            &root,
            70,
            Some(&cached),
            Ok(Walk {
                found: BTreeMap::from([("new".into(), Some((50, 60, Some("2026-09-15".into()))))]),
                complete: true,
            }),
        )
        .unwrap();
        assert!(!whole.stats.contains_key("old"));
        assert_eq!(whole.stats["new"].updated.as_deref(), Some("2026-09-15"));
        assert!(whole.warning.is_none());
        std::fs::remove_dir_all(root).unwrap();
    }
    #[test]
    fn listing_only_requests_huds_and_distinguishes_malformed_from_empty() {
        let listing = r#"{"nodes":[{"data":[{"huds":1},[2],{"id":3,"name":3,"cover":4},"LOL-!!-HUD",{"id":5,"name":6},"image-uuid","cover.png"]}]}"#;
        assert_eq!(tf2huds_list_ids(listing), Some(vec!["LOL-!!-HUD".into()]));
        assert_eq!(
            tf2huds_list_ids(r#"{"nodes":[{"data":[{"huds":1},[]]}]}"#),
            Some(vec![])
        );
        assert_eq!(tf2huds_list_ids("not json"), None);
        assert_eq!(
            tf2huds_list_ids(r#"{"nodes":[{"data":[{"huds":999}]}]}"#),
            None
        );
        assert_eq!(
            tf2huds_list_ids(&listing.replace("LOL-!!-HUD", "../huds?other")),
            None
        );
    }

    #[test]
    fn repository_joins_are_exact_unique_and_subordinate_to_explicit_links() {
        let entry = |id: &str, repository: &str| {
            execs_core::catalog_entry_from_json(
                id,
                &serde_json::json!({
                    "name": id, "author": "author", "repo": repository, "hash": ""
                })
                .to_string(),
            )
            .unwrap()
        };
        let entries = [
            entry("ahud", "https://github.com/n0kk/ahud"),
            entry("variant-a", "https://github.com/author/shared"),
            entry("variant-b", "https://github.com/Author/Shared.git/"),
        ];
        let repositories = catalog_repository_ids(&entries);
        assert_eq!(repositories.len(), 1);
        let record = r#"{"nodes":[{"data":[{"viewCount":1,"downloadCount":2,"comfigHudsUrl":3,"githubUrl":4},931686,330446,"","https://github.com/N0kk/AHud.git/"]}]}"#;
        assert_eq!(
            tf2huds_counts(record, &repositories),
            Some(Some(("ahud".into(), 330446, 931686, None)))
        );
        assert_eq!(
            tf2huds_counts(&record.replace("AHud.git/", "other"), &repositories),
            Some(None)
        );
        let explicit = record.replace(
            "330446,\"\",",
            "330446,\"https://comfig.app/huds/page/explicit/\",",
        );
        assert_eq!(
            tf2huds_counts(&explicit, &repositories),
            Some(Some(("explicit".into(), 330446, 931686, None)))
        );
        for url in [
            "http://github.com/n0kk/ahud",
            "https://github.com.evil.test/n0kk/ahud",
            "https://github.com/n0kk/ahud/tree/main",
            "https://github.com/n0kk/ahud?other=1",
        ] {
            assert_eq!(canonical_github_repository(url), None);
        }
    }

    #[test]
    fn repository_relations_are_followed_without_guessing_display_names() {
        let record = r#"{"nodes":[{"data":[{"viewCount":1,"downloadCount":2,"githubRepository":3},0,6,{"name":4,"githubUser":5},"ahud",{"name":6},"n0kk"]}]}"#;
        let repositories = BTreeMap::from([("n0kk/ahud".into(), "ahud".into())]);
        assert_eq!(
            tf2huds_counts(record, &repositories),
            Some(Some(("ahud".into(), 6, 0, None)))
        );
    }

    #[test]
    fn duplicate_source_records_cannot_overwrite_or_sum_a_huds_counts() {
        let mut counts = BTreeMap::new();
        let mut duplicate_ids = HashSet::new();
        assert!(insert_unique_counts(
            &mut counts,
            &mut duplicate_ids,
            "hud".into(),
            (10, 20, None)
        ));
        assert!(!insert_unique_counts(
            &mut counts,
            &mut duplicate_ids,
            "hud".into(),
            (50, 100, None)
        ));
        assert!(!insert_unique_counts(
            &mut counts,
            &mut duplicate_ids,
            "hud".into(),
            (2, 3, None)
        ));
        assert_eq!(counts["hud"], None);
        let mut stats = BTreeMap::from([(
            "hud".into(),
            HudStat {
                updated: Some("2026-01-01".into()),
                downloads: Some(10),
                views: Some(20),
            },
        )]);
        merge_counts(
            &mut stats,
            Ok(Walk {
                found: counts,
                complete: false,
            }),
        );
        assert_eq!(stats["hud"].downloads, None);
        assert_eq!(stats["hud"].views, None);
        assert_eq!(stats["hud"].updated, None);
    }

    #[test]
    fn legacy_source_cache_cannot_be_used_as_stale_refresh_input() {
        let root = std::env::temp_dir().join(format!(
            "execs-hud-stats-source-version-{}",
            std::process::id()
        ));
        std::fs::create_dir_all(root.join("hud-catalog")).unwrap();
        let mut cache = HudStatsCache {
            fetched_at: 5,
            stats: BTreeMap::from([(
                "hud".into(),
                HudStat {
                    views: Some(100),
                    ..HudStat::default()
                },
            )]),
            complete: false,
            source_version: STATS_SOURCE_VERSION - 1,
            warnings: Vec::new(),
        };
        std::fs::write(cache_file(&root), serde_json::to_vec(&cache).unwrap()).unwrap();
        assert!(load_stats_cache(&root, 100_000).unwrap().is_none());
        cache.source_version = STATS_SOURCE_VERSION;
        std::fs::write(cache_file(&root), serde_json::to_vec(&cache).unwrap()).unwrap();
        let loaded = load_stats_cache(&root, 100_000).unwrap().unwrap();
        assert!(!loaded.is_fresh(100_000));
        assert_eq!(loaded.stats["hud"].views, Some(100));
        std::fs::remove_file(cache_file(&root)).unwrap();
        std::fs::remove_dir(root.join("hud-catalog")).unwrap();
        std::fs::remove_dir(root).unwrap();
    }

    #[test]
    fn a_partial_read_is_served_for_an_hour_and_a_whole_one_for_a_day() {
        let whole = HudStatsCache {
            fetched_at: 1_000_000,
            stats: BTreeMap::new(),
            complete: true,
            source_version: STATS_SOURCE_VERSION,
            warnings: Vec::new(),
        };
        let partial = HudStatsCache {
            complete: false,
            ..whole.clone()
        };
        let hour = 60 * 60;
        assert!(whole.is_fresh(1_000_000 + 23 * hour));
        assert!(!whole.is_fresh(1_000_000 + 25 * hour));
        assert!(partial.is_fresh(1_000_000 + hour / 2));
        assert!(!partial.is_fresh(1_000_000 + 2 * hour));

        // A cache from before the flag existed was only written when complete.
        let old: HudStatsCache =
            serde_json::from_str(r#"{"fetchedAt":5,"stats":{"rayshud":{"views":3}}}"#).unwrap();
        assert!(old.complete);
        assert!(!old.is_fresh(5), "legacy sparse caches must be refreshed");
        assert_eq!(old.stats["rayshud"].views, Some(3));
        let json = serde_json::to_value(&partial).unwrap();
        assert_eq!(json["complete"], false);
    }

    #[test]
    fn tf2huds_devalue_documents_decode() {
        let list = r#"{"type":"data","nodes":[null,{"type":"data","data":[{"huds":1},[2,5],{"id":3,"name":4},"rayshud","rayshud",{"id":6,"name":7},"-Middle-Mann","Middle Mann"]}]}"#;
        assert_eq!(
            tf2huds_list_ids(list),
            Some(vec!["rayshud".into(), "-Middle-Mann".into()])
        );
        let hud = r#"{"type":"data","nodes":[{"type":"data","data":[{"hud":1},{"id":2,"viewCount":3,"downloadCount":4,"comfigHudsUrl":5,"updatedDatetime":6},"rayshud",1168295,398380,"https://comfig.app/huds/page/RaysHUD/",["Date","2026-01-25T00:00:00.000Z"]]}]}"#;
        assert_eq!(
            tf2huds_counts(hud, &BTreeMap::new()),
            Some(Some((
                "rayshud".to_string(),
                398380,
                1168295,
                Some("2026-01-25".into())
            )))
        );
        // An unmatched HUD is valid source data, not a failed request.
        let orphan = r#"{"type":"data","nodes":[{"type":"data","data":[{"viewCount":1,"downloadCount":2,"comfigHudsUrl":3},5,6,null]}]}"#;
        assert_eq!(tf2huds_counts(orphan, &BTreeMap::new()), Some(None));
        assert_eq!(tf2huds_counts("not json", &BTreeMap::new()), None);
        assert_eq!(
            comfig_page_id("https://comfig.app.evil.test/huds/page/rayshud/"),
            None
        );
    }

    #[test]
    fn site_activity_date_requires_a_real_utc_calendar_date() {
        let date = |text: &str| serde_json::json!(["Date", text]);
        assert_eq!(
            parse_svelte_date(&date("2024-02-29T00:00:00Z")),
            Some("2024-02-29".into())
        );
        for invalid in [
            "2025-02-29T00:00:00Z",
            "2026-13-01T00:00:00Z",
            "2026-09-22T00:00:00+02:00",
        ] {
            assert_eq!(parse_svelte_date(&date(invalid)), None);
        }
    }

    #[test]
    fn tf2huds_devalue_arrays_are_bounded_during_deserialization() {
        let values = std::iter::repeat_n("null", TF2HUDS_MAX_VALUES_PER_NODE + 1)
            .collect::<Vec<_>>()
            .join(",");
        let document = format!(r#"{{"nodes":[{{"data":[{values}]}}]}}"#);
        assert!(serde_json::from_str::<SvelteData>(&document).is_err());

        let nodes = std::iter::repeat_n("null", TF2HUDS_MAX_DATA_NODES + 1)
            .collect::<Vec<_>>()
            .join(",");
        let document = format!(r#"{{"nodes":[{nodes}]}}"#);
        assert!(serde_json::from_str::<SvelteData>(&document).is_err());
    }

    #[test]
    fn a_partial_or_failed_source_preserves_stale_fields_until_a_complete_walk() {
        let mut stats = BTreeMap::from([(
            "old".into(),
            HudStat {
                updated: Some("2025-01-01".into()),
                downloads: Some(10),
                views: Some(20),
            },
        )]);
        merge_counts(
            &mut stats,
            Ok(Walk {
                found: BTreeMap::from([("new".into(), Some((30, 40, Some("2026-01-01".into()))))]),
                complete: false,
            }),
        );
        merge_counts(&mut stats, Err("offline".into()));
        assert_eq!(stats["old"].updated.as_deref(), Some("2025-01-01"));
        assert_eq!(stats["old"].downloads, Some(10));

        merge_counts(
            &mut stats,
            Ok(Walk {
                found: BTreeMap::from([("new".into(), Some((50, 60, Some("2026-02-02".into()))))]),
                complete: true,
            }),
        );
        assert_eq!(stats["old"].updated, None);
        assert_eq!(stats["old"].downloads, None);
        assert_eq!(stats["new"].updated.as_deref(), Some("2026-02-02"));
    }
}
