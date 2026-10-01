//! Read-only, bounded choices for archives and folders. Payloads never cross IPC.
use std::collections::{BTreeMap, BTreeSet};
use std::path::Path;

use serde::Serialize;

use crate::archive::{extract_archive, read_dir_entries, ArchiveLimits};
use crate::hash::sha256_hex;
use crate::mods::{ModBatchBudget, ModContent, MAX_MOD_BYTES, MOD_CONTENT_ROOTS};
use crate::profile::ProfileError;

const LIMITS: ArchiveLimits = ArchiveLimits::new(20_000, MAX_MOD_BYTES, MAX_MOD_BYTES);
const MAX_CHOICES: usize = 256;
const MAX_READMES: usize = 8;
const MAX_README_BYTES: usize = 16 * 1024;
const SPLIT_VPK: &str = "This VPK is split into several files, which execs can't install yet.";
const SPLIT_VPK_PIECE: &str = "This is one piece of a split VPK, which execs can't install yet.";
const VPK_SIGNATURE: [u8; 4] = [0x34, 0x12, 0xaa, 0x55];

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ModImportChoice {
    pub id: String,
    pub name: String,
    pub path: String,
    pub files: usize,
    pub bytes: u64,
    pub content_roots: Vec<String>,
    pub disabled_reason: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ModImportReadme {
    pub path: String,
    pub text: String,
    pub truncated: bool,
}

#[derive(Debug)]
pub struct PreparedModImport {
    pub choices: Vec<ModImportChoice>,
    pub readmes: Vec<ModImportReadme>,
    pub fingerprint: String,
    payloads: Vec<Option<ModContent>>,
}

impl PreparedModImport {
    pub fn from_archive_file(path: &Path) -> Result<Self, ProfileError> {
        let bytes = crate::archive::read_regular_file_bounded(path, MAX_MOD_BYTES)?
            .ok_or_else(|| ProfileError::Io(crate::mods::oversized_mod_message(file_len(path))))?;
        Self::from_archive(
            &path.file_name().unwrap_or_default().to_string_lossy(),
            &bytes,
        )
    }

    pub fn from_archive(name: &str, bytes: &[u8]) -> Result<Self, ProfileError> {
        let mut prepared = Self::from_entries(name, extract_archive(bytes, LIMITS)?)?;
        prepared.fingerprint = sha256_hex(bytes);
        Ok(prepared)
    }

    pub fn from_folder(path: &Path) -> Result<Self, ProfileError> {
        let name = path.file_name().unwrap_or_default().to_string_lossy();
        Self::from_entries(&name, read_dir_entries(path, LIMITS)?)
    }

    pub fn from_vpk(name: &str, bytes: Vec<u8>) -> Result<Self, ProfileError> {
        let fingerprint = sha256_hex(&bytes);
        let mut prepared = Self::from_entries(name, vec![(name.into(), bytes)])?;
        prepared.fingerprint = fingerprint;
        Ok(prepared)
    }

    pub fn from_vpk_file(path: &Path) -> Result<Self, ProfileError> {
        let bytes = crate::archive::read_regular_file_bounded(path, MAX_MOD_BYTES)?
            .ok_or_else(|| ProfileError::Io(crate::mods::oversized_mod_message(file_len(path))))?;
        let name = path.file_name().unwrap_or_default().to_string_lossy();
        Self::from_vpk(&name, bytes)
    }

    fn from_entries(name: &str, mut entries: Vec<(String, Vec<u8>)>) -> Result<Self, ProfileError> {
        entries.sort_by(|a, b| a.0.cmp(&b.0));
        // Include membership, exact paths and exact bytes, independently of directory order.
        let mut identity = Vec::new();
        for (path, bytes) in &entries {
            identity.extend_from_slice(&(path.len() as u64).to_le_bytes());
            identity.extend_from_slice(path.as_bytes());
            identity.extend_from_slice(sha256_hex(bytes).as_bytes());
        }
        let fingerprint = sha256_hex(&identity);
        let mut roots = BTreeMap::<String, String>::new();
        let names: BTreeSet<String> = entries
            .iter()
            .map(|(p, _)| p.to_ascii_lowercase())
            .collect();
        for (path, _) in &entries {
            if is_vpk(path) || split_archive(path) {
                continue;
            }
            let parts: Vec<_> = path.split('/').collect();
            if let Some(depth) = parts[..parts.len().saturating_sub(1)]
                .iter()
                .position(|part| MOD_CONTENT_ROOTS.contains(&part.to_ascii_lowercase().as_str()))
            {
                let root = parts[..depth].join("/");
                if roots
                    .insert(root.to_ascii_lowercase(), root.clone())
                    .is_some_and(|old| old != root)
                {
                    return Err(ProfileError::Io(
                        "These content folders have names that collide on Windows.".into(),
                    ));
                }
            }
        }
        let mut trees: BTreeMap<String, Vec<(String, Vec<u8>)>> =
            roots.values().map(|r| (r.clone(), Vec::new())).collect();
        let map_files = loose_map_files(&entries, &roots);
        let mut map_trees: BTreeMap<String, Vec<(String, Vec<u8>)>> = BTreeMap::new();
        let mut packs = Vec::new();
        let mut disabled_metadata = BTreeMap::new();
        let mut readmes = Vec::new();
        for (path, bytes) in entries {
            if is_readme(&path) && readmes.len() < MAX_READMES {
                let shown = &bytes[..bytes.len().min(MAX_README_BYTES)];
                readmes.push(ModImportReadme {
                    path: path.clone(),
                    text: String::from_utf8_lossy(shown).into_owned(),
                    truncated: bytes.len() > shown.len(),
                });
            }
            if let Some((group, rel)) = map_files.get(&path) {
                match group {
                    MapGroup::Root(root) => trees.get_mut(root).expect("known root"),
                    MapGroup::Map(bsp) => map_trees.entry(bsp.clone()).or_default(),
                }
                .push((rel.clone(), bytes));
            } else if is_vpk(&path) && vpk_chunk(&path) && !bytes.starts_with(&VPK_SIGNATURE) {
                // A numbered data file of a split set: a choice to show, never
                // a reason to refuse the rest of the archive.
                disabled_metadata.insert(path.clone(), (1, bytes.len() as u64));
                packs.push((
                    path.clone(),
                    vpk_label(&path),
                    None,
                    Some(SPLIT_VPK_PIECE.into()),
                ));
            } else if is_vpk(&path) {
                let disabled = split_vpk(&path, &names).then(|| SPLIT_VPK.to_string());
                if disabled.is_some() {
                    disabled_metadata.insert(path.clone(), (1, bytes.len() as u64));
                }
                let content = if disabled.is_none() || bytes.starts_with(&VPK_SIGNATURE) {
                    Some(ModContent::Vpk(bytes))
                } else {
                    None
                };
                packs.push((path.clone(), vpk_label(&path), content, disabled));
            } else if split_archive(&path) {
                disabled_metadata.insert(path.clone(), (1, bytes.len() as u64));
                packs.push((path.clone(), path.clone(), None, Some("Split archive volumes cannot be installed. Extract the complete archive first.".into())));
            } else if let Some(root) = roots
                .values()
                .filter(|root| root.is_empty() || path.starts_with(&format!("{root}/")))
                .max_by_key(|r| r.len())
            {
                let rel = if root.is_empty() {
                    path
                } else {
                    path[root.len() + 1..].to_string()
                };
                trees.get_mut(root).expect("known root").push((rel, bytes));
            }
        }
        for (root, files) in trees {
            let label = if root.is_empty() {
                archive_label(name)
            } else {
                root.clone()
            };
            packs.push((
                if root.is_empty() { ".".into() } else { root },
                label,
                Some(ModContent::Tree(files)),
                None,
            ));
        }
        for (bsp, files) in map_trees {
            let label = file_stem(&bsp).to_string();
            packs.push((bsp, label, Some(ModContent::Tree(files)), None));
        }
        packs.sort_by(|a, b| a.0.cmp(&b.0));
        if packs.is_empty() {
            if names.iter().any(|path| path.ends_with(".vmf")) {
                return Err(ProfileError::Io(
                    "This archive has only Hammer source files (.vmf), not a playable map (.bsp)."
                        .into(),
                ));
            }
            return Err(ProfileError::Io(
                "This selection has no TF2 content or VPKs.".into(),
            ));
        }
        if packs.len() > MAX_CHOICES {
            return Err(ProfileError::Io(format!(
                "This selection contains more than {MAX_CHOICES} mod choices."
            )));
        }
        let mut choices = Vec::new();
        let mut payloads = Vec::new();
        let mut budget = ModBatchBudget::default();
        for (index, (path, name, mut content, mut disabled_reason)) in packs.into_iter().enumerate()
        {
            let mut content_roots = BTreeSet::new();
            let (files, bytes) = match &content {
                Some(ModContent::Tree(entries)) => {
                    for (rel, _) in entries {
                        if let Some((root, _)) = rel.split_once('/') {
                            content_roots.insert(root.to_string());
                        }
                    }
                    (
                        entries.len(),
                        entries.iter().map(|(_, b)| b.len() as u64).sum(),
                    )
                }
                Some(ModContent::Vpk(bytes)) => {
                    match crate::vpk::review_vpk_dir_bytes(bytes, &mut |path| {
                        if let Some((root, _)) = path.split_once('/') {
                            content_roots.insert(root.to_string());
                        }
                        Ok(())
                    }) {
                        Ok((summary, external)) => {
                            if external {
                                disabled_reason = Some(SPLIT_VPK.into());
                            }
                            (summary.files, bytes.len() as u64)
                        }
                        // One unreadable VPK greys out that choice only.
                        Err(err) => {
                            content_roots.clear();
                            disabled_reason = Some(format!(
                                "execs can't read this VPK: {}",
                                err.message().trim_end_matches('.')
                            ));
                            (0, bytes.len() as u64)
                        }
                    }
                }
                None => disabled_metadata[&path],
            };
            if disabled_reason.is_some() {
                content = None;
            }
            if let Some(content) = &content {
                budget.add(content)?;
            }
            choices.push(ModImportChoice {
                id: index.to_string(),
                name,
                path,
                files,
                bytes,
                content_roots: content_roots.into_iter().collect(),
                disabled_reason,
            });
            payloads.push(content);
        }
        Ok(Self {
            choices,
            readmes,
            fingerprint,
            payloads,
        })
    }

    /// A download with one installable choice installs under the mod's own
    /// title, not a wrapper folder such as `team fortress 2/tf`.
    pub fn name_single_choice(&mut self, title: &str) {
        if let [only] = self.choices.as_mut_slice() {
            only.name = title.to_string();
        }
    }

    /// IDs only select native-owned payloads. Validate the entire batch before returning any bytes.
    pub fn select(mut self, ids: &[String]) -> Result<Vec<(String, ModContent)>, ProfileError> {
        if ids.is_empty() || ids.len() > self.choices.len() {
            return Err(ProfileError::Io(
                "Select at least one available mod choice.".into(),
            ));
        }
        let mut seen = BTreeSet::new();
        let mut selected = Vec::new();
        let mut budget = ModBatchBudget::default();
        for id in ids {
            if !seen.insert(id) {
                return Err(ProfileError::Io(
                    "A mod choice was selected more than once.".into(),
                ));
            }
            let index = self
                .choices
                .iter()
                .position(|choice| &choice.id == id)
                .ok_or_else(|| {
                    ProfileError::Io("That mod choice is no longer available.".into())
                })?;
            let content = self.payloads[index]
                .take()
                .ok_or_else(|| ProfileError::Io("That split set cannot be installed.".into()))?;
            budget.add(&content)?;
            selected.push((self.choices[index].name.clone(), content));
        }
        Ok(selected)
    }
}

fn is_vpk(path: &str) -> bool {
    path.to_ascii_lowercase().ends_with(".vpk")
}
enum MapGroup {
    /// The map sits beside content folders and joins that pack.
    Root(String),
    /// A map of its own, keyed by its `.bsp` path.
    Map(String),
}

/// An archive's file name without its extension, as a pack label.
fn archive_label(name: &str) -> String {
    let lower = name.to_ascii_lowercase();
    [".zip", ".7z", ".rar"]
        .iter()
        .find(|ext| lower.ends_with(*ext))
        .map_or(name, |ext| &name[..name.len() - ext.len()])
        .to_string()
}

fn file_name(path: &str) -> &str {
    path.rsplit('/').next().unwrap_or(path)
}

fn file_stem(path: &str) -> &str {
    let name = file_name(path);
    name.rsplit_once('.').map_or(name, |(stem, _)| stem)
}

fn parent(path: &str) -> &str {
    path.rsplit_once('/').map_or("", |(dir, _)| dir)
}

/// Maps are uploaded as a bare `.bsp`; TF2 loads them from a pack's `maps`
/// folder. A `.bsp` outside any content folder takes along the files beside it
/// named after it (`.nav` bot navigation, `<map>_particles.txt`,
/// `<map>_level_sounds.txt`) into `maps`, and MvM missions named after it
/// (`<map>_<mission>.pop`) into `scripts/population`. Returns each moved entry's
/// group and its path inside the pack.
fn loose_map_files(
    entries: &[(String, Vec<u8>)],
    roots: &BTreeMap<String, String>,
) -> BTreeMap<String, (MapGroup, String)> {
    let in_content_root = |path: &str| {
        parent(path)
            .split('/')
            .any(|part| MOD_CONTENT_ROOTS.contains(&part.to_ascii_lowercase().as_str()))
    };
    let mut moved = BTreeMap::new();
    for (bsp, _) in entries {
        if !bsp.to_ascii_lowercase().ends_with(".bsp") || in_content_root(bsp) {
            continue;
        }
        let dir = parent(bsp);
        let stem = file_stem(bsp).to_ascii_lowercase();
        let group = || match roots.values().find(|root| root.as_str() == dir) {
            Some(root) => MapGroup::Root(root.clone()),
            None => MapGroup::Map(bsp.clone()),
        };
        for (path, _) in entries {
            if parent(path) != dir || moved.contains_key(path) {
                continue;
            }
            let name = file_name(path);
            let lower = name.to_ascii_lowercase();
            let target = if path == bsp
                || lower == format!("{stem}.nav")
                || (lower.starts_with(&format!("{stem}_")) && lower.ends_with(".txt"))
            {
                format!("maps/{name}")
            } else if lower.starts_with(&format!("{stem}_")) && lower.ends_with(".pop") {
                format!("scripts/population/{name}")
            } else {
                continue;
            };
            moved.insert(path.clone(), (group(), target));
        }
    }
    moved
}

/// `name_000.vpk`: a numbered data file of a split VPK set.
fn vpk_chunk(path: &str) -> bool {
    let lower = path.to_ascii_lowercase();
    lower
        .strip_suffix(".vpk")
        .and_then(|stem| stem.rsplit_once('_'))
        .is_some_and(|(_, tail)| tail.len() == 3 && tail.bytes().all(|c| c.is_ascii_digit()))
}
fn vpk_label(path: &str) -> String {
    let file = path.rsplit('/').next().unwrap_or(path);
    file.strip_suffix(".vpk")
        .or_else(|| file.strip_suffix(".VPK"))
        .unwrap_or(file)
        .to_string()
}
fn split_archive(path: &str) -> bool {
    let lower = path.to_ascii_lowercase();
    let ext = lower.rsplit('.').next().unwrap_or_default();
    (ext.len() == 3 && ext.bytes().all(|c| c.is_ascii_digit()))
        || (ext.len() == 3 && ext.starts_with('z') && ext[1..].bytes().all(|c| c.is_ascii_digit()))
}
fn split_vpk(path: &str, names: &BTreeSet<String>) -> bool {
    let lower = path.to_ascii_lowercase();
    if let Some(prefix) = lower.strip_suffix("_dir.vpk") {
        return names.iter().any(|name| {
            name.strip_prefix(&format!("{prefix}_"))
                .and_then(|tail| tail.strip_suffix(".vpk"))
                .is_some_and(|tail| tail.len() == 3 && tail.bytes().all(|c| c.is_ascii_digit()))
        });
    }
    lower
        .strip_suffix(".vpk")
        .and_then(|stem| stem.rsplit_once('_'))
        .is_some_and(|(prefix, number)| {
            number.len() == 3
                && number.bytes().all(|c| c.is_ascii_digit())
                && names.contains(&format!("{prefix}_dir.vpk"))
        })
}
fn file_len(path: &Path) -> Option<u64> {
    std::fs::metadata(path).ok().map(|meta| meta.len())
}

fn is_readme(path: &str) -> bool {
    let name = path.rsplit('/').next().unwrap_or(path).to_ascii_lowercase();
    (name.ends_with(".txt") || name.ends_with(".md"))
        && (name.contains("readme")
            || name.contains("read me")
            || name.contains("instruction")
            || name.contains("install"))
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::{Cursor, Write};

    fn vpk() -> Vec<u8> {
        crate::vpk::write_vpk_v1(&BTreeMap::from([
            ("materials/example.vmt".into(), b"material".to_vec()),
            ("models/example.mdl".into(), b"model".to_vec()),
        ]))
    }

    fn zip(entries: &[(&str, Vec<u8>)]) -> Vec<u8> {
        let mut out = zip::ZipWriter::new(Cursor::new(Vec::new()));
        for (path, bytes) in entries {
            out.start_file(*path, zip::write::SimpleFileOptions::default())
                .unwrap();
            out.write_all(bytes).unwrap();
        }
        out.finish().unwrap().into_inner()
    }

    #[test]
    fn multiple_vpks_show_members_roots_and_exact_payloads() {
        let bytes = vpk();
        let archive = zip(&[
            ("red/red.vpk", bytes.clone()),
            ("blue/blue.vpk", bytes.clone()),
        ]);
        let prepared = PreparedModImport::from_archive("colours.zip", &archive).unwrap();
        assert_eq!(prepared.fingerprint, sha256_hex(&archive));
        assert_eq!(prepared.choices.len(), 2);
        assert_eq!(prepared.choices[0].path, "blue/blue.vpk");
        assert_eq!(prepared.choices[0].files, 2);
        assert_eq!(prepared.choices[0].bytes, bytes.len() as u64);
        assert_eq!(prepared.choices[0].content_roots, ["materials", "models"]);
        let packs = prepared.select(&["1".into()]).unwrap();
        assert_eq!(packs, vec![("red".into(), ModContent::Vpk(bytes))]);
    }

    #[test]
    fn mixed_vpk_peer_and_nested_loose_roots_never_duplicate_bytes() {
        let prepared = PreparedModImport::from_entries(
            "options",
            vec![
                ("materials/base.vmt".into(), vec![1]),
                ("optional/materials/red.vmt".into(), vec![2]),
                ("optional/deeper/sound/red.wav".into(), vec![3]),
                ("blue/models/blue.mdl".into(), vec![4]),
                ("packed.vpk".into(), vpk()),
                (
                    "README.md".into(),
                    b"Pick one colour, then optional sound.".to_vec(),
                ),
            ],
        )
        .unwrap();
        assert_eq!(
            prepared
                .choices
                .iter()
                .map(|c| c.path.as_str())
                .collect::<Vec<_>>(),
            [".", "blue", "optional", "optional/deeper", "packed.vpk"]
        );
        assert_eq!(prepared.readmes.len(), 1);
        let packs = prepared
            .select(&["0".into(), "1".into(), "2".into(), "3".into(), "4".into()])
            .unwrap();
        let loose: Vec<_> = packs
            .into_iter()
            .flat_map(|(_, content)| match content {
                ModContent::Tree(files) => files,
                _ => Vec::new(),
            })
            .collect();
        assert_eq!(loose.len(), 5);
        for value in 1..=4 {
            assert_eq!(
                loose
                    .iter()
                    .filter(|(_, bytes)| bytes == &vec![value])
                    .count(),
                1
            );
        }
        assert!(loose
            .iter()
            .all(|(path, _)| !path.starts_with("optional/") && !path.starts_with("blue/")));
    }

    #[test]
    fn split_sets_remain_visible_with_sizes_and_cannot_be_selected() {
        let prepared = PreparedModImport::from_entries(
            "split",
            vec![
                ("large_dir.vpk".into(), vec![1, 2]),
                ("large_000.vpk".into(), vec![3, 4, 5]),
                ("archive.zip.001".into(), vec![6]),
                ("archive.z01".into(), vec![7]),
                ("plain.vpk".into(), vpk()),
            ],
        )
        .unwrap();
        assert_eq!(
            prepared
                .choices
                .iter()
                .filter(|c| c.disabled_reason.is_some())
                .count(),
            4
        );
        assert!(prepared.choices.iter().all(|c| c.bytes > 0 && c.files > 0));
        assert!(prepared.select(&["0".into()]).is_err());
    }

    #[test]
    fn an_unreadable_or_split_vpk_greys_out_only_that_choice() {
        // Real GameBanana uploads: a leftover `_000.vpk` beside a complete VPK,
        // and a VPK whose data runs past its end, used to fail the whole import.
        let prepared = PreparedModImport::from_entries(
            "pack",
            vec![
                ("oldschool mod v3.vpk".into(), vpk()),
                ("oldschool_pack_000.vpk".into(), vec![1, 2, 3]),
                ("broken.vpk".into(), vec![0x34, 0x12, 0xaa, 0x55, 9, 9]),
            ],
        )
        .unwrap();
        let by_name = |name: &str| {
            prepared
                .choices
                .iter()
                .find(|c| c.name == name)
                .unwrap_or_else(|| panic!("{name}"))
                .clone()
        };
        assert!(by_name("oldschool mod v3").disabled_reason.is_none());
        assert!(by_name("oldschool_pack_000")
            .disabled_reason
            .unwrap()
            .contains("piece of a split VPK"));
        assert!(by_name("broken")
            .disabled_reason
            .unwrap()
            .contains("can't read this VPK"));
        let id = by_name("oldschool mod v3").id;
        assert_eq!(prepared.select(&[id]).unwrap().len(), 1);
    }

    fn tree_paths(content: &ModContent) -> Vec<String> {
        match content {
            ModContent::Tree(files) => files.iter().map(|(path, _)| path.clone()).collect(),
            ModContent::Vpk(_) => panic!("expected a folder pack"),
        }
    }

    #[test]
    fn loose_maps_install_into_maps_with_their_bot_files_and_missions() {
        let prepared = PreparedModImport::from_entries(
            "map",
            vec![
                ("mapzip/mvm_rock.bsp".into(), b"VBSP".to_vec()),
                ("mapzip/mvm_rock.nav".into(), b"nav".to_vec()),
                ("mapzip/mvm_rock_particles.txt".into(), b"p".to_vec()),
                ("mapzip/mvm_rock_advanced.pop".into(), b"pop".to_vec()),
                ("mapzip/mvm_rock.vmf".into(), b"source".to_vec()),
                ("mapzip/readme.txt".into(), b"Have fun".to_vec()),
            ],
        )
        .unwrap();
        assert_eq!(prepared.choices.len(), 1);
        assert_eq!(prepared.choices[0].name, "mvm_rock");
        assert_eq!(prepared.choices[0].content_roots, ["maps", "scripts"]);
        let packs = prepared.select(&["0".into()]).unwrap();
        assert_eq!(
            tree_paths(&packs[0].1),
            [
                "maps/mvm_rock.bsp",
                "maps/mvm_rock.nav",
                "scripts/population/mvm_rock_advanced.pop",
                "maps/mvm_rock_particles.txt",
            ]
        );
    }

    #[test]
    fn several_maps_are_separate_choices_and_a_map_joins_its_content_folders() {
        let two = PreparedModImport::from_entries(
            "gorge",
            vec![
                ("cp_gorge_night_final.bsp".into(), b"VBSP".to_vec()),
                ("cp_gorge_night_custom_final.bsp".into(), b"VBSP".to_vec()),
            ],
        )
        .unwrap();
        assert_eq!(two.choices.len(), 2);

        let with_assets = PreparedModImport::from_entries(
            "koth_x",
            vec![
                ("koth_x/koth_x.bsp".into(), b"VBSP".to_vec()),
                ("koth_x/materials/x.vtf".into(), b"VTF".to_vec()),
            ],
        )
        .unwrap();
        assert_eq!(with_assets.choices.len(), 1);
        let packs = with_assets.select(&["0".into()]).unwrap();
        assert_eq!(
            tree_paths(&packs[0].1),
            ["maps/koth_x.bsp", "materials/x.vtf"]
        );
    }

    #[test]
    fn a_single_choice_takes_the_mods_title_and_archive_names_lose_their_extension() {
        let mut wrapped = PreparedModImport::from_entries(
            "tr_aim_training.zip",
            vec![(
                "Team Fortress 2/tf/maps/tr_aim.bsp".into(),
                b"VBSP".to_vec(),
            )],
        )
        .unwrap();
        assert_eq!(wrapped.choices[0].name, "Team Fortress 2/tf");
        wrapped.name_single_choice("tr_aim_training");
        assert_eq!(
            wrapped.select(&["0".into()]).unwrap()[0].0,
            "tr_aim_training"
        );

        let rooted = PreparedModImport::from_entries(
            "trade_complex.ZIP",
            vec![("maps/trade_complex.bsp".into(), b"VBSP".to_vec())],
        )
        .unwrap();
        assert_eq!(rooted.choices[0].name, "trade_complex");
    }

    #[test]
    fn hammer_sources_alone_explain_that_there_is_no_playable_map() {
        let err = PreparedModImport::from_entries("src", vec![("well.vmf".into(), b"x".to_vec())])
            .unwrap_err();
        assert!(
            err.message().contains("Hammer source files"),
            "{}",
            err.message()
        );
    }

    #[test]
    fn startup_video_mods_are_tf2_content() {
        let prepared = PreparedModImport::from_entries(
            "intro",
            vec![
                ("hl2/media/valve.webm".into(), b"webm".to_vec()),
                ("readme.txt".into(), b"Put media in custom".to_vec()),
            ],
        )
        .unwrap();
        assert_eq!(prepared.choices.len(), 1);
        assert_eq!(prepared.choices[0].content_roots, ["media"]);
    }

    #[test]
    fn orphan_directory_external_member_is_disabled_without_reading_siblings() {
        // One valid directory entry referring to archive zero, without that archive present.
        let mut tree = b"vmt\0materials\0example\0".to_vec();
        tree.extend_from_slice(&0u32.to_le_bytes()); // crc
        tree.extend_from_slice(&0u16.to_le_bytes()); // preload length
        tree.extend_from_slice(&0u16.to_le_bytes()); // external archive
        tree.extend_from_slice(&0u32.to_le_bytes()); // offset
        tree.extend_from_slice(&(2 * 1024 * 1024u32).to_le_bytes()); // external length, metadata only
        tree.extend_from_slice(&0xffffu16.to_le_bytes());
        tree.extend_from_slice(&[0, 0, 0]);
        let mut bytes = 0x55aa1234u32.to_le_bytes().to_vec();
        bytes.extend_from_slice(&1u32.to_le_bytes());
        bytes.extend_from_slice(&(tree.len() as u32).to_le_bytes());
        bytes.extend_from_slice(&tree);
        assert!(crate::vpk::validate_vpk_dir_bytes(&bytes).is_err());
        let prepared = PreparedModImport::from_vpk("orphan_dir.vpk", bytes.clone()).unwrap();
        assert_eq!(prepared.choices[0].files, 1);
        assert_eq!(prepared.choices[0].content_roots, ["materials"]);
        assert!(prepared.choices[0].disabled_reason.is_some());
        assert!(prepared.select(&["0".into()]).is_err());
        // A large external member must not prevent choosing an unrelated pack.
        let plain = vpk();
        let prepared = PreparedModImport::from_archive(
            "choices.zip",
            &zip(&[("orphan_dir.vpk", bytes), ("plain.vpk", plain.clone())]),
        )
        .unwrap();
        assert!(prepared.choices[0].disabled_reason.is_some());
        assert!(prepared.choices[1].disabled_reason.is_none());
        assert_eq!(
            prepared.select(&["1".into()]).unwrap(),
            vec![("plain".into(), ModContent::Vpk(plain))]
        );
    }

    #[test]
    fn selections_reject_duplicate_unknown_and_empty_ids() {
        for ids in [vec![], vec!["missing".into()], vec!["0".into(), "0".into()]] {
            let prepared = PreparedModImport::from_entries(
                "options",
                vec![
                    ("a/materials/a.vmt".into(), vec![1]),
                    ("b/materials/b.vmt".into(), vec![2]),
                ],
            )
            .unwrap();
            assert!(prepared.select(&ids).is_err());
        }
    }

    #[test]
    fn install_instructions_count_as_the_author_instructions() {
        for name in [
            "README.txt",
            "Installation.txt",
            "mod/INSTALL.txt",
            "How to install.md",
            "instructions.txt",
        ] {
            assert!(is_readme(name), "{name}");
        }
        for name in ["credits.txt", "install.vpk", "materials/install.vmt"] {
            assert!(!is_readme(name), "{name}");
        }
    }

    #[test]
    fn readmes_and_choices_are_bounded_and_portable_roots_refuse() {
        let mut entries = vec![("materials/a.vmt".into(), vec![1])];
        entries
            .extend((0..10).map(|i| (format!("README{i}.md"), vec![b'x'; MAX_README_BYTES + 1])));
        let prepared = PreparedModImport::from_entries("instructions", entries).unwrap();
        assert_eq!(prepared.readmes.len(), MAX_READMES);
        assert!(prepared
            .readmes
            .iter()
            .all(|r| r.truncated && r.text.len() == MAX_README_BYTES));
        let entries = (0..257)
            .map(|i| (format!("option{i}/materials/a.vmt"), vec![1]))
            .collect();
        assert!(PreparedModImport::from_entries("many", entries).is_err());
        assert!(PreparedModImport::from_entries(
            "collision",
            vec![
                ("Red/materials/a.vmt".into(), vec![1]),
                ("red/models/a.mdl".into(), vec![2])
            ]
        )
        .is_err());
    }

    #[test]
    fn folder_fingerprint_covers_paths_membership_and_bytes() {
        let entries = vec![
            ("materials/a.vmt".into(), vec![1]),
            ("models/b.mdl".into(), vec![2]),
        ];
        let base = PreparedModImport::from_entries("x", entries.clone())
            .unwrap()
            .fingerprint;
        let mut reversed = entries.clone();
        reversed.reverse();
        assert_eq!(
            base,
            PreparedModImport::from_entries("x", reversed)
                .unwrap()
                .fingerprint
        );
        for changed in [
            vec![("materials/a.vmt".into(), vec![3]), entries[1].clone()],
            vec![("materials/c.vmt".into(), vec![1]), entries[1].clone()],
            vec![entries[0].clone()],
        ] {
            assert_ne!(
                base,
                PreparedModImport::from_entries("x", changed)
                    .unwrap()
                    .fingerprint
            );
        }
    }

    #[test]
    fn selected_packs_install_together_but_a_selected_hud_refuses_the_whole_batch() {
        use crate::mods::{install_mods_to, ModSource};
        use crate::profile::{
            create_profile_record_to, load_library_from, load_manifest, set_active_profile_to,
        };
        let root = crate::test_temp_dir();
        let tf2 = root.join("tf2");
        let profiles = root.join("profiles");
        std::fs::create_dir_all(tf2.join("tf/cfg")).unwrap();
        std::fs::create_dir_all(tf2.join("tf/custom")).unwrap();
        std::fs::write(tf2.join("tf/steam.inf"), "appID=440\n").unwrap();
        create_profile_record_to(&profiles, &tf2, "Main", Vec::<String>::new()).unwrap();
        let id = load_library_from(&profiles, Some(&tf2)).unwrap().profiles[0]
            .id
            .clone();
        set_active_profile_to(&profiles, &tf2, &id, Vec::<String>::new()).unwrap();
        let input = || {
            vec![
                ("red/materials/red.vmt".into(), vec![1]),
                ("blue/materials/blue.vmt".into(), vec![2]),
                ("green/materials/green.vmt".into(), vec![3]),
            ]
        };
        let packs = PreparedModImport::from_entries("choices", input())
            .unwrap()
            .select(&["0".into(), "2".into()])
            .unwrap();
        let detail = install_mods_to(
            &profiles,
            &tf2,
            &id,
            packs,
            ModSource::Local,
            Vec::<String>::new(),
        )
        .unwrap();
        assert_eq!(detail.mods.len(), 2);
        assert!(tf2.join("tf/custom/blue/materials/blue.vmt").is_file());
        assert!(tf2.join("tf/custom/red/materials/red.vmt").is_file());
        assert!(!tf2.join("tf/custom/green").exists());
        let before = serde_json::to_vec(&load_manifest(&profiles, &id).unwrap()).unwrap();
        let hud_selection = || {
            PreparedModImport::from_entries(
                "mixed",
                vec![
                    ("other/materials/a.vmt".into(), vec![4]),
                    ("hud/resource/test.res".into(), vec![5]),
                    (
                        "hud/info.vdf".into(),
                        b"\"HUD\" { \"ui_version\" \"3\" }".to_vec(),
                    ),
                ],
            )
            .unwrap()
            .select(&["1".into(), "0".into()])
            .unwrap()
        };
        let error = install_mods_to(
            &profiles,
            &tf2,
            &id,
            hud_selection(),
            ModSource::Local,
            Vec::<String>::new(),
        )
        .unwrap_err();
        assert!(matches!(error, ProfileError::HudImportRequired(_)));
        assert_eq!(
            serde_json::to_vec(&load_manifest(&profiles, &id).unwrap()).unwrap(),
            before
        );
        assert!(!tf2.join("tf/custom/other").exists());
        let error = install_mods_to(
            &profiles,
            &tf2,
            &id,
            hud_selection(),
            ModSource::Local,
            ["tf_win64.exe"],
        )
        .unwrap_err();
        assert!(
            !matches!(error, ProfileError::HudImportRequired(_)),
            "running-game refusal must come first"
        );
        std::fs::remove_dir_all(root).unwrap();
    }

    #[cfg(unix)]
    #[test]
    fn linked_sources_are_not_followed_and_cannot_replace_reviewed_bytes() {
        let root = crate::test_temp_dir();
        let folder = root.join("mod");
        std::fs::create_dir_all(folder.join("materials")).unwrap();
        let leaf = folder.join("materials/a.vmt");
        std::fs::write(&leaf, "reviewed").unwrap();
        let before = PreparedModImport::from_folder(&folder).unwrap().fingerprint;
        let outside = root.join("outside.vmt");
        std::fs::write(&outside, "not reviewed").unwrap();
        std::fs::remove_file(&leaf).unwrap();
        std::os::unix::fs::symlink(&outside, &leaf).unwrap();
        assert!(PreparedModImport::from_folder(&folder).is_err());
        assert!(PreparedModImport::from_vpk_file(&leaf).is_err());
        std::fs::write(folder.join("materials/other.vmt"), "other").unwrap();
        assert_ne!(
            before,
            PreparedModImport::from_folder(&folder).unwrap().fingerprint
        );
        assert_eq!(std::fs::read_to_string(outside).unwrap(), "not reviewed");
        std::fs::remove_dir_all(root).unwrap();
    }
}
