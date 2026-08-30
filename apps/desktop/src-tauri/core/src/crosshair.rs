//! First-party per-weapon VTF crosshairs. Reads the user's official VPK; never writes it.

use std::collections::BTreeMap;
use std::path::Path;

use crate::apply::{
    cfg_layer_from_files, detail_from_manifest, write_owned_file_to, ProfileDetail,
    WriteOwnedOptions,
};
use crate::ice::{decrypt_weapon_ctx, encrypt_weapon_ctx};
use crate::process_lock::live_process_names;
use crate::profile::{
    exclusive_file_path, load_manifest, profiles_dir, remove_manifest_files_to, save_manifest,
    CrosshairRecord, ProfileError,
};
use crate::surface::CfgLayer;
use crate::vdf::{parse_vdf, serialize_vdf, VdfMap, VdfValue};
use crate::vpk::{read_vpk_dir_file, write_vpk_v1};

pub const EXECS_CROSSHAIRS_PACK: &str = "execs-crosshairs";
pub const CROSSHAIR_SIZE: u32 = 64;
const THUMB_DIR: &str = "materials/vgui/replay/thumbnails";
const IMAGE_FORMAT_BGRA8888: u32 = 12;
const VTF_FLAGS: u32 = 0x0001 | 0x0004 | 0x0008 | 0x0100 | 0x0200 | 0x2000;

const SHAPES: [&str; 6] = ["dot", "cross", "plus-gap", "circle", "t", "custom"];

pub fn apply_crosshairs(
    tf2_root: &Path,
    profile_id: &str,
    shape: &str,
    assignments: &BTreeMap<String, String>,
    custom_rgba: Option<&[u8]>,
) -> Result<ProfileDetail, ProfileError> {
    apply_crosshairs_to(
        &profiles_dir(),
        tf2_root,
        profile_id,
        shape,
        assignments,
        custom_rgba,
        live_process_names(),
    )
}

pub fn apply_crosshairs_to<I, S>(
    profiles_dir: &Path,
    tf2_root: &Path,
    profile_id: &str,
    shape: &str,
    assignments: &BTreeMap<String, String>,
    custom_rgba: Option<&[u8]>,
    running_names: I,
) -> Result<ProfileDetail, ProfileError>
where
    I: IntoIterator<Item = S>,
    S: AsRef<str>,
{
    let scripts = load_weapon_scripts(tf2_root)?;
    apply_crosshairs_with_scripts(
        profiles_dir,
        tf2_root,
        profile_id,
        shape,
        assignments,
        custom_rgba,
        &scripts,
        running_names,
    )
}

pub fn apply_crosshairs_with_scripts<I, S>(
    profiles_dir: &Path,
    tf2_root: &Path,
    profile_id: &str,
    shape: &str,
    assignments: &BTreeMap<String, String>,
    custom_rgba: Option<&[u8]>,
    scripts: &BTreeMap<String, String>,
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
    if !SHAPES.contains(&shape) {
        return Err(ProfileError::Io(format!(
            "Unknown crosshair shape {shape}."
        )));
    }
    let mut needed = BTreeMap::new();
    needed.insert(shape.to_string(), shape_pixels(shape, custom_rgba)?);
    for assigned in assignments.values() {
        if !SHAPES.contains(&assigned.as_str()) {
            return Err(ProfileError::Io(format!(
                "Unknown crosshair shape {assigned}."
            )));
        }
        if needed.contains_key(assigned) {
            continue;
        }
        needed.insert(assigned.clone(), shape_pixels(assigned, custom_rgba)?);
    }

    let previous = pack_paths(profiles_dir, profile_id)?;
    if !previous.is_empty() {
        remove_manifest_files_to(profiles_dir, tf2_root, profile_id, &previous, &running)?;
        remove_live_pack(tf2_root, EXECS_CROSSHAIRS_PACK)?;
    }

    for (name, rgba) in &needed {
        let vtf = encode_vtf_bgra8888(&rgba_to_bgra(rgba), CROSSHAIR_SIZE, CROSSHAIR_SIZE)?;
        let vmt = encode_vmt(name);
        write_pack_file(
            profiles_dir,
            tf2_root,
            profile_id,
            &format!("tf/custom/{EXECS_CROSSHAIRS_PACK}/{THUMB_DIR}/{name}.vtf"),
            &vtf,
            &running,
        )?;
        write_pack_file(
            profiles_dir,
            tf2_root,
            profile_id,
            &format!("tf/custom/{EXECS_CROSSHAIRS_PACK}/{THUMB_DIR}/{name}.vmt"),
            vmt.as_bytes(),
            &running,
        )?;
    }

    for (script, body) in scripts {
        let stem = script
            .trim_end_matches(".txt")
            .trim_end_matches(".ctx")
            .rsplit('/')
            .next()
            .unwrap_or(script);
        let used = assignments
            .get(stem)
            .cloned()
            .unwrap_or_else(|| shape.to_string());
        let patched = patch_crosshair_script(body, &used)
            .map_err(|err| ProfileError::Io(format!("{script}: {err}")))?;
        write_pack_file(
            profiles_dir,
            tf2_root,
            profile_id,
            &format!("tf/custom/{EXECS_CROSSHAIRS_PACK}/scripts/{stem}.txt"),
            patched.as_bytes(),
            &running,
        )?;
    }

    let mut manifest = load_manifest(profiles_dir, profile_id)?;
    manifest.crosshair = Some(CrosshairRecord {
        id: EXECS_CROSSHAIRS_PACK.into(),
        shape: shape.to_string(),
        assignments: assignments.clone(),
    });
    save_manifest(profiles_dir, tf2_root, &manifest)?;
    force_empty_stock_crosshair(profiles_dir, tf2_root, profile_id, &running)?;
    Ok(detail_from_manifest(&load_manifest(
        profiles_dir,
        profile_id,
    )?))
}

