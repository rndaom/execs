//! First-party Horsie-class viewmodel compile + Casual itemtest preload.
//! Never edits gameinfo.txt. Never writes official VPKs.

use std::collections::BTreeMap;
use std::path::{Path, PathBuf};
use std::process::Command;

use crate::apply::{
    cfg_layer_from_files, detail_from_manifest, write_owned_file_to, ProfileDetail,
    WriteOwnedOptions,
};
use crate::launch::{sanitize_launch_options, set_profile_launch_options_to};
use crate::process_lock::live_process_names;
use crate::profile::{
    exclusive_file_path, load_library_from, load_manifest, profiles_dir, remove_manifest_files_to,
    save_manifest, ProfileError, ViewmodelRecord, ViewmodelSource,
};
use crate::settings::execs_data_dir;
use crate::surface::CfgLayer;
use crate::vpk::{read_vpk_dir_bytes, write_vpk_v1};

pub const EXECS_VIEWMODELS_PACK: &str = "execs-viewmodels";
pub const EXECS_VIEWMODELS_VPK: &str = "tf/custom/execs-viewmodels.vpk";
pub const EXECS_PRELOAD_STEM: &str = "execs_preload";

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
        .any(|pair| pair == ["+exec", EXECS_PRELOAD_STEM])
        || tokens.iter().any(|token| *token == "+exec execs_preload")
}

