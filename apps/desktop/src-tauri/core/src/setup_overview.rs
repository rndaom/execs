//! Read-only summary of what each saved profile holds, for the Setups page. It
//! reads library manifests and a few stored cfgs; nothing is written.

use std::collections::BTreeMap;
use std::path::Path;

use serde::Serialize;

use crate::apply::profile_file_bytes_from;
use crate::profile::{
    load_library_from, load_manifest, CrosshairRecord, ProfileError, ProfileManifest,
};
use crate::profile_compare::{casual_names, managed_text, managed_values, sound_names};

const CONFIG_CFG: &str = "tf/cfg/config.cfg";

#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SetupOverview {
    pub id: String,
    pub hud: Option<String>,
    /// The crosshair every weapon gets from the custom pack (its `shape`;
    /// per-weapon assignments aside); `None` when the pack is off.
    pub crosshair: Option<String>,
    /// Saved designer parameters when `crosshair` is one of the player's
    /// designs, so it can be shown under its saved name.
    pub crosshair_design: Option<String>,
    pub fov: Option<String>,
    pub sensitivity: Option<String>,
    pub hit_sound: Option<String>,
    pub kill_sound: Option<String>,
    /// mastercomfig preset alias; `None` without the mastercomfig base package.
    pub performance: Option<String>,
    /// Mods the player added plus Casual setup choices.
    pub mods: usize,
}

/// One overview per saved profile, in library order. A profile whose manifest
/// can't be read right now gets an empty overview rather than failing the list.
pub fn setup_overviews(
    profiles_dir: &Path,
    tf2_root: &Path,
) -> Result<Vec<SetupOverview>, ProfileError> {
    let library = load_library_from(profiles_dir, Some(tf2_root))?;
    Ok(library
        .profiles
        .iter()
        .map(|profile| {
            load_manifest(profiles_dir, &profile.id).map_or_else(
                |_| SetupOverview {
                    id: profile.id.clone(),
                    ..SetupOverview::default()
                },
                |manifest| overview(profiles_dir, &manifest),
            )
        })
        .collect())
}

/// The stored design behind `record.shape`. `design` holds either a single
/// design (for the `designed` entry) or a map of library name to design.
fn shape_design(record: &CrosshairRecord) -> Option<String> {
    let raw = record.design.as_deref()?;
    let value: serde_json::Value = serde_json::from_str(raw).ok()?;
    let entries = value.as_object()?;
    if entries.contains_key("style") {
        return (record.shape == "designed").then(|| raw.to_string());
    }
    entries.get(&record.shape)?.as_str().map(str::to_string)
}

/// Values in the profile's saved `config.cfg`; empty when it has none.
fn config_values(profiles_dir: &Path, manifest: &ProfileManifest) -> BTreeMap<String, String> {
    if !manifest.files.iter().any(|file| file.path == CONFIG_CFG) {
        return BTreeMap::new();
    }
    profile_file_bytes_from(profiles_dir, &manifest.id, CONFIG_CFG)
        .map(|bytes| managed_values(&String::from_utf8_lossy(&bytes)))
        .unwrap_or_default()
}

