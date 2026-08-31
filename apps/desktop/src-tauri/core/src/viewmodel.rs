//! First-party Horsie-class viewmodel compile + Casual itemtest preload.
//! Never edits gameinfo.txt. Never writes official VPKs.

use std::collections::BTreeMap;
use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};

use crate::apply::{
    cfg_layer_from_files, detail_from_manifest, write_owned_file_to, ProfileDetail,
    WriteOwnedOptions,
};
use crate::finder::discover_steam_roots;
use crate::hash::sha256_file;
use crate::launch::{sanitize_launch_options, set_profile_launch_options_to};
use crate::process_lock::{live_process_names, refuse_if_running_among};
use crate::profile::{
    load_library_from, load_manifest, profiles_dir, remove_manifest_files_to, save_manifest,
    ProfileError, ProfileFile, ViewmodelRecord, ViewmodelSource,
};
use crate::settings::execs_data_dir;
use crate::surface::CfgLayer;
use crate::vpk::read_vpk_dir_bytes;
#[cfg(test)]
use crate::vpk::write_vpk_v1;

pub const EXECS_VIEWMODELS_PACK: &str = "execs-viewmodels";
pub const EXECS_VIEWMODELS_VPK: &str = "tf/custom/execs-viewmodels.vpk";
pub const EXECS_PRELOAD_STEM: &str = "execs_preload";
pub const EXECS_PRELOAD_OVERRIDES_STEM: &str = "overrides/execs_preload";
const EXECS_PRELOAD_VANILLA_PATH: &str = "tf/cfg/execs_preload.cfg";
const EXECS_PRELOAD_COMFIG_PATH: &str = "tf/cfg/overrides/execs_preload.cfg";
pub const VIEWMODEL_COMPILE_UNAVAILABLE_REASON: &str =
    "Compile is unavailable in this release while the first-party, file-safe compiler is rebuilt. Import a prebuilt VPK instead.";

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ViewmodelCompileCapability {
    pub available: bool,
    pub reason: String,
}

pub fn viewmodel_compile_capability() -> ViewmodelCompileCapability {
    ViewmodelCompileCapability {
        available: false,
        reason: VIEWMODEL_COMPILE_UNAVAILABLE_REASON.into(),
    }
}

pub fn studio_cache_dir() -> PathBuf {
    execs_data_dir().join("studio").join("viewmodels")
}

pub fn serialize_preload_cfg() -> String {
    [
        "// execs viewmodel preload — managed, do not edit by hand",
        "sv_pure 0",
        "map itemtest",
        "wait 5; disconnect",
        "",
    ]
    .join("\n")
}

pub fn has_preload_launch(options: &str) -> bool {
    let tokens: Vec<&str> = options.split_whitespace().collect();
    tokens
        .windows(2)
        .any(|pair| pair[0] == "+exec" && is_preload_stem(pair[1]))
}

pub fn with_preload_launch(options: &str, enabled: bool) -> String {
    with_preload_launch_stem(options, enabled, EXECS_PRELOAD_STEM)
}

fn with_preload_launch_stem(options: &str, enabled: bool, stem: &str) -> String {
    let tokens: Vec<&str> = options.split_whitespace().collect();
    let mut out = Vec::new();
    let mut i = 0;
    while i < tokens.len() {
        if tokens[i] == "+exec"
            && tokens
                .get(i + 1)
                .is_some_and(|candidate| is_preload_stem(candidate))
        {
            i += 2;
            continue;
        }
        out.push(tokens[i].to_string());
        i += 1;
    }
    if enabled {
        out.push("+exec".into());
        out.push(stem.into());
    }
    sanitize_launch_options(&out.join(" "))
}

fn is_preload_stem(value: &str) -> bool {
    value == EXECS_PRELOAD_STEM || value == EXECS_PRELOAD_OVERRIDES_STEM
}

#[derive(Debug, Clone, Default)]
pub struct QcEdit {
    pub origin: (f32, f32, f32),
    pub rotate: (f32, f32, f32),
    pub hide: bool,
    pub remove_left_arm: bool,
    pub keep: Vec<String>,
    pub extras: Vec<String>,
}