pub fn remove_crosshairs(tf2_root: &Path, profile_id: &str) -> Result<ProfileDetail, ProfileError> {
    remove_crosshairs_to(&profiles_dir(), tf2_root, profile_id, live_process_names())
}

pub fn remove_crosshairs_to<I, S>(
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
    remove_live_pack(tf2_root, EXECS_CROSSHAIRS_PACK)?;
    let mut manifest = load_manifest(profiles_dir, profile_id)?;
    manifest.crosshair = None;
    save_manifest(profiles_dir, tf2_root, &manifest)?;
    Ok(detail_from_manifest(&load_manifest(
        profiles_dir,
        profile_id,
    )?))
}

pub fn load_weapon_scripts(tf2_root: &Path) -> Result<BTreeMap<String, String>, ProfileError> {
    let vpk = tf2_root.join("tf").join("tf2_misc_dir.vpk");
    if !vpk.is_file() {
        return Err(ProfileError::Io(
            "Could not find tf/tf2_misc_dir.vpk. Confirm the TF2 install.".into(),
        ));
    }
    let archive = read_vpk_dir_file(&vpk).map_err(|err| ProfileError::Io(err.message()))?;
    decode_weapon_scripts(&archive.files)
}

pub fn decode_weapon_scripts(
    files: &BTreeMap<String, Vec<u8>>,
) -> Result<BTreeMap<String, String>, ProfileError> {
    let mut out = BTreeMap::new();
    for (path, bytes) in files {
        let lower = path.replace('\\', "/").to_ascii_lowercase();
        if !lower.starts_with("scripts/tf_weapon_") {
            continue;
        }
        if !(lower.ends_with(".ctx") || lower.ends_with(".txt")) {
            continue;
        }
        let text = decode_weapon_bytes(bytes)
            .map_err(|err| ProfileError::Io(format!("Could not read {path}: {err}")))?;
        out.insert(path.clone(), text);
    }
    if out.is_empty() {
        return Err(ProfileError::Io(
            "No tf_weapon scripts were found in the local TF2 VPK.".into(),
        ));
    }
    Ok(out)
}

pub fn decode_weapon_bytes(bytes: &[u8]) -> Result<String, String> {
    if let Ok(text) = std::str::from_utf8(bytes) {
        if looks_like_weapon_script(text) {
            return Ok(text.to_string());
        }
    }
    let decrypted = decrypt_weapon_ctx(bytes);
    let trimmed: Vec<u8> = decrypted.into_iter().take_while(|b| *b != 0).collect();
    let text = String::from_utf8(trimmed)
        .map_err(|_| "weapon script is not UTF-8 after decrypt".to_string())?;
    if !looks_like_weapon_script(&text) {
        return Err("decrypted weapon script did not parse as KeyValues".into());
    }
    Ok(text)
}

fn looks_like_weapon_script(text: &str) -> bool {
    let lower = text.to_ascii_lowercase();
    lower.contains("weapondata") || lower.contains("crosshair") || lower.contains("texturedata")
}

