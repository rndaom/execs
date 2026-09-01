//! Build a Yttrium-style viewmodel pack: hide chosen animation groups by
//! rewriting their SMD sequences off-screen, recompile each class's shared
//! animation model with TF2's own studiomdl, and pack the results into a VPK.
//! Everything happens in an isolated staging root — the live `tf/` tree is
//! never written.

use std::collections::{BTreeMap, BTreeSet};
use std::io::Read;
use std::path::{Path, PathBuf};

use zip::ZipArchive;

use crate::profile::ProfileError;
use crate::viewmodel_groups::{ViewmodelGroup, SOLDIER_FORCED_FILES, VIEWMODEL_GROUPS};
use crate::vpk::write_vpk_v2;

pub fn viewmodel_group(id: &str) -> Option<&'static ViewmodelGroup> {
    VIEWMODEL_GROUPS.iter().find(|group| group.id == id)
}

/// How much of the viewmodel a hidden group removes.
#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum ViewmodelHideMode {
    /// Move every bone off-screen — the weapon *and* the arms disappear.
    /// This is what CompVMInstaller does.
    Full,
    /// Move only the weapon attachment bones. The weapon disappears while the
    /// hands keep their normal animation.
    Weapon,
}

impl Default for ViewmodelHideMode {
    fn default() -> Self {
        Self::Full
    }
}

impl ViewmodelHideMode {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Full => "full",
            Self::Weapon => "weapon",
        }
    }

    pub fn from_str_or_default(value: Option<&str>) -> Self {
        match value {
            Some("weapon") => Self::Weapon,
            _ => Self::Full,
        }
    }
}

/// The weapon model is bone-merged onto these; every class parents them to
/// `bip_hand_L`/`bip_hand_R`, so moving them alone takes the weapon away and
/// leaves the arms animating.
fn is_weapon_bone(name: &str) -> bool {
    let lower = name.to_ascii_lowercase();
    lower.starts_with("weapon_bone") || lower.starts_with("vm_weapon_bone")
}

fn section(lines: &[&str], keyword: &str) -> Option<usize> {
    lines.iter().position(|line| line.trim() == keyword)
}

/// `  12 "bip_hand_R" 7` → (12, "bip_hand_R")
fn parse_node_line(line: &str) -> Option<(usize, &str)> {
    let trimmed = line.trim();
    let (index_text, rest) = trimmed.split_once(' ')?;
    let index = index_text.parse::<usize>().ok()?;
    let rest = rest.trim_start();
    let quoted = rest.strip_prefix('"')?;
    let end = quoted.find('"')?;
    Some((index, &quoted[..end]))
}

/// Leading bone index of a skeleton row like `    12 0.5 1.0 ...`.
fn parse_skeleton_row_index(line: &str) -> Option<usize> {
    let trimmed = line.trim_start();
    let (head, _) = trimmed.split_once(' ')?;
    head.parse::<usize>().ok()
}

/// Rewrite one SMD so the chosen bones sit far off-screen for the sequence.
pub fn hide_smd_sequence(text: &str, mode: ViewmodelHideMode) -> Result<String, String> {
    match mode {
        ViewmodelHideMode::Full => hide_all_bones(text),
        ViewmodelHideMode::Weapon => hide_weapon_bones(text),
    }
}

/// Faithful to CompVMInstaller's EditFile: keep everything before `skeleton`,
/// emit frame 0 with all bones at (-100,-100,-100) rot 0, then empty frames so
/// the original frame count (and therefore timing/anim events) is preserved.
fn hide_all_bones(text: &str) -> Result<String, String> {
    let lines: Vec<&str> = text.lines().collect();
    let nodes = section(&lines, "nodes").ok_or("SMD has no nodes section.")?;
    let skeleton = section(&lines, "skeleton").ok_or("SMD has no skeleton section.")?;
    if skeleton < nodes + 2 {
        return Err("SMD nodes section is malformed.".into());
    }
    let bones = skeleton - nodes - 2;
    let frames = lines
        .iter()
        .filter(|line| line.trim_start().starts_with("time "))
        .count()
        .max(1);
    let cut = text.find("skeleton").ok_or("SMD has no skeleton keyword.")?;
    let mut out = String::with_capacity(cut + bones * 32 + frames * 10 + 16);
    out.push_str(&text[..cut]);
    out.push_str("skeleton\n  time 0\n");
    for bone in 0..bones {
        out.push_str(&format!("    {bone} -100 -100 -100 0 0 0\n"));
    }
    for frame in 1..frames {
        out.push_str(&format!("  time {frame}\n"));
    }
    out.push_str("end\n");
    Ok(out)
}

