//! Read-only stock animation metadata for the independent Viewmodels builder.
//!
//! Layouts follow Valve's `studiohdr_t`, `mstudioanimdesc_t` and
//! `mstudioseqdesc_t` in Source SDK 2013 `src/public/studio.h` at
//! b8cfb12c0e083a2ef5b2f9f9b50f3902fa034474. This module does not use
//! CompVMInstaller data, decode animation frames, or change the player's game.

use std::collections::BTreeMap;
use std::path::Path;

use crate::finder::normalize_tf2_root;
use crate::hash::{read_small_text_bounded, sha256_hex};
use crate::steam_inf::parse_steam_inf;
use crate::vpk::{crc32, map_vpk_entries, read_vpk_entry};

const CLASSES: [&str; 9] = [
    "scout", "soldier", "pyro", "demo", "heavy", "engineer", "medic", "sniper", "spy",
];
const MAX_MDL_BYTES: usize = 8 * 1024 * 1024;
const MAX_STEAM_INF_BYTES: usize = 64 * 1024;
const MAX_RECORDS: usize = 4096;
const MAX_BLEND_CELLS: usize = 4096;
const MAX_NAME_BYTES: usize = 192;
const HEADER_BYTES: usize = 408;
const ANIM_DESC_BYTES: usize = 100;
const SEQ_DESC_BYTES: usize = 212;

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct StockSourceError(pub String);

impl std::fmt::Display for StockSourceError {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter.write_str(&self.0)
    }
}

impl std::error::Error for StockSourceError {}

