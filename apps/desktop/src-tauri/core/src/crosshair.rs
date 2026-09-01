//! First-party per-weapon VTF crosshairs. Reads the user's official VPK; never writes it.

use std::collections::BTreeMap;
use std::path::Path;

use crate::apply::{
    cfg_layer_from_files, detail_from_manifest, write_owned_file_to, ProfileDetail,
    WriteOwnedOptions,
};
use crate::ice::{decrypt_weapon_ctx, encrypt_weapon_ctx};
use crate::process_lock::{live_process_names, refuse_if_running_among};
use crate::profile::{
    exclusive_file_path, load_manifest, profiles_dir, remove_manifest_files_to, save_manifest,
    CrosshairRecord, ProfileError,
};
use crate::surface::CfgLayer;
use crate::vdf::{parse_vdf, serialize_vdf, VdfMap, VdfValue};
use crate::vpk::{read_vpk_dir_file_filtered, write_vpk_v2};

pub const EXECS_CROSSHAIRS_PACK: &str = "execs-crosshairs";
pub const CROSSHAIR_SIZE: u32 = 64;
const THUMB_DIR: &str = "materials/vgui/replay/thumbnails";
const IMAGE_FORMAT_BGRA8888: u32 = 12;
const VTF_FLAGS: u32 = 0x0001 | 0x0004 | 0x0008 | 0x0100 | 0x0200 | 0x2000;

/// Procedurally rendered first-party shapes. "custom" is the imported PNG.
const SHAPES: [&str; 6] = ["dot", "cross", "plus-gap", "circle", "t", "custom"];

/// Names must survive VPK paths, VMT text, and material lookups unescaped.
pub fn valid_crosshair_name(name: &str) -> bool {
    (1..=64).contains(&name.len())
        && name
            .bytes()
            .all(|b| b.is_ascii_lowercase() || b.is_ascii_digit() || b == b'-' || b == b'_')
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum CrosshairAssetFormat {
    /// A ready-made VTF written into the pack verbatim (community crosshairs).
    Vtf,
    /// 64×64 unpremultiplied RGBA to encode with our own VTF writer (designer).
    Rgba,
}

#[derive(Debug, Clone, PartialEq, Eq, serde::Deserialize)]
pub struct CrosshairAsset {
    pub format: CrosshairAssetFormat,
    pub bytes: Vec<u8>,
}

enum ResolvedAsset {
    Rgba(Vec<u8>),
    VtfVerbatim(Vec<u8>),
}

#[allow(clippy::too_many_arguments)]
pub fn apply_crosshairs(
    tf2_root: &Path,
    profile_id: &str,
    shape: &str,
    assignments: &BTreeMap<String, String>,
    custom_rgba: Option<&[u8]>,
    color: Option<[u8; 3]>,
    library: &BTreeMap<String, CrosshairAsset>,
    design: Option<&str>,
) -> Result<ProfileDetail, ProfileError> {
    apply_crosshairs_to(
        &profiles_dir(),
        tf2_root,
        profile_id,
        shape,
        assignments,
        custom_rgba,
        color,
        library,
        design,
        live_process_names(),
    )
}

#[allow(clippy::too_many_arguments)]
pub fn apply_crosshairs_to<I, S>(
    profiles_dir: &Path,
    tf2_root: &Path,
    profile_id: &str,
    shape: &str,
    assignments: &BTreeMap<String, String>,
    custom_rgba: Option<&[u8]>,
    color: Option<[u8; 3]>,
    library: &BTreeMap<String, CrosshairAsset>,
    design: Option<&str>,
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
        color,
        library,
        design,
        &scripts,
        running_names,
    )
}

