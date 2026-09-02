//! Classify a confirmed TF2 install for first launch (RND-152).
//!
//! Read-only. Never writes the game folder or the profile library.

use std::fs;
use std::path::Path;

use serde::{Deserialize, Serialize};

use crate::cfg_script::gameplay_script_signature;
use crate::launch::find_cloud_config;
use crate::profile::ProfileError;
use crate::surface::inventory_live_surface_with;

const CONFIG_CFG: &str = "tf/cfg/config.cfg";
#[cfg(test)]
const CONFIG_DEFAULT: &str = "tf/cfg/config_default.cfg";

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum FirstRunKind {
    Unused,
    Existing,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FirstRunClass {
    pub kind: FirstRunKind,
    pub reasons: Vec<String>,
}

pub fn classify_first_run(tf2_root: &Path) -> Result<FirstRunClass, ProfileError> {
    let cloud = find_cloud_config();
    classify_first_run_with(tf2_root, cloud.as_deref())
}

pub fn classify_first_run_with(
    tf2_root: &Path,
    cloud_config: Option<&Path>,
) -> Result<FirstRunClass, ProfileError> {
    let inventory = inventory_live_surface_with(tf2_root, cloud_config)?;
    let mut reasons = Vec::new();
    let mut saw_custom = false;
    let mut saw_comfig = false;
    let mut saw_overrides = false;
    let mut saw_migrated = false;
    let mut config_source = None;

    for entry in &inventory.entries {
        let dest = entry.dest_rel.as_str();
        if dest == CONFIG_CFG {
            config_source = Some(entry.source.as_path());
            continue;
        }
        if dest.starts_with("tf/custom/") {
            saw_custom = true;
            if is_mastercomfig_vpk(file_name(dest)) {
                saw_comfig = true;
            }
            continue;
        }
        if dest.starts_with("tf/cfg/overrides/") {
            saw_overrides = true;
        }
        if dest.contains("/.migrated/") {
            saw_migrated = true;
        }
        if dest.starts_with("tf/cfg/") {
            push_unique(&mut reasons, format!("Found {}", file_name(dest)));
        }
    }

    if saw_overrides {
        push_unique(&mut reasons, "Found overrides".into());
    }
    if saw_comfig {
        push_unique(&mut reasons, "Found mastercomfig in custom".into());
    }
    if saw_custom {
        push_unique(&mut reasons, "Found packs in custom".into());
    }
    if saw_migrated {
        push_unique(&mut reasons, "Found leftover user configs".into());
    }

    if let Some(source) = config_source {
        if let Some(reason) = config_cfg_reason(tf2_root, source)? {
            push_unique(&mut reasons, reason);
        }
    }

    let kind = if reasons.is_empty() {
        FirstRunKind::Unused
    } else {
        FirstRunKind::Existing
    };
    Ok(FirstRunClass { kind, reasons })
}

fn config_cfg_reason(tf2_root: &Path, source: &Path) -> Result<Option<String>, ProfileError> {
    // Only a bind signature is needed, and the engine happily writes non-UTF-8
    // bytes into config.cfg (a Latin-1 `name`, say). Reading strictly here used
    // to dead-end the entire first-run screen.
    let live = read_lossy(source)?;
    let default_path = tf2_root.join("tf").join("cfg").join("config_default.cfg");
    if !default_path.is_file() {
        return Ok(Some(
            "Could not compare config.cfg to Valve defaults".into(),
        ));
    }
    let default = read_lossy(&default_path)?;
    if gameplay_script_signature(&live) == gameplay_script_signature(&default) {
        Ok(None)
    } else {
        Ok(Some("Binds differ from Valve defaults".into()))
    }
}

fn read_lossy(path: &Path) -> Result<String, ProfileError> {
    let bytes = fs::read(path).map_err(|err| ProfileError::Io(err.to_string()))?;
    Ok(String::from_utf8_lossy(&bytes).into_owned())
}

fn is_mastercomfig_vpk(name: &str) -> bool {
    let lower = name.to_ascii_lowercase();
    lower.starts_with("mastercomfig-") && lower.ends_with(".vpk")
}

fn file_name(path: &str) -> &str {
    path.rsplit('/').next().unwrap_or(path)
}

fn push_unique(reasons: &mut Vec<String>, reason: String) {
    if !reasons.iter().any(|item| item == &reason) {
        reasons.push(reason);
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs::{self, File};
    use std::io::Write;
    use std::path::Path;

    const STOCK: &str = "unbindall\nbind w +forward\nbind s +back\n";

    fn write_file(path: &Path, contents: &str) {
        if let Some(parent) = path.parent() {
            fs::create_dir_all(parent).unwrap();
        }
        let mut file = File::create(path).unwrap();
        file.write_all(contents.as_bytes()).unwrap();
    }

    fn cleanup(dir: &Path) {
        let _ = fs::remove_dir_all(dir);
    }

    fn stock_root(dir: &Path) -> std::path::PathBuf {
        let root = dir.join("Team Fortress 2");
        write_file(&root.join(CONFIG_DEFAULT), STOCK);
        write_file(&root.join("tf/steam.inf"), "appID=440\n");
        fs::create_dir_all(root.join("tf/custom")).unwrap();
        fs::create_dir_all(root.join("tf/cfg")).unwrap();
        root
    }

    /// The engine writes whatever bytes the user typed into `name`, so a
    /// Latin-1 config.cfg is ordinary. `classify_first_run` must not answer
    /// `Io(...)` for one and dead-end the entire first-run screen.
    #[test]
    fn a_non_utf8_config_cfg_still_classifies() {
        let dir = crate::test_temp_dir();
        let root = stock_root(&dir);
        let mut bytes = STOCK.as_bytes().to_vec();
        // `name "Jorg"` with a raw Latin-1 o-umlaut.
        bytes.extend_from_slice(b"name \"J\xf6rg\"\n");
        let config = root.join("tf/cfg/config.cfg");
        fs::create_dir_all(config.parent().unwrap()).unwrap();
        fs::write(&config, &bytes).unwrap();

        let class = classify_first_run_with(&root, None).unwrap();
        // The extra `name` line is not a bind change, so the signature still
        // matches Valve's defaults and nothing is reported against config.cfg.
        assert!(
            !class
                .reasons
                .iter()
                .any(|reason| reason.contains("config.cfg")),
            "{:?}",
            class.reasons
        );
        cleanup(&dir);
    }

    #[test]
    fn unused_when_empty_or_junk_only() {
        let dir = crate::test_temp_dir();
        let root = stock_root(&dir);
        write_file(&root.join("tf/custom/.DS_Store"), "junk\n");
        let class = classify_first_run_with(&root, None).unwrap();
        assert_eq!(class.kind, FirstRunKind::Unused);
        assert!(class.reasons.is_empty());
        cleanup(&dir);
    }

    #[test]
    fn unused_when_config_only_adds_host_cvars() {
        let dir = crate::test_temp_dir();
        let root = stock_root(&dir);
        write_file(
            &root.join(CONFIG_CFG),
            "unbindall\nbind w +forward\nbind s +back\nname Player\nvolume 1.0\n",
        );
        let class = classify_first_run_with(&root, None).unwrap();
        assert_eq!(class.kind, FirstRunKind::Unused);
        cleanup(&dir);
    }

    #[test]
    fn existing_from_autoexec() {
        let dir = crate::test_temp_dir();
        let root = stock_root(&dir);
        write_file(&root.join("tf/cfg/autoexec.cfg"), "fov_desired 90\n");
        let class = classify_first_run_with(&root, None).unwrap();
        assert_eq!(class.kind, FirstRunKind::Existing);
        assert!(class
            .reasons
            .iter()
            .any(|item| item.contains("autoexec.cfg")));
        cleanup(&dir);
    }

    #[test]
    fn existing_from_custom_pack() {
        let dir = crate::test_temp_dir();
        let root = stock_root(&dir);
        write_file(
            &root.join("tf/custom/hud/resource/ui/hudlayout.res"),
            "hud\n",
        );
        let class = classify_first_run_with(&root, None).unwrap();
        assert_eq!(class.kind, FirstRunKind::Existing);
        assert!(class.reasons.iter().any(|item| item.contains("custom")));
        cleanup(&dir);
    }

    #[test]
    fn existing_from_overrides_and_comfig_vpk() {
        let dir = crate::test_temp_dir();
        let root = stock_root(&dir);
        write_file(
            &root.join("tf/cfg/overrides/modules.cfg"),
            "lighting=high\n",
        );
        write_file(&root.join("tf/custom/mastercomfig-base.vpk"), "vpk\n");
        let class = classify_first_run_with(&root, None).unwrap();
        assert_eq!(class.kind, FirstRunKind::Existing);
        assert!(class.reasons.iter().any(|item| item.contains("overrides")));
        assert!(class
            .reasons
            .iter()
            .any(|item| item.contains("mastercomfig")));
        cleanup(&dir);
    }

    #[test]
    fn existing_from_leftover_user_dir() {
        let dir = crate::test_temp_dir();
        let root = stock_root(&dir);
        write_file(&root.join("tf/cfg/user/autoexec.cfg"), "old\n");
        let class = classify_first_run_with(&root, None).unwrap();
        assert_eq!(class.kind, FirstRunKind::Existing);
        cleanup(&dir);
    }

    #[test]
    fn existing_when_binds_differ() {
        let dir = crate::test_temp_dir();
        let root = stock_root(&dir);
        write_file(
            &root.join(CONFIG_CFG),
            "unbindall\nbind w +back\nbind s +forward\n",
        );
        let class = classify_first_run_with(&root, None).unwrap();
        assert_eq!(class.kind, FirstRunKind::Existing);
        assert!(class
            .reasons
            .iter()
            .any(|item| item.contains("Binds differ")));
        cleanup(&dir);
    }

    #[test]
    fn existing_when_default_cfg_missing() {
        let dir = crate::test_temp_dir();
        let root = dir.join("Team Fortress 2");
        write_file(&root.join(CONFIG_CFG), "unbindall\nbind w +forward\n");
        write_file(&root.join("tf/steam.inf"), "appID=440\n");
        let class = classify_first_run_with(&root, None).unwrap();
        assert_eq!(class.kind, FirstRunKind::Existing);
        assert!(class
            .reasons
            .iter()
            .any(|item| item.contains("Could not compare")));
        cleanup(&dir);
    }

    #[test]
    fn existing_from_cloud_only_rebinds() {
        let dir = crate::test_temp_dir();
        let root = stock_root(&dir);
        let cloud = dir.join("cloud").join("config.cfg");
        write_file(&cloud, "unbindall\nbind w +back\n");
        let class = classify_first_run_with(&root, Some(&cloud)).unwrap();
        assert_eq!(class.kind, FirstRunKind::Existing);
        assert!(class
            .reasons
            .iter()
            .any(|item| item.contains("Binds differ")));
        cleanup(&dir);
    }
}
