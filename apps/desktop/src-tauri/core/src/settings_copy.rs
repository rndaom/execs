//! Copying personal settings from the active profile to other profiles.
//!
//! Binds, mouse and other Gameplay settings, and hit/kill sounds live in each
//! profile, so a change made once stays in one profile unless the player
//! copies it. Copying reads the active profile's saved copy and writes each
//! chosen inactive profile's library in its own profile transaction; TF2's
//! folder is not touched because only the active profile is installed.
//!
//! * Binds replace the target's managed `execs_binds.cfg`.
//! * Gameplay and Sounds replace only their own lines in the target's
//!   `execs_gameplay.cfg`; Viewmodels and Crosshair lines stay.
//! * Sounds also copy the two hit/kill WAVs and their source record.
//!
//! Each target keeps its own cfg loader: files land in `tf/cfg/overrides/`
//! for mastercomfig profiles and `tf/cfg/` otherwise, with the managed exec
//! line added to that layer's autoexec.

use std::path::Path;

use serde::{Deserialize, Serialize};

use crate::apply::{cfg_layer_from_manifest, manifest_source_path};
use crate::hash::{read_small_file_bounded, MAX_CFG_FILE_BYTES};
use crate::hitsound::{HitsoundKind, HITSOUND_MAX_BYTES};
use crate::managed_cfg::{ensure_exec, merge_scope, validate_quotes, ManagedCfgScope};
use crate::process_lock::refuse_if_running_among;
use crate::profile::{
    load_library_from, load_manifest, mutate_profile_files_to, FileSource, ProfileError,
    ProfileLiveProjection, ProfileManifest,
};
use crate::surface::CfgLayer;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum SettingsCopyScope {
    Binds,
    Gameplay,
    Sounds,
}

/// One other profile and whether copying would change it.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SettingsCopyTarget {
    pub id: String,
    pub name: String,
    /// False when the profile already has exactly these settings.
    pub changes: bool,
}

/// Every file one copy writes or removes in a target profile.
struct CopyPlan {
    puts: Vec<(String, Vec<u8>)>,
    removes: Vec<String>,
    hitsound: Option<Option<crate::hitsound::HitsoundRecord>>,
}

impl CopyPlan {
    fn is_empty(&self) -> bool {
        self.puts.is_empty() && self.removes.is_empty() && self.hitsound.is_none()
    }
}

fn prefix(layer: CfgLayer) -> &'static str {
    match layer {
        CfgLayer::Comfig => "overrides/",
        CfgLayer::Vanilla => "",
    }
}

fn saved_bytes(
    profiles_dir: &Path,
    manifest: &ProfileManifest,
    rel_path: &str,
    max: usize,
) -> Result<Option<Vec<u8>>, ProfileError> {
    let Some(file) = manifest.files.iter().find(|file| file.path == rel_path) else {
        return Ok(None);
    };
    let source = manifest_source_path(profiles_dir, &manifest.id, file)?;
    read_small_file_bounded(&source, max)
        .map(Some)
        .map_err(|err| ProfileError::Io(err.to_string()))
}

/// The source profile's settings for one scope, read once for every target.
struct Source {
    layer_file: Option<Vec<u8>>,
    sounds: [(HitsoundKind, Option<Vec<u8>>); 2],
    hitsound: Option<crate::hitsound::HitsoundRecord>,
}

