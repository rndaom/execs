//! Read-only candidates for virtual paths supplied by tf/custom packs.
//! This does not model runtime mount precedence, map rules, or sv_pure.

use std::collections::{BTreeMap, BTreeSet};
use std::fs;
use std::path::Path;

use crate::hash::metadata_is_link;
use crate::vpk::list_vpk_member_paths_filtered;

const MAX_TOP_LEVEL: usize = 1024;
const MAX_LOOSE_ENTRIES: usize = 200_000;
const MAX_DEPTH: usize = 16;
const MAX_VPK_PACKS: usize = 256;
const MAX_MATCHES_PER_VPK: usize = 1024;
const MAX_ISSUES: usize = 32;
const MAX_INDEXED_SOURCES: usize = 50_000;
const MAX_INDEXED_PATH_BYTES: usize = 8 * 1024 * 1024;

#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ContentSource {
    /// Name of the top-level directory or VPK under tf/custom.
    pub pack: String,
    /// Case-preserving path inside that pack.
    pub member: String,
    pub kind: ContentSourceKind,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Serialize)]
#[serde(rename_all = "lowercase")]
pub enum ContentSourceKind {
    Loose,
    Vpk,
}

#[derive(Debug, Clone, Default, PartialEq, Eq, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ContentIndex {
    /// Keys are slash-separated, Unicode-lowercased virtual paths.
    pub hits: BTreeMap<String, Vec<ContentSource>>,
    /// A nonempty list means absence from `hits` is not conclusive.
    pub incomplete: Vec<String>,
}

impl ContentIndex {
    fn issue(&mut self, message: String) {
        if self.incomplete.len() < MAX_ISSUES {
            self.incomplete.push(message);
        } else if self.incomplete.len() == MAX_ISSUES {
            self.incomplete
                .push("More custom content could not be inspected.".into());
        }
    }

    fn hit(&mut self, path: String, source: ContentSource) {
        self.hits.entry(path).or_default().push(source);
    }
}

fn normalize(path: &str) -> String {
    path.replace('\\', "/").to_lowercase()
}

/// The same portable comparison key used for installed and incoming members.
pub fn normalize_virtual_path(path: &str) -> String {
    normalize(path)
}

fn split_vpk_directory(name: &str) -> Option<String> {
    let stem = name.to_ascii_lowercase();
    let stem = stem.strip_suffix(".vpk")?;
    let (base, number) = stem.rsplit_once('_')?;
    (number.len() == 3 && number.bytes().all(|byte| byte.is_ascii_digit()))
        .then(|| format!("{base}_dir.vpk"))
}

/// Enumerate exact candidate paths from loose packs and VPK directory trees.
/// No VPK member payload is read. Failures are returned as incomplete scans so
/// callers can refuse a write or explain a tentative read-only result.
pub fn scan_custom_paths(
    tf2_root: &Path,
    targets: &[&str],
    excluded_pack: Option<&str>,
) -> ContentIndex {
    let targets: BTreeSet<String> = targets.iter().map(|path| normalize(path)).collect();
    if targets.is_empty() {
        return ContentIndex::default();
    }
    scan_custom_filtered(
        tf2_root,
        &|path| targets.contains(&normalize(path)),
        excluded_pack,
        MAX_MATCHES_PER_VPK,
    )
}

/// Bounded read-only inventory for diagnostics. This never reads payload bytes.
pub fn scan_all_custom_paths(tf2_root: &Path) -> ContentIndex {
    scan_custom_filtered(tf2_root, &|_| true, None, MAX_INDEXED_SOURCES)
}

#[derive(Default)]
struct IndexBudget {
    sources: usize,
    bytes: usize,
    exhausted: bool,
}

impl IndexBudget {
    fn hit(&mut self, index: &mut ContentIndex, source: ContentSource) -> bool {
        let key = normalize(&source.member);
        let bytes = key
            .len()
            .saturating_add(source.member.len())
            .saturating_add(source.pack.len());
        if self.sources >= MAX_INDEXED_SOURCES
            || self.bytes.saturating_add(bytes) > MAX_INDEXED_PATH_BYTES
        {
            self.exhausted = true;
            index.issue(
                "Custom content exceeds the inspection budget; some files were not inspected."
                    .into(),
            );
            return false;
        }
        self.sources += 1;
        self.bytes += bytes;
        index.hit(key, source);
        true
    }
}