pub fn patch_crosshair_script(text: &str, shape: &str) -> Result<String, String> {
    let mut map = parse_vdf(text)?;
    let material = format!("vgui/replay/thumbnails/{shape}");
    let patched = patch_crosshair_blocks(&mut map, &material);
    if patched == 0 {
        ensure_crosshair_block(&mut map, &material);
    }
    Ok(serialize_vdf(&map))
}

fn patch_crosshair_blocks(map: &mut VdfMap, material: &str) -> usize {
    let mut count = 0;
    patch_rec(map, material, &mut count);
    count
}

fn patch_rec(map: &mut VdfMap, material: &str, count: &mut usize) {
    for (key, value) in &mut map.entries {
        if let VdfValue::Obj(child) = value {
            if key.eq_ignore_ascii_case("crosshair") {
                set_crosshair_fields(child, material);
                *count += 1;
            }
            patch_rec(child, material, count);
        }
    }
}

fn set_crosshair_fields(map: &mut VdfMap, material: &str) {
    map.set_path(&["file"], material);
    map.set_path(&["x"], "0");
    map.set_path(&["y"], "0");
    map.set_path(&["width"], CROSSHAIR_SIZE.to_string());
    map.set_path(&["height"], CROSSHAIR_SIZE.to_string());
}

fn ensure_crosshair_block(map: &mut VdfMap, material: &str) {
    if let Some(VdfValue::Obj(weapon)) = map
        .entries
        .iter_mut()
        .rev()
        .find(|(k, _)| k.eq_ignore_ascii_case("WeaponData"))
        .map(|(_, v)| v)
    {
        if let Some(VdfValue::Obj(texture)) = weapon
            .entries
            .iter_mut()
            .rev()
            .find(|(k, _)| k.eq_ignore_ascii_case("TextureData"))
            .map(|(_, v)| v)
        {
            let mut block = VdfMap::default();
            set_crosshair_fields(&mut block, material);
            texture
                .entries
                .push(("crosshair".into(), VdfValue::Obj(block)));
            return;
        }
        let mut texture = VdfMap::default();
        let mut block = VdfMap::default();
        set_crosshair_fields(&mut block, material);
        texture
            .entries
            .push(("crosshair".into(), VdfValue::Obj(block)));
        weapon
            .entries
            .push(("TextureData".into(), VdfValue::Obj(texture)));
        return;
    }
    let mut block = VdfMap::default();
    set_crosshair_fields(&mut block, material);
    map.entries.push(("crosshair".into(), VdfValue::Obj(block)));
}

pub fn encode_vtf_bgra8888(bgra: &[u8], width: u32, height: u32) -> Result<Vec<u8>, ProfileError> {
    let expected = (width * height * 4) as usize;
    if bgra.len() != expected {
        return Err(ProfileError::Io(
            "VTF pixel buffer is the wrong size.".into(),
        ));
    }
    let mut out = vec![0u8; 80 + bgra.len()];
    out[0..4].copy_from_slice(b"VTF\0");
    out[4..8].copy_from_slice(&7u32.to_le_bytes());
    out[8..12].copy_from_slice(&2u32.to_le_bytes());
    out[12..16].copy_from_slice(&80u32.to_le_bytes());
    out[16..18].copy_from_slice(&(width as u16).to_le_bytes());
    out[18..20].copy_from_slice(&(height as u16).to_le_bytes());
    out[20..24].copy_from_slice(&VTF_FLAGS.to_le_bytes());
    out[24..26].copy_from_slice(&1u16.to_le_bytes());
    out[26..28].copy_from_slice(&0u16.to_le_bytes());
    out[44..48].copy_from_slice(&1f32.to_le_bytes());
    out[48..52].copy_from_slice(&IMAGE_FORMAT_BGRA8888.to_le_bytes());
    out[52] = 1;
    out[53..57].copy_from_slice(&0xffff_ffffu32.to_le_bytes());
    out[59..61].copy_from_slice(&1u16.to_le_bytes());
    out[80..].copy_from_slice(bgra);
    Ok(out)
}

pub fn encode_vmt(name: &str) -> String {
    format!(
        "\"UnlitGeneric\"\n{{\n\t\"$basetexture\"\t\"vgui/replay/thumbnails/{name}\"\n\t\"$translucent\"\t\"1\"\n\t\"$vertexcolor\"\t\"1\"\n\t\"$no_fullbright\"\t\"1\"\n\t\"$ignorez\"\t\"1\"\n}}\n"
    )
}

