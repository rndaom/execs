//! Read-only expectations for installed custom content, not runtime validation.
use std::collections::{BTreeMap, BTreeSet};
use std::path::Path;

use crate::content_index::{scan_all_custom_paths, ContentIndex, ContentSource, ContentSourceKind};

const MAX_DETAILS: usize = 200;

#[derive(Debug, Default, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PackContent {
    pub pack: String,
    pub files: usize,
    pub restricted_sounds: bool,
    pub sound_scripts: Vec<String>,
    pub exempt_hit_sounds: bool,
    pub models_materials: bool,
    pub particles: bool,
    pub other: bool,
}

#[derive(Debug, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ContentOverlap {
    pub path: String,
    /// Expected first custom mount only; None means order/scan is uncertain.
    pub winner: Option<String>,
    pub packs: Vec<String>,
}

#[derive(Debug, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SplitModel {
    pub model: String,
    pub components: Vec<ContentOverlap>,
}

#[derive(Debug, Default, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ModContentAudit {
    pub packs: Vec<PackContent>,
    pub overlaps: Vec<ContentOverlap>,
    pub split_models: Vec<SplitModel>,
    pub incomplete: Vec<String>,
    pub omitted_details: usize,
}

pub fn audit_custom_content(root: &Path) -> ModContentAudit {
    audit_index(scan_all_custom_paths(root))
}

fn sound_script(path: &str) -> bool {
    matches!(
        path,
        "scripts/game_sounds.txt"
            | "scripts/game_sounds_manifest.txt"
            | "scripts/game_sounds_player.txt"
            | "scripts/game_sounds_vo.txt"
            | "scripts/game_sounds_vo_handmade.txt"
            | "scripts/game_sounds_weapons.txt"
            | "scripts/soundmixers.txt"
    )
}

fn model_stem(path: &str) -> Option<&str> {
    if !path.starts_with("models/") {
        return None;
    }
    [
        ".dx90.vtx",
        ".dx80.vtx",
        ".sw.vtx",
        ".mdl",
        ".phy",
        ".vvd",
        ".vtx",
    ]
    .iter()
    .find_map(|suffix| path.strip_suffix(suffix))
}

fn ordered(path: &str, sources: &[ContentSource], complete: bool) -> ContentOverlap {
    let mut sources: Vec<_> = sources.iter().collect();
    sources.sort_by_key(|source| source.pack.to_ascii_lowercase());
    let mut keys = BTreeSet::new();
    let unambiguous = complete
        && sources.iter().all(|source| {
            source.pack.is_ascii()
                && source.member.is_ascii()
                && keys.insert(source.pack.to_ascii_lowercase())
                && (cfg!(windows) || source.kind == ContentSourceKind::Vpk || source.member == path)
        });
    ContentOverlap {
        path: path.into(),
        winner: unambiguous.then(|| sources[0].pack.clone()),
        packs: sources.iter().map(|source| source.pack.clone()).collect(),
    }
}