pub fn apply_qc_knobs(
    qc: &str,
    origin: (f32, f32, f32),
    hide: bool,
    remove_left_arm: bool,
) -> String {
    apply_qc_edit(
        qc,
        &QcEdit {
            origin,
            hide,
            remove_left_arm,
            ..QcEdit::default()
        },
    )
}

pub fn apply_qc_edit(qc: &str, edit: &QcEdit) -> String {
    let mut lines: Vec<String> = qc.lines().map(str::to_string).collect();
    lines.retain(|line| {
        let trim = line.trim_start();
        !trim.to_ascii_lowercase().starts_with("$origin") && !trim.starts_with("// execs:")
    });
    let z = if edit.hide {
        edit.origin.2 - 10_000.0
    } else {
        edit.origin.2
    };
    lines.insert(
        0,
        format!(
            "$origin {} {} {} {}",
            edit.origin.0, edit.origin.1, z, edit.rotate.2
        ),
    );
    let mut note_at = 1;
    if edit.rotate.0 != 0.0 || edit.rotate.1 != 0.0 || edit.rotate.2 != 0.0 {
        lines.insert(
            note_at,
            format!(
                "// execs: rotate {} {} {}",
                edit.rotate.0, edit.rotate.1, edit.rotate.2
            ),
        );
        note_at += 1;
    }
    if edit.hide {
        lines.insert(
            note_at,
            "// execs: hide (off-screen origin, same sequence length)".into(),
        );
        note_at += 1;
    }
    if !edit.keep.is_empty() {
        lines.insert(
            note_at,
            format!("// execs: keep_visible {}", edit.keep.join(" ")),
        );
    }
    if edit.remove_left_arm {
        lines.push("// execs: remove_left_arm".into());
    }
    for extra in &edit.extras {
        lines.push(format!("// execs: {extra}"));
    }
    let mut out = lines.join("\n");
    if !out.ends_with('\n') {
        out.push('\n');
    }
    out
}

pub fn apply_smd_origin_rotate(
    smd: &str,
    origin: (f32, f32, f32),
    rotate: (f32, f32, f32),
) -> String {
    let mut out = String::new();
    let mut in_skeleton = false;
    for line in smd.lines() {
        let trim = line.trim_start();
        if trim.eq_ignore_ascii_case("skeleton") {
            in_skeleton = true;
            out.push_str(line);
            out.push('\n');
            continue;
        }
        if in_skeleton && trim.eq_ignore_ascii_case("end") {
            in_skeleton = false;
        }
        if in_skeleton && !trim.starts_with("time ") && !trim.is_empty() {
            let parts: Vec<&str> = trim.split_whitespace().collect();
            if parts.len() >= 7 && parts[0] == "0" {
                if let (Ok(x), Ok(y), Ok(z), Ok(rx), Ok(ry), Ok(rz)) = (
                    parts[1].parse::<f32>(),
                    parts[2].parse::<f32>(),
                    parts[3].parse::<f32>(),
                    parts[4].parse::<f32>(),
                    parts[5].parse::<f32>(),
                    parts[6].parse::<f32>(),
                ) {
                    let edited = format!(
                        "  0 {} {} {} {} {} {}",
                        x + origin.0,
                        y + origin.1,
                        z + origin.2,
                        rx + rotate.0,
                        ry + rotate.1,
                        rz + rotate.2
                    );
                    out.push_str(&edited);
                    out.push('\n');
                    continue;
                }
            }
        }
        out.push_str(line);
        out.push('\n');
    }
    out
}

pub fn apply_smd_static_idle(smd: &str) -> String {
    let mut out = String::new();
    let mut in_skeleton = false;
    let mut first_time: Option<String> = None;
    for line in smd.lines() {
        let trim = line.trim_start();
        if trim.eq_ignore_ascii_case("skeleton") {
            in_skeleton = true;
            out.push_str(line);
            out.push('\n');
            continue;
        }
        if in_skeleton && trim.eq_ignore_ascii_case("end") {
            in_skeleton = false;
        }
        if in_skeleton && trim.starts_with("time ") {
            if first_time.is_none() {
                first_time = Some(line.to_string());
                out.push_str(line);
                out.push('\n');
            }
            continue;
        }
        if in_skeleton && first_time.is_some() && trim.starts_with("time ") {
            continue;
        }
        out.push_str(line);
        out.push('\n');
    }
    out
}

