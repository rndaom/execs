//! Popularity and recency for the HUD catalog, from the two places that
//! actually publish them. hud-db itself carries neither: comfig.app bakes a
//! "Last updated" date into its listing pages (all listed HUDs, newest
//! first), and tf2huds.dev exposes per-HUD download and view counts through
//! its SvelteKit data endpoint (about 170 HUDs). Both are read once a day and
//! cached; a HUD absent from either simply has no number.

use std::collections::{BTreeMap, HashSet};
use std::path::PathBuf;
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

use serde::de::{self, SeqAccess, Visitor};
use serde::{Deserialize, Deserializer, Serialize};

use crate::net::{self, RemoteSource, MIB};

const COMFIG_LIST_BASE: &str = "https://comfig.app/huds";
/// comfig.app lists twelve HUDs per page; 20 pages today, so 40 is a wide
/// ceiling that still stops the walk if the site ever loops.
const COMFIG_MAX_PAGES: usize = 40;
const TF2HUDS_BASE: &str = "https://tf2huds.dev";
const TF2HUDS_MAX_PAGES: usize = 40;
const STATS_IDS_PER_PAGE_LIMIT: usize = 256;
const STATS_IDS_TOTAL_LIMIT: usize = 1024;
const TF2HUDS_RESPONSE_MAX_BYTES: u64 = 512 * 1024;
const TF2HUDS_MAX_DATA_NODES: usize = 32;
const TF2HUDS_MAX_VALUES_PER_NODE: usize = 8192;
const STATS_WORKERS: usize = 8;
/// How long a read that reached the end of both listings is served.
const STATS_TTL: Duration = Duration::from_secs(24 * 60 * 60);
/// How long a read the deadline cut short, or one whose source was down, is
/// served before the next HUD pane load tries again. Never caching it meant
/// every pane load re-walked ~200 requests for up to 90 s while comfig.app
/// was down or its markup had moved.
const PARTIAL_STATS_TTL: Duration = Duration::from_secs(60 * 60);
/// Wall clock for one whole refresh. Both walks are paginated and tf2huds.dev
/// adds a call per HUD, so a slow day could otherwise run for many minutes.
/// Past it the walks stop and hand back what they have, which is cached only
/// briefly.
const STATS_DEADLINE: Duration = Duration::from_secs(90);
const STATS_CACHE_MAX_BYTES: u64 = 16 * MIB;

#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HudStat {
    /// ISO date (`YYYY-MM-DD`) of the last update comfig.app shows.
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
    /// Both walks reached the end of their listings. Caches written before
    /// this field existed were only ever written when that was true.
    #[serde(default = "default_true")]
    pub complete: bool,
}

fn default_true() -> bool {
    true
}

impl HudStatsCache {
    /// Whether the cache is young enough to serve: a day for a whole read,
    /// an hour for a partial one.
    fn is_fresh(&self, now: u64) -> bool {
        let ttl = if self.complete {
            STATS_TTL
        } else {
            PARTIAL_STATS_TTL
        };
        now.saturating_sub(self.fetched_at) < ttl.as_secs()
    }
}

/// What one source's walk gathered, and whether it reached the end of the
/// listing. A walk the deadline cut short is still worth showing; it is not
/// worth freezing into the cache for a day.
struct Walk<T> {
    found: T,
    complete: bool,
}

/// `(downloads, views)` per hud-db id.
type Counts = BTreeMap<String, (u64, u64)>;

fn cache_file(root: &std::path::Path) -> PathBuf {
    root.join("hud-catalog").join("stats-v1.json")
}

fn now_secs() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0)
}

