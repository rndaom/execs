//! Materialize a wizard profile in the library (RND-152 / RND-153).
//!
//! Does not write the live TF2 folder. Apply uses `switch_profile` after this.

use std::fs;
use std::path::Path;

use serde::{Deserialize, Serialize};

use crate::apply::profile_file_bytes_from;
use crate::launch::{recommended_launch_options, sanitize_launch_options};
use crate::process_lock::live_process_names;
use crate::profile::{
    create_profile_record_to, is_shared_rel_path, load_library_from, load_manifest, profiles_dir,
    put_exclusive_file_to, put_shared_blob_to, FileStorage, ProfileError, ProfileLibrary,
};

const CONFIG_CFG: &str = "tf/cfg/config.cfg";
const SETUP_HOOK: &str = "tf/cfg/overrides/setup_hook.cfg";
const BASE_VPK: &str = "tf/custom/mastercomfig-base.vpk";

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ComfigPreset {
    Ultra,
    High,
    MediumHigh,
    Medium,
    MediumLow,
    Low,
    VeryLow,
    None,
}

impl ComfigPreset {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Ultra => "ultra",
            Self::High => "high",
            Self::MediumHigh => "medium_high",
            Self::Medium => "medium",
            Self::MediumLow => "medium_low",
            Self::Low => "low",
            Self::VeryLow => "very_low",
            Self::None => "none",
        }
    }

    /// The alias mastercomfig actually defines in `cfg/comfig/define_presets.cfg`
    /// — only destitute/low/medium/high/ultra/custom exist. Writing anything
    /// else (`preset=very_low`) is an unknown command, so the preset silently
    /// stays whatever it was before. `as_str` remains the manifest spelling.
    pub fn alias(self) -> &'static str {
        match self {
            Self::Ultra => "ultra",
            Self::High | Self::MediumHigh => "high",
            Self::Medium => "medium",
            Self::Low | Self::MediumLow => "low",
            Self::VeryLow => "destitute",
            Self::None => "custom",
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum OfficialAddon {
    NoFootsteps,
    NoPyroland,
    NoSoundscapes,
    NoTutorial,
    Lowmem,
    NullCancelingMovement,
    FlatMouse,
    TransparentViewmodels,
}

impl OfficialAddon {
    pub fn all() -> &'static [Self] {
        &[
            Self::NoFootsteps,
            Self::NoPyroland,
            Self::NoSoundscapes,
            Self::NoTutorial,
            Self::Lowmem,
            Self::NullCancelingMovement,
            Self::FlatMouse,
            Self::TransparentViewmodels,
        ]
    }

    pub fn stem(self) -> &'static str {
        match self {
            Self::NoFootsteps => "no-footsteps",
            Self::NoPyroland => "no-pyroland",
            Self::NoSoundscapes => "no-soundscapes",
            Self::NoTutorial => "no-tutorial",
            Self::Lowmem => "lowmem",
            Self::NullCancelingMovement => "null-canceling-movement",
            Self::FlatMouse => "flat-mouse",
            Self::TransparentViewmodels => "transparent-viewmodels",
        }
    }

    pub fn vpk_file_name(self) -> String {
        format!("mastercomfig-addon-{}.vpk", self.stem())
    }

    pub fn rel_path(self) -> String {
        format!("tf/custom/{}", self.vpk_file_name())
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WizardSpec {
    pub name: String,
    pub preset: ComfigPreset,
    pub addons: Vec<OfficialAddon>,
}

/// What a new profile's `tf/cfg/config.cfg` starts from (user decision,
/// 2026-09-01). `Current` copies the ACTIVE profile's `config.cfg` verbatim, so
/// binds, audio, `con_enable`, advanced options and the
/// `tf_training_has_prompted_*` / `tf_explanations_*` "already shown" flags all
/// carry over. `Fresh` is Valve's `config_default.cfg`, i.e. a newly installed
/// TF2.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum StartFrom {
    Current,
    Fresh,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct WizardAsset<'a> {
    pub path: &'a str,
    pub bytes: &'a [u8],
}