fn shape_pixels(shape: &str, custom_rgba: Option<&[u8]>) -> Result<Vec<u8>, ProfileError> {
    if shape == "custom" {
        let pixels = custom_rgba.ok_or_else(|| {
            ProfileError::Io("Import a PNG before applying a custom crosshair.".into())
        })?;
        let expected = (CROSSHAIR_SIZE * CROSSHAIR_SIZE * 4) as usize;
        if pixels.len() != expected {
            return Err(ProfileError::Io(
                "Custom crosshair must be a 64×64 RGBA buffer.".into(),
            ));
        }
        return Ok(pixels.to_vec());
    }
    Ok(render_shape_rgba(shape))
}

pub fn render_shape_rgba(shape: &str) -> Vec<u8> {
    let size = CROSSHAIR_SIZE as i32;
    let mut pixels = vec![0u8; (size * size * 4) as usize];
    let mut set = |x: i32, y: i32| {
        if x < 0 || y < 0 || x >= size || y >= size {
            return;
        }
        let i = ((y * size + x) * 4) as usize;
        pixels[i] = 255;
        pixels[i + 1] = 255;
        pixels[i + 2] = 255;
        pixels[i + 3] = 255;
    };
    let mid = size / 2;
    match shape {
        "dot" => {
            for y in (mid - 1)..=(mid + 1) {
                for x in (mid - 1)..=(mid + 1) {
                    set(x, y);
                }
            }
        }
        "cross" => {
            for i in 8..(size - 8) {
                set(mid, i);
                set(i, mid);
            }
        }
        "plus-gap" => {
            for i in 8..(mid - 3) {
                set(mid, i);
                set(mid, size - 1 - i);
                set(i, mid);
                set(size - 1 - i, mid);
            }
        }
        "circle" => {
            let r = 12.0_f32;
            for y in 0..size {
                for x in 0..size {
                    let dx = x as f32 - mid as f32 + 0.5;
                    let dy = y as f32 - mid as f32 + 0.5;
                    let d = dx.hypot(dy);
                    if (d - r).abs() < 0.85 {
                        set(x, y);
                    }
                }
            }
        }
        "t" => {
            for x in (mid - 10)..=(mid + 10) {
                set(x, mid - 8);
            }
            for y in (mid - 8)..=(mid + 12) {
                set(mid, y);
            }
        }
        _ => {}
    }
    pixels
}

fn rgba_to_bgra(rgba: &[u8]) -> Vec<u8> {
    let mut out = rgba.to_vec();
    for chunk in out.chunks_exact_mut(4) {
        chunk.swap(0, 2);
    }
    out
}

fn write_pack_file(
    profiles_dir: &Path,
    tf2_root: &Path,
    profile_id: &str,
    rel: &str,
    bytes: &[u8],
    running: &[String],
) -> Result<(), ProfileError> {
    write_owned_file_to(
        profiles_dir,
        tf2_root,
        profile_id,
        rel,
        bytes,
        running.iter().cloned(),
        WriteOwnedOptions::default(),
    )?;
    let _ = exclusive_file_path(profiles_dir, profile_id, rel);
    Ok(())
}

fn force_empty_stock_crosshair(
    profiles_dir: &Path,
    tf2_root: &Path,
    profile_id: &str,
    running: &[String],
) -> Result<(), ProfileError> {
    let manifest = load_manifest(profiles_dir, profile_id)?;
    let layer = cfg_layer_from_files(&manifest.files);
    let path = match layer {
        CfgLayer::Comfig => "tf/cfg/overrides/execs_gameplay.cfg",
        CfgLayer::Vanilla => "tf/cfg/execs_gameplay.cfg",
    };
    let existing = exclusive_file_path(profiles_dir, profile_id, path);
    let text = if existing.is_file() {
        std::fs::read_to_string(&existing).unwrap_or_default()
    } else {
        String::new()
    };
    write_owned_file_to(
        profiles_dir,
        tf2_root,
        profile_id,
        path,
        force_empty_crosshair_file(&text).as_bytes(),
        running.iter().cloned(),
        WriteOwnedOptions::default(),
    )?;
    Ok(())
}