fn overview(profiles_dir: &Path, manifest: &ProfileManifest) -> SetupOverview {
    let managed = managed_values(&managed_text(profiles_dir, manifest));
    // config.cfg is the big read, so it is only opened for what the managed
    // cfgs leave out.
    let mut config = None;
    let mut value = |name: &str| {
        let found = managed.get(name).filter(|value| !value.is_empty());
        found
            .or_else(|| {
                config
                    .get_or_insert_with(|| config_values(profiles_dir, manifest))
                    .get(name)
                    .filter(|value| !value.is_empty())
            })
            .cloned()
    };
    let fov = value("fov_desired");
    let sensitivity = value("sensitivity");
    let (hit_sound, kill_sound) = sound_names(manifest.hitsound.as_ref());
    // `id` names the pack itself; `shape` is the crosshair it gives every
    // weapon. Very old records may have no shape to name.
    let pack = manifest
        .crosshair
        .as_ref()
        .filter(|record| !record.inactive && !record.shape.is_empty());
    SetupOverview {
        id: manifest.id.clone(),
        hud: manifest.hud.as_ref().map(|hud| hud.id.clone()),
        crosshair: pack.map(|record| record.shape.clone()),
        crosshair_design: pack.and_then(shape_design),
        fov,
        sensitivity,
        hit_sound,
        kill_sound,
        performance: crate::comfig::saved_preset(profiles_dir, manifest)
            .map(|preset| preset.alias().to_string()),
        mods: manifest.mods.len() + casual_names(manifest.preloader.as_ref(), &manifest.mods).len(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::profile::{
        mutate_profile_files_to, save_current_as_to, FileSource, ProfileLiveProjection,
        SaveCurrentOptions,
    };
    use std::path::PathBuf;

    fn write(path: &Path, text: &str) {
        std::fs::create_dir_all(path.parent().unwrap()).unwrap();
        std::fs::write(path, text).unwrap();
    }

    /// A saved profile built from `files` under a fake TF2 folder; with
    /// `base`, the mastercomfig base package is part of it.
    fn saved(dir: &Path, files: &[(&str, &str)], base: bool) -> (PathBuf, PathBuf, String) {
        let profiles = dir.join("profiles");
        let root = dir.join("Team Fortress 2");
        write(&root.join("tf/steam.inf"), "appID=440\n");
        for (path, text) in files {
            write(&root.join(path), text);
        }
        if base {
            crate::cfg_layer::write_test_base(&root);
        }
        let library = save_current_as_to(
            &profiles,
            &root,
            "Main",
            ["not-running"],
            SaveCurrentOptions {
                launch_options: None,
                cloud_config: None,
            },
        )
        .unwrap();
        let id = library.profiles[0].id.clone();
        (profiles, root, id)
    }

    fn only(profiles: &Path, root: &Path) -> SetupOverview {
        let mut all = setup_overviews(profiles, root).unwrap();
        assert_eq!(all.len(), 1);
        all.remove(0)
    }

    #[test]
    fn managed_value_wins_over_config_cfg() {
        let dir = crate::test_temp_dir();
        let (profiles, root, id) = saved(
            &dir,
            &[
                (
                    "tf/cfg/config.cfg",
                    "fov_desired \"75\"\nsensitivity \"3\"\n",
                ),
                (
                    "tf/cfg/overrides/execs_gameplay.cfg",
                    "fov_desired 90\nsensitivity \"\"\n",
                ),
            ],
            true,
        );
        let overview = only(&profiles, &root);
        assert_eq!(overview.id, id);
        assert_eq!(overview.fov.as_deref(), Some("90"));
        // An empty managed value doesn't hide the saved one.
        assert_eq!(overview.sensitivity.as_deref(), Some("3"));
        std::fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn config_cfg_fills_in_what_the_managed_cfgs_leave_out() {
        let dir = crate::test_temp_dir();
        let (profiles, root, _) = saved(
            &dir,
            &[
                (
                    "tf/cfg/config.cfg",
                    "bind w +forward\nfov_desired \"82\"\nsensitivity \"2.5\"\n",
                ),
                ("tf/cfg/overrides/execs_gameplay.cfg", "viewmodel_fov 70\n"),
            ],
            true,
        );
        let overview = only(&profiles, &root);
        assert_eq!(overview.fov.as_deref(), Some("82"));
        assert_eq!(overview.sensitivity.as_deref(), Some("2.5"));
        std::fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn nothing_saved_reads_as_nothing() {
        let dir = crate::test_temp_dir();
        let (profiles, root, _) = saved(&dir, &[("tf/cfg/config.cfg", "bind w +forward\n")], false);
        let overview = only(&profiles, &root);
        assert_eq!(
            SetupOverview {
                id: overview.id.clone(),
                ..SetupOverview::default()
            },
            overview
        );
        std::fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn crosshair_hud_sounds_and_mods_come_from_the_manifest() {
        let dir = crate::test_temp_dir();
        let (profiles, root, id) = saved(&dir, &[], false);
        let edit = |crosshair: serde_json::Value| {
            let hitsound = serde_json::json!({
                "hit": { "name": "ding", "source": "file" },
                "kill": { "name": "bell", "source": "community" },
            });
            let hud = serde_json::json!({ "id": "flawhud", "source": "hudDb" });
            let mods = |name: &str| {
                serde_json::json!({
                    "id": name, "name": name, "source": { "kind": "local" },
                    "pack": name, "files": 1, "bytes": 1, "installedAt": "now",
                })
            };
            let preloader = serde_json::json!({
                "addons": ["a", "b"],
                "particleMods": [],
                "profileParticleMods": ["skin"],
            });
            mutate_profile_files_to(
                &profiles,
                &root,
                &id,
                &[(
                    "tf/cfg/overrides/execs_gameplay.cfg".into(),
                    FileSource::Bytes(b"fov_desired 90\n"),
                )],
                &[],
                ProfileLiveProjection::LibraryOnly,
                ["not-running"],
                |manifest| {
                    manifest.crosshair = Some(serde_json::from_value(crosshair).unwrap());
                    manifest.hitsound = Some(serde_json::from_value(hitsound).unwrap());
                    manifest.hud = Some(serde_json::from_value(hud).unwrap());
                    manifest.mods = vec![
                        serde_json::from_value(mods("skin")).unwrap(),
                        serde_json::from_value(mods("map")).unwrap(),
                    ];
                    manifest.preloader = Some(serde_json::from_value(preloader).unwrap());
                    Ok(())
                },
            )
            .unwrap();
        };

        let pack = |shape: &str, design: Option<&str>, active: bool| {
            serde_json::json!({
                "id": "execs-crosshairs",
                "inactive": !active,
                "shape": shape,
                "assignments": { "tf_weapon_sniperrifle": "circle" },
                "design": design,
            })
        };

        edit(pack("dot", None, true));
        let on = only(&profiles, &root);
        assert_eq!(on.hud.as_deref(), Some("flawhud"));
        // The shape every weapon gets, not the pack's id or an assignment.
        assert_eq!(on.crosshair.as_deref(), Some("dot"));
        assert_eq!(on.crosshair_design, None);
        assert_eq!(on.hit_sound.as_deref(), Some("ding"));
        assert_eq!(on.kill_sound.as_deref(), Some("bell"));
        // Two mods, plus two Casual addons and one particle mod (named "skin"
        // after the mod it points at).
        assert_eq!(on.mods, 2 + 3);
        assert_eq!(on.performance, None);

        // A design is passed along with its saved parameters, whether the
        // record holds one design or a library of them.
        let single = r#"{"style":"dot","label":"Mine"}"#;
        edit(pack("designed", Some(single), true));
        let designed = only(&profiles, &root);
        assert_eq!(designed.crosshair.as_deref(), Some("designed"));
        assert_eq!(designed.crosshair_design.as_deref(), Some(single));
        let ring = r#"{"style":"ring","label":"Ring"}"#;
        let library = serde_json::json!({ "design-ring": ring, "design-x": "{}" }).to_string();
        edit(pack("design-ring", Some(&library), true));
        assert_eq!(
            only(&profiles, &root).crosshair_design.as_deref(),
            Some(ring)
        );
        edit(pack("dot", Some(single), true));
        assert_eq!(only(&profiles, &root).crosshair_design, None);

        edit(pack("dot", None, false));
        let off = only(&profiles, &root);
        assert_eq!(off.crosshair, None);
        assert_eq!(off.crosshair_design, None);
        std::fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn preset_needs_the_mastercomfig_base_package() {
        let hook = ("tf/cfg/overrides/setup_hook.cfg", "preset=high\n");
        let without = crate::test_temp_dir();
        let (profiles, root, _) = saved(&without, &[hook], false);
        assert_eq!(only(&profiles, &root).performance, None);
        std::fs::remove_dir_all(without).unwrap();

        let with = crate::test_temp_dir();
        let (profiles, root, _) = saved(&with, &[hook], true);
        assert_eq!(only(&profiles, &root).performance.as_deref(), Some("high"));
        std::fs::remove_dir_all(with).unwrap();

        // No hook means mastercomfig's default, as on the Comfig pane.
        let plain = crate::test_temp_dir();
        let (profiles, root, _) = saved(&plain, &[], true);
        assert_eq!(
            only(&profiles, &root).performance.as_deref(),
            Some("medium")
        );
        std::fs::remove_dir_all(plain).unwrap();
    }

    #[test]
    fn overviews_follow_library_order_and_change_nothing() {
        let dir = crate::test_temp_dir();
        let (profiles, root, first) = saved(&dir, &[], false);
        let library =
            crate::profile::duplicate_profile_to(&profiles, &root, &first, "Second", ["x"])
                .unwrap();
        let ids: Vec<String> = library.profiles.iter().map(|p| p.id.clone()).collect();
        let before: Vec<Vec<u8>> = ids
            .iter()
            .map(|id| std::fs::read(crate::profile::manifest_file(&profiles, id)).unwrap())
            .collect();
        let all = setup_overviews(&profiles, &root).unwrap();
        assert_eq!(all.iter().map(|o| o.id.clone()).collect::<Vec<_>>(), ids);
        let after: Vec<Vec<u8>> = ids
            .iter()
            .map(|id| std::fs::read(crate::profile::manifest_file(&profiles, id)).unwrap())
            .collect();
        assert_eq!(before, after);
        std::fs::remove_dir_all(dir).unwrap();
    }
}