#[derive(Debug, Clone, PartialEq)]
pub struct StockAnimation {
    pub name: String,
    pub frames: u16,
    pub fps: f32,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct StockSequence {
    pub label: String,
    pub activity: Option<String>,
    /// Each blend cell refers to one local animation in the same model.
    pub animation_indexes: Vec<usize>,
}

#[derive(Debug, Clone, PartialEq)]
pub struct StockAnimationModel {
    pub model_name: String,
    pub sha256: String,
    pub animations: Vec<StockAnimation>,
    pub sequences: Vec<StockSequence>,
}

#[derive(Debug, Clone, PartialEq)]
pub struct StockAnimationIndex {
    pub patch_version: String,
    pub models: BTreeMap<String, StockAnimationModel>,
}

fn invalid(message: impl Into<String>) -> StockSourceError {
    StockSourceError(message.into())
}

fn span(bytes: &[u8], offset: usize, size: usize, field: &str) -> Result<(), StockSourceError> {
    if offset > bytes.len() || size > bytes.len() - offset {
        return Err(invalid(format!("{field} extends outside the MDL")));
    }
    Ok(())
}

fn i32_at(bytes: &[u8], offset: usize, field: &str) -> Result<i32, StockSourceError> {
    span(bytes, offset, 4, field)?;
    Ok(i32::from_le_bytes(bytes[offset..offset + 4].try_into().unwrap()))
}

fn f32_at(bytes: &[u8], offset: usize, field: &str) -> Result<f32, StockSourceError> {
    span(bytes, offset, 4, field)?;
    Ok(f32::from_le_bytes(bytes[offset..offset + 4].try_into().unwrap()))
}

fn positive_offset(value: i32, field: &str) -> Result<usize, StockSourceError> {
    usize::try_from(value)
        .ok()
        .filter(|value| *value > 0)
        .ok_or_else(|| invalid(format!("{field} offset is invalid")))
}

fn relative_offset(base: usize, value: i32, field: &str) -> Result<usize, StockSourceError> {
    base.checked_add(positive_offset(value, field)?)
        .ok_or_else(|| invalid(format!("{field} offset overflows")))
}

fn name_at(bytes: &[u8], offset: usize, field: &str) -> Result<String, StockSourceError> {
    span(bytes, offset, 1, field)?;
    let end_limit = offset.saturating_add(MAX_NAME_BYTES).min(bytes.len());
    let end = bytes[offset..end_limit]
        .iter()
        .position(|byte| *byte == 0)
        .map(|length| offset + length)
        .ok_or_else(|| invalid(format!("{field} lacks a bounded NUL terminator")))?;
    if end == offset || bytes[offset..end].iter().any(|byte| !(32..=126).contains(byte)) {
        return Err(invalid(format!("{field} is not printable ASCII")));
    }
    Ok(String::from_utf8(bytes[offset..end].to_vec()).expect("ASCII name"))
}

fn table(
    bytes: &[u8],
    count: i32,
    offset: i32,
    stride: usize,
    field: &str,
) -> Result<Vec<usize>, StockSourceError> {
    let count = usize::try_from(count)
        .ok()
        .filter(|count| *count <= MAX_RECORDS)
        .ok_or_else(|| invalid(format!("{field} count exceeds the limit")))?;
    if count == 0 {
        return Ok(Vec::new());
    }
    let offset = positive_offset(offset, field)?;
    if !offset.is_multiple_of(4) {
        return Err(invalid(format!("{field} table is misaligned")));
    }
    span(bytes, offset, count * stride, &format!("{field} table"))?;
    Ok((0..count).map(|index| offset + index * stride).collect())
}

/// Parse only names, activities, and blend references from a bounded TF2 MDL.
/// No animation frame data is decoded or copied into output files.
pub fn parse_stock_animation_mdl(bytes: &[u8]) -> Result<StockAnimationModel, StockSourceError> {
    if bytes.len() > MAX_MDL_BYTES {
        return Err(invalid("MDL exceeds the 8 MiB limit"));
    }
    span(bytes, 0, HEADER_BYTES, "studiohdr_t")?;
    if &bytes[..4] != b"IDST" || i32_at(bytes, 4, "version")? != 48 {
        return Err(invalid("expected a Source IDST MDL v48 file"));
    }
    if i32_at(bytes, 76, "declared length")? != bytes.len() as i32 {
        return Err(invalid("studiohdr_t length differs from the file length"));
    }
    let model_name = name_at(bytes, 12, "model name")?;
    let anim_table = table(
        bytes,
        i32_at(bytes, 180, "animation count")?,
        i32_at(bytes, 184, "animation index")?,
        ANIM_DESC_BYTES,
        "animation",
    )?;
    let seq_table = table(
        bytes,
        i32_at(bytes, 188, "sequence count")?,
        i32_at(bytes, 192, "sequence index")?,
        SEQ_DESC_BYTES,
        "sequence",
    )?;
    if anim_table.is_empty() || seq_table.is_empty() {
        return Err(invalid("stock animation model has no animations or sequences"));
    }

    let mut animations = Vec::with_capacity(anim_table.len());
    for base in anim_table {
        if i32_at(bytes, base, "animation baseptr")? != -(base as i32) {
            return Err(invalid("animation descriptor does not point back to the header"));
        }
        let name = name_at(
            bytes,
            relative_offset(base, i32_at(bytes, base + 4, "animation name")?, "animation name")?,
            "animation name",
        )?;
        let fps = f32_at(bytes, base + 8, "animation FPS")?;
        let frames = i32_at(bytes, base + 16, "animation frame count")?;
        if !fps.is_finite() || !(0.0..=1000.0).contains(&fps) || fps == 0.0 {
            return Err(invalid("animation FPS is outside the limit"));
        }
        let frames = u16::try_from(frames)
            .ok()
            .filter(|frames| *frames > 0)
            .ok_or_else(|| invalid("animation frame count is outside the limit"))?;
        animations.push(StockAnimation { name, frames, fps });
    }

    let mut sequences = Vec::with_capacity(seq_table.len());
    for base in seq_table {
        if i32_at(bytes, base, "sequence baseptr")? != -(base as i32) {
            return Err(invalid("sequence descriptor does not point back to the header"));
        }
        let label = name_at(
            bytes,
            relative_offset(base, i32_at(bytes, base + 4, "sequence label")?, "sequence label")?,
            "sequence label",
        )?;
        let activity_offset = i32_at(bytes, base + 8, "sequence activity")?;
        let activity = if activity_offset == 0 {
            None
        } else {
            let at = relative_offset(base, activity_offset, "sequence activity")?;
            span(bytes, at, 1, "sequence activity")?;
            if bytes[at] == 0 {
                None
            } else {
                Some(name_at(bytes, at, "sequence activity").map_err(|error| {
                    invalid(format!("sequence {label}: {error}"))
                })?)
            }
        };
        let blends = usize::try_from(i32_at(bytes, base + 56, "sequence blend count")?)
            .ok()
            .filter(|count| (1..=MAX_BLEND_CELLS).contains(count))
            .ok_or_else(|| invalid("sequence blend count is outside the limit"))?;
        let width = usize::try_from(i32_at(bytes, base + 68, "sequence blend width")?)
            .map_err(|_| invalid("sequence blend width is invalid"))?;
        let height = usize::try_from(i32_at(bytes, base + 72, "sequence blend height")?)
            .map_err(|_| invalid("sequence blend height is invalid"))?;
        if width == 0 || height == 0 || width.checked_mul(height) != Some(blends) {
            return Err(invalid("sequence blend grid does not match the blend count"));
        }
        let grid = relative_offset(
            base,
            i32_at(bytes, base + 60, "sequence blend grid")?,
            "sequence blend grid",
        )?;
        span(bytes, grid, blends * 2, "sequence blend grid")?;
        let mut animation_indexes = Vec::with_capacity(blends);
        for cell in bytes[grid..grid + blends * 2].as_chunks::<2>().0 {
            let index = i16::from_le_bytes(*cell);
            let index = usize::try_from(index)
                .ok()
                .filter(|index| *index < animations.len())
                .ok_or_else(|| invalid("sequence references an invalid local animation"))?;
            animation_indexes.push(index);
        }
        sequences.push(StockSequence {
            label,
            activity,
            animation_indexes,
        });
    }

    Ok(StockAnimationModel {
        model_name,
        sha256: sha256_hex(bytes),
        animations,
        sequences,
    })
}

/// Inspect all nine class animation models from the selected app-440 install.
/// Every VPK body must match the directory's CRC. The install identity and
/// selected entry locations are checked again before the result is returned.
pub fn read_stock_animation_index(tf2_root: &Path) -> Result<StockAnimationIndex, StockSourceError> {
    let root = normalize_tf2_root(tf2_root).map_err(|error| invalid(error.message()))?;
    let steam_inf_path = root.join("tf/steam.inf");
    let steam_inf = read_small_text_bounded(&steam_inf_path, MAX_STEAM_INF_BYTES)
        .map_err(|error| invalid(format!("Could not read tf/steam.inf: {error}")))?;
    let patch_version = parse_steam_inf(&steam_inf)
        .remove("patchversion")
        .filter(|value| !value.is_empty())
        .ok_or_else(|| invalid("TF2 patch version is missing"))?;
    let vpk_path = root.join("tf/tf2_misc_dir.vpk");
    let entries = map_vpk_entries(&vpk_path)
        .map_err(|error| invalid(format!("Could not map tf2_misc VPK: {}", error.0)))?;
    let mut models = BTreeMap::new();
    for class_id in CLASSES {
        let rel = format!("models/weapons/c_models/c_{class_id}_animations.mdl");
        let entry = entries
            .get(&rel)
            .ok_or_else(|| invalid(format!("TF2 stock model {rel} is missing")))?;
        if entry.total_len() > MAX_MDL_BYTES {
            return Err(invalid(format!("TF2 stock model {rel} exceeds 8 MiB")));
        }
        let body = read_vpk_entry(&vpk_path, entry)
            .map_err(|error| invalid(format!("Could not read {rel}: {}", error.0)))?;
        if crc32(&body) != entry.crc {
            return Err(invalid(format!("TF2 stock model {rel} differs from its VPK CRC")));
        }
        let model = parse_stock_animation_mdl(&body)
            .map_err(|error| invalid(format!("{rel}: {error}")))?;
        let expected_name = format!("weapons/c_models/c_{class_id}_animations.mdl");
        if !model.model_name.replace('\\', "/").eq_ignore_ascii_case(&expected_name) {
            return Err(invalid(format!("{rel} has a different model identity")));
        }
        models.insert(class_id.to_string(), model);
    }
    let updated_inf = read_small_text_bounded(&steam_inf_path, MAX_STEAM_INF_BYTES)
        .map_err(|error| invalid(format!("Could not recheck tf/steam.inf: {error}")))?;
    if updated_inf != steam_inf {
        return Err(invalid("TF2 patch changed during stock model inspection"));
    }
    let updated_entries = map_vpk_entries(&vpk_path)
        .map_err(|error| invalid(format!("Could not recheck tf2_misc VPK: {}", error.0)))?;
    for class_id in CLASSES {
        let rel = format!("models/weapons/c_models/c_{class_id}_animations.mdl");
        if entries.get(&rel) != updated_entries.get(&rel) {
            return Err(invalid(format!("TF2 stock model {rel} changed during inspection")));
        }
        let entry = updated_entries.get(&rel).expect("entry checked above");
        let body = read_vpk_entry(&vpk_path, entry)
            .map_err(|error| invalid(format!("Could not recheck {rel}: {}", error.0)))?;
        if crc32(&body) != entry.crc
            || sha256_hex(&body) != models.get(class_id).expect("class indexed above").sha256
        {
            return Err(invalid(format!("TF2 stock model {rel} changed during inspection")));
        }
    }
    Ok(StockAnimationIndex {
        patch_version,
        models,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn write_i32(bytes: &mut [u8], at: usize, value: i32) {
        bytes[at..at + 4].copy_from_slice(&value.to_le_bytes());
    }

    fn append_name(bytes: &mut Vec<u8>, base: usize, name: &str) -> i32 {
        let offset = bytes.len() - base;
        bytes.extend_from_slice(name.as_bytes());
        bytes.push(0);
        offset as i32
    }

    fn sample_mdl() -> Vec<u8> {
        let animation = HEADER_BYTES;
        let sequence = animation + ANIM_DESC_BYTES;
        let mut bytes = vec![0; sequence + SEQ_DESC_BYTES];
        bytes[..4].copy_from_slice(b"IDST");
        let model_name = b"weapons/c_models/c_scout_animations.mdl";
        bytes[12..12 + model_name.len()].copy_from_slice(model_name);
        write_i32(&mut bytes, 4, 48);
        write_i32(&mut bytes, 180, 1);
        write_i32(&mut bytes, 184, animation as i32);
        write_i32(&mut bytes, 188, 1);
        write_i32(&mut bytes, 192, sequence as i32);
        write_i32(&mut bytes, animation, -(animation as i32));
        write_i32(&mut bytes, sequence, -(sequence as i32));
        let anim_name = append_name(&mut bytes, animation, "@draw");
        let seq_label = append_name(&mut bytes, sequence, "draw");
        let seq_activity = append_name(&mut bytes, sequence, "ACT_VM_DRAW");
        let grid = bytes.len() - sequence;
        bytes.extend_from_slice(&0i16.to_le_bytes());
        write_i32(&mut bytes, animation + 4, anim_name);
        bytes[animation + 8..animation + 12].copy_from_slice(&30f32.to_le_bytes());
        write_i32(&mut bytes, animation + 16, 42);
        write_i32(&mut bytes, sequence + 4, seq_label);
        write_i32(&mut bytes, sequence + 8, seq_activity);
        write_i32(&mut bytes, sequence + 56, 1);
        write_i32(&mut bytes, sequence + 60, grid as i32);
        write_i32(&mut bytes, sequence + 68, 1);
        write_i32(&mut bytes, sequence + 72, 1);
        let length = bytes.len() as i32;
        write_i32(&mut bytes, 76, length);
        bytes
    }

    #[test]
    fn reads_activity_and_blend_reference() {
        let bytes = sample_mdl();
        let model = parse_stock_animation_mdl(&bytes).unwrap();
        assert_eq!(model.animations[0].name, "@draw");
        assert_eq!(model.animations[0].frames, 42);
        assert_eq!(model.sequences[0].label, "draw");
        assert_eq!(model.sequences[0].activity.as_deref(), Some("ACT_VM_DRAW"));
        assert_eq!(model.sequences[0].animation_indexes, [0]);
        assert_eq!(model.sha256, sha256_hex(&bytes));
    }

    #[test]
    fn refuses_truncated_and_misdirected_metadata() {
        let mut bytes = sample_mdl();
        bytes.truncate(HEADER_BYTES);
        assert!(parse_stock_animation_mdl(&bytes).is_err());

        let mut bytes = sample_mdl();
        write_i32(&mut bytes, HEADER_BYTES + ANIM_DESC_BYTES + 60, i32::MAX);
        assert!(parse_stock_animation_mdl(&bytes).is_err());

        let mut bytes = sample_mdl();
        let grid = bytes.len() - 2;
        bytes[grid..].copy_from_slice(&1i16.to_le_bytes());
        assert!(parse_stock_animation_mdl(&bytes).is_err());
    }

    #[test]
    fn refuses_invalid_activity_and_length() {
        let mut bytes = sample_mdl();
        write_i32(&mut bytes, HEADER_BYTES + ANIM_DESC_BYTES + 8, -1);
        assert!(parse_stock_animation_mdl(&bytes).is_err());

        let mut bytes = sample_mdl();
        write_i32(&mut bytes, 76, 10);
        assert!(parse_stock_animation_mdl(&bytes).is_err());
    }

    #[test]
    fn empty_activity_is_an_unassigned_stock_sequence() {
        let mut bytes = sample_mdl();
        let sequence = HEADER_BYTES + ANIM_DESC_BYTES;
        let activity = sequence + i32_at(&bytes, sequence + 8, "activity").unwrap() as usize;
        bytes[activity] = 0;
        let model = parse_stock_animation_mdl(&bytes).unwrap();
        assert_eq!(model.sequences[0].activity, None);
    }
}