pub fn force_empty_crosshair_file(text: &str) -> String {
    let mut found = false;
    let mut lines: Vec<String> = text
        .lines()
        .map(|line| {
            if line
                .trim_start()
                .to_ascii_lowercase()
                .starts_with("cl_crosshair_file")
            {
                found = true;
                "cl_crosshair_file \"\"".to_string()
            } else {
                line.to_string()
            }
        })
        .collect();
    if !found {
        if !text.is_empty() && !text.ends_with('\n') {
            lines.push(String::new());
        }
        lines.push("cl_crosshair_file \"\"".into());
    }
    let mut out = lines.join("\n");
    if !out.ends_with('\n') {
        out.push('\n');
    }
    out
}

fn pack_paths(profiles_dir: &Path, profile_id: &str) -> Result<Vec<String>, ProfileError> {
    let manifest = load_manifest(profiles_dir, profile_id)?;
    let prefix = format!("tf/custom/{EXECS_CROSSHAIRS_PACK}/");
    Ok(manifest
        .files
        .into_iter()
        .filter(|file| file.path.starts_with(&prefix))
        .map(|file| file.path)
        .collect())
}

fn remove_live_pack(tf2_root: &Path, pack: &str) -> Result<(), ProfileError> {
    let dir = tf2_root.join("tf").join("custom").join(pack);
    if dir.is_dir() {
        std::fs::remove_dir_all(&dir).map_err(|err| ProfileError::Io(err.to_string()))?;
    }
    Ok(())
}

