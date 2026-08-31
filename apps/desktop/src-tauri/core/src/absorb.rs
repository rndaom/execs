//! Absorb live drift into the active profile (RND-150).
//!
//! Owned-file and `config.cfg` changes update the library automatically.
//! New or deleted `tf/custom/` packs wait for an Update / Keep choice.
//! Never rolls the live game folder back to an old snapshot.

use std::collections::{BTreeMap, BTreeSet, HashMap};
use std::fs;
use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};

use crate::finder::discover_steam_roots;
use crate::hash::sha256_file;
use crate::launch::{
    cloud_config_path_from, find_cloud_config, find_cloud_config_from,
};
use crate::process_lock::{live_process_names, refuse_if_running_among};
use crate::profile::{
    is_shared_rel_path, load_library_from, load_manifest, profiles_dir,
    put_exclusive_file_from_path_to, put_shared_blob_from_path_to, remove_manifest_files_to,
    ProfileError, ProfileFile, ProfileLibrary,
};
use crate::surface::inventory_live_surface_with;

const CONFIG_CFG: &str = "tf/cfg/config.cfg";

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum PackChoice {
    Update,
    Keep,
}

#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AbsorbDelta {
    pub owned_changed: Vec<String>,
    pub owned_missing: Vec<String>,
    pub packs_added: Vec<String>,
    pub packs_removed: Vec<String>,
    pub config_cfg: bool,
}

impl AbsorbDelta {
    pub fn empty() -> Self {
        Self::default()
    }