#[derive(Debug, Clone, Default)]
pub struct WizardOptions<'a> {
    pub launch_options: Option<&'a str>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WizardResult {
    pub library: ProfileLibrary,
    pub profile_id: String,
}

pub fn required_wizard_assets(spec: &WizardSpec) -> Vec<String> {
    let mut paths = vec![BASE_VPK.to_string()];
    for addon in &spec.addons {
        let path = addon.rel_path();
        if !paths.contains(&path) {
            paths.push(path);
        }
    }
    paths
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct GitHubRelease {
    pub assets: Vec<GitHubAsset>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct GitHubAsset {
    pub name: String,
    pub browser_download_url: String,
}

pub fn file_name_for_rel(path: &str) -> &str {
    path.rsplit('/').next().unwrap_or(path)
}

pub fn pick_release_asset<'a>(
    release: &'a GitHubRelease,
    file_name: &str,
) -> Option<&'a GitHubAsset> {
    release
        .assets
        .iter()
        .find(|asset| asset.name.eq_ignore_ascii_case(file_name))
}

pub fn download_urls_for_spec(
    spec: &WizardSpec,
    release: &GitHubRelease,
) -> Result<Vec<(String, String)>, String> {
    let mut out = Vec::new();
    for rel in required_wizard_assets(spec) {
        let name = file_name_for_rel(&rel);
        let Some(asset) = pick_release_asset(release, name) else {
            return Err(format!("Official mastercomfig release is missing {name}."));
        };
        out.push((rel, asset.browser_download_url.clone()));
    }
    Ok(out)
}