fn read_source(
    profiles_dir: &Path,
    manifest: &ProfileManifest,
    scope: SettingsCopyScope,
) -> Result<Source, ProfileError> {
    let layer = prefix(cfg_layer_from_manifest(profiles_dir, manifest)?);
    let stem = match scope {
        SettingsCopyScope::Binds => "execs_binds",
        SettingsCopyScope::Gameplay | SettingsCopyScope::Sounds => "execs_gameplay",
    };
    let layer_file = saved_bytes(
        profiles_dir,
        manifest,
        &format!("tf/cfg/{layer}{stem}.cfg"),
        MAX_CFG_FILE_BYTES,
    )?;
    let sounds = if scope == SettingsCopyScope::Sounds {
        [
            (
                HitsoundKind::Hit,
                saved_bytes(
                    profiles_dir,
                    manifest,
                    HitsoundKind::Hit.rel_path(),
                    HITSOUND_MAX_BYTES,
                )?,
            ),
            (
                HitsoundKind::Kill,
                saved_bytes(
                    profiles_dir,
                    manifest,
                    HitsoundKind::Kill.rel_path(),
                    HITSOUND_MAX_BYTES,
                )?,
            ),
        ]
    } else {
        [(HitsoundKind::Hit, None), (HitsoundKind::Kill, None)]
    };
    let nothing = match scope {
        SettingsCopyScope::Binds => layer_file.is_none(),
        SettingsCopyScope::Gameplay => layer_file
            .as_deref()
            .is_none_or(|bytes| merge_scope(b"", bytes, ManagedCfgScope::Gameplay).is_err()),
        SettingsCopyScope::Sounds => {
            layer_file
                .as_deref()
                .is_none_or(|bytes| merge_scope(b"", bytes, ManagedCfgScope::Sounds).is_err())
                && sounds.iter().all(|(_, bytes)| bytes.is_none())
        }
    };
    if nothing {
        return Err(ProfileError::Io(match scope {
            SettingsCopyScope::Binds => "This profile has no binds saved in execs yet.".into(),
            SettingsCopyScope::Gameplay => {
                "This profile has no Gameplay settings saved in execs yet.".into()
            }
            SettingsCopyScope::Sounds => {
                "This profile has no sound settings saved in execs yet.".into()
            }
        }));
    }
    if let Some(bytes) = &layer_file {
        validate_quotes(bytes)?;
    }
    Ok(Source {
        layer_file,
        sounds,
        hitsound: manifest.hitsound.clone(),
    })
}

fn plan_copy(
    profiles_dir: &Path,
    scope: SettingsCopyScope,
    source: &Source,
    target: &ProfileManifest,
) -> Result<CopyPlan, ProfileError> {
    let layer = prefix(cfg_layer_from_manifest(profiles_dir, target)?);
    let mut puts = Vec::new();
    let mut removes = Vec::new();
    let mut hitsound = None;
    let (stem, cfg_path) = match scope {
        SettingsCopyScope::Binds => ("execs_binds", format!("tf/cfg/{layer}execs_binds.cfg")),
        _ => (
            "execs_gameplay",
            format!("tf/cfg/{layer}execs_gameplay.cfg"),
        ),
    };
    let existing = saved_bytes(profiles_dir, target, &cfg_path, MAX_CFG_FILE_BYTES)?;
    let next = match (scope, &source.layer_file) {
        (SettingsCopyScope::Binds, Some(bytes)) => Some(bytes.clone()),
        (SettingsCopyScope::Binds, None) => None,
        (_, Some(bytes)) => {
            let owned = if scope == SettingsCopyScope::Gameplay {
                ManagedCfgScope::Gameplay
            } else {
                ManagedCfgScope::Sounds
            };
            // TF2 refuses the cheat-only line from any startup cfg.
            let bytes = crate::managed_cfg::drop_standalone_command(bytes, "r_drawtracers")
                .unwrap_or_else(|| bytes.clone());
            let base = existing.clone().unwrap_or_default();
            validate_quotes(&base)?;
            merge_scope(&base, &bytes, owned).ok()
        }
        (_, None) => None,
    };
    if let Some(next) = next {
        if next.len() > MAX_CFG_FILE_BYTES {
            return Err(ProfileError::Io(
                "Managed cfg exceeds the cfg size limit.".into(),
            ));
        }
        if existing.as_deref() != Some(next.as_slice()) {
            puts.push((cfg_path.clone(), next));
        }
        let auto_path = format!("tf/cfg/{layer}autoexec.cfg");
        let auto = saved_bytes(profiles_dir, target, &auto_path, MAX_CFG_FILE_BYTES)?;
        let current = auto.clone().unwrap_or_default();
        validate_quotes(&current)?;
        let wired = ensure_exec(&current, layer, stem);
        if auto.as_deref() != Some(wired.as_slice()) {
            puts.push((auto_path, wired));
        }
    }
    if scope == SettingsCopyScope::Sounds {
        for (kind, bytes) in &source.sounds {
            let path = kind.rel_path();
            let current = saved_bytes(profiles_dir, target, path, HITSOUND_MAX_BYTES)?;
            match bytes {
                Some(bytes) if current.as_deref() != Some(bytes.as_slice()) => {
                    puts.push((path.to_string(), bytes.clone()));
                }
                None if current.is_some() => removes.push(path.to_string()),
                _ => {}
            }
        }
        if target.hitsound != source.hitsound {
            hitsound = Some(source.hitsound.clone());
        }
    }
    Ok(CopyPlan {
        puts,
        removes,
        hitsound,
    })
}