fn audit_index(index: ContentIndex) -> ModContentAudit {
    let mut result = ModContentAudit {
        incomplete: index.incomplete,
        ..Default::default()
    };
    let complete = result.incomplete.is_empty();
    let mut packs = BTreeMap::<String, PackContent>::new();
    let mut models = BTreeMap::<String, Vec<ContentOverlap>>::new();
    for (path, sources) in index.hits {
        for source in &sources {
            let pack = packs
                .entry(source.pack.clone())
                .or_insert_with(|| PackContent {
                    pack: source.pack.clone(),
                    ..Default::default()
                });
            pack.files += 1;
            if matches!(
                path.as_str(),
                "sound/ui/hitsound.wav" | "sound/ui/killsound.wav"
            ) {
                pack.exempt_hit_sounds = true;
            } else if path.starts_with("sound/") {
                pack.restricted_sounds = true;
            } else if sound_script(&path) {
                if !pack.sound_scripts.contains(&path) {
                    pack.sound_scripts.push(path.clone());
                }
            } else if path.starts_with("models/") || path.starts_with("materials/") {
                pack.models_materials = true;
            } else if path.starts_with("particles/") {
                pack.particles = true;
            } else {
                pack.other = true;
            }
        }
        if let Some(stem) = model_stem(&path) {
            models
                .entry(stem.into())
                .or_default()
                .push(ordered(&path, &sources, complete));
        }
        if sources.len() > 1 {
            if result.overlaps.len() < MAX_DETAILS {
                result.overlaps.push(ordered(&path, &sources, complete));
            } else {
                result.omitted_details += 1;
            }
        }
    }
    result.packs = packs.into_values().collect();
    for (model, components) in models {
        if !components
            .iter()
            .any(|component| component.path.ends_with(".mdl"))
        {
            continue;
        }
        let owners: BTreeSet<_> = components
            .iter()
            .filter_map(|component| component.winner.as_ref())
            .collect();
        // For an incomplete scan retain a possible split as a warning, never
        // claim a winner from the partial result.
        let candidates: BTreeSet<_> = components
            .iter()
            .flat_map(|component| &component.packs)
            .collect();
        if owners.len() > 1
            || (components
                .iter()
                .any(|component| component.winner.is_none())
                && candidates.len() > 1)
        {
            if result.split_models.len() < MAX_DETAILS {
                result.split_models.push(SplitModel { model, components });
            } else {
                result.omitted_details += 1;
            }
        }
    }
    result
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    fn put(root: &Path, pack: &str, member: &str) {
        let path = root.join("tf/custom").join(pack).join(member);
        fs::create_dir_all(path.parent().unwrap()).unwrap();
        fs::write(path, b"fixture").unwrap();
    }
    #[test]
    fn overlaps_use_source_mount_order_and_model_companions_share_the_stem() {
        let root = crate::test_temp_dir();
        put(&root, "z-model", "models/player/engineer.mdl");
        put(&root, "a-ragdolls", "models/player/engineer.phy");
        put(&root, "z-model", "models/player/engineer.dx90.vtx");
        put(&root, "a-sounds", "sound/ui/buttonclick.wav");
        let bytes = crate::vpk::write_vpk_v1(&BTreeMap::from([(
            "sound/ui/buttonclick.wav".into(),
            b"sound".to_vec(),
        )]));
        fs::write(root.join("tf/custom/Z-hud.vpk"), bytes).unwrap();
        let result = audit_custom_content(&root);
        assert!(result.incomplete.is_empty());
        assert_eq!(result.overlaps[0].winner.as_deref(), Some("a-sounds"));
        assert_eq!(result.split_models[0].components.len(), 3);
        let _ = fs::remove_dir_all(root);
    }
    #[test]
    fn hit_kill_exceptions_and_whole_sound_scripts_are_distinct() {
        let root = crate::test_temp_dir();
        put(&root, "hits", "sound/ui/hitsound.wav");
        put(&root, "hits", "sound/ui/killsound.wav");
        put(&root, "weapons", "sound/weapons/test.wav");
        put(&root, "weapons", "scripts/game_sounds_weapons.txt");
        let result = audit_custom_content(&root);
        assert!(result.packs[0].exempt_hit_sounds);
        assert!(!result.packs[0].restricted_sounds);
        assert!(result.packs[1].restricted_sounds);
        assert_eq!(
            result.packs[1].sound_scripts,
            ["scripts/game_sounds_weapons.txt"]
        );
        let _ = fs::remove_dir_all(root);
    }
    #[test]
    fn broken_scans_and_ambiguous_names_never_claim_a_winner() {
        let sources = [
            ContentSource {
                pack: "A.vpk".into(),
                member: "sound/a.wav".into(),
                kind: ContentSourceKind::Vpk,
            },
            ContentSource {
                pack: "a.VPK".into(),
                member: "sound/a.wav".into(),
                kind: ContentSourceKind::Vpk,
            },
        ];
        assert!(ordered("sound/a.wav", &sources, true).winner.is_none());
        assert!(ordered("sound/a.wav", &sources[..1], false)
            .winner
            .is_none());
        let root = crate::test_temp_dir();
        put(&root, "a", "sound/a.wav");
        put(&root, "b", "sound/a.wav");
        fs::write(root.join("tf/custom/broken.vpk"), b"invalid").unwrap();
        let result = audit_custom_content(&root);
        assert!(!result.incomplete.is_empty());
        assert!(result.overlaps[0].winner.is_none());
        let _ = fs::remove_dir_all(root);
    }
}
