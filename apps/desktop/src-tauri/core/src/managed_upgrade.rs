//! Bringing execs-managed files that older versions wrote up to date.
//!
//! Some files execs writes into a profile changed format after release: the
//! Casual preload hook, bind key names and a cheat-only Gameplay line. A
//! profile keeps its old copy until the matching pane saves again, which for
//! an unused pane or an inactive profile may be never. This module rewrites
//! only what is recognisably execs' own older output:
//!
//! * the preload hook, only when its whole text is a version execs shipped;
//! * a bind or unbind key that TF2 rejects and older execs recorded
//!   (`semicolin`, `comma`, …), rewriting just that key;
//! * the standalone `r_drawtracers` line, which TF2 refuses from every startup
//!   cfg ("Can't use cheat cvar r_drawtracers in multiplayer").
//!
//! Anything else in those files, and every other file, is left byte for byte.

use std::path::Path;

use serde::{Deserialize, Serialize};

use crate::apply::manifest_source_path;
use crate::hash::read_small_file_bounded;
use crate::profile::{
    load_library_from, load_manifest, mutate_profile_files_to, FileSource, ProfileError,
    ProfileLiveProjection,
};

/// Managed cfgs are small; anything larger is not one execs wrote.
const MAX_MANAGED_BYTES: usize = 256 * 1024;

const PRELOAD_PATHS: [&str; 2] = [
    "tf/cfg/execs_preload.cfg",
    "tf/cfg/overrides/execs_preload.cfg",
];
const BINDS_PATHS: [&str; 2] = ["tf/cfg/execs_binds.cfg", "tf/cfg/overrides/execs_binds.cfg"];
const GAMEPLAY_PATHS: [&str; 2] = [
    "tf/cfg/execs_gameplay.cfg",
    "tf/cfg/overrides/execs_gameplay.cfg",
];

/// Every preload hook text an earlier execs wrote (LF line endings).
const OLD_PRELOAD_HOOKS: [&str; 3] = [
    // First development hook.
    "// execs viewmodel preload — managed, do not edit by hand\nsv_pure 0\nmap itemtest\nwait 5; disconnect\n",
    // Development builds before 0.1.0.
    "// execs preload — managed, do not edit by hand\nsv_pure -1\nsv_allow_point_servercommand always\nmap itemtest\nwait 10; disconnect\nwait 1; clear\nplaymenumusic\n",
    // Released 0.1.0 through 0.1.8: cleared the console, including engine errors.
    "// execs preload — managed, do not edit by hand\nsv_pure -1\nsv_allow_point_servercommand always\nmap itemtest\nwait 10; disconnect\nwait 1; clear\nscript_execute randommenumusic\n",
];

