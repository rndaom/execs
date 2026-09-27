//! Read-only comparison of two saved profiles before a switch. It reads only
//! library manifests and managed cfg bytes; switching repeats every check.

use std::collections::{BTreeMap, BTreeSet};
use std::path::Path;

use serde::Serialize;

use crate::apply::profile_file_bytes_from;
use crate::hash::sha256_hex;
use crate::profile::{
    load_library_from, load_manifest, manifest_file, ProfileError, ProfileManifest,
};

/// Credential commands whose values never leave the library in a summary.
const CREDENTIAL_NAMES: [&str; 4] = ["password", "rcon_password", "sv_password", "rcon"];
/// Managed cfg value changes listed; the count stays exact.
const MAX_VALUE_CHANGES: usize = 200;

#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SetChange {
    pub added: Vec<String>,
    pub removed: Vec<String>,
    pub changed: Vec<String>,
}

#[cfg(test)]
impl SetChange {
    fn is_empty(&self) -> bool {
        self.added.is_empty() && self.removed.is_empty() && self.changed.is_empty()
    }
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ValueChange {
    pub name: String,
    pub from: Option<String>,
    pub to: Option<String>,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TextChange {
    pub from: Option<String>,
    pub to: Option<String>,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProfileComparison {
    pub from_id: String,
    pub from_name: String,
    pub to_id: String,
    pub to_name: String,
    /// Identifies both manifests; a later comparison with a different value
    /// means a profile changed after this preview.
    pub revision: String,
    pub launch_options: Option<TextChange>,
    pub hud: Option<TextChange>,
    pub hit_sound: Option<TextChange>,
    pub kill_sound: Option<TextChange>,
    /// Top-level `tf/custom` folders and VPKs, compared by every file hash.
    pub packs: SetChange,
    /// `tf/cfg` files other than config.cfg, compared by hash.
    pub cfg_files: SetChange,
    pub config_cfg_changed: bool,
    /// Values in the execs Gameplay and Binds cfgs.
    pub values: Vec<ValueChange>,
    pub values_truncated: bool,
    pub casual: SetChange,
    /// Why switching to the target would be refused right now, if it would.
    pub blocked: Option<String>,
}

fn is_credential(name: &str) -> bool {
    CREDENTIAL_NAMES.contains(&name.to_ascii_lowercase().as_str())
}

fn tokens(line: &str) -> Vec<String> {
    let line = match line.find("//") {
        Some(at) if line[..at].matches('"').count().is_multiple_of(2) => &line[..at],
        _ => line,
    };
    let mut out = Vec::new();
    let mut chars = line.chars().peekable();
    while let Some(&ch) = chars.peek() {
        if ch.is_whitespace() {
            chars.next();
        } else if ch == '"' {
            chars.next();
            let mut token = String::new();
            for next in chars.by_ref() {
                if next == '"' {
                    break;
                }
                token.push(next);
            }
            out.push(token);
        } else {
            let mut token = String::new();
            while let Some(&next) = chars.peek() {
                if next.is_whitespace() || next == '"' {
                    break;
                }
                token.push(next);
                chars.next();
            }
            out.push(token);
        }
    }
    out
}

/// `name value` and `bind key command` lines, last one wins, credentials skipped.
fn managed_values(text: &str) -> BTreeMap<String, String> {
    let mut values = BTreeMap::new();
    for line in text.lines() {
        let parts = tokens(line);
        let Some(name) = parts.first() else { continue };
        let lower = name.to_ascii_lowercase();
        if is_credential(&lower) || lower == "exec" || lower == "alias" {
            continue;
        }
        if lower == "bind" && parts.len() >= 3 {
            values.insert(
                format!("bind {}", parts[1].to_ascii_lowercase()),
                parts[2..].join(" "),
            );
        } else if lower == "unbind" && parts.len() >= 2 {
            values.insert(
                format!("bind {}", parts[1].to_ascii_lowercase()),
                "(nothing)".into(),
            );
        } else if parts.len() >= 2 && lower != "bind" {
            values.insert(lower, parts[1..].join(" "));
        }
    }
    values
}

/// Hide the value after any launch `+password`-style command.
fn redact_launch(options: &str) -> String {
    let mut out = Vec::new();
    let mut hide_next = false;
    for part in options.split_whitespace() {
        if hide_next {
            out.push("•••".to_string());
            hide_next = false;
            continue;
        }
        let name = part.trim_start_matches(['+', '-']);
        if part.starts_with('+') && is_credential(name) {
            hide_next = true;
        }
        out.push(part.to_string());
    }
    out.join(" ")
}

fn text_change(from: Option<String>, to: Option<String>) -> Option<TextChange> {
    (from != to).then_some(TextChange { from, to })
}

fn pack_name(path: &str) -> Option<String> {
    let rest = path.strip_prefix("tf/custom/")?;
    Some(rest.split('/').next()?.to_string())
}

/// One side of a comparison: a saved profile or a restore-point archive.
#[derive(Clone, Debug, Default)]
pub(crate) struct CompareSide {
    pub id: String,
    pub name: String,
    pub launch_options: String,
    pub hud: Option<String>,
    pub hit_sound: Option<String>,
    pub kill_sound: Option<String>,
    /// `(path, sha256)` for every tracked file.
    pub files: Vec<(String, String)>,
    pub casual: BTreeSet<String>,
    /// The execs Gameplay and Binds cfg text, concatenated.
    pub managed_text: String,
}

/// Library paths of the managed cfgs whose values are compared.
pub(crate) const MANAGED_COMPARE_PATHS: [&str; 4] = [
    "tf/cfg/overrides/execs_gameplay.cfg",
    "tf/cfg/execs_gameplay.cfg",
    "tf/cfg/overrides/execs_binds.cfg",
    "tf/cfg/execs_binds.cfg",
];

pub(crate) fn casual_names(
    selection: Option<&crate::preloader::PreloaderSelection>,
    mods: &[crate::mods::ModRecord],
) -> BTreeSet<String> {
    let Some(selection) = selection else {
        return BTreeSet::new();
    };
    selection
        .addons
        .iter()
        .chain(&selection.particle_mods)
        .cloned()
        .chain(selection.profile_particle_mods.iter().map(|id| {
            mods.iter()
                .find(|record| &record.id == id)
                .map_or_else(|| id.clone(), |record| record.name.clone())
        }))
        .collect()
}

pub(crate) fn sound_names(
    record: Option<&crate::hitsound::HitsoundRecord>,
) -> (Option<String>, Option<String>) {
    (
        record.and_then(|record| record.hit.as_ref().map(|entry| entry.name.clone())),
        record.and_then(|record| record.kill.as_ref().map(|entry| entry.name.clone())),
    )
}

fn library_side(profiles_dir: &Path, manifest: &ProfileManifest) -> CompareSide {
    let mut managed_text = String::new();
    for path in MANAGED_COMPARE_PATHS {
        if manifest.files.iter().any(|file| file.path == path) {
            if let Ok(bytes) = profile_file_bytes_from(profiles_dir, &manifest.id, path) {
                managed_text.push_str(&String::from_utf8_lossy(&bytes));
                managed_text.push('\n');
            }
        }
    }
    let (hit_sound, kill_sound) = sound_names(manifest.hitsound.as_ref());
    CompareSide {
        id: manifest.id.clone(),
        name: manifest.name.clone(),
        launch_options: manifest.launch_options.clone(),
        hud: manifest.hud.as_ref().map(|hud| hud.id.clone()),
        hit_sound,
        kill_sound,
        files: manifest
            .files
            .iter()
            .map(|file| (file.path.clone(), file.sha256.clone()))
            .collect(),
        casual: casual_names(manifest.preloader.as_ref(), &manifest.mods),
        managed_text,
    }
}

fn grouped(side: &CompareSide, key: impl Fn(&str) -> Option<String>) -> BTreeMap<String, String> {
    let mut groups: BTreeMap<String, Vec<(String, String)>> = BTreeMap::new();
    for (path, sha) in &side.files {
        if let Some(group) = key(path) {
            groups
                .entry(group)
                .or_default()
                .push((path.to_ascii_lowercase(), sha.clone()));
        }
    }
    groups
        .into_iter()
        .map(|(group, mut files)| {
            files.sort();
            let joined = files
                .iter()
                .map(|(path, sha)| format!("{path}\0{sha}"))
                .collect::<Vec<_>>()
                .join("\n");
            (group, sha256_hex(joined.as_bytes()))
        })
        .collect()
}

fn set_change(from: &BTreeMap<String, String>, to: &BTreeMap<String, String>) -> SetChange {
    let mut change = SetChange::default();
    for (name, digest) in to {
        match from.get(name) {
            None => change.added.push(name.clone()),
            Some(old) if old != digest => change.changed.push(name.clone()),
            _ => {}
        }
    }
    change.removed = from
        .keys()
        .filter(|name| !to.contains_key(*name))
        .cloned()
        .collect();
    change
}

pub(crate) fn compare_sides(
    from: &CompareSide,
    to: &CompareSide,
    revision: String,
    blocked: Option<String>,
) -> ProfileComparison {
    let from_values = managed_values(&from.managed_text);
    let to_values = managed_values(&to.managed_text);
    let names: BTreeSet<&String> = from_values.keys().chain(to_values.keys()).collect();
    let mut values: Vec<ValueChange> = names
        .into_iter()
        .filter(|name| from_values.get(*name) != to_values.get(*name))
        .map(|name| ValueChange {
            name: name.clone(),
            from: from_values.get(name).cloned(),
            to: to_values.get(name).cloned(),
        })
        .collect();
    let values_truncated = values.len() > MAX_VALUE_CHANGES;
    values.truncate(MAX_VALUE_CHANGES);

    let cfg_key = |path: &str| {
        (path.starts_with("tf/cfg/") && path != "tf/cfg/config.cfg").then(|| path.to_string())
    };
    let config_hash = |side: &CompareSide| {
        side.files
            .iter()
            .find(|(path, _)| path == "tf/cfg/config.cfg")
            .map(|(_, sha)| sha.clone())
    };
    let as_set = |names: &BTreeSet<String>| {
        names
            .iter()
            .map(|name| (name.clone(), String::new()))
            .collect::<BTreeMap<_, _>>()
    };
    let launch = |side: &CompareSide| {
        Some(redact_launch(&side.launch_options)).filter(|text| !text.is_empty())
    };
    ProfileComparison {
        from_id: from.id.clone(),
        from_name: from.name.clone(),
        to_id: to.id.clone(),
        to_name: to.name.clone(),
        revision,
        launch_options: text_change(launch(from), launch(to)),
        hud: text_change(from.hud.clone(), to.hud.clone()),
        hit_sound: text_change(from.hit_sound.clone(), to.hit_sound.clone()),
        kill_sound: text_change(from.kill_sound.clone(), to.kill_sound.clone()),
        packs: set_change(&grouped(from, pack_name), &grouped(to, pack_name)),
        cfg_files: set_change(&grouped(from, cfg_key), &grouped(to, cfg_key)),
        config_cfg_changed: config_hash(from) != config_hash(to),
        values,
        values_truncated,
        casual: set_change(&as_set(&from.casual), &as_set(&to.casual)),
        blocked,
    }
}

pub(crate) fn manifest_revision(profiles_dir: &Path, id: &str) -> Result<String, ProfileError> {
    let bytes = crate::hash::read_small_file_bounded(&manifest_file(profiles_dir, id), 64 << 20)
        .map_err(|err| ProfileError::Io(err.to_string()))?;
    Ok(sha256_hex(&bytes))
}

pub(crate) fn saved_profile_side(
    profiles_dir: &Path,
    tf2_root: &Path,
    id: &str,
) -> Result<CompareSide, ProfileError> {
    let library = load_library_from(profiles_dir, Some(tf2_root))?;
    if !library.profiles.iter().any(|profile| profile.id == id) {
        return Err(ProfileError::UnknownProfile);
    }
    Ok(library_side(
        profiles_dir,
        &load_manifest(profiles_dir, id)?,
    ))
}

pub fn compare_profiles(
    profiles_dir: &Path,
    tf2_root: &Path,
    from_id: &str,
    to_id: &str,
) -> Result<ProfileComparison, ProfileError> {
    let from = saved_profile_side(profiles_dir, tf2_root, from_id)?;
    let to = saved_profile_side(profiles_dir, tf2_root, to_id)?;
    let revision = format!(
        "{}{}",
        manifest_revision(profiles_dir, from_id)?,
        manifest_revision(profiles_dir, to_id)?
    );
    let blocked = crate::switch::validate_profile_switch_target(profiles_dir, tf2_root, to_id)
        .err()
        .map(|err| err.message());
    Ok(compare_sides(&from, &to, revision, blocked))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn managed_values_parse_binds_unbinds_and_skip_credentials() {
        let values = managed_values(
            "// execs gameplay\nfov_desired 90\nbind \"MOUSE4\" \"+jump\" // jump\nunbind e\npassword hunter2\nrcon_password \"x y\"\nexec other\n",
        );
        assert_eq!(values.get("fov_desired").map(String::as_str), Some("90"));
        assert_eq!(values.get("bind mouse4").map(String::as_str), Some("+jump"));
        assert_eq!(values.get("bind e").map(String::as_str), Some("(nothing)"));
        assert!(!values.contains_key("password"));
        assert!(!values.contains_key("rcon_password"));
        assert!(!values.contains_key("exec"));
    }

    fn write(path: &Path, text: &str) {
        std::fs::create_dir_all(path.parent().unwrap()).unwrap();
        std::fs::write(path, text).unwrap();
    }

    #[test]
    fn compares_two_saved_profiles_without_changing_either() {
        use crate::profile::{
            duplicate_profile_to, mutate_profile_files_to, save_current_as_to, FileSource,
            ProfileLiveProjection, SaveCurrentOptions,
        };
        let dir = crate::test_temp_dir();
        let profiles = dir.join("profiles");
        let root = dir.join("Team Fortress 2");
        write(&root.join("tf/steam.inf"), "appID=440\n");
        write(&root.join("tf/cfg/config.cfg"), "bind w +forward\n");
        write(
            &root.join("tf/cfg/overrides/execs_gameplay.cfg"),
            "fov_desired 90\npassword hunter2\n",
        );
        write(&root.join("tf/custom/pack/materials/a.vmt"), "pack\n");
        crate::cfg_layer::write_test_base(&root);
        let library = save_current_as_to(
            &profiles,
            &root,
            "Main",
            ["not-running"],
            SaveCurrentOptions {
                launch_options: Some("-novid +password secret"),
                cloud_config: None,
            },
        )
        .unwrap();
        let main = library.profiles[0].id.clone();
        let library =
            duplicate_profile_to(&profiles, &root, &main, "Casual", ["not-running"]).unwrap();
        let casual = library
            .profiles
            .iter()
            .find(|profile| profile.id != main)
            .unwrap()
            .id
            .clone();

        let same = compare_profiles(&profiles, &root, &main, &casual).unwrap();
        assert_eq!(same.launch_options, None);
        assert!(same.packs.is_empty() && same.cfg_files.is_empty() && same.values.is_empty());
        assert!(!same.config_cfg_changed);
        assert_eq!(same.blocked, None);

        mutate_profile_files_to(
            &profiles,
            &root,
            &casual,
            &[
                (
                    "tf/cfg/overrides/execs_gameplay.cfg".into(),
                    FileSource::Bytes(b"fov_desired 75\npassword other\n"),
                ),
                (
                    "tf/custom/other/materials/b.vmt".into(),
                    FileSource::Bytes(b"other\n"),
                ),
            ],
            &["tf/custom/pack/materials/a.vmt".into()],
            ProfileLiveProjection::LibraryOnly,
            ["not-running"],
            |manifest| {
                manifest.launch_options = "-novid +password other -high".into();
                Ok(())
            },
        )
        .unwrap();
        let before: Vec<Vec<u8>> = [&main, &casual]
            .iter()
            .map(|id| std::fs::read(manifest_file(&profiles, id)).unwrap())
            .collect();

        let diff = compare_profiles(&profiles, &root, &main, &casual).unwrap();
        assert_eq!(diff.from_name, "Main");
        assert_eq!(diff.to_name, "Casual");
        assert_ne!(diff.revision, same.revision);
        assert_eq!(
            diff.launch_options,
            Some(TextChange {
                from: Some("-novid +password •••".into()),
                to: Some("-novid +password ••• -high".into()),
            })
        );
        assert_eq!(diff.packs.added, ["other"]);
        assert_eq!(diff.packs.removed, ["pack"]);
        assert_eq!(
            diff.cfg_files.changed,
            ["tf/cfg/overrides/execs_gameplay.cfg"]
        );
        assert_eq!(
            diff.values,
            [ValueChange {
                name: "fov_desired".into(),
                from: Some("90".into()),
                to: Some("75".into()),
            }]
        );
        let json = serde_json::to_string(&diff).unwrap();
        assert!(
            !json.contains("hunter2") && !json.contains("secret") && !json.contains("other\\n")
        );
        let after: Vec<Vec<u8>> = [&main, &casual]
            .iter()
            .map(|id| std::fs::read(manifest_file(&profiles, id)).unwrap())
            .collect();
        assert_eq!(before, after);
        std::fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn launch_credentials_are_redacted() {
        assert_eq!(
            redact_launch("-novid +password secret +exec x"),
            "-novid +password ••• +exec x"
        );
    }

    #[test]
    fn set_changes_report_added_removed_and_changed_names() {
        let from = BTreeMap::from([("a".into(), "1".into()), ("b".into(), "2".into())]);
        let to = BTreeMap::from([("b".into(), "3".into()), ("c".into(), "4".into())]);
        assert_eq!(
            set_change(&from, &to),
            SetChange {
                added: vec!["c".into()],
                removed: vec!["a".into()],
                changed: vec!["b".into()],
            }
        );
    }
}