/// Keep every frame of arm animation; rewrite only the weapon bones' rows.
/// Their transforms are parent-local, so -100 on a hand-parented bone parks
/// the weapon far from the camera without moving the hand.
fn hide_weapon_bones(text: &str) -> Result<String, String> {
    let lines: Vec<&str> = text.lines().collect();
    let nodes = section(&lines, "nodes").ok_or("SMD has no nodes section.")?;
    let skeleton = section(&lines, "skeleton").ok_or("SMD has no skeleton section.")?;
    if skeleton < nodes + 2 {
        return Err("SMD nodes section is malformed.".into());
    }
    let weapon_bones: BTreeSet<usize> = lines[nodes + 1..skeleton - 1]
        .iter()
        .filter_map(|line| parse_node_line(line))
        .filter(|(_, name)| is_weapon_bone(name))
        .map(|(index, _)| index)
        .collect();
    if weapon_bones.is_empty() {
        return Err("SMD has no weapon bones to hide.".into());
    }

    let mut out = String::with_capacity(text.len());
    for (position, line) in lines.iter().enumerate() {
        let rewritten = if position > skeleton {
            parse_skeleton_row_index(line)
                .filter(|index| weapon_bones.contains(index))
                .map(|index| format!("    {index} -100 -100 -100 0 0 0"))
        } else {
            None
        };
        out.push_str(rewritten.as_deref().unwrap_or(line));
        out.push('\n');
    }
    Ok(out)
}

/// Minimal gameinfo.txt so studiomdl accepts the staging dir as its game root
/// and writes compiled models under it instead of the live install.
pub fn write_staging_gameinfo(dir: &Path) -> Result<(), ProfileError> {
    std::fs::create_dir_all(dir).map_err(|err| ProfileError::Io(err.to_string()))?;
    let gameinfo = concat!(
        "\"GameInfo\"\n{\n",
        "\tgame\t\"execs viewmodel staging\"\n",
        "\tFileSystem\n\t{\n",
        "\t\tSteamAppId\t440\n",
        "\t\tToolsAppId\t211\n",
        "\t\tSearchPaths\n\t\t{\n",
        "\t\t\tgame\t|gameinfo_path|.\n",
        "\t\t}\n\t}\n}\n",
    );
    std::fs::write(dir.join("gameinfo.txt"), gameinfo)
        .map_err(|err| ProfileError::Io(err.to_string()))
}

fn model_name_from_qc(qc: &str) -> Option<String> {
    for line in qc.lines() {
        let trimmed = line.trim();
        if trimmed.to_ascii_lowercase().starts_with("$modelname") {
            let value = trimmed["$modelname".len()..].trim().trim_matches('"');
            return Some(value.replace('\\', "/"));
        }
    }
    None
}

/// Classes touched by the hidden-group set, as their zip folder names.
fn changed_zip_folders(hidden_groups: &BTreeSet<String>) -> Result<Vec<String>, ProfileError> {
    let mut folders: Vec<String> = Vec::new();
    for id in hidden_groups {
        let group = viewmodel_group(id)
            .ok_or_else(|| ProfileError::Io(format!("Unknown viewmodel group {id}.")))?;
        if !folders.iter().any(|folder| folder == group.zip_folder) {
            folders.push(group.zip_folder.to_string());
        }
    }
    Ok(folders)
}

/// Files to hide for one class folder (group files plus Soldier's forced set).
fn hidden_files_for_folder(
    hidden_groups: &BTreeSet<String>,
    zip_folder: &str,
) -> BTreeSet<String> {
    let mut files = BTreeSet::new();
    for id in hidden_groups {
        if let Some(group) = viewmodel_group(id) {
            if group.zip_folder == zip_folder {
                for file in group.files {
                    files.insert((*file).to_string());
                }
            }
        }
    }
    if zip_folder == "soldier" && !files.is_empty() {
        for file in SOLDIER_FORCED_FILES {
            files.insert((*file).to_string());
        }
    }
    files
}