pub fn import_viewmodel_vpk(
    tf2_root: &Path,
    profile_id: &str,
    vpk_bytes: &[u8],
    preload: bool,
) -> Result<ProfileDetail, ProfileError> {
    let process_names = live_process_names();
    let steam_roots = discover_steam_roots();
    import_viewmodel_vpk_to_with_launch(
        &profiles_dir(),
        tf2_root,
        profile_id,
        vpk_bytes,
        preload,
        ViewmodelSource::Imported,
        BTreeMap::new(),
        process_names.clone(),
        process_names,
        &steam_roots,
    )
}

pub fn import_viewmodel_vpk_to<I, S>(
    profiles_dir: &Path,
    tf2_root: &Path,
    profile_id: &str,
    vpk_bytes: &[u8],
    preload: bool,
    source: ViewmodelSource,
    options: BTreeMap<String, String>,
    running_names: I,
) -> Result<ProfileDetail, ProfileError>
where
    I: IntoIterator<Item = S>,
    S: AsRef<str>,
{
    import_viewmodel_vpk_to_with_launch(
        profiles_dir,
        tf2_root,
        profile_id,
        vpk_bytes,
        preload,
        source,
        options,
        running_names,
        std::iter::empty::<String>(),
        &[],
    )
}

fn import_viewmodel_vpk_to_with_launch<I, J, S, T>(
    profiles_dir: &Path,
    tf2_root: &Path,
    profile_id: &str,
    vpk_bytes: &[u8],
    preload: bool,
    source: ViewmodelSource,
    options: BTreeMap<String, String>,
    running_names: I,
    steam_names: J,
    steam_roots: &[PathBuf],
) -> Result<ProfileDetail, ProfileError>
where
    I: IntoIterator<Item = S>,
    S: AsRef<str>,
    J: IntoIterator<Item = T>,
    T: AsRef<str>,
{
    let running: Vec<String> = running_names
        .into_iter()
        .map(|name| name.as_ref().to_string())
        .collect();
    let steam: Vec<String> = steam_names
        .into_iter()
        .map(|name| name.as_ref().to_string())
        .collect();
    read_vpk_dir_bytes(vpk_bytes).map_err(|err| ProfileError::Io(err.message()))?;
    refuse_if_running_among(&running).map_err(ProfileError::from)?;
    let previous = pack_files(profiles_dir, profile_id)?;
    if !previous.is_empty() {
        let paths: Vec<String> = previous.iter().map(|file| file.path.clone()).collect();
        remove_manifest_files_to(profiles_dir, tf2_root, profile_id, &paths, &running)?;
        remove_live_paths_if_active(profiles_dir, tf2_root, profile_id, &previous)?;
    }
    write_owned_file_to(
        profiles_dir,
        tf2_root,
        profile_id,
        EXECS_VIEWMODELS_VPK,
        vpk_bytes,
        running.iter().cloned(),
        WriteOwnedOptions::default(),
    )?;
    set_preload_state(
        profiles_dir,
        tf2_root,
        profile_id,
        preload,
        &running,
        &steam,
        steam_roots,
    )?;
    let mut manifest = load_manifest(profiles_dir, profile_id)?;
    manifest.viewmodel = Some(ViewmodelRecord {
        id: EXECS_VIEWMODELS_PACK.into(),
        source,
        preload,
        options,
    });
    save_manifest(profiles_dir, tf2_root, &manifest)?;
    Ok(detail_from_manifest(&load_manifest(
        profiles_dir,
        profile_id,
    )?))
}

pub fn remove_viewmodels(tf2_root: &Path, profile_id: &str) -> Result<ProfileDetail, ProfileError> {
    let process_names = live_process_names();
    let steam_roots = discover_steam_roots();
    remove_viewmodels_to_with_launch(
        &profiles_dir(),
        tf2_root,
        profile_id,
        process_names.clone(),
        process_names,
        &steam_roots,
    )
}