pub fn materialize_wizard_profile(
    tf2_root: &Path,
    spec: &WizardSpec,
    start_from: StartFrom,
    assets: &[WizardAsset<'_>],
) -> Result<WizardResult, ProfileError> {
    materialize_wizard_profile_to(
        &profiles_dir(),
        tf2_root,
        spec,
        start_from,
        assets,
        live_process_names(),
        WizardOptions::default(),
    )
}

pub fn materialize_wizard_profile_to<I, S>(
    profiles_dir: &Path,
    tf2_root: &Path,
    spec: &WizardSpec,
    start_from: StartFrom,
    assets: &[WizardAsset<'_>],
    running_names: I,
    options: WizardOptions<'_>,
) -> Result<WizardResult, ProfileError>
where
    I: IntoIterator<Item = S>,
    S: AsRef<str>,
{
    let running: Vec<String> = running_names
        .into_iter()
        .map(|name| name.as_ref().to_string())
        .collect();
    // Read the source config before the new record exists: `current` means the
    // profile that is active now, never the one we are about to create.
    let config = build_config_cfg(profiles_dir, tf2_root, start_from)?;
    let library = create_profile_record_to(profiles_dir, tf2_root, &spec.name, &running)?;
    let profile_id = library
        .profiles
        .iter()
        .rev()
        .find(|profile| profile.name == spec.name.trim())
        .map(|profile| profile.id.clone())
        .ok_or(ProfileError::UnknownProfile)?;

    // The record exists from here on. A failure filling it (a missing
    // official VPK, most often) must not leave an empty profile in the
    // library, so the record is removed again before the error goes out.
    if let Err(err) = fill_wizard_profile(
        profiles_dir,
        tf2_root,
        &profile_id,
        spec,
        &config,
        assets,
        &options,
        &running,
    ) {
        let _ =
            crate::profile::remove_profile_record_to(profiles_dir, tf2_root, &profile_id, &running);
        return Err(err);
    }

    Ok(WizardResult {
        library: load_library_from(profiles_dir, Some(tf2_root))?,
        profile_id,
    })
}

#[allow(clippy::too_many_arguments)]
fn fill_wizard_profile(
    profiles_dir: &Path,
    tf2_root: &Path,
    profile_id: &str,
    spec: &WizardSpec,
    config: &[u8],
    assets: &[WizardAsset<'_>],
    options: &WizardOptions<'_>,
    running: &[String],
) -> Result<(), ProfileError> {
    put_exclusive_file_to(
        profiles_dir,
        tf2_root,
        profile_id,
        CONFIG_CFG,
        config,
        running,
    )?;

    let hook = format!("preset={}\n", spec.preset.alias());
    put_exclusive_file_to(
        profiles_dir,
        tf2_root,
        profile_id,
        SETUP_HOOK,
        hook.as_bytes(),
        running,
    )?;

    put_required_assets(profiles_dir, tf2_root, profile_id, spec, assets, running)?;

    let launch = match options.launch_options {
        Some(raw) => sanitize_launch_options(raw),
        None => recommended_launch_options(),
    };
    crate::profile::set_manifest_launch_options(profiles_dir, tf2_root, profile_id, launch, running)
}

fn put_required_assets<I, S>(
    profiles_dir: &Path,
    tf2_root: &Path,
    profile_id: &str,
    spec: &WizardSpec,
    assets: &[WizardAsset<'_>],
    running: I,
) -> Result<(), ProfileError>
where
    I: IntoIterator<Item = S> + Clone,
    S: AsRef<str>,
{
    for required in required_wizard_assets(spec) {
        let Some(asset) = assets.iter().find(|asset| asset.path == required) else {
            return Err(ProfileError::Io(format!(
                "Missing official mastercomfig file: {required}"
            )));
        };
        if !crate::profile::is_file_safe_rel_path(&required) {
            return Err(ProfileError::ForbiddenPath(required));
        }
        if is_shared_rel_path(&required) {
            put_shared_blob_to(
                profiles_dir,
                tf2_root,
                profile_id,
                &required,
                asset.bytes,
                running.clone(),
            )?;
        } else {
            put_exclusive_file_to(
                profiles_dir,
                tf2_root,
                profile_id,
                &required,
                asset.bytes,
                running.clone(),
            )?;
        }
    }
    Ok(())
}

fn build_config_cfg(
    profiles_dir: &Path,
    tf2_root: &Path,
    start_from: StartFrom,
) -> Result<Vec<u8>, ProfileError> {
    match start_from {
        StartFrom::Fresh => {
            let default_path = tf2_root.join("tf").join("cfg").join("config_default.cfg");
            if !default_path.is_file() {
                return Err(ProfileError::Io(
                    "Valve config_default.cfg is missing from this TF2 install.".into(),
                ));
            }
            fs::read(&default_path).map_err(|err| ProfileError::Io(err.to_string()))
        }
        StartFrom::Current => {
            let library = load_library_from(profiles_dir, Some(tf2_root))?;
            let Some(active) = library.active_profile_id else {
                return Err(ProfileError::Io(
                    "Save or switch to a profile before starting from your current setup.".into(),
                ));
            };
            profile_file_bytes_from(profiles_dir, &active, CONFIG_CFG).map_err(|_| {
                ProfileError::Io("The active profile has no config.cfg to copy.".into())
            })
        }
    }
}

pub fn wizard_profile_rel_paths(
    profiles_dir: &Path,
    profile_id: &str,
) -> Result<Vec<String>, ProfileError> {
    let manifest = load_manifest(profiles_dir, profile_id)?;
    Ok(manifest.files.into_iter().map(|file| file.path).collect())
}

pub fn wizard_file_storage(
    profiles_dir: &Path,
    profile_id: &str,
    path: &str,
) -> Result<FileStorage, ProfileError> {
    let manifest = load_manifest(profiles_dir, profile_id)?;
    manifest
        .files
        .into_iter()
        .find(|file| file.path == path)
        .map(|file| file.storage)
        .ok_or(ProfileError::InvalidPath)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::absorb::AbsorbOptions;
    use crate::profile::{
        exclusive_file_path, init_library_to, save_current_as_to, SaveCurrentOptions,
    };
    use crate::switch::switch_profile_to;
    use std::fs::{self, File};
    use std::io::Write;
    use std::path::Path;

    const STOCK: &str = "unbindall\nbind w +forward\nbind s +back\nvolume 1\n";

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

    fn tf2_name() -> &'static str {
        if cfg!(windows) {
            "tf_win64.exe"
        } else {
            "tf_linux64"
        }
    }

    fn tf2_root(dir: &Path) -> std::path::PathBuf {
        let root = dir.join("Team Fortress 2");
        write_file(&root.join("tf/cfg/config_default.cfg"), STOCK);
        write_file(&root.join("tf/steam.inf"), "appID=440\n");
        fs::create_dir_all(root.join("tf/custom")).unwrap();
        root
    }

    fn spec(name: &str) -> WizardSpec {
        WizardSpec {
            name: name.into(),
            preset: ComfigPreset::Medium,
            addons: vec![OfficialAddon::NoTutorial],
        }
    }

    fn assets<'a>(base: &'a [u8], addon: &'a [u8]) -> Vec<WizardAsset<'a>> {
        vec![
            WizardAsset {
                path: BASE_VPK,
                bytes: base,
            },
            WizardAsset {
                path: "tf/custom/mastercomfig-addon-no-tutorial.vpk",
                bytes: addon,
            },
        ]
    }

    #[test]
    fn required_assets_include_base_and_addons() {
        let spec = spec("Fresh");
        assert_eq!(
            required_wizard_assets(&spec),
            vec![
                BASE_VPK.to_string(),
                "tf/custom/mastercomfig-addon-no-tutorial.vpk".into()
            ]
        );
    }

    #[test]
    fn picks_base_and_selected_addons_skips_override_packs() {
        let release = GitHubRelease {
            assets: vec![
                GitHubAsset {
                    name: "mastercomfig-base.vpk".into(),
                    browser_download_url: "https://example.test/base.vpk".into(),
                },
                GitHubAsset {
                    name: "mastercomfig-addon-no-tutorial.vpk".into(),
                    browser_download_url: "https://example.test/no-tutorial.vpk".into(),
                },
                GitHubAsset {
                    name: "mastercomfig-addon-override-1.vpk".into(),
                    browser_download_url: "https://example.test/override.vpk".into(),
                },
            ],
        };
        let urls = download_urls_for_spec(&spec("Fresh"), &release).unwrap();
        assert_eq!(
            urls,
            vec![
                (BASE_VPK.to_string(), "https://example.test/base.vpk".into()),
                (
                    "tf/custom/mastercomfig-addon-no-tutorial.vpk".into(),
                    "https://example.test/no-tutorial.vpk".into()
                ),
            ]
        );
    }

    #[test]
    fn missing_official_asset_is_an_error() {
        let release = GitHubRelease { assets: vec![] };
        let err = download_urls_for_spec(&spec("Fresh"), &release).unwrap_err();
        assert!(err.contains("mastercomfig-base.vpk"));
    }

    #[test]
    fn materialize_writes_hook_shared_base_and_addons() {
        let dir = crate::test_temp_dir();
        let root = tf2_root(&dir);
        let profiles = dir.join("profiles");
        let base = b"base-vpk";
        let addon = b"addon-vpk";
        let result = materialize_wizard_profile_to(
            &profiles,
            &root,
            &spec("Fresh"),
            StartFrom::Fresh,
            &assets(base, addon),
            None::<&str>,
            WizardOptions {
                launch_options: Some("-novid -autoconfig"),
            },
        )
        .unwrap();

        assert!(result.library.active_profile_id.is_none());
        assert_eq!(result.library.profiles[0].name, "Fresh");
        let paths = wizard_profile_rel_paths(&profiles, &result.profile_id).unwrap();
        assert!(paths.contains(&CONFIG_CFG.to_string()));
        assert!(paths.contains(&SETUP_HOOK.to_string()));
        assert!(paths.contains(&BASE_VPK.to_string()));
        assert!(paths.contains(&"tf/custom/mastercomfig-addon-no-tutorial.vpk".to_string()));
        assert!(!paths.iter().any(|path| path.contains("tf/cfg/user/")));
        assert!(!paths.iter().any(|path| path.contains("steam.inf")));
        assert_eq!(
            wizard_file_storage(&profiles, &result.profile_id, BASE_VPK).unwrap(),
            FileStorage::Shared
        );
        assert_eq!(
            wizard_file_storage(
                &profiles,
                &result.profile_id,
                "tf/custom/mastercomfig-addon-no-tutorial.vpk"
            )
            .unwrap(),
            FileStorage::Exclusive
        );

        let hook = fs::read_to_string(exclusive_file_path(
            &profiles,
            &result.profile_id,
            SETUP_HOOK,
        ))
        .unwrap();
        assert_eq!(hook, "preset=medium\n");
        let config = fs::read_to_string(exclusive_file_path(
            &profiles,
            &result.profile_id,
            CONFIG_CFG,
        ))
        .unwrap();
        assert_eq!(config, STOCK);
        let manifest = load_manifest(&profiles, &result.profile_id).unwrap();
        assert_eq!(manifest.launch_options, "-novid");
        assert!(paths
            .iter()
            .any(|path| path.ends_with("mastercomfig-base.vpk")));
        cleanup(&dir);
    }

    /// A real live `config.cfg`: a custom bind, an archived audio cvar, the
    /// console toggle and one of the "tutorial already shown" flags.
    const LIVE_CONFIG: &str = concat!(
        "unbindall\n",
        "bind \"mouse4\" \"+voicerecord\"\n",
        "volume \"0.35\"\n",
        "con_enable \"1\"\n",
        "hud_fastswitch \"1\"\n",
        "tf_training_has_prompted_for_training \"1\"\n",
        "tf_explanations_charinfopanel \"1\"\n"
    );

    fn library_with_active_profile(profiles: &Path, root: &Path, config: &str) {
        write_file(&root.join("tf/cfg/config.cfg"), config);
        init_library_to(profiles, root, None::<&str>).unwrap();
        save_current_as_to(
            profiles,
            root,
            "Main",
            None::<&str>,
            SaveCurrentOptions {
                launch_options: Some(""),
                cloud_config: None,
            },
        )
        .unwrap();
    }

    #[test]
    fn start_from_current_copies_the_active_config_verbatim() {
        let dir = crate::test_temp_dir();
        let root = tf2_root(&dir);
        let profiles = dir.join("profiles");
        library_with_active_profile(&profiles, &root, LIVE_CONFIG);

        let result = materialize_wizard_profile_to(
            &profiles,
            &root,
            &spec("Alt"),
            StartFrom::Current,
            &assets(b"base", b"addon"),
            None::<&str>,
            WizardOptions::default(),
        )
        .unwrap();
        let config = fs::read(exclusive_file_path(
            &profiles,
            &result.profile_id,
            CONFIG_CFG,
        ))
        .unwrap();
        assert_eq!(config, LIVE_CONFIG.as_bytes());
        cleanup(&dir);
    }

    #[test]
    fn start_from_fresh_still_uses_stock_binds() {
        let dir = crate::test_temp_dir();
        let root = tf2_root(&dir);
        let profiles = dir.join("profiles");
        library_with_active_profile(&profiles, &root, LIVE_CONFIG);

        let result = materialize_wizard_profile_to(
            &profiles,
            &root,
            &spec("Alt"),
            StartFrom::Fresh,
            &assets(b"base", b"addon"),
            None::<&str>,
            WizardOptions::default(),
        )
        .unwrap();
        let config = fs::read_to_string(exclusive_file_path(
            &profiles,
            &result.profile_id,
            CONFIG_CFG,
        ))
        .unwrap();
        assert_eq!(config, STOCK);
        assert!(!config.contains("tf_training_has_prompted_for_training"));
        cleanup(&dir);
    }

    #[test]
    fn start_from_current_without_an_active_profile_errors() {
        let dir = crate::test_temp_dir();
        let root = tf2_root(&dir);
        let profiles = dir.join("profiles");
        init_library_to(&profiles, &root, None::<&str>).unwrap();

        let err = materialize_wizard_profile_to(
            &profiles,
            &root,
            &spec("Alt"),
            StartFrom::Current,
            &assets(b"base", b"addon"),
            None::<&str>,
            WizardOptions::default(),
        )
        .unwrap_err();
        assert!(
            matches!(&err, ProfileError::Io(message) if message.contains("current setup")),
            "unexpected error: {err:?}"
        );
        cleanup(&dir);
    }

    #[test]
    fn refuses_while_tf2_running() {
        let dir = crate::test_temp_dir();
        let root = tf2_root(&dir);
        let err = materialize_wizard_profile_to(
            &dir.join("profiles"),
            &root,
            &spec("Fresh"),
            StartFrom::Fresh,
            &assets(b"base", b"addon"),
            [tf2_name()],
            WizardOptions::default(),
        )
        .unwrap_err();
        assert_eq!(err, ProfileError::GameRunning);
        cleanup(&dir);
    }

    #[test]
    fn missing_base_vpk_is_an_error() {
        let dir = crate::test_temp_dir();
        let root = tf2_root(&dir);
        let err = materialize_wizard_profile_to(
            &dir.join("profiles"),
            &root,
            &spec("Fresh"),
            StartFrom::Fresh,
            &[],
            None::<&str>,
            WizardOptions::default(),
        )
        .unwrap_err();
        assert!(matches!(err, ProfileError::Io(message) if message.contains("mastercomfig-base")));
        // The record created before the failure is gone again: no orphan
        // profile with an empty manifest in the library.
        let library = load_library_from(&dir.join("profiles"), Some(&root)).unwrap();
        assert!(library.profiles.is_empty(), "{:?}", library.profiles);
        cleanup(&dir);
    }

    #[test]
    fn switch_applies_wizard_and_clears_previous_custom() {
        let dir = crate::test_temp_dir();
        let root = tf2_root(&dir);
        write_file(&root.join("tf/cfg/autoexec.cfg"), "fov_desired 90\n");
        write_file(&root.join("tf/custom/oldpack/note.txt"), "old\n");
        write_file(&root.join("tf/cfg/config.cfg"), STOCK);
        let profiles = dir.join("profiles");
        save_current_as_to(
            &profiles,
            &root,
            "Main",
            None::<&str>,
            SaveCurrentOptions {
                launch_options: Some(""),
                cloud_config: None,
            },
        )
        .unwrap();

        let result = materialize_wizard_profile_to(
            &profiles,
            &root,
            &spec("Fresh"),
            StartFrom::Fresh,
            &assets(b"base-vpk", b"addon-vpk"),
            None::<&str>,
            WizardOptions {
                launch_options: Some("-console"),
            },
        )
        .unwrap();
        switch_profile_to(
            &profiles,
            &root,
            &result.profile_id,
            None::<&str>,
            AbsorbOptions {
                cloud_config: None,
                steam_roots: Some(&[]),
            },
            |_| {},
        )
        .unwrap();

        assert!(!root.join("tf/cfg/autoexec.cfg").is_file());
        assert!(!root.join("tf/custom/oldpack/note.txt").is_file());
        assert_eq!(
            fs::read(root.join("tf/custom/mastercomfig-base.vpk")).unwrap(),
            b"base-vpk"
        );
        assert_eq!(
            fs::read(root.join("tf/custom/mastercomfig-addon-no-tutorial.vpk")).unwrap(),
            b"addon-vpk"
        );
        assert_eq!(
            fs::read_to_string(root.join("tf/cfg/overrides/setup_hook.cfg")).unwrap(),
            "preset=medium\n"
        );
        cleanup(&dir);
    }
}