#[allow(clippy::too_many_arguments)]
pub fn apply_crosshairs_with_scripts<I, S>(
    profiles_dir: &Path,
    tf2_root: &Path,
    profile_id: &str,
    shape: &str,
    assignments: &BTreeMap<String, String>,
    custom_rgba: Option<&[u8]>,
    color: Option<[u8; 3]>,
    library: &BTreeMap<String, CrosshairAsset>,
    design: Option<&str>,
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
    for name in library.keys() {
        if !valid_crosshair_name(name) {
            return Err(ProfileError::Io(format!(
                "Crosshair name {name} must be 1-64 lowercase letters, digits, - or _."
            )));
        }
        if SHAPES.contains(&name.as_str()) {
            return Err(ProfileError::Io(format!(
                "Crosshair name {name} is reserved for a built-in shape."
            )));
        }
    }

    // Every name the pack must contain: the base shape plus every override.
    let mut referenced: Vec<&str> = vec![shape];
    for assigned in assignments.values() {
        if !referenced.contains(&assigned.as_str()) {
            referenced.push(assigned);
        }
    }
    for name in &referenced {
        if !valid_crosshair_name(name) {
            return Err(ProfileError::Io(format!(
                "Unknown crosshair shape {name}."
            )));
        }
    }

    // Imported pixels / library bytes are not stored on the manifest; when the
    // caller has none (a re-apply after reload), recover them from the pack's
    // own VTFs before those files are removed below.
    let custom_needed = referenced.contains(&"custom");
    let stored_custom = if custom_needed && custom_rgba.is_none() {
        load_stored_custom_rgba(profiles_dir, profile_id)
    } else {
        None
    };
    let custom_source: Option<&[u8]> = custom_rgba.or(stored_custom.as_deref());

    let mut needed: BTreeMap<String, ResolvedAsset> = BTreeMap::new();
    for name in &referenced {
        if needed.contains_key(*name) {
            continue;
        }
        let resolved = if SHAPES.contains(name) {
            ResolvedAsset::Rgba(shape_pixels(name, custom_source)?)
        } else if let Some(asset) = library.get(*name) {
            resolve_library_asset(name, asset)?
        } else if let Some(bytes) = load_stored_pack_vtf(profiles_dir, profile_id, name) {
            ResolvedAsset::VtfVerbatim(bytes)
        } else {
            return Err(ProfileError::Io(format!(
                "Crosshair {name} is not in the library. Add it again before applying."
            )));
        };
        needed.insert((*name).to_string(), resolved);
    }
    // Library entries that exist but are not referenced still ride along so
    // they survive on the pack for later use.
    for (name, asset) in library {
        if !needed.contains_key(name) {
            needed.insert(name.clone(), resolve_library_asset(name, asset)?);
        }
    }

    let previous = pack_paths(profiles_dir, profile_id)?;
    if !previous.is_empty() {
        remove_manifest_files_to(profiles_dir, tf2_root, profile_id, &previous, &running)?;
        remove_live_pack(tf2_root, EXECS_CROSSHAIRS_PACK)?;
    }

    // Community VTFs keep their own dimensions; the weapon script must match.
    let mut dimensions: BTreeMap<String, (u32, u32)> = BTreeMap::new();
    for (name, asset) in &needed {
        let vtf: Vec<u8> = match asset {
            ResolvedAsset::Rgba(rgba) => {
                dimensions.insert(name.clone(), (CROSSHAIR_SIZE, CROSSHAIR_SIZE));
                encode_vtf_bgra8888(&rgba_to_bgra(rgba), CROSSHAIR_SIZE, CROSSHAIR_SIZE)?
            }
            ResolvedAsset::VtfVerbatim(bytes) => {
                dimensions.insert(name.clone(), vtf_header_dimensions(bytes));
                bytes.clone()
            }
        };
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
        let (width, height) = dimensions
            .get(&used)
            .copied()
            .unwrap_or((CROSSHAIR_SIZE, CROSSHAIR_SIZE));
        let patched = patch_crosshair_script(body, &used, width, height)
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

    let library_record: BTreeMap<String, String> = needed
        .iter()
        .filter(|(name, _)| !SHAPES.contains(&name.as_str()))
        .map(|(name, asset)| {
            let format = match asset {
                ResolvedAsset::Rgba(_) => "rgba",
                ResolvedAsset::VtfVerbatim(_) => "vtf",
            };
            (name.clone(), format.to_string())
        })
        .collect();
    let mut manifest = load_manifest(profiles_dir, profile_id)?;
    manifest.crosshair = Some(CrosshairRecord {
        id: EXECS_CROSSHAIRS_PACK.into(),
        shape: shape.to_string(),
        assignments: assignments.clone(),
        color,
        library: library_record,
        design: design.map(|value| value.to_string()),
    });
    save_manifest(profiles_dir, tf2_root, &manifest)?;
    force_empty_stock_crosshair(profiles_dir, tf2_root, profile_id, color, &running)?;
    Ok(detail_from_manifest(&load_manifest(
        profiles_dir,
        profile_id,
    )?))
}

fn resolve_library_asset(name: &str, asset: &CrosshairAsset) -> Result<ResolvedAsset, ProfileError> {
    match asset.format {
        CrosshairAssetFormat::Rgba => {
            let expected = (CROSSHAIR_SIZE * CROSSHAIR_SIZE * 4) as usize;
            if asset.bytes.len() != expected {
                return Err(ProfileError::Io(format!(
                    "Crosshair {name} must be a 64×64 RGBA buffer."
                )));
            }
            Ok(ResolvedAsset::Rgba(asset.bytes.clone()))
        }
        CrosshairAssetFormat::Vtf => {
            if asset.bytes.len() < 80 || &asset.bytes[0..4] != b"VTF\0" {
                return Err(ProfileError::Io(format!(
                    "Crosshair {name} is not a valid VTF file."
                )));
            }
            Ok(ResolvedAsset::VtfVerbatim(asset.bytes.clone()))
        }
    }
}

/// Width/height straight from the VTF header (bytes 16..20), 64 on nonsense.
fn vtf_header_dimensions(bytes: &[u8]) -> (u32, u32) {
    let width = bytes
        .get(16..18)
        .map(|b| u16::from_le_bytes([b[0], b[1]]))
        .unwrap_or(CROSSHAIR_SIZE as u16);
    let height = bytes
        .get(18..20)
        .map(|b| u16::from_le_bytes([b[0], b[1]]))
        .unwrap_or(CROSSHAIR_SIZE as u16);
    if width == 0 || height == 0 || width > 1024 || height > 1024 {
        (CROSSHAIR_SIZE, CROSSHAIR_SIZE)
    } else {
        (u32::from(width), u32::from(height))
    }
}

/// Read a previously-applied pack VTF back out of the exclusive store,
/// verbatim — the pack itself is the byte store for library entries.
pub fn stored_pack_crosshair(profiles_dir: &Path, profile_id: &str, name: &str) -> Option<Vec<u8>> {
    load_stored_pack_vtf(profiles_dir, profile_id, name)
}

fn load_stored_pack_vtf(profiles_dir: &Path, profile_id: &str, name: &str) -> Option<Vec<u8>> {
    if !valid_crosshair_name(name) {
        return None;
    }
    let rel = format!("tf/custom/{EXECS_CROSSHAIRS_PACK}/{THUMB_DIR}/{name}.vtf");
    let path = exclusive_file_path(profiles_dir, profile_id, &rel);
    let bytes = std::fs::read(path).ok()?;
    if bytes.len() < 80 || &bytes[0..4] != b"VTF\0" {
        return None;
    }
    Some(bytes)
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
    // `remove_live_pack` below is unconditional, so the guard cannot live
    // inside the `previous` branch: a manifest with no pack files (re-imported
    // profile, partially-failed apply) would otherwise `remove_dir_all` the
    // live folder while TF2 is running.
    refuse_if_running_among(&running).map_err(ProfileError::from)?;
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

#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StockCrosshairSprite {
    pub width: u32,
    pub height: u32,
    /// Frame 0 as unpremultiplied RGBA.
    pub rgba: Vec<u8>,
}

/// Decode Valve's stock crosshair sprites (crosshair1..7 + default) from the
/// user's own tf2_textures_dir.vpk for pixel-perfect previews. Read-only.
pub fn extract_stock_crosshair_sprites(
    tf2_root: &Path,
) -> Result<BTreeMap<String, StockCrosshairSprite>, ProfileError> {
    let vpk = tf2_root.join("tf").join("tf2_textures_dir.vpk");
    if !vpk.is_file() {
        return Err(ProfileError::Io(
            "Could not find tf/tf2_textures_dir.vpk. Confirm the TF2 install.".into(),
        ));
    }
    let keep = |rel: &str| {
        let lower = rel.to_ascii_lowercase();
        lower.starts_with("materials/vgui/crosshairs/") && lower.ends_with(".vtf")
    };
    let archive =
        read_vpk_dir_file_filtered(&vpk, &keep).map_err(|err| ProfileError::Io(err.message()))?;
    let mut out = BTreeMap::new();
    for (path, bytes) in &archive.files {
        let stem = path
            .rsplit('/')
            .next()
            .unwrap_or(path)
            .trim_end_matches(".vtf")
            .to_ascii_lowercase();
        if let Ok(decoded) = crate::vtf_read::decode_vtf_frame0(bytes) {
            out.insert(
                stem,
                StockCrosshairSprite {
                    width: decoded.width,
                    height: decoded.height,
                    rgba: decoded.rgba,
                },
            );
        }
    }
    if out.is_empty() {
        return Err(ProfileError::Io(
            "No crosshair sprites were found in the local TF2 VPK.".into(),
        ));
    }
    Ok(out)
}

pub fn load_weapon_scripts(tf2_root: &Path) -> Result<BTreeMap<String, String>, ProfileError> {
    let vpk = tf2_root.join("tf").join("tf2_misc_dir.vpk");
    if !vpk.is_file() {
        return Err(ProfileError::Io(
            "Could not find tf/tf2_misc_dir.vpk. Confirm the TF2 install.".into(),
        ));
    }
    // Only weapon scripts are needed — never materialize the whole archive set.
    let keep = |rel: &str| {
        let lower = rel.to_ascii_lowercase();
        lower.starts_with("scripts/tf_weapon_")
            && (lower.ends_with(".ctx") || lower.ends_with(".txt"))
    };
    let archive =
        read_vpk_dir_file_filtered(&vpk, &keep).map_err(|err| ProfileError::Io(err.message()))?;
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

pub fn patch_crosshair_script(
    text: &str,
    shape: &str,
    width: u32,
    height: u32,
) -> Result<String, String> {
    let mut map = parse_vdf(text)?;
    let material = format!("vgui/replay/thumbnails/{shape}");
    let patched = patch_crosshair_blocks(&mut map, &material, width, height);
    if patched == 0 {
        ensure_crosshair_block(&mut map, &material, width, height);
    }
    Ok(serialize_vdf(&map))
}

fn patch_crosshair_blocks(map: &mut VdfMap, material: &str, width: u32, height: u32) -> usize {
    let mut count = 0;
    patch_rec(map, material, width, height, &mut count);
    count
}

fn patch_rec(map: &mut VdfMap, material: &str, width: u32, height: u32, count: &mut usize) {
    for (key, value) in &mut map.entries {
        if let VdfValue::Obj(child) = value {
            if key.eq_ignore_ascii_case("crosshair") {
                set_crosshair_fields(child, material, width, height);
                *count += 1;
            }
            patch_rec(child, material, width, height, count);
        }
    }
}

fn set_crosshair_fields(map: &mut VdfMap, material: &str, width: u32, height: u32) {
    map.set_path(&["file"], material);
    map.set_path(&["x"], "0");
    map.set_path(&["y"], "0");
    map.set_path(&["width"], width.to_string());
    map.set_path(&["height"], height.to_string());
}

fn ensure_crosshair_block(map: &mut VdfMap, material: &str, width: u32, height: u32) {
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
            set_crosshair_fields(&mut block, material, width, height);
            texture
                .entries
                .push(("crosshair".into(), VdfValue::Obj(block)));
            return;
        }
        let mut texture = VdfMap::default();
        let mut block = VdfMap::default();
        set_crosshair_fields(&mut block, material, width, height);
        texture
            .entries
            .push(("crosshair".into(), VdfValue::Obj(block)));
        weapon
            .entries
            .push(("TextureData".into(), VdfValue::Obj(texture)));
        return;
    }
    let mut block = VdfMap::default();
    set_crosshair_fields(&mut block, material, width, height);
    map.entries.push(("crosshair".into(), VdfValue::Obj(block)));
}