pub fn build_script_vpk(scripts: &BTreeMap<String, String>) -> Vec<u8> {
    let mut files = BTreeMap::new();
    for (name, body) in scripts {
        let rel = if name.contains('/') {
            name.clone()
        } else {
            format!("scripts/{name}")
        };
        let rel = if rel.ends_with(".ctx") || rel.ends_with(".txt") {
            rel
        } else {
            format!("{rel}.ctx")
        };
        files.insert(rel, encrypt_weapon_ctx(body.as_bytes()));
    }
    write_vpk_v1(&files)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::process_lock::live_process_names;
    use crate::profile::{create_profile_record_to, set_active_profile_to};
    use crate::vpk::read_vpk_dir_bytes;
    use crate::{test_temp_dir, ProfileError};

    fn unlocked() -> Vec<String> {
        Vec::new()
    }

    fn tf2_name() -> Vec<String> {
        live_process_names()
            .into_iter()
            .take(1)
            .collect::<Vec<_>>()
            .into_iter()
            .chain(std::iter::once("tf_linux64".into()))
            .collect()
    }

    fn setup() -> (std::path::PathBuf, std::path::PathBuf, String) {
        let root = test_temp_dir();
        let tf2 = root.join("tf2");
        std::fs::create_dir_all(tf2.join("tf/cfg")).unwrap();
        std::fs::write(tf2.join("tf/steam.inf"), "appID=440\n").unwrap();
        let profiles = root.join("profiles");
        let library = create_profile_record_to(&profiles, &tf2, "Main", unlocked()).unwrap();
        let id = library.profiles[0].id.clone();
        set_active_profile_to(&profiles, &tf2, &id, unlocked()).unwrap();
        (root, tf2, id)
    }

    fn cleanup(root: &Path) {
        let _ = std::fs::remove_dir_all(root);
    }

    fn sample_script() -> String {
        r##"WeaponData
{
	"printname"	"Scattergun"
	"Damage"	"6"
	"clip_size"	"6"
	TextureData
	{
		"crosshair"
		{
			"file"	"sprites/crosshairs"
			"x"	"0"
			"y"	"48"
			"width"	"24"
			"height"	"24"
		}
	}
}
"##
        .into()
    }

    #[test]
    fn patch_changes_only_the_crosshair_block() {
        let patched = patch_crosshair_script(&sample_script(), "dot").unwrap();
        assert!(patched.contains("vgui/replay/thumbnails/dot"));
        assert!(patched.contains("\"Damage\""));
        assert!(patched.contains("\"6\""));
        assert!(!patched.contains("sprites/crosshairs"));
    }

    #[test]
    fn vtf_header_is_7_2_bgra() {
        let rgba = render_shape_rgba("cross");
        let vtf = encode_vtf_bgra8888(&rgba_to_bgra(&rgba), 64, 64).unwrap();
        assert_eq!(&vtf[0..4], b"VTF\0");
        assert_eq!(&vtf[4..8], &7u32.to_le_bytes());
        assert_eq!(&vtf[8..12], &2u32.to_le_bytes());
        assert_eq!(vtf.len(), 80 + 64 * 64 * 4);
        assert!(rgba.iter().skip(3).step_by(4).any(|a| *a > 0));
    }

    #[test]
    fn apply_writes_pack_and_clears_stock_file() {
        let (root, tf2, id) = setup();
        let mut scripts = BTreeMap::new();
        scripts.insert("scripts/tf_weapon_scattergun.ctx".into(), sample_script());
        let mut assignments = BTreeMap::new();
        assignments.insert("tf_weapon_scattergun".into(), "dot".into());
        let detail = apply_crosshairs_with_scripts(
            &root.join("profiles"),
            &tf2,
            &id,
            "cross",
            &assignments,
            None,
            &scripts,
            unlocked(),
        )
        .unwrap();
        assert_eq!(detail.crosshair.as_ref().unwrap().shape, "cross");
        assert!(tf2
            .join("tf/custom/execs-crosshairs/scripts/tf_weapon_scattergun.txt")
            .is_file());
        assert!(tf2
            .join("tf/custom/execs-crosshairs/materials/vgui/replay/thumbnails/dot.vtf")
            .is_file());
        assert!(!tf2.join("tf/custom/execs-crosshairs/info.vdf").exists());
        assert!(!tf2.join("tf/custom/execs-crosshairs/resource/ui").exists());
        let gameplay = std::fs::read_to_string(tf2.join("tf/cfg/execs_gameplay.cfg")).unwrap();
        assert!(gameplay.contains("cl_crosshair_file \"\""));
        remove_crosshairs_to(&root.join("profiles"), &tf2, &id, unlocked()).unwrap();
        assert!(!tf2.join("tf/custom/execs-crosshairs").exists());
        cleanup(&root);
    }

    #[test]
    fn custom_shape_requires_pixels() {
        let (root, tf2, id) = setup();
        let mut scripts = BTreeMap::new();
        scripts.insert("scripts/tf_weapon_scattergun.ctx".into(), sample_script());
        let err = apply_crosshairs_with_scripts(
            &root.join("profiles"),
            &tf2,
            &id,
            "custom",
            &BTreeMap::new(),
            None,
            &scripts,
            unlocked(),
        )
        .unwrap_err();
        assert!(err.message().contains("PNG"));
        cleanup(&root);
    }

    #[test]
    fn apply_writes_imported_png_pixels() {
        let (root, tf2, id) = setup();
        let mut scripts = BTreeMap::new();
        scripts.insert("scripts/tf_weapon_scattergun.ctx".into(), sample_script());
        let mut pixels = vec![0u8; 64 * 64 * 4];
        pixels[0] = 9;
        pixels[3] = 255;
        apply_crosshairs_with_scripts(
            &root.join("profiles"),
            &tf2,
            &id,
            "custom",
            &BTreeMap::new(),
            Some(&pixels),
            &scripts,
            unlocked(),
        )
        .unwrap();
        assert!(tf2
            .join("tf/custom/execs-crosshairs/materials/vgui/replay/thumbnails/custom.vtf")
            .is_file());
        cleanup(&root);
    }

    #[test]
    fn refuses_while_tf2_is_running() {
        let (root, tf2, id) = setup();
        let mut scripts = BTreeMap::new();
        scripts.insert("scripts/tf_weapon_scattergun.ctx".into(), sample_script());
        let err = apply_crosshairs_with_scripts(
            &root.join("profiles"),
            &tf2,
            &id,
            "cross",
            &BTreeMap::new(),
            None,
            &scripts,
            tf2_name(),
        )
        .unwrap_err();
        assert!(matches!(err, ProfileError::GameRunning));
        cleanup(&root);
    }

    #[test]
    fn pack_paths_stay_file_safe() {
        assert!(crate::apply::is_file_safe_rel_path(
            "tf/custom/execs-crosshairs/scripts/tf_weapon_scattergun.txt"
        ));
        assert!(!crate::apply::is_file_safe_rel_path("tf/steam.inf"));
        assert!(!crate::apply::is_file_safe_rel_path("tf/gameinfo.txt"));
        assert!(!crate::apply::is_file_safe_rel_path("tf/tf2_misc_dir.vpk"));
    }

    #[test]
    fn decodes_ice_encrypted_scripts_from_a_synthetic_vpk() {
        let mut scripts = BTreeMap::new();
        scripts.insert("tf_weapon_scattergun.ctx".into(), sample_script());
        let vpk = build_script_vpk(&scripts);
        let archive = read_vpk_dir_bytes(&vpk).unwrap();
        let decoded = decode_weapon_scripts(&archive.files).unwrap();
        assert!(decoded.values().any(|text| text.contains("Scattergun")));
    }
}