fn extract_class_sources(
    animations_zip: &[u8],
    zip_folder: &str,
    dest: &Path,
) -> Result<PathBuf, ProfileError> {
    let mut archive = ZipArchive::new(std::io::Cursor::new(animations_zip))
        .map_err(|err| ProfileError::Io(err.to_string()))?;
    // The archive is flat: c_<class>_animations.qc + c_<class>_animations_anims/*.
    let stem = format!("c_{zip_folder}_animations");
    let mut qc_path = None;
    for index in 0..archive.len() {
        let mut entry = archive
            .by_index(index)
            .map_err(|err| ProfileError::Io(err.to_string()))?;
        let raw_name = entry.name().replace('\\', "/");
        let rel = raw_name.as_str();
        let belongs = rel.eq_ignore_ascii_case(&format!("{stem}.qc"))
            || rel
                .to_ascii_lowercase()
                .starts_with(&format!("{stem}_anims/"));
        if !belongs || entry.is_dir() {
            continue;
        }
        if rel.is_empty() || rel.contains("..") {
            continue;
        }
        let out_path = dest.join(rel);
        if let Some(parent) = out_path.parent() {
            std::fs::create_dir_all(parent).map_err(|err| ProfileError::Io(err.to_string()))?;
        }
        let mut bytes = Vec::new();
        entry
            .read_to_end(&mut bytes)
            .map_err(|err| ProfileError::Io(err.to_string()))?;
        if rel.to_ascii_lowercase().ends_with(".qc") {
            qc_path = Some(out_path.clone());
        }
        std::fs::write(&out_path, bytes).map_err(|err| ProfileError::Io(err.to_string()))?;
    }
    qc_path.ok_or_else(|| {
        ProfileError::Io(format!(
            "The animation archive has no QC for class folder {zip_folder}."
        ))
    })
}

/// Case-insensitive lookup of `<file>.smd` inside the class anims dir.
fn find_smd(anims_dir: &Path, file: &str) -> Option<PathBuf> {
    let wanted = format!("{}.smd", file.to_ascii_lowercase());
    let entries = std::fs::read_dir(anims_dir).ok()?;
    for entry in entries.flatten() {
        let name = entry.file_name();
        if name.to_string_lossy().to_ascii_lowercase() == wanted {
            return Some(entry.path());
        }
    }
    None
}