    pub fn has_pack_changes(&self) -> bool {
        !self.packs_added.is_empty() || !self.packs_removed.is_empty()
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AbsorbOwnedResult {
    pub library: ProfileLibrary,
    pub delta: AbsorbDelta,
    /// True only when this absorb observed and stored a changed config.cfg.
    pub config_cfg_absorbed: bool,
}

#[derive(Debug, Clone, Default)]
pub struct AbsorbOptions<'a> {
    pub cloud_config: Option<&'a Path>,
    pub steam_roots: Option<&'a [PathBuf]>,
}

/// Top-level `tf/custom/` pack identity. A leading `-` is the Source disable prefix.
pub fn pack_key(rel: &str) -> Option<String> {
    let rest = rel.strip_prefix("tf/custom/")?;
    let first = rest.split('/').next()?;
    if first.is_empty() {
        return None;
    }
    let name = first.strip_prefix('-').unwrap_or(first);
    if name.is_empty() {
        return None;
    }
    Some(name.to_ascii_lowercase())
}

pub fn write_config_cfg_dual(tf2_root: &Path, bytes: &[u8]) -> Result<(), ProfileError> {
    write_config_cfg_dual_to(tf2_root, bytes, &discover_steam_roots())
}

pub fn write_config_cfg_dual_to(
    tf2_root: &Path,
    bytes: &[u8],
    steam_roots: &[PathBuf],
) -> Result<(), ProfileError> {
    let live = tf2_root.join("tf").join("cfg").join("config.cfg");
    write_bytes(&live, bytes)?;
    if let Some(cloud) = cloud_config_path_from(steam_roots) {
        write_bytes(&cloud, bytes)?;
    }
    Ok(())
}

pub fn scan_absorb_delta(tf2_root: &Path) -> Result<AbsorbDelta, ProfileError> {
    let cloud = find_cloud_config();
    scan_absorb_delta_to(
        &profiles_dir(),
        tf2_root,
        AbsorbOptions {
            cloud_config: cloud.as_deref(),
            steam_roots: None,
        },
    )
}

pub fn scan_absorb_delta_to(
    profiles_dir: &Path,
    tf2_root: &Path,
    options: AbsorbOptions<'_>,
) -> Result<AbsorbDelta, ProfileError> {
    let Some(profile_id) = active_profile_id(profiles_dir, tf2_root)? else {
        return Ok(AbsorbDelta::empty());
    };
    let classified = classify(profiles_dir, tf2_root, &profile_id, &options)?;
    Ok(classified.delta)
}

pub fn absorb_owned(tf2_root: &Path) -> Result<AbsorbOwnedResult, ProfileError> {
    let cloud = find_cloud_config();
    absorb_owned_to(
        &profiles_dir(),
        tf2_root,
        live_process_names(),
        AbsorbOptions {
            cloud_config: cloud.as_deref(),
            steam_roots: None,
        },
    )
}

pub fn absorb_owned_to<I, S>(
    profiles_dir: &Path,
    tf2_root: &Path,
    running_names: I,
    options: AbsorbOptions<'_>,
) -> Result<AbsorbOwnedResult, ProfileError>
where
    I: IntoIterator<Item = S>,
    S: AsRef<str>,
{
    let running = collect_running(running_names);
    refuse_if_running_among(&running)?;
    let library = load_library_from(profiles_dir, Some(tf2_root))?;
    let Some(profile_id) = library.active_profile_id.clone() else {
        return Ok(AbsorbOwnedResult {
            library,
            delta: AbsorbDelta::empty(),
            config_cfg_absorbed: false,
        });
    };

    let classified = classify(profiles_dir, tf2_root, &profile_id, &options)?;
    let config_cfg_absorbed = classified.delta.config_cfg;
    for path in &classified.delta.owned_changed {
        put_live_file(
            profiles_dir,
            tf2_root,
            &profile_id,
            path,
            &classified.live,
            &running,
        )?;
    }
    if !classified.delta.owned_missing.is_empty() {
        remove_manifest_files_to(
            profiles_dir,
            tf2_root,
            &profile_id,
            &classified.delta.owned_missing,
            &running,
        )?;
    }

    dual_write_config(tf2_root, &classified, &options)?;

    let mut remaining = classified.delta;
    remaining.owned_changed.clear();
    remaining.owned_missing.clear();
    remaining.config_cfg = false;

    Ok(AbsorbOwnedResult {
        library: load_library_from(profiles_dir, Some(tf2_root))?,
        delta: remaining,
        config_cfg_absorbed,
    })
}

pub fn absorb_packs(tf2_root: &Path, choice: PackChoice) -> Result<ProfileLibrary, ProfileError> {
    let cloud = find_cloud_config();
    absorb_packs_to(
        &profiles_dir(),
        tf2_root,
        choice,
        live_process_names(),
        AbsorbOptions {
            cloud_config: cloud.as_deref(),
            steam_roots: None,
        },
    )
}

pub fn absorb_packs_to<I, S>(
    profiles_dir: &Path,
    tf2_root: &Path,
    choice: PackChoice,
    running_names: I,
    options: AbsorbOptions<'_>,
) -> Result<ProfileLibrary, ProfileError>
where
    I: IntoIterator<Item = S>,
    S: AsRef<str>,
{
    let running = collect_running(running_names);
    refuse_if_running_among(&running)?;
    let library = load_library_from(profiles_dir, Some(tf2_root))?;
    let Some(profile_id) = library.active_profile_id.clone() else {
        return Ok(library);
    };
    if choice == PackChoice::Keep {
        return load_library_from(profiles_dir, Some(tf2_root));
    }

    let classified = classify(profiles_dir, tf2_root, &profile_id, &options)?;
    for pack in &classified.delta.packs_added {
        for path in classified.pack_live_files.get(pack).into_iter().flatten() {
            put_live_file(
                profiles_dir,
                tf2_root,
                &profile_id,
                path,
                &classified.live,
                &running,
            )?;
        }
    }
    let mut remove = Vec::new();
    for pack in &classified.delta.packs_removed {
        if let Some(paths) = classified.pack_manifest_files.get(pack) {
            remove.extend(paths.iter().cloned());
        }
    }
    if !remove.is_empty() {
        remove_manifest_files_to(profiles_dir, tf2_root, &profile_id, &remove, &running)?;
    }
    load_library_from(profiles_dir, Some(tf2_root))
}

fn collect_running<I, S>(running_names: I) -> Vec<String>
where
    I: IntoIterator<Item = S>,
    S: AsRef<str>,
{
    running_names
        .into_iter()
        .map(|name| name.as_ref().to_string())
        .collect()
}

fn active_profile_id(
    profiles_dir: &Path,
    tf2_root: &Path,
) -> Result<Option<String>, ProfileError> {
    Ok(load_library_from(profiles_dir, Some(tf2_root))?.active_profile_id)
}

struct Classified {
    delta: AbsorbDelta,
    live: HashMap<String, PathBuf>,
    pack_live_files: BTreeMap<String, Vec<String>>,
    pack_manifest_files: BTreeMap<String, Vec<String>>,
}

fn classify(
    profiles_dir: &Path,
    tf2_root: &Path,
    profile_id: &str,
    options: &AbsorbOptions<'_>,
) -> Result<Classified, ProfileError> {
    let cloud = resolve_inventory_cloud(options);
    let inventory = inventory_live_surface_with(tf2_root, cloud.as_deref())?;
    let mut live = HashMap::new();
    for entry in inventory.entries {
        live.insert(entry.dest_rel, entry.source);
    }
    let manifest = load_manifest(profiles_dir, profile_id)?;
    let manifest_paths: BTreeSet<String> = manifest.files.iter().map(|file| file.path.clone()).collect();

    let mut owned_changed = Vec::new();
    let mut owned_missing = Vec::new();
    let mut config_cfg = false;

    for file in &manifest.files {
        match live.get(&file.path) {
            Some(source) => {
                let hash = sha256_file(source).map_err(|e| ProfileError::Io(e.to_string()))?;
                if hash != file.sha256 {
                    owned_changed.push(file.path.clone());
                    if file.path == CONFIG_CFG {
                        config_cfg = true;
                    }
                }
            }
            None if pack_key(&file.path).is_none() => {
                owned_missing.push(file.path.clone());
                if file.path == CONFIG_CFG {
                    config_cfg = true;
                }
            }
            None => {}
        }
    }

    for path in live.keys() {
        if manifest_paths.contains(path) || pack_key(path).is_some() {
            continue;
        }
        owned_changed.push(path.clone());
        if path == CONFIG_CFG {
            config_cfg = true;
        }
    }

    for path in live.keys() {
        if pack_key(path).is_some() && !manifest_paths.contains(path) {
            if let Some(pack) = pack_key(path) {
                if manifest_pack_keys(&manifest.files).contains(&pack) {
                    owned_changed.push(path.clone());
                }
            }
        }
    }

    owned_changed.sort();
    owned_changed.dedup();
    owned_missing.sort();

    let pack_live_files = group_by_pack(live.keys());
    let pack_manifest_files = group_by_pack(manifest_paths.iter());
    let live_packs: BTreeSet<String> = pack_live_files.keys().cloned().collect();
    let manifest_packs: BTreeSet<String> = pack_manifest_files.keys().cloned().collect();
    let packs_added: Vec<String> = live_packs.difference(&manifest_packs).cloned().collect();
    let packs_removed: Vec<String> = manifest_packs.difference(&live_packs).cloned().collect();

    if live.contains_key(CONFIG_CFG) && !manifest_paths.contains(CONFIG_CFG) {
        config_cfg = true;
    }

    Ok(Classified {
        delta: AbsorbDelta {
            owned_changed,
            owned_missing,
            packs_added,
            packs_removed,
            config_cfg,
        },
        live,
        pack_live_files,
        pack_manifest_files,
    })
}

fn manifest_pack_keys(files: &[ProfileFile]) -> BTreeSet<String> {
    files.iter().filter_map(|file| pack_key(&file.path)).collect()
}

fn group_by_pack<'a>(paths: impl Iterator<Item = &'a String>) -> BTreeMap<String, Vec<String>> {
    let mut groups = BTreeMap::new();
    for path in paths {
        if let Some(pack) = pack_key(path) {
            groups.entry(pack).or_insert_with(Vec::new).push(path.clone());
        }
    }
    for files in groups.values_mut() {
        files.sort();
    }
    groups
}