pub fn remove_viewmodels_to<I, S>(
    profiles_dir: &Path,
    tf2_root: &Path,
    profile_id: &str,
    running_names: I,
) -> Result<ProfileDetail, ProfileError>
where
    I: IntoIterator<Item = S>,
    S: AsRef<str>,
{
    remove_viewmodels_to_with_launch(
        profiles_dir,
        tf2_root,
        profile_id,
        running_names,
        std::iter::empty::<String>(),
        &[],
    )
}

fn remove_viewmodels_to_with_launch<I, J, S, T>(
    profiles_dir: &Path,
    tf2_root: &Path,
    profile_id: &str,
    running_names: I,
    steam_names: J,
    steam_roots: &[PathBuf],
) -> Result<ProfileDetail, ProfileError>
where
    I: IntoIterator<Item = S>,
    S: AsRef<str>,
    J: IntoIterator<Item = T>,
    T: AsRef<str>,
{
    let running: Vec<String> = running_names
        .into_iter()
        .map(|name| name.as_ref().to_string())
        .collect();
    let steam: Vec<String> = steam_names
        .into_iter()
        .map(|name| name.as_ref().to_string())
        .collect();
    refuse_if_running_among(&running).map_err(ProfileError::from)?;
    let previous = pack_files(profiles_dir, profile_id)?;
    if !previous.is_empty() {
        let paths: Vec<String> = previous.iter().map(|file| file.path.clone()).collect();
        remove_manifest_files_to(profiles_dir, tf2_root, profile_id, &paths, &running)?;
        remove_live_paths_if_active(profiles_dir, tf2_root, profile_id, &previous)?;
    }
    let mut manifest = load_manifest(profiles_dir, profile_id)?;
    let preload_was = manifest
        .viewmodel
        .as_ref()
        .is_some_and(|record| record.preload);
    manifest.viewmodel = None;
    save_manifest(profiles_dir, tf2_root, &manifest)?;
    if preload_was {
        set_preload_state(
            profiles_dir,
            tf2_root,
            profile_id,
            false,
            &running,
            &steam,
            steam_roots,
        )?;
    }
    Ok(detail_from_manifest(&load_manifest(
        profiles_dir,
        profile_id,
    )?))
}

pub fn set_viewmodel_preload(
    tf2_root: &Path,
    profile_id: &str,
    enabled: bool,
) -> Result<ProfileDetail, ProfileError> {
    let process_names = live_process_names();
    let steam_roots = discover_steam_roots();
    set_viewmodel_preload_to_with_launch(
        &profiles_dir(),
        tf2_root,
        profile_id,
        enabled,
        process_names.clone(),
        process_names,
        &steam_roots,
    )
}

pub fn set_viewmodel_preload_to<I, S>(
    profiles_dir: &Path,
    tf2_root: &Path,
    profile_id: &str,
    enabled: bool,
    running_names: I,
) -> Result<ProfileDetail, ProfileError>
where
    I: IntoIterator<Item = S>,
    S: AsRef<str>,
{
    set_viewmodel_preload_to_with_launch(
        profiles_dir,
        tf2_root,
        profile_id,
        enabled,
        running_names,
        std::iter::empty::<String>(),
        &[],
    )
}

fn set_viewmodel_preload_to_with_launch<I, J, S, T>(
    profiles_dir: &Path,
    tf2_root: &Path,
    profile_id: &str,
    enabled: bool,
    running_names: I,
    steam_names: J,
    steam_roots: &[PathBuf],
) -> Result<ProfileDetail, ProfileError>
where
    I: IntoIterator<Item = S>,
    S: AsRef<str>,
    J: IntoIterator<Item = T>,
    T: AsRef<str>,
{
    let running: Vec<String> = running_names
        .into_iter()
        .map(|name| name.as_ref().to_string())
        .collect();
    let steam: Vec<String> = steam_names
        .into_iter()
        .map(|name| name.as_ref().to_string())
        .collect();
    let manifest = load_manifest(profiles_dir, profile_id)?;
    if enabled && manifest.viewmodel.is_none() {
        return Err(ProfileError::Io(
            "Import or compile viewmodels before enabling preload.".into(),
        ));
    }
    set_preload_state(
        profiles_dir,
        tf2_root,
        profile_id,
        enabled,
        &running,
        &steam,
        steam_roots,
    )?;
    let mut manifest = load_manifest(profiles_dir, profile_id)?;
    if let Some(record) = manifest.viewmodel.as_mut() {
        record.preload = enabled;
    }
    save_manifest(profiles_dir, tf2_root, &manifest)?;
    Ok(detail_from_manifest(&load_manifest(
        profiles_dir,
        profile_id,
    )?))
}