/// Build the pack VPK. `studiomdl` is TF2's own compiler; `staging` is a
/// scratch dir this function owns (created/overwritten, caller may delete).
pub fn build_viewmodel_pack_vpk(
    animations_zip: &[u8],
    hidden_groups: &BTreeSet<String>,
    mode: ViewmodelHideMode,
    studiomdl: &Path,
    staging: &Path,
) -> Result<Vec<u8>, ProfileError> {
    if hidden_groups.is_empty() {
        return Err(ProfileError::Io(
            "Pick at least one animation group to hide.".into(),
        ));
    }
    if !studiomdl.is_file() {
        return Err(ProfileError::Io(
            "Could not find studiomdl.exe in the TF2 install's bin folder.".into(),
        ));
    }
    let folders = changed_zip_folders(hidden_groups)?;
    let game_dir = staging.join("game");
    if game_dir.exists() {
        std::fs::remove_dir_all(&game_dir).map_err(|err| ProfileError::Io(err.to_string()))?;
    }
    write_staging_gameinfo(&game_dir)?;

    let mut pack_files: BTreeMap<String, Vec<u8>> = BTreeMap::new();
    for folder in &folders {
        let src_dir = staging.join("src").join(folder);
        if src_dir.exists() {
            std::fs::remove_dir_all(&src_dir).map_err(|err| ProfileError::Io(err.to_string()))?;
        }
        std::fs::create_dir_all(&src_dir).map_err(|err| ProfileError::Io(err.to_string()))?;
        let qc_path = extract_class_sources(animations_zip, folder, &src_dir)?;
        let anims_dir = src_dir.join(format!("c_{folder}_animations_anims"));

        for file in hidden_files_for_folder(hidden_groups, folder) {
            let smd_path = find_smd(&anims_dir, &file).ok_or_else(|| {
                ProfileError::Io(format!("Animation {file}.smd is missing for {folder}."))
            })?;
            let text = std::fs::read_to_string(&smd_path)
                .map_err(|err| ProfileError::Io(err.to_string()))?;
            let hidden = hide_smd_sequence(&text, mode)
                .map_err(|err| ProfileError::Io(format!("{}: {err}", smd_path.display())))?;
            std::fs::write(&smd_path, hidden).map_err(|err| ProfileError::Io(err.to_string()))?;
        }

        let qc_text = std::fs::read_to_string(&qc_path)
            .map_err(|err| ProfileError::Io(err.to_string()))?;
        let model_name = model_name_from_qc(&qc_text).ok_or_else(|| {
            ProfileError::Io(format!("QC for {folder} has no $ModelName."))
        })?;

        let output = std::process::Command::new(studiomdl)
            .arg("-game")
            .arg(&game_dir)
            .arg("-nop4")
            .arg(&qc_path)
            .output()
            .map_err(|err| {
                ProfileError::Io(format!("Could not run studiomdl: {err}"))
            })?;
        let compiled = game_dir.join("models").join(&model_name);
        if !compiled.is_file() {
            let stdout = String::from_utf8_lossy(&output.stdout);
            let stderr = String::from_utf8_lossy(&output.stderr);
            let tail: String = stdout
                .lines()
                .chain(stderr.lines())
                .rev()
                .take(6)
                .collect::<Vec<_>>()
                .into_iter()
                .rev()
                .collect::<Vec<_>>()
                .join(" | ");
            return Err(ProfileError::Io(format!(
                "studiomdl failed for {folder}: {tail}"
            )));
        }
        let bytes =
            std::fs::read(&compiled).map_err(|err| ProfileError::Io(err.to_string()))?;
        pack_files.insert(format!("models/{model_name}"), bytes);
    }

    Ok(write_vpk_v2(&pack_files))
}

#[cfg(test)]
mod tests {
    use super::*;

    const SAMPLE_SMD: &str = "version 1\nnodes\n  0 \"bip_pelvis\" -1\n  1 \"bip_spine\" 0\nend\nskeleton\n  time 0\n    0 1.5 2.5 3.5 0.1 0.2 0.3\n    1 0.5 0.5 0.5 0 0 0\n  time 1\n    0 1.6 2.6 3.6 0.1 0.2 0.3\n  time 2\n    1 0.9 0.9 0.9 0 0 0\nend\n";

    /// Shaped like the real files: hand bones plus weapon bones parented to
    /// them, and two frames of animation.
    const HAND_SMD: &str = "version 1\nnodes\n  0 \"root\" -1\n  1 \"bip_hand_R\" 0\n  2 \"weapon_bone\" 1\n  3 \"vm_weapon_bone_1\" 1\nend\nskeleton\n  time 0\n    0 0 0 0 0 0 0\n    1 1.5 2.5 3.5 0.1 0.2 0.3\n    2 5.1 3.5 0.0 0 0 0\n    3 5.4 4.9 -0.1 0 0 0\n  time 1\n    1 1.6 2.6 3.6 0.1 0.2 0.3\n    2 5.2 3.6 0.0 0 0 0\nend\n";

    #[test]
    fn weapon_mode_hides_only_weapon_bones_and_keeps_hand_frames() {
        let hidden = hide_smd_sequence(HAND_SMD, ViewmodelHideMode::Weapon).unwrap();
        // Weapon bones parked, every frame preserved.
        assert!(hidden.contains("    2 -100 -100 -100 0 0 0"));
        assert!(hidden.contains("    3 -100 -100 -100 0 0 0"));
        assert!(!hidden.contains("5.1 3.5"));
        assert!(!hidden.contains("5.4 4.9"));
        // Hand and root animation untouched, both frames still there.
        assert!(hidden.contains("    1 1.5 2.5 3.5 0.1 0.2 0.3"));
        assert!(hidden.contains("    1 1.6 2.6 3.6 0.1 0.2 0.3"));
        assert!(hidden.contains("    0 0 0 0 0 0 0"));
        assert!(hidden.contains("  time 0\n"));
        assert!(hidden.contains("  time 1\n"));
        // The nodes section is never rewritten.
        assert!(hidden.contains("  2 \"weapon_bone\" 1"));

        // Full mode on the same file still flattens everything.
        let full = hide_smd_sequence(HAND_SMD, ViewmodelHideMode::Full).unwrap();
        assert!(full.contains("    1 -100 -100 -100 0 0 0"));
        assert!(!full.contains("1.5 2.5 3.5"));
    }