pub fn encode_vtf_bgra8888(bgra: &[u8], width: u32, height: u32) -> Result<Vec<u8>, ProfileError> {
    let expected = (width * height * 4) as usize;
    if bgra.len() != expected {
        return Err(ProfileError::Io(
            "VTF pixel buffer is the wrong size.".into(),
        ));
    }
    // Field offsets follow the VTF 7.2 header as observed in Valve's own and
    // known-good community files: bumpScale@48, format@52, mips@56,
    // lowResFormat@57, lowResDims@61/62, depth@63.
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
    out[48..52].copy_from_slice(&1f32.to_le_bytes());
    out[52..56].copy_from_slice(&IMAGE_FORMAT_BGRA8888.to_le_bytes());
    out[56] = 1;
    out[57..61].copy_from_slice(&0xffff_ffffu32.to_le_bytes());
    // lowResWidth/Height stay 0 (no thumbnail); depth = 1.
    out[63..65].copy_from_slice(&1u16.to_le_bytes());
    out[80..].copy_from_slice(bgra);
    Ok(out)
}

pub fn encode_vmt(name: &str) -> String {
    format!(
        "\"UnlitGeneric\"\n{{\n\t\"$basetexture\"\t\"vgui/replay/thumbnails/{name}\"\n\t\"$translucent\"\t\"1\"\n\t\"$vertexcolor\"\t\"1\"\n\t\"$no_fullbright\"\t\"1\"\n\t\"$ignorez\"\t\"1\"\n}}\n"
    )
}