fn inactive_targets(
    profiles_dir: &Path,
    tf2_root: &Path,
    source_id: &str,
) -> Result<Vec<(String, String)>, ProfileError> {
    let library = load_library_from(profiles_dir, Some(tf2_root))?;
    if !library.usable || library.active_profile_id.as_deref() != Some(source_id) {
        return Err(ProfileError::Io(
            "Copy settings from the active profile.".into(),
        ));
    }
    Ok(library
        .profiles
        .into_iter()
        .filter(|profile| profile.id != source_id)
        .map(|profile| (profile.id, profile.name))
        .collect())
}

/// Which other profiles a copy would change.
pub fn review_settings_copy_to(
    profiles_dir: &Path,
    tf2_root: &Path,
    source_id: &str,
    scope: SettingsCopyScope,
) -> Result<Vec<SettingsCopyTarget>, ProfileError> {
    let targets = inactive_targets(profiles_dir, tf2_root, source_id)?;
    let source = read_source(
        profiles_dir,
        &load_manifest(profiles_dir, source_id)?,
        scope,
    )?;
    targets
        .into_iter()
        .map(|(id, name)| {
            let target = load_manifest(profiles_dir, &id)?;
            Ok(SettingsCopyTarget {
                changes: !plan_copy(profiles_dir, scope, &source, &target)?.is_empty(),
                id,
                name,
            })
        })
        .collect()
}