    #[test]
    fn weapon_mode_needs_weapon_bones() {
        // A skeleton with no weapon attachment bones cannot hide a weapon.
        assert!(hide_smd_sequence(SAMPLE_SMD, ViewmodelHideMode::Weapon).is_err());
    }

    #[test]
    fn hide_mode_round_trips_through_options() {
        assert_eq!(ViewmodelHideMode::default(), ViewmodelHideMode::Full);
        assert_eq!(ViewmodelHideMode::Weapon.as_str(), "weapon");
        assert_eq!(
            ViewmodelHideMode::from_str_or_default(Some("weapon")),
            ViewmodelHideMode::Weapon
        );
        assert_eq!(
            ViewmodelHideMode::from_str_or_default(Some("full")),
            ViewmodelHideMode::Full
        );
        // Unknown / missing falls back to the CompVMInstaller behavior.
        assert_eq!(
            ViewmodelHideMode::from_str_or_default(None),
            ViewmodelHideMode::Full
        );
        assert_eq!(
            ViewmodelHideMode::from_str_or_default(Some("nonsense")),
            ViewmodelHideMode::Full
        );
    }

    #[test]
    fn hides_all_bones_and_preserves_frame_count() {
        let hidden = hide_smd_sequence(SAMPLE_SMD, ViewmodelHideMode::Full).unwrap();
        assert!(hidden.contains("nodes"));
        assert!(hidden.contains("  time 0\n"));
        assert!(hidden.contains("    0 -100 -100 -100 0 0 0"));
        assert!(hidden.contains("    1 -100 -100 -100 0 0 0"));
        assert!(!hidden.contains("    2 -100"));
        assert!(hidden.contains("  time 1\n"));
        assert!(hidden.contains("  time 2\n"));
        assert!(!hidden.contains("  time 3"));
        assert!(hidden.trim_end().ends_with("end"));
        assert!(!hidden.contains("1.5 2.5 3.5"));
    }

    #[test]
    fn rejects_smd_without_skeleton() {
        assert!(hide_smd_sequence("version 1\nnodes\nend\n", ViewmodelHideMode::Full).is_err());
        assert!(hide_smd_sequence("version 1\nnodes\nend\n", ViewmodelHideMode::Weapon).is_err());
    }

    #[test]
    fn resolves_model_name_from_qc() {
        let qc = "$ModelName \"weapons\\c_models\\c_medic_animations.mdl\"\n$Sequence x\n";
        assert_eq!(
            model_name_from_qc(qc).as_deref(),
            Some("weapons/c_models/c_medic_animations.mdl")
        );
    }

    #[test]
    fn soldier_hides_force_the_original_files() {
        let mut hidden = BTreeSet::new();
        hidden.insert("soldier/melee".to_string());
        let files = hidden_files_for_folder(&hidden, "soldier");
        assert!(files.contains("bet_idle"));
        assert!(files.contains("s_draw"));
        let scout: BTreeSet<String> = ["scout/melee".to_string()].into_iter().collect();
        assert!(!hidden_files_for_folder(&scout, "scout").contains("bet_idle"));
    }

    #[test]
    fn unknown_group_is_an_error() {
        let mut hidden = BTreeSet::new();
        hidden.insert("scout/rocketlaunchers".to_string());
        assert!(changed_zip_folders(&hidden).is_err());
        let known: BTreeSet<String> = ["demoman/melee".to_string()].into_iter().collect();
        assert_eq!(changed_zip_folders(&known).unwrap(), vec!["demo".to_string()]);
    }
}