/// The cached map when it is fresh, otherwise a new read of both sources.
/// A failure on one source keeps the other's numbers; a failure on both
/// keeps the stale cache rather than blanking every sort.
pub fn load_or_fetch_stats(refresh: bool) -> Result<BTreeMap<String, HudStat>, String> {
    let now = now_secs();
    let root = execs_core::try_execs_data_dir()?;
    let cached = load_stats_cache(&root, now)?;
    if !refresh {
        if let Some(cache) = &cached {
            if cache.is_fresh(now) {
                return Ok(cache.stats.clone());
            }
        }
    }
    let client = net::api_client()?;
    let deadline = Instant::now() + STATS_DEADLINE;
    let updated = fetch_comfig_updated(&client, deadline);
    let counts = fetch_tf2huds_counts(&client, deadline);
    let complete = matches!(&updated, Ok(walk) if walk.complete)
        && matches!(&counts, Ok(walk) if walk.complete);
    if let (Err(err), Err(_)) = (&updated, &counts) {
        if let Some(cache) = cached {
            return Ok(cache.stats);
        }
        return Err(err.clone());
    }
    let mut stats = cached
        .as_ref()
        .map(|cache| cache.stats.clone())
        .unwrap_or_default();
    merge_updated(&mut stats, updated);
    merge_counts(&mut stats, counts);
    stats.retain(|_, stat| {
        stat.updated.is_some() || stat.downloads.is_some() || stat.views.is_some()
    });
    // Only a refresh that read both sources to the end earns a day of TTL:
    // caching a walk the deadline cut short, or one whose source was down,
    // for that long would hold half the numbers back until tomorrow. It is
    // still cached for an hour, so a dead source costs one walk per hour
    // rather than one per pane load.
    let cache = HudStatsCache {
        fetched_at: now,
        stats: stats.clone(),
        complete,
    };
    let text = serde_json::to_string(&cache).map_err(|err| err.to_string())?;
    net::write_cache_file_within(&root, &cache_file(&root), text.as_bytes())
        .map_err(|err| format!("Could not save HUD statistics ({err})."))?;
    Ok(stats)
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
    let valid = cache.fetched_at <= now.saturating_add(60 * 60)
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

fn merge_updated(
    stats: &mut BTreeMap<String, HudStat>,
    source: Result<Walk<BTreeMap<String, String>>, String>,
) {
    let Ok(walk) = source else { return };
    if walk.complete {
        for stat in stats.values_mut() {
            stat.updated = None;
        }
    }
    for (id, date) in walk.found {
        stats.entry(id).or_default().updated = Some(date);
    }
}

fn merge_counts(stats: &mut BTreeMap<String, HudStat>, source: Result<Walk<Counts>, String>) {
    let Ok(walk) = source else { return };
    if walk.complete {
        for stat in stats.values_mut() {
            stat.downloads = None;
            stat.views = None;
        }
    }
    for (id, (downloads, views)) in walk.found {
        let stat = stats.entry(id).or_default();
        stat.downloads = Some(downloads);
        stat.views = Some(views);
    }
}

// ---------------------------------------------------------------------------
// comfig.app: "Last updated" per listed HUD
// ---------------------------------------------------------------------------

fn fetch_comfig_updated(
    client: &reqwest::blocking::Client,
    deadline: Instant,
) -> Result<Walk<BTreeMap<String, String>>, String> {
    let mut out = BTreeMap::new();
    let mut complete = true;
    let mut reached_end = false;
    for page in 1..=COMFIG_MAX_PAGES {
        if Instant::now() >= deadline {
            complete = false;
            break;
        }
        let url = format!("{COMFIG_LIST_BASE}/{page}/");
        let html = match net::get_text_for(client, &url, RemoteSource::ComfigApp) {
            Ok(html) => html,
            // The first page failing is an outage; a later one is the end.
            Err(err) if page == 1 => return Err(err),
            Err(_) => {
                complete = false;
                break;
            }
        };
        let found = parse_comfig_listing(&html);
        if found.len() > STATS_IDS_PER_PAGE_LIMIT {
            return Err("comfig.app returned too many HUDs on one page.".into());
        }
        if found.is_empty() {
            reached_end = true;
            break;
        }
        out.extend(found);
        if out.len() > STATS_IDS_TOTAL_LIMIT {
            return Err("comfig.app returned too many HUDs.".into());
        }
    }
    // Pages that parse to nothing mean the listing's markup moved, not that
    // comfig.app has no dates. Failing keeps that out of the cache.
    if out.is_empty() {
        return Err("comfig.app listed no HUD update dates.".to_string());
    }
    Ok(Walk {
        found: out,
        complete: complete && reached_end,
    })
}

/// Pairs of (id, ISO date) from one listing page. Each card carries
/// `href="/huds/page/<id>/"` followed by `Last updated <strong>Mon D, YYYY</strong>`.
pub fn parse_comfig_listing(html: &str) -> Vec<(String, String)> {
    let mut out = Vec::new();
    let mut seen = HashSet::new();
    let mut rest = html;
    while let Some(start) = rest.find("href=\"/huds/page/") {
        let after = &rest[start + "href=\"/huds/page/".len()..];
        let Some(end) = after.find('/') else { break };
        let id = after[..end].trim().to_ascii_lowercase();
        rest = &after[end..];
        // The date sits inside this card, before the next card's link.
        let card_end = rest.find("href=\"/huds/page/").unwrap_or(rest.len());
        let card = &rest[..card_end];
        if let Some(date) = card
            .find("Last updated")
            .and_then(|at| {
                card[at..]
                    .find("<strong>")
                    .map(|s| at + s + "<strong>".len())
            })
            .and_then(|from| {
                card[from..]
                    .find("</strong>")
                    .map(|to| card[from..from + to].trim())
            })
            .and_then(parse_month_day_year)
        {
            if valid_stat_id(&id) && seen.insert(id.clone()) {
                out.push((id, date));
                if out.len() > STATS_IDS_PER_PAGE_LIMIT {
                    break;
                }
            }
        }
    }
    out
}

/// `Aug 28, 2026` → `2026-08-28`.
fn parse_month_day_year(text: &str) -> Option<String> {
    let mut parts = text.split_whitespace();
    let month = match parts
        .next()?
        .trim_end_matches('.')
        .to_ascii_lowercase()
        .as_str()
    {
        "jan" => 1,
        "feb" => 2,
        "mar" => 3,
        "apr" => 4,
        "may" => 5,
        "jun" => 6,
        "jul" => 7,
        "aug" => 8,
        "sep" | "sept" => 9,
        "oct" => 10,
        "nov" => 11,
        "dec" => 12,
        _ => return None,
    };
    let day: u32 = parts.next()?.trim_end_matches(',').parse().ok()?;
    let year: u32 = parts.next()?.parse().ok()?;
    if !(1..=31).contains(&day) || year < 2000 {
        return None;
    }
    Some(format!("{year:04}-{month:02}-{day:02}"))
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
        let found = tf2huds_list_ids(&text);
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
            reached_end = true;
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
                        .and_then(|text| tf2huds_counts(&text))
                        {
                            Some(entry) => found.push(entry),
                            None => complete = false,
                        }
                    }
                    (found, complete)
                })
            })
            .collect();
        let mut out = BTreeMap::new();
        let mut walked_all = true;
        for handle in handles {
            match handle.join() {
                Ok((batch, complete)) => {
                    walked_all &= complete;
                    for (id, downloads, views) in batch {
                        out.insert(id, (downloads, views));
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

/// The site's ids on one listing page: every object with an `id` whose
/// value is a string and a `name` beside it.
pub fn tf2huds_list_ids(text: &str) -> Vec<String> {
    let mut ids = Vec::new();
    let mut seen = HashSet::new();
    for data in devalue_nodes(text) {
        for value in &data {
            let Some(object) = value.as_object() else {
                continue;
            };
            if !object.contains_key("name") {
                continue;
            }
            if let Some(serde_json::Value::String(id)) = devalue_lookup(&data, object, "id") {
                if !id.is_empty() && id.len() <= 128 && seen.insert(id.clone()) {
                    ids.push(id.clone());
                    if ids.len() > STATS_IDS_PER_PAGE_LIMIT {
                        return ids;
                    }
                }
            }
        }
    }
    ids
}

/// `(hud-db id, downloads, views)` from one HUD's data document. The hud-db
/// id comes from `comfigHudsUrl` (`https://comfig.app/huds/page/<id>/`);
/// a HUD without one is not in hud-db and is skipped.
pub fn tf2huds_counts(text: &str) -> Option<(String, u64, u64)> {
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
            let url = devalue_lookup(&data, object, "comfigHudsUrl")?.as_str()?;
            let id = comfig_page_id(url)?;
            return Some((id, downloads, views));
        }
    }
    None
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
    fn comfig_listing_pairs_ids_with_dates() {
        let html = r#"<a href="/huds/page/rayshud/">rayshud</a> by raysfire
        <span>Last updated <strong>Jan 11, 2026</strong></span>
        <a href="/huds/page/budhud/"><img></a><p>Last updated <strong>Aug 28, 2026</strong></p>
        <a href="/huds/page/nodate/">x</a>"#;
        assert_eq!(
            parse_comfig_listing(html),
            vec![
                ("rayshud".to_string(), "2026-01-11".to_string()),
                ("budhud".to_string(), "2026-08-28".to_string()),
            ]
        );
        assert_eq!(
            parse_month_day_year("Sept 3, 2025").as_deref(),
            Some("2025-09-03")
        );
        assert_eq!(parse_month_day_year("Yesterday"), None);
    }

    #[test]
    fn comfig_listing_returns_only_an_overflow_sentinel() {
        let html = (0..400)
            .map(|index| {
                format!(
                    "<a href=\"/huds/page/hud-{index}/\">x</a><span>Last updated <strong>Jan 1, 2026</strong></span>"
                )
            })
            .collect::<String>();
        assert_eq!(
            parse_comfig_listing(&html).len(),
            STATS_IDS_PER_PAGE_LIMIT + 1
        );
    }

    #[test]
    fn a_partial_read_is_served_for_an_hour_and_a_whole_one_for_a_day() {
        let whole = HudStatsCache {
            fetched_at: 1_000_000,
            stats: BTreeMap::new(),
            complete: true,
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
        assert_eq!(old.stats["rayshud"].views, Some(3));
        let json = serde_json::to_value(&partial).unwrap();
        assert_eq!(json["complete"], false);
    }

    #[test]
    fn tf2huds_devalue_documents_decode() {
        let list = r#"{"type":"data","nodes":[null,{"type":"data","data":[{"huds":1},[2,5],{"id":3,"name":4},"rayshud","rayshud",{"id":6,"name":7},"-Middle-Mann","Middle Mann"]}]}"#;
        assert_eq!(tf2huds_list_ids(list), vec!["rayshud", "-Middle-Mann"]);
        let hud = r#"{"type":"data","nodes":[{"type":"data","data":[{"hud":1},{"id":2,"viewCount":3,"downloadCount":4,"comfigHudsUrl":5,"updatedDatetime":6},"rayshud",1168295,398380,"https://comfig.app/huds/page/RaysHUD/",["Date","2026-01-25T00:00:00.000Z"]]}]}"#;
        assert_eq!(
            tf2huds_counts(hud),
            Some(("rayshud".to_string(), 398380, 1168295))
        );
        // No comfig link → not a hud-db HUD → skipped.
        let orphan = r#"{"type":"data","nodes":[{"type":"data","data":[{"viewCount":1,"downloadCount":2,"comfigHudsUrl":3},5,6,null]}]}"#;
        assert_eq!(tf2huds_counts(orphan), None);
        assert_eq!(tf2huds_counts("not json"), None);
        assert_eq!(
            comfig_page_id("https://comfig.app.evil.test/huds/page/rayshud/"),
            None
        );
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
        merge_updated(
            &mut stats,
            Ok(Walk {
                found: BTreeMap::from([("new".into(), "2026-01-01".into())]),
                complete: false,
            }),
        );
        merge_counts(&mut stats, Err("offline".into()));
        assert_eq!(stats["old"].updated.as_deref(), Some("2025-01-01"));
        assert_eq!(stats["old"].downloads, Some(10));

        merge_updated(
            &mut stats,
            Ok(Walk {
                found: BTreeMap::from([("new".into(), "2026-02-02".into())]),
                complete: true,
            }),
        );
        assert_eq!(stats["old"].updated, None);
        assert_eq!(stats["old"].downloads, Some(10));
        assert_eq!(stats["new"].updated.as_deref(), Some("2026-02-02"));
    }
}