pub fn compile_viewmodels(
    tf2_root: &Path,
    profile_id: &str,
    options: &BTreeMap<String, String>,
    preload: bool,
) -> Result<ProfileDetail, ProfileError> {
    compile_viewmodels_to(
        &profiles_dir(),
        tf2_root,
        profile_id,
        options,
        preload,
        None,
        live_process_names(),
    )
}

pub fn compile_viewmodels_to<I, S>(
    _profiles_dir: &Path,
    _tf2_root: &Path,
    _profile_id: &str,
    _options: &BTreeMap<String, String>,
    _preload: bool,
    _studiomdl: Option<&Path>,
    _running_names: I,
) -> Result<ProfileDetail, ProfileError>
where
    I: IntoIterator<Item = S>,
    S: AsRef<str>,
{
    Err(ProfileError::Io(
        VIEWMODEL_COMPILE_UNAVAILABLE_REASON.into(),
    ))
}

fn set_preload_state(
    profiles_dir: &Path,
    tf2_root: &Path,
    profile_id: &str,
    enabled: bool,
    running: &[String],
    steam: &[String],
    steam_roots: &[PathBuf],
) -> Result<(), ProfileError> {
    refuse_if_running_among(running).map_err(ProfileError::from)?;
    let manifest = load_manifest(profiles_dir, profile_id)?;
    let layer = cfg_layer_from_files(&manifest.files);
    let (path, launch_stem) = match layer {
        CfgLayer::Comfig => (EXECS_PRELOAD_COMFIG_PATH, EXECS_PRELOAD_OVERRIDES_STEM),
        CfgLayer::Vanilla => (EXECS_PRELOAD_VANILLA_PATH, EXECS_PRELOAD_STEM),
    };
    if enabled {
        write_owned_file_to(
            profiles_dir,
            tf2_root,
            profile_id,
            path,
            serialize_preload_cfg().as_bytes(),
            running.iter().cloned(),
            WriteOwnedOptions::default(),
        )?;
    } else {
        let preload_files: Vec<ProfileFile> = manifest
            .files
            .iter()
            .filter(|file| is_preload_path(&file.path))
            .cloned()
            .collect();
        let preload_paths: Vec<String> =
            preload_files.iter().map(|file| file.path.clone()).collect();
        remove_manifest_files_to(
            profiles_dir,
            tf2_root,
            profile_id,
            &preload_paths,
            running.iter().cloned(),
        )?;
        remove_live_paths_if_active(profiles_dir, tf2_root, profile_id, &preload_files)?;
    }
    let current = load_manifest(profiles_dir, profile_id)?.launch_options;
    let next = with_preload_launch_stem(&current, enabled, launch_stem);
    set_profile_launch_options_to(
        profiles_dir,
        tf2_root,
        profile_id,
        &next,
        running.iter().cloned(),
        steam.iter().cloned(),
        steam_roots,
    )?;
    let _ = load_library_from(profiles_dir, Some(tf2_root))?;
    Ok(())
}

fn remove_live_paths_if_active(
    profiles_dir: &Path,
    tf2_root: &Path,
    profile_id: &str,
    files: &[ProfileFile],
) -> Result<(), ProfileError> {
    let library = load_library_from(profiles_dir, Some(tf2_root))?;
    if library.active_profile_id.as_deref() != Some(profile_id) {
        return Ok(());
    }
    for file in files {
        let mut dest = tf2_root.to_path_buf();
        for part in file.path.split('/') {
            dest.push(part);
        }
        if dest.is_file() {
            let live_hash = sha256_file(&dest).map_err(|err| ProfileError::Io(err.to_string()))?;
            if live_hash == file.sha256 {
                std::fs::remove_file(&dest).map_err(|err| ProfileError::Io(err.to_string()))?;
            }
        }
    }
    Ok(())
}