/// Read the previously-applied imported pixels back out of the pack's VTF.
fn load_stored_custom_rgba(profiles_dir: &Path, profile_id: &str) -> Option<Vec<u8>> {
    let rel = format!("tf/custom/{EXECS_CROSSHAIRS_PACK}/{THUMB_DIR}/custom.vtf");
    let path = exclusive_file_path(profiles_dir, profile_id, &rel);
    let bytes = std::fs::read(path).ok()?;
    decode_vtf_bgra8888(&bytes, CROSSHAIR_SIZE, CROSSHAIR_SIZE)
}

/// Inverse of `encode_vtf_bgra8888` for the fixed-size VTFs this module writes.
pub fn decode_vtf_bgra8888(bytes: &[u8], width: u32, height: u32) -> Option<Vec<u8>> {
    let expected = 80 + (width * height * 4) as usize;
    if bytes.len() < expected || &bytes[0..4] != b"VTF\0" {
        return None;
    }
    let mut rgba = bytes[80..expected].to_vec();
    for chunk in rgba.chunks_exact_mut(4) {
        chunk.swap(0, 2);
    }
    Some(rgba)
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
    // Textures stay white; the tint rides on cl_crosshair_red/green/blue so it
    // reaches community VTFs too (see force_empty_crosshair_file).
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
    color: Option<[u8; 3]>,
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
        force_empty_crosshair_file(&text, color).as_bytes(),
        running.iter().cloned(),
        WriteOwnedOptions::default(),
    )?;
    Ok(())
}