fn resolve_inventory_cloud(options: &AbsorbOptions<'_>) -> Option<PathBuf> {
    if let Some(path) = options.cloud_config {
        return Some(path.to_path_buf());
    }
    if let Some(roots) = options.steam_roots {
        return find_cloud_config_from(roots);
    }
    None
}

fn put_live_file<I, S>(
    profiles_dir: &Path,
    tf2_root: &Path,
    profile_id: &str,
    path: &str,
    live: &HashMap<String, PathBuf>,
    running: I,
) -> Result<(), ProfileError>
where
    I: IntoIterator<Item = S>,
    S: AsRef<str>,
{
    let Some(source) = live.get(path) else {
        return Ok(());
    };
    if is_shared_rel_path(path) {
        put_shared_blob_from_path_to(profiles_dir, tf2_root, profile_id, path, source, running)?;
    } else {
        put_exclusive_file_from_path_to(profiles_dir, tf2_root, profile_id, path, source, running)?;
    }
    Ok(())
}

fn dual_write_config(
    tf2_root: &Path,
    classified: &Classified,
    options: &AbsorbOptions<'_>,
) -> Result<(), ProfileError> {
    let Some(source) = classified.live.get(CONFIG_CFG) else {
        return Ok(());
    };
    let bytes = fs::read(source).map_err(|e| ProfileError::Io(e.to_string()))?;
    let roots = match options.steam_roots {
        Some(roots) => roots.to_vec(),
        None => discover_steam_roots(),
    };
    write_config_cfg_dual_to(tf2_root, &bytes, &roots)
}