/// Copy one scope of the active profile's settings to the chosen profiles.
/// Returns the ids that changed. Every target is checked before any write.
pub fn copy_settings_to_profiles_to<I, S>(
    profiles_dir: &Path,
    tf2_root: &Path,
    source_id: &str,
    scope: SettingsCopyScope,
    target_ids: &[String],
    running_names: I,
) -> Result<Vec<String>, ProfileError>
where
    I: IntoIterator<Item = S>,
    S: AsRef<str>,
{
    let running: Vec<String> = running_names
        .into_iter()
        .map(|name| name.as_ref().to_string())
        .collect();
    refuse_if_running_among(&running)?;
    let targets = inactive_targets(profiles_dir, tf2_root, source_id)?;
    if target_ids.is_empty()
        || target_ids
            .iter()
            .any(|id| !targets.iter().any(|(target, _)| target == id))
    {
        return Err(ProfileError::UnknownProfile);
    }
    let source = read_source(
        profiles_dir,
        &load_manifest(profiles_dir, source_id)?,
        scope,
    )?;
    let plans = target_ids
        .iter()
        .map(|id| {
            let target = load_manifest(profiles_dir, id)?;
            Ok((
                id.clone(),
                plan_copy(profiles_dir, scope, &source, &target)?,
            ))
        })
        .collect::<Result<Vec<_>, ProfileError>>()?;
    let mut changed = Vec::new();
    for (id, plan) in plans {
        if plan.is_empty() {
            continue;
        }
        let puts: Vec<(String, FileSource<'_>)> = plan
            .puts
            .iter()
            .map(|(path, bytes)| (path.clone(), FileSource::Bytes(bytes)))
            .collect();
        let hitsound = plan.hitsound.clone();
        mutate_profile_files_to(
            profiles_dir,
            tf2_root,
            &id,
            &puts,
            &plan.removes,
            ProfileLiveProjection::LibraryOnly,
            &running,
            move |manifest| {
                if let Some(record) = hitsound {
                    manifest.hitsound = record;
                }
                Ok(())
            },
        )?;
        changed.push(id);
    }
    Ok(changed)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::profile::{create_profile_record_to, save_current_as_to, SaveCurrentOptions};
    use std::fs;
    use std::path::PathBuf;

    const UNLOCKED: [&str; 1] = ["explorer.exe"];

    fn tf2(root: &Path) {
        fs::create_dir_all(root.join("tf/cfg")).unwrap();
        fs::create_dir_all(root.join("tf/custom")).unwrap();
        fs::write(root.join("tf/steam.inf"), "appID=440\n").unwrap();
    }

    /// Active "Low" with binds, Gameplay/Sounds lines and a hit sound, plus an
    /// empty inactive "Ultra".
    fn library(dir: &Path) -> (PathBuf, PathBuf, String, String) {
        let profiles = dir.join("execs").join("profiles");
        let root = dir.join("Team Fortress 2");
        tf2(&root);
        fs::write(root.join("tf/cfg/config.cfg"), "bind w +forward\n").unwrap();
        fs::write(
            root.join("tf/cfg/autoexec.cfg"),
            "exec execs_binds // execs:managed\nexec execs_gameplay // execs:managed\n",
        )
        .unwrap();
        fs::write(root.join("tf/cfg/execs_binds.cfg"), "bind \",\" +jump\n").unwrap();
        fs::write(
            root.join("tf/cfg/execs_gameplay.cfg"),
            "sensitivity 1.8\nr_drawtracers 0\nviewmodel_fov 70\ntf_dingalingaling 1\n",
        )
        .unwrap();
        let sound = root.join("tf/custom/execs-hitsounds/sound/ui");
        fs::create_dir_all(&sound).unwrap();
        fs::write(sound.join("hitsound.wav"), wav()).unwrap();
        let low = save_current_as_to(
            &profiles,
            &root,
            "Low",
            UNLOCKED,
            SaveCurrentOptions::default(),
        )
        .unwrap()
        .profiles[0]
            .id
            .clone();
        let ultra = create_profile_record_to(&profiles, &root, "Ultra", UNLOCKED)
            .unwrap()
            .profiles
            .into_iter()
            .find(|profile| profile.id != low)
            .unwrap()
            .id;
        (profiles, root, low, ultra)
    }

    fn wav() -> Vec<u8> {
        let mut bytes = b"RIFF\x28\x00\x00\x00WAVEfmt \x10\x00\x00\x00\x01\x00\x01\x00\x44\xac\x00\x00\x88\x58\x01\x00\x02\x00\x10\x00data\x04\x00\x00\x00".to_vec();
        bytes.extend_from_slice(&[0, 0, 0, 0]);
        bytes
    }

    fn saved(profiles: &Path, id: &str, path: &str) -> Option<Vec<u8>> {
        let manifest = load_manifest(profiles, id).unwrap();
        saved_bytes(profiles, &manifest, path, 1 << 20).unwrap()
    }

    #[test]
    fn copies_binds_and_wires_the_target_autoexec() {
        let dir = crate::test_temp_dir();
        let (profiles, root, low, ultra) = library(&dir);
        let review =
            review_settings_copy_to(&profiles, &root, &low, SettingsCopyScope::Binds).unwrap();
        assert_eq!(review.len(), 1);
        assert!(review[0].changes);
        let live_before = fs::read(root.join("tf/cfg/execs_binds.cfg")).unwrap();
        let changed = copy_settings_to_profiles_to(
            &profiles,
            &root,
            &low,
            SettingsCopyScope::Binds,
            std::slice::from_ref(&ultra),
            UNLOCKED,
        )
        .unwrap();
        assert_eq!(changed, vec![ultra.clone()]);
        assert_eq!(
            saved(&profiles, &ultra, "tf/cfg/execs_binds.cfg").unwrap(),
            b"bind \",\" +jump\n"
        );
        let autoexec = saved(&profiles, &ultra, "tf/cfg/autoexec.cfg").unwrap();
        assert!(String::from_utf8(autoexec)
            .unwrap()
            .contains("exec execs_binds"));
        // TF2's folder belongs to the active profile and is untouched.
        assert_eq!(
            fs::read(root.join("tf/cfg/execs_binds.cfg")).unwrap(),
            live_before
        );
        assert!(
            !review_settings_copy_to(&profiles, &root, &low, SettingsCopyScope::Binds).unwrap()[0]
                .changes
        );
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn copies_only_gameplay_lines_and_never_the_cheat_tracer() {
        let dir = crate::test_temp_dir();
        let (profiles, root, low, ultra) = library(&dir);
        copy_settings_to_profiles_to(
            &profiles,
            &root,
            &low,
            SettingsCopyScope::Gameplay,
            std::slice::from_ref(&ultra),
            UNLOCKED,
        )
        .unwrap();
        let text =
            String::from_utf8(saved(&profiles, &ultra, "tf/cfg/execs_gameplay.cfg").unwrap())
                .unwrap();
        assert!(text.contains("sensitivity 1.8"));
        assert!(!text.contains("r_drawtracers"));
        assert!(!text.contains("viewmodel_fov"));
        assert!(!text.contains("tf_dingalingaling"));
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn copies_sounds_with_their_wavs_and_record() {
        let dir = crate::test_temp_dir();
        let (profiles, root, low, ultra) = library(&dir);
        copy_settings_to_profiles_to(
            &profiles,
            &root,
            &low,
            SettingsCopyScope::Sounds,
            std::slice::from_ref(&ultra),
            UNLOCKED,
        )
        .unwrap();
        assert_eq!(
            saved(&profiles, &ultra, HitsoundKind::Hit.rel_path()).unwrap(),
            wav()
        );
        assert!(saved(&profiles, &ultra, HitsoundKind::Kill.rel_path()).is_none());
        let text =
            String::from_utf8(saved(&profiles, &ultra, "tf/cfg/execs_gameplay.cfg").unwrap())
                .unwrap();
        assert_eq!(text, "tf_dingalingaling 1\n");
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn refuses_the_active_profile_unknown_targets_and_a_running_game() {
        let dir = crate::test_temp_dir();
        let (profiles, root, low, ultra) = library(&dir);
        let copy = |targets: &[String], running: &str| {
            copy_settings_to_profiles_to(
                &profiles,
                &root,
                &low,
                SettingsCopyScope::Binds,
                targets,
                [running],
            )
        };
        assert!(copy(std::slice::from_ref(&low), "explorer.exe").is_err());
        assert!(copy(&["missing".into()], "explorer.exe").is_err());
        assert!(copy(&[], "explorer.exe").is_err());
        assert!(matches!(
            copy(std::slice::from_ref(&ultra), "tf_win64.exe"),
            Err(ProfileError::GameRunning)
        ));
        assert!(saved(&profiles, &ultra, "tf/cfg/execs_binds.cfg").is_none());
        // Only the active profile is a source.
        assert!(
            review_settings_copy_to(&profiles, &root, &ultra, SettingsCopyScope::Binds).is_err()
        );
        let _ = fs::remove_dir_all(&dir);
    }
}