fn pack_files(profiles_dir: &Path, profile_id: &str) -> Result<Vec<ProfileFile>, ProfileError> {
    let manifest = load_manifest(profiles_dir, profile_id)?;
    Ok(manifest
        .files
        .into_iter()
        .filter(|file| {
            file.path == EXECS_VIEWMODELS_VPK
                || file.path.starts_with("tf/custom/execs-viewmodels/")
                || is_preload_path(&file.path)
        })
        .collect())
}

fn is_preload_path(path: &str) -> bool {
    path == EXECS_PRELOAD_VANILLA_PATH || path == EXECS_PRELOAD_COMFIG_PATH
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::profile::{create_profile_record_to, set_active_profile_to};
    use crate::test_temp_dir;

    fn unlocked() -> Vec<String> {
        Vec::new()
    }

    fn locked() -> Vec<String> {
        vec![if cfg!(windows) {
            "tf_win64.exe".into()
        } else {
            "tf_linux64".into()
        }]
    }

    fn setup() -> (
        std::path::PathBuf,
        std::path::PathBuf,
        std::path::PathBuf,
        String,
    ) {
        let root = test_temp_dir();
        let tf2 = root.join("tf2");
        std::fs::create_dir_all(tf2.join("tf/cfg")).unwrap();
        std::fs::create_dir_all(tf2.join("tf/custom")).unwrap();
        std::fs::write(tf2.join("tf/steam.inf"), "appID=440\n").unwrap();
        let profiles = root.join("profiles");
        create_profile_record_to(&profiles, &tf2, "Main", unlocked()).unwrap();
        let id = crate::profile::load_library_from(&profiles, Some(&tf2))
            .unwrap()
            .profiles[0]
            .id
            .clone();
        set_active_profile_to(&profiles, &tf2, &id, unlocked()).unwrap();
        (root, profiles, tf2, id)
    }

    fn cleanup(root: &Path) {
        let _ = std::fs::remove_dir_all(root);
    }

    fn write_steam_account(steam: &Path, launch_options: &str) -> PathBuf {
        let localconfig = steam
            .join("userdata")
            .join("111")
            .join("config")
            .join("localconfig.vdf");
        std::fs::create_dir_all(localconfig.parent().unwrap()).unwrap();
        std::fs::write(
            &localconfig,
            format!(
                "\"UserLocalConfigStore\"\n{{\n  \"Software\"\n  {{\n    \"Valve\"\n    {{\n      \"Steam\"\n      {{\n        \"apps\"\n        {{\n          \"440\"\n          {{\n            \"LaunchOptions\" \"{launch_options}\"\n          }}\n        }}\n      }}\n    }}\n  }}\n}}\n"
            ),
        )
        .unwrap();
        localconfig
    }

    #[test]
    fn preload_cfg_is_itemtest_and_never_mentions_gameinfo() {
        let cfg = serialize_preload_cfg();
        assert!(cfg.contains("map itemtest"));
        assert!(cfg.contains("disconnect"));
        assert!(!cfg.contains("gameinfo"));
        assert!(!cfg.contains("+quit"));
        let enabled = with_preload_launch("-novid -nojoy", true);
        assert!(has_preload_launch(&enabled));
        assert!(!with_preload_launch(&enabled, false).contains("execs_preload"));
        let comfig = format!("-novid +exec {EXECS_PRELOAD_OVERRIDES_STEM}");
        assert!(has_preload_launch(&comfig));
        assert_eq!(with_preload_launch(&comfig, false), "-novid");
        assert!(!with_preload_launch("-novid -autoconfig +quit", true).contains("+quit"));
    }

    #[test]
    fn qc_hide_keeps_a_timing_safe_offscreen_origin() {
        let qc = apply_qc_edit(
            "$modelname \"x.mdl\"\n",
            &QcEdit {
                origin: (1.0, 2.0, 3.0),
                rotate: (4.0, 5.0, 6.0),
                hide: true,
                remove_left_arm: true,
                keep: vec!["draw".into(), "reload".into()],
                extras: vec!["keepBeamVisible".into()],
            },
        );
        assert!(qc.contains("$origin 1 2 -9997 6"));
        assert!(qc.contains("rotate 4 5 6"));
        assert!(qc.contains("keep_visible draw reload"));
        assert!(qc.contains("remove_left_arm"));
        assert!(qc.contains("keepBeamVisible"));
        let smd = "version 1\nskeleton\ntime 0\n  0 1 2 3 0 0 0\ntime 1\n  0 1 2 3 0 0 0\nend\n";
        let moved = apply_smd_origin_rotate(smd, (10.0, 0.0, 0.0), (0.0, 0.0, 90.0));
        assert!(moved.contains("11 2 3 0 0 90"));
        let static_idle = apply_smd_static_idle(smd);
        assert_eq!(static_idle.matches("time ").count(), 1);
    }

    #[test]
    fn import_installs_vpk_and_preload() {
        let (root, profiles, tf2, id) = setup();
        let mut files = BTreeMap::new();
        files.insert(
            "models/weapons/c_models/c_scout_animations.mdl".into(),
            b"mdl".to_vec(),
        );
        let vpk = write_vpk_v1(&files);
        let detail = import_viewmodel_vpk_to(
            &profiles,
            &tf2,
            &id,
            &vpk,
            true,
            ViewmodelSource::Imported,
            BTreeMap::new(),
            unlocked(),
        )
        .unwrap();
        assert_eq!(
            detail.viewmodel.as_ref().unwrap().source,
            ViewmodelSource::Imported
        );
        assert!(detail.viewmodel.as_ref().unwrap().preload);
        assert!(tf2.join("tf/custom/execs-viewmodels.vpk").is_file());
        assert!(tf2.join("tf/cfg/execs_preload.cfg").is_file());
        assert!(detail.launch_options.contains("execs_preload"));
        remove_viewmodels_to(&profiles, &tf2, &id, unlocked()).unwrap();
        assert!(!tf2.join("tf/custom/execs-viewmodels.vpk").exists());
        assert!(!tf2.join("tf/cfg/execs_preload.cfg").exists());
        cleanup(&root);
    }

    #[test]
    fn enabling_preload_without_viewmodels_is_side_effect_free() {
        let (root, profiles, tf2, id) = setup();
        let before = load_manifest(&profiles, &id).unwrap();
        let err = set_viewmodel_preload_to(&profiles, &tf2, &id, true, unlocked()).unwrap_err();
        assert!(err.message().contains("Import or compile"));
        let after = load_manifest(&profiles, &id).unwrap();
        assert_eq!(after.launch_options, before.launch_options);
        assert_eq!(after.files, before.files);
        assert!(!tf2.join("tf/cfg/execs_preload.cfg").exists());
        assert!(!tf2.join("tf/cfg/overrides/execs_preload.cfg").exists());
        cleanup(&root);
    }

    #[test]
    fn disabling_preload_removes_the_managed_cfg_and_launch_token() {
        let (root, profiles, tf2, id) = setup();
        let mut files = BTreeMap::new();
        files.insert("models/a.mdl".into(), b"x".to_vec());
        import_viewmodel_vpk_to(
            &profiles,
            &tf2,
            &id,
            &write_vpk_v1(&files),
            true,
            ViewmodelSource::Imported,
            BTreeMap::new(),
            unlocked(),
        )
        .unwrap();

        let detail = set_viewmodel_preload_to(&profiles, &tf2, &id, false, unlocked()).unwrap();
        assert!(!detail.viewmodel.as_ref().unwrap().preload);
        assert!(!detail.launch_options.contains("execs_preload"));
        assert!(!tf2.join("tf/cfg/execs_preload.cfg").exists());
        let manifest = load_manifest(&profiles, &id).unwrap();
        assert!(!manifest
            .files
            .iter()
            .any(|file| file.path.ends_with("execs_preload.cfg")));
        cleanup(&root);
    }

    #[test]
    fn comfig_preload_uses_the_overrides_exec_target() {
        let (root, profiles, tf2, id) = setup();
        write_owned_file_to(
            &profiles,
            &tf2,
            &id,
            "tf/cfg/overrides/modules.cfg",
            b"lighting=high\n",
            unlocked(),
            WriteOwnedOptions::default(),
        )
        .unwrap();
        let mut files = BTreeMap::new();
        files.insert("models/a.mdl".into(), b"x".to_vec());
        let detail = import_viewmodel_vpk_to(
            &profiles,
            &tf2,
            &id,
            &write_vpk_v1(&files),
            true,
            ViewmodelSource::Imported,
            BTreeMap::new(),
            unlocked(),
        )
        .unwrap();
        assert!(tf2.join(EXECS_PRELOAD_COMFIG_PATH).is_file());
        assert!(detail
            .launch_options
            .contains("+exec overrides/execs_preload"));
        assert!(!detail.launch_options.contains("+exec execs_preload"));
        cleanup(&root);
    }

    #[test]
    fn preload_updates_steam_launch_options_when_steam_is_closed() {
        let (root, profiles, tf2, id) = setup();
        let steam = root.join("Steam");
        let localconfig = write_steam_account(&steam, "-novid");
        let mut files = BTreeMap::new();
        files.insert("models/a.mdl".into(), b"x".to_vec());
        import_viewmodel_vpk_to_with_launch(
            &profiles,
            &tf2,
            &id,
            &write_vpk_v1(&files),
            true,
            ViewmodelSource::Imported,
            BTreeMap::new(),
            unlocked(),
            unlocked(),
            &[steam],
        )
        .unwrap();
        let text = std::fs::read_to_string(localconfig).unwrap();
        assert!(text.contains("\"LaunchOptions\"\t\t\"+exec execs_preload\""));
        cleanup(&root);
    }

    #[test]
    fn compile_is_disabled_before_any_cache_or_live_mutation() {
        let (root, profiles, tf2, id) = setup();
        let before = load_manifest(&profiles, &id).unwrap();
        let work = profiles
            .join("..")
            .join("studio")
            .join("viewmodels")
            .join(&id);
        let mut options = BTreeMap::new();
        options.insert("../../escape".into(), "{}".into());
        let err = compile_viewmodels_to(
            &profiles,
            &tf2,
            &id,
            &options,
            true,
            Some(Path::new("studiomdl.exe")),
            unlocked(),
        )
        .unwrap_err();
        assert!(err.message().contains("file-safe compiler is rebuilt"));
        assert!(!work.exists());
        assert!(!tf2.join("tf/models").exists());
        assert_eq!(load_manifest(&profiles, &id).unwrap(), before);
        assert!(!viewmodel_compile_capability().available);
        cleanup(&root);
    }

    #[test]
    fn remove_preserves_drifted_live_viewmodel_files() {
        let (root, profiles, tf2, id) = setup();
        let mut files = BTreeMap::new();
        files.insert("models/a.mdl".into(), b"x".to_vec());
        import_viewmodel_vpk_to(
            &profiles,
            &tf2,
            &id,
            &write_vpk_v1(&files),
            true,
            ViewmodelSource::Imported,
            BTreeMap::new(),
            unlocked(),
        )
        .unwrap();
        let live_vpk = tf2.join(EXECS_VIEWMODELS_VPK);
        let live_preload = tf2.join(EXECS_PRELOAD_VANILLA_PATH);
        std::fs::write(&live_vpk, b"user drift").unwrap();
        std::fs::write(&live_preload, b"user drift\n").unwrap();

        let detail = remove_viewmodels_to(&profiles, &tf2, &id, unlocked()).unwrap();
        assert_eq!(std::fs::read(live_vpk).unwrap(), b"user drift");
        assert_eq!(std::fs::read(live_preload).unwrap(), b"user drift\n");
        assert!(detail.viewmodel.is_none());
        assert!(!detail.launch_options.contains("execs_preload"));
        cleanup(&root);
    }

    #[test]
    fn refuses_while_tf2_is_running() {
        let (root, profiles, tf2, id) = setup();
        let mut files = BTreeMap::new();
        files.insert("models/a.mdl".into(), b"x".to_vec());
        let err = import_viewmodel_vpk_to(
            &profiles,
            &tf2,
            &id,
            &write_vpk_v1(&files),
            false,
            ViewmodelSource::Imported,
            BTreeMap::new(),
            locked(),
        )
        .unwrap_err();
        assert!(matches!(err, ProfileError::GameRunning));
        cleanup(&root);
    }
}