fn write_bytes(path: &Path, bytes: &[u8]) -> Result<(), ProfileError> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|e| ProfileError::Io(e.to_string()))?;
    }
    fs::write(path, bytes).map_err(|e| ProfileError::Io(e.to_string()))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::hash::sha256_hex;
    use crate::profile::{
        exclusive_file_path, load_manifest, save_current_as_to, SaveCurrentOptions,
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

    fn save_main(profiles: &Path, root: &Path) -> String {
        let library = save_current_as_to(
            profiles,
            root,
            "Main",
            unlocked(),
            SaveCurrentOptions {
                launch_options: Some("-novid"),
                cloud_config: None,
            },
        )
        .unwrap();
        library.profiles[0].id.clone()
    }

    fn opts<'a>(steam: Option<&'a [PathBuf]>) -> AbsorbOptions<'a> {
        AbsorbOptions {
            cloud_config: None,
            steam_roots: steam,
        }
    }

    #[test]
    fn pack_key_strips_disable_prefix() {
        assert_eq!(pack_key("tf/custom/hud/resource/ui/x"), Some("hud".into()));
        assert_eq!(pack_key("tf/custom/-hud/info.vdf"), Some("hud".into()));
        assert_eq!(
            pack_key("tf/custom/mastercomfig-base.vpk"),
            Some("mastercomfig-base.vpk".into())
        );
        assert_eq!(pack_key("tf/cfg/config.cfg"), None);
    }

    #[test]
    fn no_active_profile_is_noop() {
        let dir = crate::test_temp_dir();
        let profiles = dir.join("execs").join("profiles");
        let root = dir.join("Team Fortress 2");
        fs::create_dir_all(root.join("tf/cfg")).unwrap();
        let delta = scan_absorb_delta_to(&profiles, &root, opts(None)).unwrap();
        assert_eq!(delta, AbsorbDelta::empty());
        let result = absorb_owned_to(&profiles, &root, unlocked(), opts(None)).unwrap();
        assert!(result.library.active_profile_id.is_none());
        assert_eq!(result.delta, AbsorbDelta::empty());
        assert!(!result.config_cfg_absorbed);
        cleanup(&dir);
    }

    #[test]
    fn owned_cfg_drift_absorbs_and_new_pack_waits() {
        let dir = crate::test_temp_dir();
        let profiles = dir.join("execs").join("profiles");
        let root = dir.join("Team Fortress 2");
        write_live(&root.join("tf/cfg/config.cfg"), "unbindall\n");
        write_live(
            &root.join("tf/cfg/overrides/autoexec.cfg"),
            "fov_desired 90\n",
        );
        write_live(&root.join("tf/custom/hud/resource/ui/hudlayout.res"), "hud\n");
        let id = save_main(&profiles, &root);

        write_live(&root.join("tf/cfg/config.cfg"), "unbindall\nbind w +forward\n");
        write_live(
            &root.join("tf/cfg/overrides/autoexec.cfg"),
            "fov_desired 110\n",
        );
        write_live(&root.join("tf/cfg/overrides/modules.cfg"), "modules\n");
        write_live(&root.join("tf/custom/toon/info.vdf"), "toon\n");

        let before_live = fs::read(root.join("tf/custom/toon/info.vdf")).unwrap();
        let delta = scan_absorb_delta_to(&profiles, &root, opts(None)).unwrap();
        assert!(delta.owned_changed.contains(&"tf/cfg/config.cfg".into()));
        assert!(delta
            .owned_changed
            .contains(&"tf/cfg/overrides/autoexec.cfg".into()));
        assert!(delta
            .owned_changed
            .contains(&"tf/cfg/overrides/modules.cfg".into()));
        assert!(delta.packs_added.contains(&"toon".into()));
        assert!(delta.packs_removed.is_empty());
        assert!(delta.config_cfg);

        let result = absorb_owned_to(&profiles, &root, unlocked(), opts(None)).unwrap();
        assert!(result.delta.packs_added.contains(&"toon".into()));
        assert!(result.delta.owned_changed.is_empty());
        assert!(result.config_cfg_absorbed);
        let manifest = load_manifest(&profiles, &id).unwrap();
        let autoexec = manifest
            .files
            .iter()
            .find(|file| file.path == "tf/cfg/overrides/autoexec.cfg")
            .unwrap();
        assert_eq!(autoexec.sha256, sha256_hex(b"fov_desired 110\n"));
        assert_eq!(
            fs::read(exclusive_file_path(
                &profiles,
                &id,
                "tf/cfg/overrides/autoexec.cfg"
            ))
            .unwrap(),
            b"fov_desired 110\n"
        );
        assert!(manifest
            .files
            .iter()
            .any(|file| file.path == "tf/cfg/overrides/modules.cfg"));
        assert!(!manifest
            .files
            .iter()
            .any(|file| file.path.contains("toon")));
        assert_eq!(
            fs::read(root.join("tf/custom/toon/info.vdf")).unwrap(),
            before_live
        );
        cleanup(&dir);
    }

    #[test]
    fn deleted_pack_waits_missing_owned_cfg_is_removed() {
        let dir = crate::test_temp_dir();
        let profiles = dir.join("execs").join("profiles");
        let root = dir.join("Team Fortress 2");
        write_live(&root.join("tf/cfg/config.cfg"), "unbindall\n");
        write_live(
            &root.join("tf/cfg/overrides/autoexec.cfg"),
            "fov_desired 90\n",
        );
        write_live(&root.join("tf/custom/hud/resource/ui/hudlayout.res"), "hud\n");
        let id = save_main(&profiles, &root);

        fs::remove_file(root.join("tf/cfg/overrides/autoexec.cfg")).unwrap();
        fs::remove_dir_all(root.join("tf/custom/hud")).unwrap();

        let delta = scan_absorb_delta_to(&profiles, &root, opts(None)).unwrap();
        assert!(delta
            .owned_missing
            .contains(&"tf/cfg/overrides/autoexec.cfg".into()));
        assert!(delta.packs_removed.contains(&"hud".into()));

        let result = absorb_owned_to(&profiles, &root, unlocked(), opts(None)).unwrap();
        assert!(result.delta.packs_removed.contains(&"hud".into()));
        let manifest = load_manifest(&profiles, &id).unwrap();
        assert!(!manifest
            .files
            .iter()
            .any(|file| file.path == "tf/cfg/overrides/autoexec.cfg"));
        assert!(manifest
            .files
            .iter()
            .any(|file| file.path == "tf/custom/hud/resource/ui/hudlayout.res"));
        cleanup(&dir);
    }

    #[test]
    fn pack_update_adds_and_removes_keep_leaves_library() {
        let dir = crate::test_temp_dir();
        let profiles = dir.join("execs").join("profiles");
        let root = dir.join("Team Fortress 2");
        write_live(&root.join("tf/cfg/config.cfg"), "unbindall\n");
        write_live(&root.join("tf/custom/old/pack.txt"), "old\n");
        let id = save_main(&profiles, &root);
        fs::remove_dir_all(root.join("tf/custom/old")).unwrap();
        write_live(&root.join("tf/custom/new/pack.txt"), "new\n");

        absorb_owned_to(&profiles, &root, unlocked(), opts(None)).unwrap();
        let kept = absorb_packs_to(
            &profiles,
            &root,
            PackChoice::Keep,
            unlocked(),
            opts(None),
        )
        .unwrap();
        assert_eq!(kept.active_profile_id.as_deref(), Some(id.as_str()));
        let manifest = load_manifest(&profiles, &id).unwrap();
        assert!(manifest.files.iter().any(|file| file.path.contains("old")));
        assert!(!manifest.files.iter().any(|file| file.path.contains("new")));

        absorb_packs_to(
            &profiles,
            &root,
            PackChoice::Update,
            unlocked(),
            opts(None),
        )
        .unwrap();
        let manifest = load_manifest(&profiles, &id).unwrap();
        assert!(!manifest.files.iter().any(|file| file.path.contains("old")));
        assert!(manifest
            .files
            .iter()
            .any(|file| file.path == "tf/custom/new/pack.txt"));
        assert_eq!(
            fs::read(exclusive_file_path(&profiles, &id, "tf/custom/new/pack.txt")).unwrap(),
            b"new\n"
        );
        assert!(root.join("tf/custom/new/pack.txt").is_file());
        cleanup(&dir);
    }

    #[test]
    fn disabled_prefix_is_same_pack() {
        let dir = crate::test_temp_dir();
        let profiles = dir.join("execs").join("profiles");
        let root = dir.join("Team Fortress 2");
        write_live(&root.join("tf/cfg/config.cfg"), "unbindall\n");
        write_live(&root.join("tf/custom/hud/info.vdf"), "hud\n");
        save_main(&profiles, &root);
        fs::rename(root.join("tf/custom/hud"), root.join("tf/custom/-hud")).unwrap();
        let delta = scan_absorb_delta_to(&profiles, &root, opts(None)).unwrap();
        assert!(!delta.packs_added.contains(&"hud".into()));
        assert!(!delta.packs_removed.contains(&"hud".into()));
        cleanup(&dir);
    }

    #[test]
    fn dual_write_matches_live_and_cloud() {
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
        write_live(&root.join("tf/cfg/config.cfg"), "unbindall\n");
        save_main(&profiles, &root);
        write_live(&root.join("tf/cfg/config.cfg"), "updated\n");

        absorb_owned_to(
            &profiles,
            &root,
            unlocked(),
            AbsorbOptions {
                cloud_config: None,
                steam_roots: Some(std::slice::from_ref(&steam)),
            },
        )
        .unwrap();
        assert_eq!(fs::read(root.join("tf/cfg/config.cfg")).unwrap(), b"updated\n");
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
            b"updated\n"
        );
        cleanup(&dir);
    }

    #[test]
    fn dual_write_without_steam_still_writes_live() {
        let dir = crate::test_temp_dir();
        let root = dir.join("Team Fortress 2");
        write_config_cfg_dual_to(&root, b"cloudless\n", &[]).unwrap();
        assert_eq!(
            fs::read(root.join("tf/cfg/config.cfg")).unwrap(),
            b"cloudless\n"
        );
        cleanup(&dir);
    }

    #[test]
    fn refuse_while_tf2_running() {
        let dir = crate::test_temp_dir();
        let profiles = dir.join("execs").join("profiles");
        let root = dir.join("Team Fortress 2");
        write_live(&root.join("tf/cfg/config.cfg"), "unbindall\n");
        save_main(&profiles, &root);
        write_live(&root.join("tf/cfg/config.cfg"), "changed\n");
        let err = absorb_owned_to(&profiles, &root, [tf2_name()], opts(None)).unwrap_err();
        assert_eq!(err, ProfileError::GameRunning);
        let err = absorb_packs_to(
            &profiles,
            &root,
            PackChoice::Update,
            [tf2_name()],
            opts(None),
        )
        .unwrap_err();
        assert_eq!(err, ProfileError::GameRunning);
        cleanup(&dir);
    }

    #[test]
    fn new_file_in_existing_pack_absorbs_automatically() {
        let dir = crate::test_temp_dir();
        let profiles = dir.join("execs").join("profiles");
        let root = dir.join("Team Fortress 2");
        write_live(&root.join("tf/cfg/config.cfg"), "unbindall\n");
        write_live(&root.join("tf/custom/hud/info.vdf"), "hud\n");
        let id = save_main(&profiles, &root);
        write_live(&root.join("tf/custom/hud/extra.txt"), "extra\n");
        let result = absorb_owned_to(&profiles, &root, unlocked(), opts(None)).unwrap();
        assert!(!result.delta.has_pack_changes());
        assert!(!result.config_cfg_absorbed);
        let manifest = load_manifest(&profiles, &id).unwrap();
        assert!(manifest
            .files
            .iter()
            .any(|file| file.path == "tf/custom/hud/extra.txt"));
        cleanup(&dir);
    }
}
