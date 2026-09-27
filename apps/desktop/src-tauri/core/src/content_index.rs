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
    let mut index = ContentIndex::default();
    let targets: BTreeSet<String> = targets.iter().map(|path| normalize(path)).collect();
    if targets.is_empty() {
        return index;
    }
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
    for entry in entries {
        if packs.len() >= MAX_TOP_LEVEL {
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
    for entry in packs {
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
        {
            continue;
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
                0,
                &targets,
                &mut loose_entries,
                &mut index,
            );
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
                &|path| targets.contains(&normalize(path)),
                MAX_MATCHES_PER_VPK,
            ) {
                Ok(members) => {
                    for member in members {
                        index.hit(
                            normalize(&member),
                            ContentSource {
                                pack: name.clone(),
                                member,
                                kind: ContentSourceKind::Vpk,
                            },
                        );
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
    depth: usize,
    targets: &BTreeSet<String>,
    entries_seen: &mut usize,
    index: &mut ContentIndex,
) {
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
                depth + 1,
                targets,
                entries_seen,
                index,
            );
        } else if metadata.is_file() && targets.contains(&normalize(&member)) {
            index.hit(
                normalize(&member),
                ContentSource {
                    pack: pack.to_string(),
                    member,
                    kind: ContentSourceKind::Loose,
                },
            );
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::test_temp_dir;

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