fn scan_custom_filtered(
    tf2_root: &Path,
    keep: &dyn Fn(&str) -> bool,
    excluded_pack: Option<&str>,
    max_vpk_matches: usize,
) -> ContentIndex {
    let mut index = ContentIndex::default();
    let mut budget = IndexBudget::default();
    let custom = tf2_root.join("tf/custom");
    let metadata = match fs::symlink_metadata(&custom) {
        Ok(metadata) => metadata,
        Err(err) if err.kind() == std::io::ErrorKind::NotFound => return index,
        Err(err) => {
            index.issue(format!("Could not inspect tf/custom: {err}"));
            return index;
        }
    };
    if metadata_is_link(&metadata) || !metadata.is_dir() {
        index.issue("tf/custom is not a regular directory.".into());
        return index;
    }
    let entries = match fs::read_dir(&custom) {
        Ok(entries) => entries,
        Err(err) => {
            index.issue(format!("Could not list tf/custom: {err}"));
            return index;
        }
    };
    let mut packs = Vec::new();
    for (count, entry) in entries.enumerate() {
        if count >= MAX_TOP_LEVEL {
            index.issue(format!(
                "tf/custom has more than {MAX_TOP_LEVEL} top-level entries."
            ));
            break;
        }
        match entry {
            Ok(entry) => packs.push(entry),
            Err(err) => index.issue(format!("Could not list a custom pack: {err}")),
        }
    }
    packs.sort_by_key(|entry| entry.file_name());
    let pack_names: BTreeSet<String> = packs
        .iter()
        .filter_map(|entry| entry.file_name().to_str().map(str::to_lowercase))
        .collect();
    let mut loose_entries = 0usize;
    let mut vpk_packs = 0usize;
    'packs: for entry in packs {
        let name = match entry.file_name().to_str() {
            Some(name) => name.to_string(),
            None => {
                index.issue("A custom pack name could not be decoded.".into());
                continue;
            }
        };
        if excluded_pack.is_some_and(|excluded| name.eq_ignore_ascii_case(excluded))
            || name.eq_ignore_ascii_case("workshop")
            || name.eq_ignore_ascii_case("readme.txt")
            || name.to_ascii_lowercase().ends_with(".execs-part")
            || name.starts_with('.')
            || name.eq_ignore_ascii_case(crate::surface::HUD_BACKUP_CONTAINER)
        {
            continue;
        }
        if matches!(
            name.to_ascii_lowercase().as_str(),
            "materials" | "maps" | "resource" | "scripts" | "sound" | "models"
        ) {
            index.issue(format!("{name} is not a valid outer custom pack name; TF2 may refuse to mount custom content."));
        }
        let metadata = match fs::symlink_metadata(entry.path()) {
            Ok(metadata) => metadata,
            Err(err) => {
                index.issue(format!("Could not inspect {name}: {err}"));
                continue;
            }
        };
        if metadata_is_link(&metadata) {
            index.issue(format!("{name} is a linked pack and was not inspected."));
            continue;
        }
        if metadata.is_dir() {
            scan_loose_pack(
                &entry.path(),
                &name,
                "",
                keep,
                &mut loose_entries,
                &mut budget,
                &mut index,
            );
            if budget.exhausted {
                break;
            }
        } else if metadata.is_file() && name.to_ascii_lowercase().ends_with(".vpk") {
            // Numbered archive shards have no tree of their own. The sibling
            // `_dir.vpk` is the mount root and contains their virtual paths.
            if split_vpk_directory(&name).is_some_and(|dir| pack_names.contains(&dir)) {
                continue;
            }
            if vpk_packs >= MAX_VPK_PACKS {
                index.issue(format!(
                    "More than {MAX_VPK_PACKS} custom VPKs are installed."
                ));
                break;
            }
            vpk_packs += 1;
            match list_vpk_member_paths_filtered(
                &entry.path(),
                keep,
                max_vpk_matches.min(MAX_INDEXED_SOURCES - budget.sources),
            ) {
                Ok(members) => {
                    for member in members {
                        if !budget.hit(
                            &mut index,
                            ContentSource {
                                pack: name.clone(),
                                member,
                                kind: ContentSourceKind::Vpk,
                            },
                        ) {
                            break 'packs;
                        }
                    }
                }
                Err(err) => index.issue(format!("Could not inspect {name}: {}", err.message())),
            }
        }
    }
    for sources in index.hits.values_mut() {
        sources.sort_by(|a, b| a.pack.cmp(&b.pack).then(a.member.cmp(&b.member)));
    }
    index
}