pub fn force_empty_crosshair_file(text: &str, color: Option<[u8; 3]>) -> String {
    // The engine multiplies the weapon-script crosshair sprite by
    // cl_crosshair_red/green/blue (the pack's VMTs enable $vertexcolor for
    // exactly this), so the tint rides on the cvars. That colors every source
    // uniformly — first-party shapes, community VTFs and designed crosshairs
    // alike. With no pack color set we leave the cvars alone so the stock
    // crosshair panel keeps ownership of them.
    let tint = color.map(|[red, green, blue]| {
        [
            format!("cl_crosshair_red {red}"),
            format!("cl_crosshair_green {green}"),
            format!("cl_crosshair_blue {blue}"),
        ]
    });
    let mut forced: Vec<(&str, String)> =
        vec![("cl_crosshair_file", "cl_crosshair_file \"\"".to_string())];
    if let Some([red, green, blue]) = tint {
        forced.push(("cl_crosshair_red", red));
        forced.push(("cl_crosshair_green", green));
        forced.push(("cl_crosshair_blue", blue));
    }
    let mut found = vec![false; forced.len()];
    let mut lines: Vec<String> = text
        .lines()
        .map(|line| {
            let lower = line.trim_start().to_ascii_lowercase();
            for (index, (prefix, replacement)) in forced.iter().enumerate() {
                let matches_cvar = lower
                    .strip_prefix(prefix)
                    .is_some_and(|rest| !rest.starts_with(|c: char| c.is_ascii_alphanumeric() || c == '_'));
                if matches_cvar {
                    found[index] = true;
                    return replacement.clone();
                }
            }
            line.to_string()
        })
        .collect();
    if found.iter().any(|seen| !seen) && !text.is_empty() && !text.ends_with('\n') {
        lines.push(String::new());
    }
    for (index, (_, replacement)) in forced.iter().enumerate() {
        if !found[index] {
            lines.push(replacement.clone());
        }
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
    write_vpk_v2(&files)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::profile::{create_profile_record_to, set_active_profile_to};
    use crate::vpk::read_vpk_dir_bytes;
    use crate::{test_temp_dir, ProfileError};

    fn unlocked() -> Vec<String> {
        Vec::new()
    }

    fn tf2_name() -> &'static str {
        if cfg!(windows) {
            "tf_win64.exe"
        } else {
            "tf_linux64"
        }
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
        let patched = patch_crosshair_script(&sample_script(), "dot", 64, 64).unwrap();
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
        // Spec offsets (matching known-good community VTFs): format@52, mips@56.
        assert_eq!(&vtf[52..56], &12u32.to_le_bytes());
        assert_eq!(vtf[56], 1);
        assert_eq!(&vtf[57..61], &0xffff_ffffu32.to_le_bytes());
        assert!(rgba.iter().skip(3).step_by(4).any(|a| *a > 0));
        // The spec-conformant reader must round-trip our own writer.
        let decoded = crate::vtf_read::decode_vtf_frame0(&vtf).unwrap();
        assert_eq!((decoded.width, decoded.height), (64, 64));
        assert_eq!(decoded.rgba, rgba.to_vec());
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
            Some([255, 64, 0]),
            &BTreeMap::new(),
            None,
            &scripts,
            unlocked(),
        )
        .unwrap();
        assert_eq!(detail.crosshair.as_ref().unwrap().shape, "cross");
        assert_eq!(detail.crosshair.as_ref().unwrap().color, Some([255, 64, 0]));
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
        assert!(gameplay.contains("cl_crosshair_red 255"));
        assert!(gameplay.contains("cl_crosshair_green 64"));
        assert!(gameplay.contains("cl_crosshair_blue 0"));
        remove_crosshairs_to(&root.join("profiles"), &tf2, &id, unlocked()).unwrap();
        assert!(!tf2.join("tf/custom/execs-crosshairs").exists());
        cleanup(&root);
    }

    #[test]
    fn tint_rides_on_the_cvars_and_textures_stay_white() {
        // A community VTF can only be colored by the engine, so the tint must
        // live in the cfg rather than being baked into first-party pixels.
        let cfg = force_empty_crosshair_file("", Some([255, 64, 0]));
        assert!(cfg.contains("cl_crosshair_red 255"));
        assert!(cfg.contains("cl_crosshair_green 64"));
        assert!(cfg.contains("cl_crosshair_blue 0"));
        let pixels = shape_pixels("cross", None).unwrap();
        let lit = pixels
            .chunks_exact(4)
            .find(|chunk| chunk[3] == 255)
            .expect("shape draws at least one pixel");
        assert_eq!(&lit[0..3], &[255, 255, 255]);
    }

    #[test]
    fn no_pack_color_leaves_the_stock_crosshair_cvars_alone() {
        let existing = "cl_crosshair_red 12
cl_crosshair_green 34
cl_crosshair_blue 56
";
        let cfg = force_empty_crosshair_file(existing, None);
        assert!(cfg.contains("cl_crosshair_file \"\""));
        assert!(cfg.contains("cl_crosshair_red 12"));
        assert!(cfg.contains("cl_crosshair_green 34"));
        assert!(cfg.contains("cl_crosshair_blue 56"));
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
            None,
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
            None,
            &BTreeMap::new(),
            None,
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
    fn reapply_recovers_imported_pixels_from_the_pack() {
        let (root, tf2, id) = setup();
        let mut scripts = BTreeMap::new();
        scripts.insert("scripts/tf_weapon_scattergun.ctx".into(), sample_script());
        let mut pixels = vec![0u8; 64 * 64 * 4];
        pixels[0] = 9;
        pixels[1] = 40;
        pixels[2] = 200;
        pixels[3] = 255;
        apply_crosshairs_with_scripts(
            &root.join("profiles"),
            &tf2,
            &id,
            "custom",
            &BTreeMap::new(),
            Some(&pixels),
            None,
            &BTreeMap::new(),
            None,
            &scripts,
            unlocked(),
        )
        .unwrap();
        // Re-apply without the pixel buffer (a reload dropped it) — the pack's
        // stored custom.vtf must supply them.
        let detail = apply_crosshairs_with_scripts(
            &root.join("profiles"),
            &tf2,
            &id,
            "custom",
            &BTreeMap::new(),
            None,
            None,
            &BTreeMap::new(),
            None,
            &scripts,
            unlocked(),
        )
        .unwrap();
        assert_eq!(detail.crosshair.as_ref().unwrap().shape, "custom");
        let vtf = std::fs::read(
            tf2.join("tf/custom/execs-crosshairs/materials/vgui/replay/thumbnails/custom.vtf"),
        )
        .unwrap();
        let recovered = decode_vtf_bgra8888(&vtf, 64, 64).unwrap();
        assert_eq!(&recovered[0..4], &[9, 40, 200, 255]);
        cleanup(&root);
    }

    #[test]
    fn library_vtf_is_written_verbatim_with_its_own_dimensions() {
        let (root, tf2, id) = setup();
        let mut scripts = BTreeMap::new();
        scripts.insert("scripts/tf_weapon_scattergun.ctx".into(), sample_script());
        // A 128x128 BGRA "community" VTF.
        let rgba = vec![7u8; 128 * 128 * 4];
        let vtf = encode_vtf_bgra8888(&rgba_to_bgra(&rgba), 128, 128).unwrap();
        let mut library = BTreeMap::new();
        library.insert(
            "seeker".to_string(),
            CrosshairAsset {
                format: CrosshairAssetFormat::Vtf,
                bytes: vtf.clone(),
            },
        );
        let mut assignments = BTreeMap::new();
        assignments.insert("tf_weapon_scattergun".into(), "seeker".into());
        let detail = apply_crosshairs_with_scripts(
            &root.join("profiles"),
            &tf2,
            &id,
            "cross",
            &assignments,
            None,
            None,
            &library,
            None,
            &scripts,
            unlocked(),
        )
        .unwrap();
        let record = detail.crosshair.as_ref().unwrap();
        assert_eq!(record.library.get("seeker").map(String::as_str), Some("vtf"));
        let written = std::fs::read(
            tf2.join("tf/custom/execs-crosshairs/materials/vgui/replay/thumbnails/seeker.vtf"),
        )
        .unwrap();
        assert_eq!(written, vtf);
        let script = std::fs::read_to_string(
            tf2.join("tf/custom/execs-crosshairs/scripts/tf_weapon_scattergun.txt"),
        )
        .unwrap();
        assert!(script.contains("vgui/replay/thumbnails/seeker"));
        // The community VTF's own dimensions land in the weapon script.
        assert!(script.contains("\"128\""));

        // Re-apply without supplying bytes: recovered verbatim from the pack.
        let detail = apply_crosshairs_with_scripts(
            &root.join("profiles"),
            &tf2,
            &id,
            "seeker",
            &BTreeMap::new(),
            None,
            None,
            &BTreeMap::new(),
            None,
            &scripts,
            unlocked(),
        )
        .unwrap();
        assert_eq!(detail.crosshair.as_ref().unwrap().shape, "seeker");
        let rewritten = std::fs::read(
            tf2.join("tf/custom/execs-crosshairs/materials/vgui/replay/thumbnails/seeker.vtf"),
        )
        .unwrap();
        assert_eq!(rewritten, vtf);
        cleanup(&root);
    }

    #[test]
    fn rejects_invalid_library_names() {
        let (root, tf2, id) = setup();
        let mut scripts = BTreeMap::new();
        scripts.insert("scripts/tf_weapon_scattergun.ctx".into(), sample_script());
        let mut library = BTreeMap::new();
        library.insert(
            "Bad Name!".to_string(),
            CrosshairAsset {
                format: CrosshairAssetFormat::Rgba,
                bytes: vec![0u8; 64 * 64 * 4],
            },
        );
        let err = apply_crosshairs_with_scripts(
            &root.join("profiles"),
            &tf2,
            &id,
            "cross",
            &BTreeMap::new(),
            None,
            None,
            &library,
            None,
            &scripts,
            unlocked(),
        )
        .unwrap_err();
        assert!(err.message().contains("lowercase"));
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
            None,
            &BTreeMap::new(),
            None,
            &scripts,
            [tf2_name()],
        )
        .unwrap_err();
        assert!(matches!(err, ProfileError::GameRunning));
        cleanup(&root);
    }

    /// The live pack removal is unconditional, so an empty manifest must not
    /// be a way past the write lock.
    #[test]
    fn remove_refuses_while_tf2_is_running_even_with_no_tracked_pack_files() {
        let (root, tf2, id) = setup();
        let live = tf2.join("tf/custom").join(EXECS_CROSSHAIRS_PACK);
        std::fs::create_dir_all(&live).unwrap();
        std::fs::write(live.join("stray.vmt"), b"vmt").unwrap();

        // Nothing tracked on the manifest: the old guard would be skipped.
        assert!(pack_paths(&root.join("profiles"), &id).unwrap().is_empty());

        let err = remove_crosshairs_to(&root.join("profiles"), &tf2, &id, [tf2_name()])
            .unwrap_err();
        assert!(matches!(err, ProfileError::GameRunning));
        assert!(live.join("stray.vmt").is_file(), "live pack must survive");

        // With the game closed it still removes the folder.
        remove_crosshairs_to(&root.join("profiles"), &tf2, &id, unlocked()).unwrap();
        assert!(!live.exists());
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