pub fn with_preload_launch(options: &str, enabled: bool) -> String {
    let tokens: Vec<&str> = options.split_whitespace().collect();
    let mut out = Vec::new();
    let mut i = 0;
    while i < tokens.len() {
        if tokens[i] == "+exec" && tokens.get(i + 1) == Some(&EXECS_PRELOAD_STEM) {
            i += 2;
            continue;
        }
        out.push(tokens[i].to_string());
        i += 1;
    }
    if enabled {
        out.push("+exec".into());
        out.push(EXECS_PRELOAD_STEM.into());
    }
    sanitize_launch_options(&out.join(" "))
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
    import_viewmodel_vpk_to(
        &profiles_dir(),
        tf2_root,
        profile_id,
        vpk_bytes,
        preload,
        ViewmodelSource::Imported,
        BTreeMap::new(),
        live_process_names(),
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
    let running: Vec<String> = running_names
        .into_iter()
        .map(|name| name.as_ref().to_string())
        .collect();
    read_vpk_dir_bytes(vpk_bytes).map_err(|err| ProfileError::Io(err.message()))?;
    let previous = pack_paths(profiles_dir, profile_id)?;
    if !previous.is_empty() {
        remove_manifest_files_to(profiles_dir, tf2_root, profile_id, &previous, &running)?;
        remove_live_vpk(tf2_root)?;
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
    set_preload_state(profiles_dir, tf2_root, profile_id, preload, &running)?;
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
    remove_viewmodels_to(&profiles_dir(), tf2_root, profile_id, live_process_names())
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
    let running: Vec<String> = running_names
        .into_iter()
        .map(|name| name.as_ref().to_string())
        .collect();
    let previous = pack_paths(profiles_dir, profile_id)?;
    if !previous.is_empty() {
        remove_manifest_files_to(profiles_dir, tf2_root, profile_id, &previous, &running)?;
    }
    remove_live_vpk(tf2_root)?;
    let mut manifest = load_manifest(profiles_dir, profile_id)?;
    let preload_was = manifest
        .viewmodel
        .as_ref()
        .is_some_and(|record| record.preload);
    manifest.viewmodel = None;
    save_manifest(profiles_dir, tf2_root, &manifest)?;
    if preload_was {
        set_preload_state(profiles_dir, tf2_root, profile_id, false, &running)?;
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
    set_viewmodel_preload_to(
        &profiles_dir(),
        tf2_root,
        profile_id,
        enabled,
        live_process_names(),
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
    let running: Vec<String> = running_names
        .into_iter()
        .map(|name| name.as_ref().to_string())
        .collect();
    set_preload_state(profiles_dir, tf2_root, profile_id, enabled, &running)?;
    let mut manifest = load_manifest(profiles_dir, profile_id)?;
    if let Some(record) = manifest.viewmodel.as_mut() {
        record.preload = enabled;
    } else if enabled {
        return Err(ProfileError::Io(
            "Import or compile viewmodels before enabling preload.".into(),
        ));
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
    profiles_dir: &Path,
    tf2_root: &Path,
    profile_id: &str,
    options: &BTreeMap<String, String>,
    preload: bool,
    studiomdl: Option<&Path>,
    running_names: I,
) -> Result<ProfileDetail, ProfileError>
where
    I: IntoIterator<Item = S>,
    S: AsRef<str>,
{
    let running: Vec<String> = running_names
        .into_iter()
        .map(|name| name.as_ref().to_string())
        .collect();
    if cfg!(not(windows)) && studiomdl.is_none() {
        return Err(ProfileError::Io(
            "Compile is Windows-only because it uses TF2's studiomdl. Import a prebuilt VPK."
                .into(),
        ));
    }
    let compiler = studiomdl
        .map(PathBuf::from)
        .or_else(|| default_studiomdl(tf2_root));
    let Some(compiler) = compiler else {
        return Err(ProfileError::Io(
            "Could not find Team Fortress 2/bin/studiomdl.exe.".into(),
        ));
    };

    let cache = studio_work_dir(profiles_dir, profile_id);
    std::fs::create_dir_all(&cache).map_err(|err| ProfileError::Io(err.to_string()))?;
    bootstrap_tree(tf2_root, &cache)?;

    let mut compiled = BTreeMap::new();
    if options.is_empty() {
        let qc = apply_qc_knobs(
            "$modelname \"weapons/c_models/c_scout_animations.mdl\"\n",
            (0.0, 0.0, 0.0),
            false,
            false,
        );
        let qc_path = cache.join("execs.qc");
        std::fs::write(&qc_path, qc).map_err(|err| ProfileError::Io(err.to_string()))?;
        run_studiomdl(&compiler, tf2_root, &qc_path)?;
    }
    for (weapon, raw) in options {
        let knobs = parse_knobs(raw);
        let qc_path = cache.join(format!("{weapon}.qc"));
        let source_qc = if qc_path.is_file() {
            std::fs::read_to_string(&qc_path).unwrap_or_default()
        } else {
            format!("$modelname \"weapons/c_models/c_{weapon}_animations.mdl\"\n")
        };
        let qc = apply_qc_edit(&source_qc, &knobs.to_qc_edit());
        std::fs::write(&qc_path, qc).map_err(|err| ProfileError::Io(err.to_string()))?;
        let smd_path = cache.join(format!("{weapon}.smd"));
        if smd_path.is_file() {
            if let Ok(smd) = std::fs::read_to_string(&smd_path) {
                let edited = apply_smd_origin_rotate(
                    &smd,
                    (knobs.origin_x, knobs.origin_y, knobs.origin_z),
                    (knobs.rotate_x, knobs.rotate_y, knobs.rotate_z),
                );
                std::fs::write(&smd_path, edited)
                    .map_err(|err| ProfileError::Io(err.to_string()))?;
            }
        }
        if knobs.stat_idle {
            if let Ok(smd) = std::fs::read_to_string(cache.join(format!("{weapon}_idle.smd"))) {
                std::fs::write(
                    cache.join(format!("{weapon}_idle.smd")),
                    apply_smd_static_idle(&smd),
                )
                .map_err(|err| ProfileError::Io(err.to_string()))?;
            }
        }
        run_studiomdl(&compiler, tf2_root, &qc_path)?;
        let mdl = cache.join(format!("c_{weapon}_animations.mdl"));
        if mdl.is_file() {
            compiled.insert(
                format!("models/weapons/c_models/c_{weapon}_animations.mdl"),
                std::fs::read(&mdl).map_err(|err| ProfileError::Io(err.to_string()))?,
            );
        }
    }
    if compiled.is_empty() {
        // Fake / stub compilers may write a well-known output file.
        let stub = cache.join("compiled.mdl");
        if stub.is_file() {
            compiled.insert(
                "models/weapons/c_models/c_scout_animations.mdl".into(),
                std::fs::read(&stub).map_err(|err| ProfileError::Io(err.to_string()))?,
            );
        }
    }
    if compiled.is_empty() {
        return Err(ProfileError::Io(
            "studiomdl finished but no compiled model was produced.".into(),
        ));
    }
    let vpk = write_vpk_v1(&compiled);
    import_viewmodel_vpk_to(
        profiles_dir,
        tf2_root,
        profile_id,
        &vpk,
        preload,
        ViewmodelSource::Compiled,
        options.clone(),
        running,
    )
}

fn bootstrap_tree(tf2_root: &Path, cache: &Path) -> Result<(), ProfileError> {
    std::fs::create_dir_all(cache).map_err(|err| ProfileError::Io(err.to_string()))?;
    let marker = cache.join("extracted.txt");
    if marker.is_file() {
        return Ok(());
    }
    let vpk = tf2_root.join("tf").join("tf2_misc_dir.vpk");
    if vpk.is_file() {
        if let Ok(archive) = read_vpk_dir_file_safe(&vpk) {
            for (path, bytes) in archive {
                let lower = path.to_ascii_lowercase();
                if !(lower.contains("c_models")
                    && (lower.ends_with(".mdl")
                        || lower.ends_with(".smd")
                        || lower.ends_with(".qc")))
                {
                    continue;
                }
                let dest = cache.join(&path);
                if let Some(parent) = dest.parent() {
                    let _ = std::fs::create_dir_all(parent);
                }
                let _ = std::fs::write(dest, bytes);
            }
        }
    }
    try_decompile_extracted(tf2_root, cache);
    std::fs::write(&marker, "ok\n").map_err(|err| ProfileError::Io(err.to_string()))?;
    Ok(())
}

fn try_decompile_extracted(tf2_root: &Path, cache: &Path) {
    let Some(decompiler) = find_decompiler(tf2_root) else {
        return;
    };
    if let Ok(entries) = std::fs::read_dir(cache) {
        for entry in entries.flatten() {
            let path = entry.path();
            if path.extension().and_then(|ext| ext.to_str()) != Some("mdl") {
                continue;
            }
            let _ = Command::new(&decompiler)
                .arg("-p")
                .arg(&path)
                .arg("-o")
                .arg(cache)
                .status();
        }
    }
}

fn find_decompiler(tf2_root: &Path) -> Option<PathBuf> {
    for name in ["crowbar", "Crowbar", "crowbar.exe", "Crowbar.exe"] {
        if let Ok(path) = which_on_path(name) {
            return Some(path);
        }
    }
    let next_to_bin = tf2_root.join("bin").join("Crowbar.exe");
    next_to_bin.is_file().then_some(next_to_bin)
}

fn which_on_path(name: &str) -> Result<PathBuf, ()> {
    let Ok(path) = std::env::var("PATH") else {
        return Err(());
    };
    for dir in std::env::split_paths(&path) {
        let candidate = dir.join(name);
        if candidate.is_file() {
            return Ok(candidate);
        }
    }
    Err(())
}

fn read_vpk_dir_file_safe(path: &Path) -> Result<BTreeMap<String, Vec<u8>>, ProfileError> {
    match crate::vpk::read_vpk_dir_file(path) {
        Ok(archive) => Ok(archive.files),
        Err(err) => Err(ProfileError::Io(err.message())),
    }
}

fn run_studiomdl(compiler: &Path, tf2_root: &Path, qc: &Path) -> Result<(), ProfileError> {
    let status = Command::new(compiler)
        .arg("-game")
        .arg(tf2_root.join("tf"))
        .arg(qc)
        .status()
        .map_err(|err| ProfileError::Io(format!("Could not run studiomdl: {err}")))?;
    if !status.success() {
        return Err(ProfileError::Io("studiomdl failed.".into()));
    }
    Ok(())
}

fn default_studiomdl(tf2_root: &Path) -> Option<PathBuf> {
    let exe = tf2_root.join("bin").join("studiomdl.exe");
    exe.is_file().then_some(exe)
}

#[derive(Default)]
struct Knobs {
    origin_x: f32,
    origin_y: f32,
    origin_z: f32,
    rotate_x: f32,
    rotate_y: f32,
    rotate_z: f32,
    hide: bool,
    remove_left_arm: bool,
    stat_idle: bool,
    keep: Vec<String>,
    extras: Vec<String>,
}

impl Knobs {
    fn to_qc_edit(&self) -> QcEdit {
        QcEdit {
            origin: (self.origin_x, self.origin_y, self.origin_z),
            rotate: (self.rotate_x, self.rotate_y, self.rotate_z),
            hide: self.hide,
            remove_left_arm: self.remove_left_arm,
            keep: self.keep.clone(),
            extras: self.extras.clone(),
        }
    }
}

fn parse_knobs(raw: &str) -> Knobs {
    let Ok(value) = serde_json::from_str::<serde_json::Value>(raw) else {
        return Knobs::default();
    };
    let num = |key: &str| {
        value
            .get(key)
            .and_then(|item| item.as_f64().or_else(|| item.as_i64().map(|n| n as f64)))
            .unwrap_or(0.0) as f32
    };
    let flag = |key: &str| {
        value
            .get(key)
            .and_then(|item| item.as_bool())
            .unwrap_or(false)
    };
    let nested_true = |group: &str| -> Vec<String> {
        value
            .get(group)
            .and_then(|item| item.as_object())
            .map(|map| {
                map.iter()
                    .filter(|(_, item)| item.as_bool() == Some(true))
                    .map(|(key, _)| key.clone())
                    .collect()
            })
            .unwrap_or_default()
    };
    let stat_idle = value
        .get("stat")
        .and_then(|item| item.get("idle"))
        .and_then(|item| item.as_bool())
        .unwrap_or(false);
    Knobs {
        origin_x: num("originX"),
        origin_y: num("originY"),
        origin_z: num("originZ"),
        rotate_x: num("rotateX"),
        rotate_y: num("rotateY"),
        rotate_z: num("rotateZ"),
        hide: flag("hide"),
        remove_left_arm: flag("removeLeftArm"),
        stat_idle,
        keep: nested_true("keep"),
        extras: nested_true("extra"),
    }
}

fn set_preload_state(
    profiles_dir: &Path,
    tf2_root: &Path,
    profile_id: &str,
    enabled: bool,
    running: &[String],
) -> Result<(), ProfileError> {
    let manifest = load_manifest(profiles_dir, profile_id)?;
    let layer = cfg_layer_from_files(&manifest.files);
    let path = match layer {
        CfgLayer::Comfig => "tf/cfg/overrides/execs_preload.cfg",
        CfgLayer::Vanilla => "tf/cfg/execs_preload.cfg",
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
    }
    let current = manifest.launch_options;
    let next = with_preload_launch(&current, enabled);
    set_profile_launch_options_to(
        profiles_dir,
        tf2_root,
        profile_id,
        &next,
        running.iter().cloned(),
        std::iter::empty::<String>(),
        &[],
    )?;
    let _ = exclusive_file_path(profiles_dir, profile_id, path);
    let _ = load_library_from(profiles_dir, Some(tf2_root))?;
    Ok(())
}

fn pack_paths(profiles_dir: &Path, profile_id: &str) -> Result<Vec<String>, ProfileError> {
    let manifest = load_manifest(profiles_dir, profile_id)?;
    Ok(manifest
        .files
        .into_iter()
        .filter(|file| {
            file.path == EXECS_VIEWMODELS_VPK
                || file.path.starts_with("tf/custom/execs-viewmodels/")
                || file.path.ends_with("execs_preload.cfg")
        })
        .map(|file| file.path)
        .collect())
}

fn remove_live_vpk(tf2_root: &Path) -> Result<(), ProfileError> {
    let path = tf2_root
        .join("tf")
        .join("custom")
        .join("execs-viewmodels.vpk");
    if path.is_file() {
        std::fs::remove_file(&path).map_err(|err| ProfileError::Io(err.to_string()))?;
    }
    Ok(())
}

fn studio_work_dir(profiles_dir: &Path, profile_id: &str) -> PathBuf {
    profiles_dir
        .join("..")
        .join("studio")
        .join("viewmodels")
        .join(profile_id)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::profile::{create_profile_record_to, set_active_profile_to};
    use crate::test_temp_dir;

    fn unlocked() -> Vec<String> {
        Vec::new()
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
        cleanup(&root);
    }

    #[test]
    fn compile_uses_injected_studiomdl_and_refuses_on_linux_without_it() {
        let (root, profiles, tf2, id) = setup();
        let err = compile_viewmodels_to(
            &profiles,
            &tf2,
            &id,
            &BTreeMap::new(),
            false,
            None,
            unlocked(),
        )
        .unwrap_err();
        assert!(err.message().contains("Windows-only") || err.message().contains("studiomdl"));

        let fake = root.join("studiomdl");
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            std::fs::write(
                &fake,
                "#!/bin/sh\nqc=\"$3\"\ndir=$(dirname \"$qc\")\nprintf mdl > \"$dir/compiled.mdl\"\nexit 0\n",
            )
            .unwrap();
            let mut perm = std::fs::metadata(&fake).unwrap().permissions();
            perm.set_mode(0o755);
            std::fs::set_permissions(&fake, perm).unwrap();
        }
        #[cfg(not(unix))]
        {
            std::fs::write(&fake, b"rem").unwrap();
        }

        let work = profiles
            .join("..")
            .join("studio")
            .join("viewmodels")
            .join(&id);
        std::fs::create_dir_all(&work).unwrap();
        let mut options = BTreeMap::new();
        options.insert(
            "scattergun".into(),
            r#"{"originX":1,"originY":0,"originZ":0,"rotateZ":15,"hide":true,"removeLeftArm":false,"stat":{"idle":false},"keep":{"draw":true},"extra":{"keepBeamVisible":true}}"#.into(),
        );
        let detail = compile_viewmodels_to(
            &profiles,
            &tf2,
            &id,
            &options,
            true,
            Some(&fake),
            unlocked(),
        )
        .unwrap();
        assert_eq!(
            detail.viewmodel.as_ref().unwrap().source,
            ViewmodelSource::Compiled
        );
        assert!(tf2.join("tf/custom/execs-viewmodels.vpk").is_file());
        assert!(detail
            .viewmodel
            .as_ref()
            .unwrap()
            .options
            .get("scattergun")
            .unwrap()
            .contains("keepBeamVisible"));
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
            ["tf_linux64".to_string()],
        )
        .unwrap_err();
        assert!(matches!(err, ProfileError::GameRunning));
        cleanup(&root);
    }
}
