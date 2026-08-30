//! Exact-replace profile switch with real progress steps (RND-149).

use std::fs;
use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};

use crate::absorb::{
    absorb_owned_to, absorb_packs_to, pack_key, write_config_cfg_dual_to, AbsorbOptions, PackChoice,
};
use crate::hud::{hud_packs, live_hud_names};
use crate::blob::blob_path;
use crate::hash::{copy_and_sha256, sha256_file};
use crate::process_lock::{live_process_names, refuse_if_running_among};
use crate::profile::{
    exclusive_file_path, is_forbidden_rel_path, load_library_from, load_manifest, profiles_dir,
    set_active_profile_to, FileStorage, ProfileError, ProfileFile, ProfileLibrary, ProfileManifest,
};

const CONFIG_CFG: &str = "tf/cfg/config.cfg";

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum SwitchStep {
    Closed,
    Pack,
    Remove,
    Write,
    Cloud,
    Done,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SwitchProgress {
    pub step: SwitchStep,
    pub detail: Option<String>,
}

impl SwitchProgress {
    fn new(step: SwitchStep) -> Self {
        Self { step, detail: None }
    }
}

pub fn switch_profile(tf2_root: &Path, profile_id: &str) -> Result<ProfileLibrary, ProfileError> {
    switch_profile_with_progress(tf2_root, profile_id, |_| {})
}

pub fn switch_profile_with_progress<F>(
    tf2_root: &Path,
    profile_id: &str,
    progress: F,
) -> Result<ProfileLibrary, ProfileError>
where
    F: FnMut(SwitchProgress),
{
    switch_profile_to(
        &profiles_dir(),
        tf2_root,
        profile_id,
        live_process_names(),
        AbsorbOptions::default(),
        progress,
    )
}

pub fn switch_profile_to<I, S, F>(
    profiles_dir: &Path,
    tf2_root: &Path,
    profile_id: &str,
    running_names: I,
    options: AbsorbOptions<'_>,
    mut progress: F,
) -> Result<ProfileLibrary, ProfileError>
where
    I: IntoIterator<Item = S>,
    S: AsRef<str>,
    F: FnMut(SwitchProgress),
{
    let running: Vec<String> = running_names
        .into_iter()
        .map(|name| name.as_ref().to_string())
        .collect();
    progress(SwitchProgress::new(SwitchStep::Closed));
    refuse_if_running_among(&running)?;

    let library = load_library_from(profiles_dir, Some(tf2_root))?;
    if !library.usable {
        return Err(ProfileError::NotInitialized);
    }
    if !library.profiles.iter().any(|profile| profile.id == profile_id) {
        return Err(ProfileError::UnknownProfile);
    }
    if library.active_profile_id.as_deref() == Some(profile_id) {
        progress(SwitchProgress::new(SwitchStep::Done));
        return Ok(library);
    }

    let live_huds = live_hud_names(tf2_root);
    let previous = library.active_profile_id.clone();
    if let Some(active) = previous.as_deref() {
        progress(SwitchProgress::new(SwitchStep::Pack));
        absorb_owned_to(profiles_dir, tf2_root, &running, clone_options(&options))?;
        absorb_packs_to(
            profiles_dir,
            tf2_root,
            PackChoice::Update,
            &running,
            clone_options(&options),
        )?;
        progress(SwitchProgress::new(SwitchStep::Remove));
        remove_unmodified_live(profiles_dir, tf2_root, active)?;
    } else {
        progress(SwitchProgress::new(SwitchStep::Pack));
        progress(SwitchProgress::new(SwitchStep::Remove));
    }

    let target = load_manifest(profiles_dir, profile_id)?;
    progress(SwitchProgress::new(SwitchStep::Write));
    write_target_live(profiles_dir, tf2_root, &target, &live_huds)?;

    progress(SwitchProgress::new(SwitchStep::Cloud));
    dual_write_target_config(tf2_root, profiles_dir, &target, &options)?;
    let steam_roots = match options.steam_roots {
        Some(roots) => roots.to_vec(),
        None => crate::finder::discover_steam_roots(),
    };
    let _ = crate::launch::write_launch_options_to_localconfig_from(
        &steam_roots,
        &target.launch_options,
        &running,
    );

    progress(SwitchProgress::new(SwitchStep::Done));
    set_active_profile_to(profiles_dir, tf2_root, profile_id, &running)
}

fn clone_options<'a>(options: &'a AbsorbOptions<'a>) -> AbsorbOptions<'a> {
    AbsorbOptions {
        cloud_config: options.cloud_config,
        steam_roots: options.steam_roots,
    }
}

fn remove_unmodified_live(
    profiles_dir: &Path,
    tf2_root: &Path,
    profile_id: &str,
) -> Result<(), ProfileError> {
    let manifest = load_manifest(profiles_dir, profile_id)?;
    for file in &manifest.files {
        for candidate in live_candidates(tf2_root, &file.path) {
            if !candidate.is_file() {
                continue;
            }
            let hash = sha256_file(&candidate).map_err(|e| ProfileError::Io(e.to_string()))?;
            if hash == file.sha256 {
                fs::remove_file(&candidate).map_err(|e| ProfileError::Io(e.to_string()))?;
                prune_empty_parents(&candidate, tf2_root);
            }
        }
    }
    Ok(())
}

fn write_target_live(
    profiles_dir: &Path,
    tf2_root: &Path,
    target: &ProfileManifest,
    live_huds: &[String],
) -> Result<(), ProfileError> {
    let preferred_hud = preferred_hud(target, live_huds);
    let extra_huds = extra_hud_packs(&target.files, preferred_hud.as_deref());
    for file in &target.files {
        if is_forbidden_rel_path(&file.path) {
            return Err(ProfileError::ForbiddenPath(file.path.clone()));
        }
        let dest_rel = rewrite_extra_hud_path(&file.path, &extra_huds);
        let source = match file.storage {
            FileStorage::Shared => blob_path(profiles_dir, &file.sha256),
            FileStorage::Exclusive => exclusive_file_path(profiles_dir, &target.id, &file.path),
        };
        if !source.is_file() {
            return Err(ProfileError::Io(format!(
                "Profile file missing: {}",
                file.path
            )));
        }
        let dest = live_path(tf2_root, &dest_rel);
        copy_and_sha256(&source, &dest).map_err(|e| ProfileError::Io(e.to_string()))?;
    }
    Ok(())
}

fn dual_write_target_config(
    tf2_root: &Path,
    profiles_dir: &Path,
    target: &ProfileManifest,
    options: &AbsorbOptions<'_>,
) -> Result<(), ProfileError> {
    let Some(file) = target.files.iter().find(|file| file.path == CONFIG_CFG) else {
        return Ok(());
    };
    let source = exclusive_file_path(profiles_dir, &target.id, &file.path);
    if !source.is_file() {
        return Ok(());
    }
    let bytes = fs::read(&source).map_err(|e| ProfileError::Io(e.to_string()))?;
    let roots = match options.steam_roots {
        Some(roots) => roots.to_vec(),
        None => crate::finder::discover_steam_roots(),
    };
    write_config_cfg_dual_to(tf2_root, &bytes, &roots)
}

fn preferred_hud(target: &ProfileManifest, live_huds: &[String]) -> Option<String> {
    let mut target_huds = hud_packs(&target.files);
    if target_huds.is_empty() {
        return None;
    }
    if let Some(hud) = &target.hud {
        if target_huds.iter().any(|pack| pack == &hud.id) {
            return Some(hud.id.clone());
        }
    }
    for live in live_huds {
        if target_huds.iter().any(|hud| hud == live) {
            return Some(live.clone());
        }
    }
    target_huds.sort();
    target_huds.into_iter().next()
}

fn extra_hud_packs(files: &[ProfileFile], preferred: Option<&str>) -> Vec<String> {
    hud_packs(files)
        .into_iter()
        .filter(|hud| preferred != Some(hud.as_str()))
        .collect()
}

fn rewrite_extra_hud_path(rel: &str, extra_huds: &[String]) -> String {
    let Some(pack) = pack_key(rel) else {
        return rel.to_string();
    };
    if !extra_huds.iter().any(|hud| hud == &pack) {
        return rel.to_string();
    }
    let Some(rest) = rel.strip_prefix("tf/custom/") else {
        return rel.to_string();
    };
    let (first, after) = rest.split_once('/').unwrap_or((rest, ""));
    let disabled = if first.starts_with('-') {
        first.to_string()
    } else {
        format!("-{first}")
    };
    if after.is_empty() {
        format!("tf/custom/{disabled}")
    } else {
        format!("tf/custom/{disabled}/{after}")
    }
}

fn live_candidates(tf2_root: &Path, rel: &str) -> Vec<PathBuf> {
    let mut out = vec![live_path(tf2_root, rel)];
    if let Some(disabled) = disabled_custom_rel(rel) {
        out.push(live_path(tf2_root, &disabled));
    }
    out
}

fn disabled_custom_rel(rel: &str) -> Option<String> {
    let rest = rel.strip_prefix("tf/custom/")?;
    if rest.starts_with('-') {
        return None;
    }
    Some(format!("tf/custom/-{rest}"))
}

fn live_path(tf2_root: &Path, rel: &str) -> PathBuf {
    let mut path = tf2_root.to_path_buf();
    for part in rel.split('/') {
        path.push(part);
    }
    path
}

fn prune_empty_parents(start: &Path, tf2_root: &Path) {
    let stop = [
        tf2_root.to_path_buf(),
        tf2_root.join("tf"),
        tf2_root.join("tf").join("cfg"),
        tf2_root.join("tf").join("custom"),
    ];
    let mut current = start.parent().map(Path::to_path_buf);
    while let Some(dir) = current {
        if stop.iter().any(|root| root == &dir) {
            break;
        }
        let empty = fs::read_dir(&dir)
            .ok()
            .is_some_and(|mut entries| entries.next().is_none());
        if !empty {
            break;
        }
        let parent = dir.parent().map(Path::to_path_buf);
        let _ = fs::remove_dir(&dir);
        current = parent;
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::profile::{
        create_profile_record_to, put_exclusive_file_to, save_current_as_to, SaveCurrentOptions,
    };
    use std::io::Write;

    fn unlocked() -> [&'static str; 1] {
        ["bash"]
    }

    fn tf2_name() -> &'static str {
        if cfg!(windows) {
            "tf_win64.exe"
        } else {
            "tf_linux64"
        }
    }

    fn write_live(path: &Path, contents: &str) {
        if let Some(parent) = path.parent() {
            fs::create_dir_all(parent).unwrap();
        }
        fs::write(path, contents).unwrap();
    }

    fn write_file(path: &Path, contents: &str) {
        if let Some(parent) = path.parent() {
            fs::create_dir_all(parent).unwrap();
        }
        let mut file = fs::File::create(path).unwrap();
        file.write_all(contents.as_bytes()).unwrap();
    }

    fn localconfig(options: &str) -> String {
        format!(
            r#""UserLocalConfigStore"
{{
	"Software"
	{{
		"Valve"
		{{
			"Steam"
			{{
				"apps"
				{{
					"440"
					{{
						"LaunchOptions"		"{options}"
					}}
				}}
			}}
		}}
	}}
}}
"#
        )
    }

    fn cleanup(dir: &Path) {
        let _ = fs::remove_dir_all(dir);
    }

    fn save(profiles: &Path, root: &Path, name: &str) -> String {
        save_current_as_to(
            profiles,
            root,
            name,
            unlocked(),
            SaveCurrentOptions {
                launch_options: Some(""),
                cloud_config: None,
            },
        )
        .unwrap()
        .profiles
        .last()
        .unwrap()
        .id
        .clone()
    }

    fn library_profile(profiles: &Path, root: &Path, name: &str, files: &[(&str, &[u8])]) -> String {
        let library = create_profile_record_to(profiles, root, name, unlocked()).unwrap();
        let id = library.profiles.last().unwrap().id.clone();
        for (path, bytes) in files {
            put_exclusive_file_to(profiles, root, &id, path, bytes, unlocked()).unwrap();
        }
        id
    }

    fn steps_of(progress: &[SwitchProgress]) -> Vec<SwitchStep> {
        progress.iter().map(|item| item.step).collect()
    }

    #[test]
    fn switch_replaces_surface_and_keeps_official_files() {
        let dir = crate::test_temp_dir();
        let profiles = dir.join("execs").join("profiles");
        let root = dir.join("Team Fortress 2");
        write_live(&root.join("tf/steam.inf"), "appID=440\n");
        write_live(&root.join("tf/tf2_misc_dir.vpk"), "official\n");
        write_live(&root.join("tf/cfg/config.cfg"), "binds-a\n");
        write_live(&root.join("tf/cfg/overrides/autoexec.cfg"), "fov_desired 90\n");
        write_live(&root.join("tf/custom/hud/resource/ui/hudlayout.res"), "hud-a\n");
        let _a = save(&profiles, &root, "A");
        let b = library_profile(
            &profiles,
            &root,
            "B",
            &[
                ("tf/cfg/config.cfg", b"binds-b\n"),
                ("tf/cfg/overrides/autoexec.cfg", b"fov_desired 110\n"),
                ("tf/custom/alt/note.txt", b"alt\n"),
            ],
        );

        let mut steps = Vec::new();
        let library = switch_profile_to(
            &profiles,
            &root,
            &b,
            unlocked(),
            AbsorbOptions::default(),
            |step| steps.push(step),
        )
        .unwrap();
        assert_eq!(library.active_profile_id.as_deref(), Some(b.as_str()));
        assert_eq!(
            steps_of(&steps),
            vec![
                SwitchStep::Closed,
                SwitchStep::Pack,
                SwitchStep::Remove,
                SwitchStep::Write,
                SwitchStep::Cloud,
                SwitchStep::Done,
            ]
        );
        assert_eq!(
            fs::read(root.join("tf/cfg/overrides/autoexec.cfg")).unwrap(),
            b"fov_desired 110\n"
        );
        assert_eq!(fs::read(root.join("tf/cfg/config.cfg")).unwrap(), b"binds-b\n");
        assert_eq!(fs::read(root.join("tf/custom/alt/note.txt")).unwrap(), b"alt\n");
        assert!(!root.join("tf/custom/hud/resource/ui/hudlayout.res").exists());
        assert_eq!(fs::read(root.join("tf/steam.inf")).unwrap(), b"appID=440\n");
        assert_eq!(
            fs::read(root.join("tf/tf2_misc_dir.vpk")).unwrap(),
            b"official\n"
        );
        assert!(root.join("tf/cfg").is_dir());
        cleanup(&dir);
    }

    #[test]
    fn remove_keeps_modified_and_unknown_files() {
        let dir = crate::test_temp_dir();
        let profiles = dir.join("execs").join("profiles");
        let root = dir.join("Team Fortress 2");
        write_live(&root.join("tf/cfg/config.cfg"), "binds-a\n");
        write_live(&root.join("tf/cfg/overrides/keep.cfg"), "original\n");
        write_live(&root.join("tf/custom/pack/a.txt"), "a\n");
        let a = save(&profiles, &root, "A");
        write_live(&root.join("tf/custom/pack/a.txt"), "user-changed\n");
        write_live(&root.join("tf/custom/stray/extra.txt"), "stray\n");

        remove_unmodified_live(&profiles, &root, &a).unwrap();
        assert_eq!(
            fs::read(root.join("tf/custom/pack/a.txt")).unwrap(),
            b"user-changed\n"
        );
        assert_eq!(
            fs::read(root.join("tf/custom/stray/extra.txt")).unwrap(),
            b"stray\n"
        );
        assert!(!root.join("tf/cfg/overrides/keep.cfg").exists());
        assert!(!root.join("tf/cfg/config.cfg").exists());
        cleanup(&dir);
    }

    #[test]
    fn extra_hud_writes_with_disable_prefix() {
        let dir = crate::test_temp_dir();
        let profiles = dir.join("execs").join("profiles");
        let root = dir.join("Team Fortress 2");
        write_live(&root.join("tf/cfg/config.cfg"), "unbindall\n");
        write_live(&root.join("tf/custom/ahud/info.vdf"), "a\n");
        write_live(&root.join("tf/custom/zhud/info.vdf"), "z\n");
        let both = save(&profiles, &root, "Both");
        let plain = library_profile(
            &profiles,
            &root,
            "Plain",
            &[
                ("tf/cfg/config.cfg", b"unbindall\n"),
                ("tf/custom/plain/note.txt", b"plain\n"),
            ],
        );
        switch_profile_to(
            &profiles,
            &root,
            &plain,
            unlocked(),
            AbsorbOptions::default(),
            |_| {},
        )
        .unwrap();
        switch_profile_to(
            &profiles,
            &root,
            &both,
            unlocked(),
            AbsorbOptions::default(),
            |_| {},
        )
        .unwrap();

        assert!(root.join("tf/custom/ahud/info.vdf").is_file());
        assert!(root.join("tf/custom/-zhud/info.vdf").is_file());
        assert!(!root.join("tf/custom/zhud/info.vdf").exists());
        cleanup(&dir);
    }

    #[test]
    fn prefers_currently_live_hud() {
        let dir = crate::test_temp_dir();
        let profiles = dir.join("execs").join("profiles");
        let root = dir.join("Team Fortress 2");
        write_live(&root.join("tf/cfg/config.cfg"), "unbindall\n");
        write_live(&root.join("tf/custom/ahud/info.vdf"), "a\n");
        write_live(&root.join("tf/custom/zhud/info.vdf"), "z\n");
        let both = save(&profiles, &root, "Both");
        let plain = library_profile(
            &profiles,
            &root,
            "Plain",
            &[("tf/cfg/config.cfg", b"unbindall\n")],
        );
        switch_profile_to(
            &profiles,
            &root,
            &plain,
            unlocked(),
            AbsorbOptions::default(),
            |_| {},
        )
        .unwrap();
        write_live(&root.join("tf/custom/zhud/info.vdf"), "z\n");
        switch_profile_to(
            &profiles,
            &root,
            &both,
            unlocked(),
            AbsorbOptions::default(),
            |_| {},
        )
        .unwrap();

        assert!(root.join("tf/custom/zhud/info.vdf").is_file());
        assert!(root.join("tf/custom/-ahud/info.vdf").is_file());
        cleanup(&dir);
    }

    #[test]
    fn dual_write_on_switch() {
        let dir = crate::test_temp_dir();
        let profiles = dir.join("execs").join("profiles");
        let root = dir.join("Team Fortress 2");
        let steam = dir.join("Steam");
        write_file(
            &steam
                .join("userdata")
                .join("111")
                .join("config")
                .join("localconfig.vdf"),
            &localconfig("-novid"),
        );
        fs::create_dir_all(steam.join("userdata").join("111").join("440")).unwrap();
        write_live(&root.join("tf/cfg/config.cfg"), "binds-a\n");
        let _a = save(&profiles, &root, "A");
        let b = library_profile(&profiles, &root, "B", &[("tf/cfg/config.cfg", b"binds-b\n")]);

        switch_profile_to(
            &profiles,
            &root,
            &b,
            unlocked(),
            AbsorbOptions {
                cloud_config: None,
                steam_roots: Some(std::slice::from_ref(&steam)),
            },
            |_| {},
        )
        .unwrap();
        assert_eq!(fs::read(root.join("tf/cfg/config.cfg")).unwrap(), b"binds-b\n");
        assert_eq!(
            fs::read(
                steam
                    .join("userdata")
                    .join("111")
                    .join("440")
                    .join("remote")
                    .join("cfg")
                    .join("config.cfg")
            )
            .unwrap(),
            b"binds-b\n"
        );
        cleanup(&dir);
    }

    #[test]
    fn refuse_while_running_and_unknown_profile() {
        let dir = crate::test_temp_dir();
        let profiles = dir.join("execs").join("profiles");
        let root = dir.join("Team Fortress 2");
        write_live(&root.join("tf/cfg/config.cfg"), "x\n");
        let a = save(&profiles, &root, "A");
        let err = switch_profile_to(
            &profiles,
            &root,
            &a,
            [tf2_name()],
            AbsorbOptions::default(),
            |_| {},
        )
        .unwrap_err();
        assert_eq!(err, ProfileError::GameRunning);
        let err = switch_profile_to(
            &profiles,
            &root,
            "missing",
            unlocked(),
            AbsorbOptions::default(),
            |_| {},
        )
        .unwrap_err();
        assert_eq!(err, ProfileError::UnknownProfile);
        cleanup(&dir);
    }

    #[test]
    fn switching_to_active_is_noop() {
        let dir = crate::test_temp_dir();
        let profiles = dir.join("execs").join("profiles");
        let root = dir.join("Team Fortress 2");
        write_live(&root.join("tf/cfg/config.cfg"), "x\n");
        let a = save(&profiles, &root, "A");
        let mut steps = Vec::new();
        let library = switch_profile_to(
            &profiles,
            &root,
            &a,
            unlocked(),
            AbsorbOptions::default(),
            |step| steps.push(step),
        )
        .unwrap();
        assert_eq!(library.active_profile_id.as_deref(), Some(a.as_str()));
        assert_eq!(
            steps_of(&steps),
            vec![SwitchStep::Closed, SwitchStep::Done]
        );
        cleanup(&dir);
    }

    #[test]
    fn rewrite_extra_hud_path_prefixes() {
        assert_eq!(
            rewrite_extra_hud_path("tf/custom/zhud/info.vdf", &["zhud".into()]),
            "tf/custom/-zhud/info.vdf"
        );
        assert_eq!(
            rewrite_extra_hud_path("tf/custom/ahud/info.vdf", &["zhud".into()]),
            "tf/custom/ahud/info.vdf"
        );
    }
}
