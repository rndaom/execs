//! Popularity and recency for the HUD catalog, from the two places that
//! actually publish them. hud-db itself carries neither: comfig.app bakes a
//! "Last updated" date into its listing pages (all listed HUDs, newest
//! first), and tf2huds.dev exposes per-HUD download and view counts through
//! its SvelteKit data endpoint (about 170 HUDs). Both are read once a day and
//! cached; a HUD absent from either simply has no number.

use std::collections::BTreeMap;
use std::path::PathBuf;
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

use execs_core::catalog_cache_dir;
use serde::{Deserialize, Serialize};

use crate::net;

const COMFIG_LIST_BASE: &str = "https://comfig.app/huds";
/// comfig.app lists twelve HUDs per page; 20 pages today, so 40 is a wide
/// ceiling that still stops the walk if the site ever loops.
const COMFIG_MAX_PAGES: usize = 40;
const TF2HUDS_BASE: &str = "https://tf2huds.dev";
const TF2HUDS_MAX_PAGES: usize = 40;
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

fn cache_file() -> PathBuf {
    catalog_cache_dir().join("stats-v1.json")
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
    let cached = std::fs::read_to_string(cache_file())
        .ok()
        .and_then(|text| serde_json::from_str::<HudStatsCache>(&text).ok());
    if !refresh {
        if let Some(cache) = &cached {
            if cache.is_fresh(now_secs()) {
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
    let (updated, counts) = match (updated, counts) {
        (Err(err), Err(_)) => {
            if let Some(cache) = cached {
                return Ok(cache.stats);
            }
            return Err(err);
        }
        (updated, counts) => (
            updated.map(|walk| walk.found).unwrap_or_default(),
            counts.map(|walk| walk.found).unwrap_or_default(),
        ),
    };
    let mut stats: BTreeMap<String, HudStat> = BTreeMap::new();
    for (id, date) in updated {
        stats.entry(id).or_default().updated = Some(date);
    }
    for (id, (downloads, views)) in counts {
        let stat = stats.entry(id).or_default();
        stat.downloads = Some(downloads);
        stat.views = Some(views);
    }
    // Only a refresh that read both sources to the end earns a day of TTL:
    // caching a walk the deadline cut short, or one whose source was down,
    // for that long would hold half the numbers back until tomorrow. It is
    // still cached for an hour, so a dead source costs one walk per hour
    // rather than one per pane load.
    let cache = HudStatsCache {
        fetched_at: now_secs(),
        stats: stats.clone(),
        complete,
    };
    if let Ok(text) = serde_json::to_string(&cache) {
        let _ = execs_core::hash::write_atomic(&cache_file(), text.as_bytes());
    }
    Ok(stats)
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
    for page in 1..=COMFIG_MAX_PAGES {
        if Instant::now() >= deadline {
            complete = false;
            break;
        }
        let url = format!("{COMFIG_LIST_BASE}/{page}/");
        let html = match net::get_text(client, &url) {
            Ok(html) => html,
            // The first page failing is an outage; a later one is the end.
            Err(err) if page == 1 => return Err(err),
            Err(_) => break,
        };
        let found = parse_comfig_listing(&html);
        if found.is_empty() {
            break;
        }
        out.extend(found);
    }
    // Pages that parse to nothing mean the listing's markup moved, not that
    // comfig.app has no dates. Failing keeps that out of the cache.
    if out.is_empty() {
        return Err("comfig.app listed no HUD update dates.".to_string());
    }
    Ok(Walk {
        found: out,
        complete,
    })
}

/// Pairs of (id, ISO date) from one listing page. Each card carries
/// `href="/huds/page/<id>/"` followed by `Last updated <strong>Mon D, YYYY</strong>`.
pub fn parse_comfig_listing(html: &str) -> Vec<(String, String)> {
    let mut out = Vec::new();
    let mut rest = html;
    while let Some(start) = rest.find("href=\"/huds/page/") {
        let after = &rest[start + "href=\"/huds/page/".len()..];
        let Some(end) = after.find('/') else { break };
        let id = after[..end].to_string();
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
            if !id.is_empty() && !out.iter().any(|(seen, _)| seen == &id) {
                out.push((id, date));
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
    #[serde(default)]
    nodes: Vec<Option<SvelteNode>>,
}

#[derive(Debug, Deserialize)]
struct SvelteNode {
    #[serde(default)]
    data: Vec<serde_json::Value>,
}

fn fetch_tf2huds_counts(
    client: &reqwest::blocking::Client,
    deadline: Instant,
) -> Result<Walk<Counts>, String> {
    // 1. The listing pages give the site's own ids.
    let mut ids: Vec<String> = Vec::new();
    let mut complete = true;
    for page in 1..=TF2HUDS_MAX_PAGES {
        if Instant::now() >= deadline {
            complete = false;
            break;
        }
        let url = format!("{TF2HUDS_BASE}/huds/__data.json?page={page}");
        let text = match net::get_text(client, &url) {
            Ok(text) => text,
            Err(err) if page == 1 => return Err(err),
            Err(_) => break,
        };
        let found = tf2huds_list_ids(&text);
        if found.is_empty() {
            break;
        }
        let before = ids.len();
        for id in found {
            if !ids.contains(&id) {
                ids.push(id);
            }
        }
        if ids.len() == before {
            break;
        }
    }
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
                        if let Ok(text) = net::get_text(&client, &url) {
                            if let Some(entry) = tf2huds_counts(&text) {
                                found.push(entry);
                            }
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
        complete: complete && walked_all,
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
    for data in devalue_nodes(text) {
        for value in &data {
            let Some(object) = value.as_object() else {
                continue;
            };
            if !object.contains_key("name") {
                continue;
            }
            if let Some(serde_json::Value::String(id)) = devalue_lookup(&data, object, "id") {
                if !id.is_empty() && !ids.contains(id) {
                    ids.push(id.clone());
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
    let rest = url.split("/huds/page/").nth(1)?;
    let id = rest
        .split(['/', '?', '#'])
        .next()?
        .trim()
        .to_ascii_lowercase();
    if id.is_empty() {
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
    }
}