fn scan_loose_pack(
    directory: &Path,
    pack: &str,
    parent: &str,
    keep: &dyn Fn(&str) -> bool,
    entries_seen: &mut usize,
    budget: &mut IndexBudget,
    index: &mut ContentIndex,
) {
    let depth = if parent.is_empty() {
        0
    } else {
        parent.bytes().filter(|byte| *byte == b'/').count() + 1
    };
    if depth >= MAX_DEPTH {
        index.issue(format!(
            "{pack} has content deeper than {MAX_DEPTH} directories."
        ));
        return;
    }
    let entries = match fs::read_dir(directory) {
        Ok(entries) => entries,
        Err(err) => {
            index.issue(format!("Could not list {pack}/{parent}: {err}"));
            return;
        }
    };
    for entry in entries {
        if budget.exhausted {
            return;
        }
        if *entries_seen >= MAX_LOOSE_ENTRIES {
            index.issue(format!(
                "Custom loose content exceeds {MAX_LOOSE_ENTRIES} entries."
            ));
            return;
        }
        *entries_seen += 1;
        let entry = match entry {
            Ok(entry) => entry,
            Err(err) => {
                index.issue(format!("Could not list a file in {pack}/{parent}: {err}"));
                continue;
            }
        };
        let name = match entry.file_name().to_str() {
            Some(name) => name.to_string(),
            None => {
                index.issue(format!(
                    "A file name in {pack}/{parent} could not be decoded."
                ));
                continue;
            }
        };
        let member = if parent.is_empty() {
            name
        } else {
            format!("{parent}/{name}")
        };
        let metadata = match fs::symlink_metadata(entry.path()) {
            Ok(metadata) => metadata,
            Err(err) => {
                index.issue(format!("Could not inspect {pack}/{member}: {err}"));
                continue;
            }
        };
        if metadata_is_link(&metadata) {
            index.issue(format!("{pack}/{member} is linked and was not inspected."));
        } else if metadata.is_dir() {
            scan_loose_pack(
                &entry.path(),
                pack,
                &member,
                keep,
                entries_seen,
                budget,
                index,
            );
        } else if metadata.is_file()
            && keep(&member)
            && !budget.hit(
                index,
                ContentSource {
                    pack: pack.to_string(),
                    member,
                    kind: ContentSourceKind::Loose,
                },
            )
        {
            return;
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::test_temp_dir;

    #[test]
    fn shared_budget_counts_duplicate_sources_and_path_bytes() {
        let mut index = ContentIndex::default();
        let source = ContentSource {
            pack: "pack".into(),
            member: "sound/a.wav".into(),
            kind: ContentSourceKind::Loose,
        };
        let mut budget = IndexBudget {
            sources: MAX_INDEXED_SOURCES - 1,
            ..Default::default()
        };
        assert!(budget.hit(&mut index, source.clone()));
        assert!(!budget.hit(&mut index, source.clone()));
        assert!(budget.exhausted);
        assert_eq!(index.hits["sound/a.wav"].len(), 1);
        assert!(!index.incomplete.is_empty());
        let mut budget = IndexBudget {
            bytes: MAX_INDEXED_PATH_BYTES - 1,
            ..Default::default()
        };
        assert!(!budget.hit(&mut index, source));
    }

    #[test]
    fn full_scan_excludes_unmounted_hidden_packs_and_hud_backups() {
        let root = test_temp_dir();
        for pack in [".hidden", crate::surface::HUD_BACKUP_CONTAINER, "visible"] {
            let directory = root.join("tf/custom").join(pack).join("sound");
            fs::create_dir_all(&directory).unwrap();
            fs::write(directory.join("test.wav"), b"sound").unwrap();
        }
        let index = scan_all_custom_paths(&root);
        assert!(index.incomplete.is_empty());
        assert_eq!(index.hits["sound/test.wav"].len(), 1);
        assert_eq!(index.hits["sound/test.wav"][0].pack, "visible");
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn all_vpks_share_one_source_budget_even_for_duplicate_paths() {
        let root = test_temp_dir();
        let custom = root.join("tf/custom");
        fs::create_dir_all(&custom).unwrap();
        let files = (0..18_000)
            .map(|number| (format!("materials/{number:05}.vmt"), vec![]))
            .collect();
        let bytes = crate::vpk::write_vpk_v1(&files);
        for name in ["a.vpk", "b.vpk", "c.vpk"] {
            fs::write(custom.join(name), &bytes).unwrap();
        }
        let index = scan_all_custom_paths(&root);
        let sources: usize = index.hits.values().map(Vec::len).sum();
        assert_eq!(sources, 36_000);
        assert!(!index.incomplete.is_empty());
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn indexes_case_insensitive_loose_and_vpk_members_without_reading_payloads() {
        let root = test_temp_dir();
        let custom = root.join("tf/custom");
        fs::create_dir_all(custom.join("Loose/Scripts")).unwrap();
        fs::write(custom.join("Loose/Scripts/TF_WEAPON_BAT.TXT"), b"loose").unwrap();
        let vpk = crate::vpk::write_vpk_v1(&BTreeMap::from([(
            "scripts/tf_weapon_bat.txt".into(),
            b"vpk".to_vec(),
        )]));
        fs::write(custom.join("Other.vpk"), vpk).unwrap();
        let index = scan_custom_paths(&root, &["SCRIPTS\\tf_weapon_bat.txt"], None);
        assert!(index.incomplete.is_empty(), "{:?}", index.incomplete);
        let sources = &index.hits["scripts/tf_weapon_bat.txt"];
        assert_eq!(sources.len(), 2);
        assert_eq!(sources[0].pack, "Loose");
        assert_eq!(sources[0].member, "Scripts/TF_WEAPON_BAT.TXT");
        assert_eq!(sources[1].pack, "Other.vpk");
        assert_eq!(sources[1].kind, ContentSourceKind::Vpk);
        let excluded = scan_custom_paths(&root, &["scripts/tf_weapon_bat.txt"], Some("loose"));
        assert_eq!(excluded.hits["scripts/tf_weapon_bat.txt"].len(), 1);
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn malformed_vpk_makes_absence_inconclusive() {
        let root = test_temp_dir();
        let custom = root.join("tf/custom");
        fs::create_dir_all(&custom).unwrap();
        fs::write(custom.join("broken.vpk"), b"not a VPK").unwrap();
        let index = scan_custom_paths(&root, &["sound/ui/hitsound.wav"], None);
        assert!(index.hits.is_empty());
        assert!(index
            .incomplete
            .iter()
            .any(|issue| issue.contains("broken.vpk")));
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn split_vpk_shards_are_read_through_the_directory_tree() {
        let root = test_temp_dir();
        let custom = root.join("tf/custom");
        fs::create_dir_all(&custom).unwrap();
        let vpk = crate::vpk::write_vpk_v1(&BTreeMap::from([(
            "sound/ui/hitsound.wav".into(),
            b"payload".to_vec(),
        )]));
        fs::write(custom.join("soundmod_dir.vpk"), vpk).unwrap();
        fs::write(custom.join("soundmod_000.vpk"), b"archive payload shard").unwrap();
        let index = scan_custom_paths(&root, &["sound/ui/hitsound.wav"], None);
        assert!(index.incomplete.is_empty(), "{:?}", index.incomplete);
        assert_eq!(
            index.hits["sound/ui/hitsound.wav"][0].pack,
            "soundmod_dir.vpk"
        );
        let _ = fs::remove_dir_all(root);
    }
}