/// Key spellings older execs recorded that TF2's key table does not contain,
/// with TF2's name (as `bind` expects it, quoted where needed).
const LEGACY_KEYS: [(&str, &str); 8] = [
    ("semicolin", "semicolon"),
    ("apostrophe", "\"'\""),
    ("comma", "\",\""),
    ("period", "\".\""),
    ("slash", "\"/\""),
    ("backslash", "\"\\\""),
    ("minus", "\"-\""),
    ("equal", "\"=\""),
];

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum ManagedUpgradeKind {
    /// The Casual preload hook from an older version.
    PreloadHook,
    /// Bind keys recorded with names TF2 does not know.
    BindKeyNames,
    /// The cheat-only `r_drawtracers` line TF2 refuses at startup.
    CheatTracers,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ManagedFileUpgrade {
    pub path: String,
    pub kind: ManagedUpgradeKind,
}

/// The current bytes for a managed file an older execs wrote, or `None` when
/// the file is current, unknown or edited beyond what can be upgraded safely.
pub fn upgrade_managed_file(rel_path: &str, bytes: &[u8]) -> Option<(Vec<u8>, ManagedUpgradeKind)> {
    let text = std::str::from_utf8(bytes).ok()?;
    if PRELOAD_PATHS.contains(&rel_path) {
        let normalized = text.replace("\r\n", "\n");
        return OLD_PRELOAD_HOOKS.contains(&normalized.as_str()).then(|| {
            (
                crate::viewmodel::serialize_preload_cfg().into_bytes(),
                ManagedUpgradeKind::PreloadHook,
            )
        });
    }
    if BINDS_PATHS.contains(&rel_path) {
        let upgraded = repair_legacy_bind_keys(text)?;
        return Some((upgraded.into_bytes(), ManagedUpgradeKind::BindKeyNames));
    }
    if GAMEPLAY_PATHS.contains(&rel_path) {
        let upgraded = crate::managed_cfg::drop_standalone_command(bytes, "r_drawtracers")?;
        return Some((upgraded, ManagedUpgradeKind::CheatTracers));
    }
    None
}

/// Rewrite the key of each single-command `bind`/`unbind` line whose key is a
/// legacy execs spelling. `None` when no line needs it.
fn repair_legacy_bind_keys(text: &str) -> Option<String> {
    let mut changed = false;
    let mut out = String::with_capacity(text.len());
    for line in text.split_inclusive('\n') {
        match repaired_bind_line(line) {
            Some(repaired) => {
                out.push_str(&repaired);
                changed = true;
            }
            None => out.push_str(line),
        }
    }
    changed.then_some(out)
}

fn repaired_bind_line(line: &str) -> Option<String> {
    let start = line.len() - line.trim_start().len();
    let rest = &line[start..];
    let word_end = rest.find(|ch: char| ch.is_whitespace())?;
    let word = &rest[..word_end];
    if !word.eq_ignore_ascii_case("bind") && !word.eq_ignore_ascii_case("unbind") {
        return None;
    }
    let after_word = &rest[word_end..];
    let key_start = start + word_end + (after_word.len() - after_word.trim_start().len());
    let tail = &line[key_start..];
    let (key, key_len) = if let Some(quoted) = tail.strip_prefix('"') {
        let close = quoted.find('"')?;
        (&quoted[..close], close + 2)
    } else {
        let end = tail
            .find(|ch: char| ch.is_whitespace() || ch == ';' || ch == '"')
            .unwrap_or(tail.len());
        (&tail[..end], end)
    };
    // One command per line: a `;` outside quotes would make the key ambiguous.
    let remainder = &line[key_start + key_len..];
    if remainder
        .split('"')
        .step_by(2)
        .any(|part| part.contains(';'))
    {
        return None;
    }
    let replacement = LEGACY_KEYS
        .iter()
        .find(|(legacy, _)| key.eq_ignore_ascii_case(legacy))?
        .1;
    Some(format!(
        "{}{}{}",
        &line[..key_start],
        replacement,
        remainder
    ))
}

/// Upgrade one profile's managed files in a single profile transaction. For
/// the active profile the live copy is rewritten too, and only when it still
/// matches the saved copy: unabsorbed edits wait for absorb, never overwritten.
pub fn upgrade_profile_managed_files_to<I, S>(
    profiles_dir: &Path,
    tf2_root: &Path,
    profile_id: &str,
    running_names: I,
) -> Result<Vec<ManagedFileUpgrade>, ProfileError>
where
    I: IntoIterator<Item = S>,
    S: AsRef<str>,
{
    let manifest = load_manifest(profiles_dir, profile_id)?;
    let library = load_library_from(profiles_dir, Some(tf2_root))?;
    let active = library.active_profile_id.as_deref() == Some(profile_id);
    let mut puts: Vec<(String, Vec<u8>)> = Vec::new();
    let mut upgrades = Vec::new();
    for file in &manifest.files {
        if !PRELOAD_PATHS.contains(&file.path.as_str())
            && !BINDS_PATHS.contains(&file.path.as_str())
            && !GAMEPLAY_PATHS.contains(&file.path.as_str())
        {
            continue;
        }
        let source = manifest_source_path(profiles_dir, profile_id, file)?;
        let Ok(saved) = read_small_file_bounded(&source, MAX_MANAGED_BYTES) else {
            continue;
        };
        let Some((upgraded, kind)) = upgrade_managed_file(&file.path, &saved) else {
            continue;
        };
        if active {
            let live = read_small_file_bounded(&tf2_root.join(&file.path), MAX_MANAGED_BYTES);
            if !live.is_ok_and(|live| live == saved) {
                continue;
            }
        }
        puts.push((file.path.clone(), upgraded));
        upgrades.push(ManagedFileUpgrade {
            path: file.path.clone(),
            kind,
        });
    }
    if puts.is_empty() {
        return Ok(upgrades);
    }
    let sources: Vec<(String, FileSource<'_>)> = puts
        .iter()
        .map(|(path, bytes)| (path.clone(), FileSource::Bytes(bytes)))
        .collect();
    mutate_profile_files_to(
        profiles_dir,
        tf2_root,
        profile_id,
        &sources,
        &[],
        ProfileLiveProjection::MirrorIfActive,
        running_names,
        |_| Ok(()),
    )?;
    Ok(upgrades)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use std::path::PathBuf;

    const V018_HOOK: &str = OLD_PRELOAD_HOOKS[2];

    #[test]
    fn replaces_only_preload_hooks_execs_shipped() {
        for old in OLD_PRELOAD_HOOKS {
            let (bytes, kind) =
                upgrade_managed_file("tf/cfg/overrides/execs_preload.cfg", old.as_bytes()).unwrap();
            assert_eq!(kind, ManagedUpgradeKind::PreloadHook);
            let text = String::from_utf8(bytes).unwrap();
            assert!(!text.contains("clear"));
            assert!(!text.contains("menumusic"));
            assert_eq!(text, crate::viewmodel::serialize_preload_cfg());
        }
        let crlf = V018_HOOK.replace('\n', "\r\n");
        assert!(upgrade_managed_file("tf/cfg/execs_preload.cfg", crlf.as_bytes()).is_some());
        // Current, hand-edited and unrelated files stay as they are.
        let current = crate::viewmodel::serialize_preload_cfg();
        assert!(upgrade_managed_file("tf/cfg/execs_preload.cfg", current.as_bytes()).is_none());
        let edited = format!("{V018_HOOK}echo mine\n");
        assert!(upgrade_managed_file("tf/cfg/execs_preload.cfg", edited.as_bytes()).is_none());
        assert!(upgrade_managed_file("tf/cfg/my_preload.cfg", V018_HOOK.as_bytes()).is_none());
    }

    #[test]
    fn repairs_legacy_bind_keys_and_keeps_every_other_byte() {
        let text = "// execs binds — header\r\nbind semicolin +jump\r\nbind \"comma\" \"changeclass\" // execs:custom-bind\r\n  UNBIND backslash\r\nbind w +forward\r\nbind period \"say a; say b\"\r\nbind slash +duck; echo x\r\n";
        let (bytes, kind) =
            upgrade_managed_file("tf/cfg/execs_binds.cfg", text.as_bytes()).unwrap();
        assert_eq!(kind, ManagedUpgradeKind::BindKeyNames);
        assert_eq!(
            String::from_utf8(bytes).unwrap(),
            "// execs binds — header\r\nbind semicolon +jump\r\nbind \",\" \"changeclass\" // execs:custom-bind\r\n  UNBIND \"\\\"\r\nbind w +forward\r\nbind \".\" \"say a; say b\"\r\nbind slash +duck; echo x\r\n"
        );
        assert!(upgrade_managed_file(
            "tf/cfg/execs_binds.cfg",
            b"bind semicolon +jump\nbind \",\" +duck\n"
        )
        .is_none());
    }

    #[test]
    fn drops_only_the_standalone_cheat_tracer_line() {
        let text = b"// execs gameplay\nfov_desired 90\nr_drawtracers_firstperson 1\nr_drawtracers 0\nsensitivity 2\n";
        let (bytes, kind) = upgrade_managed_file("tf/cfg/execs_gameplay.cfg", text).unwrap();
        assert_eq!(kind, ManagedUpgradeKind::CheatTracers);
        assert_eq!(
            bytes,
            b"// execs gameplay\nfov_desired 90\nr_drawtracers_firstperson 1\nsensitivity 2\n"
        );
        assert!(upgrade_managed_file("tf/cfg/execs_gameplay.cfg", b"fov_desired 90\n").is_none());
    }

    fn tf2(root: &Path) {
        fs::create_dir_all(root.join("tf/cfg")).unwrap();
        fs::create_dir_all(root.join("tf/custom")).unwrap();
        fs::write(root.join("tf/steam.inf"), "appID=440\n").unwrap();
    }

    fn saved_profile(dir: &Path, hook: &str) -> (PathBuf, PathBuf, String) {
        let profiles = dir.join("execs").join("profiles");
        let root = dir.join("Team Fortress 2");
        tf2(&root);
        fs::write(root.join("tf/cfg/config.cfg"), "bind w +forward\n").unwrap();
        fs::write(root.join("tf/cfg/execs_preload.cfg"), hook).unwrap();
        fs::write(
            root.join("tf/cfg/execs_gameplay.cfg"),
            "r_drawtracers 0\nfov_desired 90\n",
        )
        .unwrap();
        let library = crate::profile::save_current_as_to(
            &profiles,
            &root,
            "Low",
            ["explorer.exe"],
            crate::profile::SaveCurrentOptions::default(),
        )
        .unwrap();
        let id = library.profiles[0].id.clone();
        (profiles, root, id)
    }

    #[test]
    fn upgrades_the_active_profile_library_and_live_copies_together() {
        let dir = crate::test_temp_dir();
        let (profiles, root, id) = saved_profile(&dir, V018_HOOK);
        let upgrades =
            upgrade_profile_managed_files_to(&profiles, &root, &id, ["explorer.exe"]).unwrap();
        assert_eq!(upgrades.len(), 2);
        let hook = fs::read_to_string(root.join("tf/cfg/execs_preload.cfg")).unwrap();
        assert_eq!(hook, crate::viewmodel::serialize_preload_cfg());
        assert_eq!(
            fs::read_to_string(root.join("tf/cfg/execs_gameplay.cfg")).unwrap(),
            "fov_desired 90\n"
        );
        let manifest = load_manifest(&profiles, &id).unwrap();
        let saved = manifest
            .files
            .iter()
            .find(|file| file.path == "tf/cfg/execs_preload.cfg")
            .unwrap();
        assert_eq!(
            fs::read_to_string(manifest_source_path(&profiles, &id, saved).unwrap()).unwrap(),
            hook
        );
        // Running it again changes nothing.
        assert!(
            upgrade_profile_managed_files_to(&profiles, &root, &id, ["explorer.exe"])
                .unwrap()
                .is_empty()
        );
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn switching_to_a_profile_saved_by_0_1_x_installs_the_current_hook() {
        let dir = crate::test_temp_dir();
        let (profiles, root, low) = saved_profile(&dir, V018_HOOK);
        let other =
            crate::profile::create_profile_record_to(&profiles, &root, "Other", ["explorer.exe"])
                .unwrap()
                .profiles
                .into_iter()
                .find(|profile| profile.id != low)
                .unwrap()
                .id;
        let switch = |id: &str| {
            crate::switch::switch_profile_to(
                &profiles,
                &root,
                id,
                ["explorer.exe"],
                crate::absorb::AbsorbOptions::default(),
                |_| {},
            )
            .unwrap()
        };
        switch(&other);
        assert!(!root.join("tf/cfg/execs_preload.cfg").exists());
        // Simulate the old hook still saved in the inactive profile.
        let manifest = load_manifest(&profiles, &low).unwrap();
        let saved = manifest
            .files
            .iter()
            .find(|file| file.path == "tf/cfg/execs_preload.cfg")
            .unwrap();
        assert_eq!(
            fs::read_to_string(manifest_source_path(&profiles, &low, saved).unwrap()).unwrap(),
            V018_HOOK
        );
        assert_eq!(
            switch(&low).active_profile_id.as_deref(),
            Some(low.as_str())
        );
        assert_eq!(
            fs::read_to_string(root.join("tf/cfg/execs_preload.cfg")).unwrap(),
            crate::viewmodel::serialize_preload_cfg()
        );
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn leaves_live_edits_for_absorb_and_refuses_while_tf2_runs() {
        let dir = crate::test_temp_dir();
        let (profiles, root, id) = saved_profile(&dir, V018_HOOK);
        fs::write(root.join("tf/cfg/execs_preload.cfg"), "echo hand edit\n").unwrap();
        assert!(matches!(
            upgrade_profile_managed_files_to(&profiles, &root, &id, ["tf_win64.exe"]),
            Err(ProfileError::GameRunning)
        ));
        let upgrades =
            upgrade_profile_managed_files_to(&profiles, &root, &id, ["explorer.exe"]).unwrap();
        assert_eq!(
            upgrades,
            vec![ManagedFileUpgrade {
                path: "tf/cfg/execs_gameplay.cfg".into(),
                kind: ManagedUpgradeKind::CheatTracers
            }]
        );
        assert_eq!(
            fs::read_to_string(root.join("tf/cfg/execs_preload.cfg")).unwrap(),
            "echo hand edit\n"
        );
        let _ = fs::remove_dir_all(&dir);
    }
}
