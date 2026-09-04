//! Classify a confirmed TF2 install for first launch (RND-152).
//!
//! Read-only. Never writes the game folder or the profile library.

use std::fs;
use std::io::Read;
use std::path::Path;

use serde::{Deserialize, Serialize};

use crate::cfg_script::gameplay_script_signature;
use crate::launch::find_cloud_config;
use crate::profile::ProfileError;
use crate::surface::{inventory_live_surface_with, is_inventory_limit_error};

const CONFIG_CFG: &str = "tf/cfg/config.cfg";
/// Classification only needs to decide whether setup is pristine. A real TF2
/// config is far smaller; anything beyond this is conservatively treated as
/// existing customization instead of being loaded and amplified at startup.
const MAX_CONFIG_COMPARE_BYTES: usize = 1024 * 1024;
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
    let inventory = match inventory_live_surface_with(tf2_root, cloud_config) {
        Ok(inventory) => inventory,
        Err(error) if is_inventory_limit_error(&error) => {
            return Ok(FirstRunClass {
                kind: FirstRunKind::Existing,
                reasons: vec!["Could not safely inspect all existing customization".into()],
            });
        }
        Err(error) => return Err(error),
    };
    let mut reasons = Vec::new();
    let mut saw_custom = false;
    let mut saw_comfig = false;
    let mut saw_overrides = false;
    let mut saw_migrated = false;
    let mut cfg_count = 0usize;
    let mut first_cfg_name = None;
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
            cfg_count = cfg_count.saturating_add(1);
            first_cfg_name.get_or_insert_with(|| file_name(dest).to_string());
        }
    }

    if cfg_count == 1 {
        push_unique(
            &mut reasons,
            format!("Found {}", first_cfg_name.unwrap_or_default()),
        );
    } else if cfg_count > 1 {
        push_unique(&mut reasons, format!("Found {cfg_count} user config files"));
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
    // The engine happily writes non-UTF-8 bytes into config.cfg (a Latin-1
    // `name`, say). Reading strictly here used to dead-end the entire first-run
    // screen, so compare a lossy command stream but preserve every command and
    // its execution order.
    let Some(live) = read_lossy_bounded(source) else {
        return Ok(Some(
            "Could not compare config.cfg to Valve defaults".into(),
        ));
    };
    let default_path = tf2_root.join("tf").join("cfg").join("config_default.cfg");
    if !default_path.is_file() {
        return Ok(Some(
            "Could not compare config.cfg to Valve defaults".into(),
        ));
    }
    let Some(default) = read_lossy_bounded(&default_path) else {
        return Ok(Some(
            "Could not compare config.cfg to Valve defaults".into(),
        ));
    };
    if gameplay_script_signature(&live).eq(gameplay_script_signature(&default)) {
        Ok(None)
    } else {
        Ok(Some("config.cfg differs from Valve defaults".into()))
    }
}

fn read_lossy_bounded(path: &Path) -> Option<String> {
    let file = fs::File::open(path).ok()?;
    let mut bytes = Vec::new();
    file.take((MAX_CONFIG_COMPARE_BYTES + 1) as u64)
        .read_to_end(&mut bytes)
        .ok()?;
    if bytes.len() > MAX_CONFIG_COMPARE_BYTES {
        return None;
    }
    Some(String::from_utf8_lossy(&bytes).into_owned())
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
        assert_eq!(class.kind, FirstRunKind::Existing);
        assert!(class
            .reasons
            .iter()
            .any(|reason| reason.contains("config.cfg")));
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
    fn existing_when_config_adds_or_changes_cvars() {
        let dir = crate::test_temp_dir();
        let root = stock_root(&dir);
        write_file(
            &root.join(CONFIG_CFG),
            "unbindall\nbind w +forward\nbind s +back\nname Player\nvolume 1.0\n",
        );
        let class = classify_first_run_with(&root, None).unwrap();
        assert_eq!(class.kind, FirstRunKind::Existing);
        assert!(class
            .reasons
            .iter()
            .any(|reason| reason.contains("config.cfg")));
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
            .any(|item| item.contains("config.cfg differs")));
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
            .any(|item| item.contains("config.cfg differs")));
        cleanup(&dir);
    }

    #[test]
    fn existing_when_repeated_commands_are_reordered_on_one_line() {
        let dir = crate::test_temp_dir();
        let root = stock_root(&dir);
        write_file(
            &root.join(CONFIG_DEFAULT),
            "unbindall\nbind w +forward; bind w +back\n",
        );
        write_file(
            &root.join(CONFIG_CFG),
            "unbindall\nbind w +back; bind w +forward\n",
        );

        let class = classify_first_run_with(&root, None).unwrap();
        assert_eq!(class.kind, FirstRunKind::Existing);
        cleanup(&dir);
    }

    #[test]
    fn oversized_config_is_existing_instead_of_loaded_or_rejected() {
        let dir = crate::test_temp_dir();
        let root = stock_root(&dir);
        let config = root.join(CONFIG_CFG);
        fs::write(&config, vec![b';'; MAX_CONFIG_COMPARE_BYTES + 1]).unwrap();

        let class = classify_first_run_with(&root, None).unwrap();
        assert_eq!(class.kind, FirstRunKind::Existing);
        assert!(class
            .reasons
            .iter()
            .any(|item| item.contains("Could not compare config.cfg")));
        cleanup(&dir);
    }

    #[test]
    fn over_limit_surface_is_existing_instead_of_a_first_run_dead_end() {
        let dir = crate::test_temp_dir();
        let root = stock_root(&dir);
        let mut nested = root.join("tf/cfg");
        const OVER_LIMIT_DEPTH: usize = 65;
        for _ in 0..OVER_LIMIT_DEPTH {
            nested.push("d");
        }
        write_file(&nested.join("deep.cfg"), "echo deep\n");

        let class = classify_first_run_with(&root, None).unwrap();
        assert_eq!(class.kind, FirstRunKind::Existing);
        assert_eq!(
            class.reasons,
            ["Could not safely inspect all existing customization"]
        );
        cleanup(&dir);
    }

    #[test]
    fn many_unique_cfgs_produce_one_bounded_reason() {
        let dir = crate::test_temp_dir();
        let root = stock_root(&dir);
        const CFG_COUNT: usize = 512;
        for index in 0..CFG_COUNT {
            write_file(
                &root.join(format!("tf/cfg/custom-{index}.cfg")),
                "echo custom\n",
            );
        }

        let class = classify_first_run_with(&root, None).unwrap();
        assert_eq!(class.kind, FirstRunKind::Existing);
        assert!(class.reasons.len() <= 2, "{:?}", class.reasons);
        assert!(class
            .reasons
            .iter()
            .any(|reason| reason == "Found 512 user config files"));
        cleanup(&dir);
    }
}
