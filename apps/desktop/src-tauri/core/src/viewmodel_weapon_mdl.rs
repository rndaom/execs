//! In-memory prototype for locally derived Weapon-hide Viewmodels models.
//!
//! The input remains the player's verified installed class MDL. Selected
//! ordinary animations get new local chains: non-weapon records keep their
//! original payloads, while direct hand-child weapon bones receive raw local
//! positions far from the visible hand. The candidate is never installed by
//! this module; engine and visual behavior still require retail verification.

use std::collections::{BTreeMap, BTreeSet};

use crate::viewmodel_pose::parse_stock_pose_mdl;
use crate::viewmodel_record_span::infer_terminal_record_span;
use crate::viewmodel_source::{
    parse_stock_animation_mdl, parse_stock_bone_mdl, StockAnimationModel, StockBoneModel,
    StockSourceError,
};

const MAX_MDL_BYTES: usize = 8 * 1024 * 1024;
const ANIM_DESC_BYTES: usize = 100;
const HIDE_POSITION: [u8; 6] = [0x40, 0xd6, 0x40, 0xd6, 0x40, 0xd6]; // Vector48(-100,-100,-100)

fn invalid(message: impl Into<String>) -> StockSourceError {
    StockSourceError(message.into())
}

fn i32_at(bytes: &[u8], offset: usize, field: &str) -> Result<i32, StockSourceError> {
    let raw = bytes
        .get(offset..offset.saturating_add(4))
        .ok_or_else(|| invalid(format!("{field} extends outside the MDL")))?;
    Ok(i32::from_le_bytes(raw.try_into().unwrap()))
}

fn patch_i32(bytes: &mut [u8], offset: usize, value: i32) -> Result<(), StockSourceError> {
    let raw = bytes
        .get_mut(offset..offset.saturating_add(4))
        .ok_or_else(|| invalid("animation pointer extends outside the MDL"))?;
    raw.copy_from_slice(&value.to_le_bytes());
    Ok(())
}

fn weapon_indexes(bones: &StockBoneModel) -> Result<BTreeSet<usize>, StockSourceError> {
    let mut indexes = BTreeSet::new();
    for (index, bone) in bones.bones.iter().enumerate() {
        let name = bone.name.to_ascii_lowercase();
        if name.starts_with("weapon_bone") || name.starts_with("vm_weapon_bone") {
            let parent = bone
                .parent
                .and_then(|parent| bones.bones.get(parent))
                .ok_or_else(|| invalid("weapon bone has no verified hand parent"))?;
            if !parent.name.eq_ignore_ascii_case("bip_hand_l")
                && !parent.name.eq_ignore_ascii_case("bip_hand_r")
            {
                return Err(invalid("weapon bone is not a direct hand child"));
            }
            indexes.insert(index);
        }
    }
    if indexes.is_empty() {
        return Err(invalid("class model has no verified weapon bones"));
    }
    Ok(indexes)
}

/// Count frame values actually selected through Source's section routing.
/// An extra descriptor section may exist but never be selected by a frame.
fn active_sections(frames: u16, chunk: usize) -> Result<BTreeMap<usize, u16>, StockSourceError> {
    if frames == 0 {
        return Err(invalid("animation has no frames"));
    }
    if chunk == 0 {
        return Ok(BTreeMap::from([(0, frames)]));
    }
    let mut sections = BTreeMap::<usize, u16>::new();
    for frame in 0..usize::from(frames) {
        let (section, local) = if frame == usize::from(frames) - 1 && usize::from(frames) > chunk {
            (usize::from(frames) / chunk + 1, 0)
        } else {
            (frame / chunk, frame % chunk)
        };
        let count = sections.entry(section).or_default();
        *count = (*count).max(
            u16::try_from(local + 1)
                .map_err(|_| invalid("animation section frame count exceeds u16"))?,
        );
    }
    Ok(sections)
}

/// Copy exactly the bytes a Source chain advances over. For a terminal
/// record, the bounded channel decoder supplies only the consumed payload.
fn read_chain(
    bytes: &[u8],
    start: usize,
    bone_count: usize,
    frames: u16,
) -> Result<(BTreeMap<usize, Vec<u8>>, bool), StockSourceError> {
    let mut at = start;
    let mut records = BTreeMap::new();
    for _ in 0..=bone_count {
        let header = bytes
            .get(at..at.saturating_add(4))
            .ok_or_else(|| invalid("weapon source chain header is truncated"))?;
        let bone = usize::from(header[0]);
        let next = i16::from_le_bytes([header[2], header[3]]);
        if bone == 255 {
            return if header[1] == 0 && next == 0 {
                Ok((records, true))
            } else {
                Err(invalid("weapon source chain end marker is invalid"))
            };
        }
        if bone >= bone_count || records.contains_key(&bone) {
            return Err(invalid("weapon source chain bone index is invalid"));
        }
        let size = if next == 0 {
            infer_terminal_record_span(&bytes[at..], frames)?.used_bytes
        } else {
            usize::try_from(next)
                .ok()
                .filter(|size| *size >= 4)
                .ok_or_else(|| invalid("weapon source chain does not advance"))?
        };
        let record = bytes
            .get(at..at.saturating_add(size))
            .ok_or_else(|| invalid("weapon source record extends outside the MDL"))?;
        records.insert(bone, record.to_vec());
        if next == 0 {
            return Ok((records, false));
        }
        at = at
            .checked_add(size)
            .ok_or_else(|| invalid("weapon source chain offset overflows"))?;
    }
    Err(invalid("weapon source chain exceeds the model bone count"))
}

fn hide_chain(
    records: &mut BTreeMap<usize, Vec<u8>>,
    weapon_bones: &BTreeSet<usize>,
    marker: bool,
) -> Result<Vec<u8>, StockSourceError> {
    for &bone in weapon_bones {
        let mut record = vec![bone as u8, 0x01, 0, 0];
        record.extend_from_slice(&HIDE_POSITION);
        records.insert(bone, record);
    }
    let mut chain = Vec::new();
    let count = records.len();
    for (index, record) in records.values_mut().enumerate() {
        let next = if index + 1 == count && !marker {
            0
        } else {
            i16::try_from(record.len())
                .map_err(|_| invalid("weapon bone record exceeds i16 nextoffset"))?
        };
        record[2..4].copy_from_slice(&next.to_le_bytes());
        chain.extend_from_slice(record);
    }
    if marker {
        chain.extend_from_slice(&[255, 0, 0, 0]);
    }
    if chain.len() > MAX_MDL_BYTES {
        return Err(invalid("weapon chain exceeds the model limit"));
    }
    Ok(chain)
}

/// Construct a candidate using exact installed MDL bytes and their verified
/// indexes. Unknown names, unsupported animation paths or malformed records
/// refuse the output. This does not determine runtime group reachability.
pub fn prototype_weapon_hide_mdl(
    original: &[u8],
    animation_model: &StockAnimationModel,
    bone_model: &StockBoneModel,
    hidden_animations: &BTreeSet<String>,
) -> Result<Vec<u8>, StockSourceError> {
    let pose = parse_stock_pose_mdl(original, animation_model, bone_model)?;
    let weapon_bones = weapon_indexes(bone_model)?;
    let mut names = BTreeMap::new();
    for (index, animation) in animation_model.animations.iter().enumerate() {
        if names.insert(animation.name.as_str(), index).is_some() {
            return Err(invalid("model has duplicate local animation names"));
        }
    }
    for name in hidden_animations {
        if !names.contains_key(name.as_str()) {
            return Err(invalid(format!("local animation {name} is missing")));
        }
    }
    if hidden_animations.is_empty() {
        return Ok(original.to_vec());
    }
    let table = usize::try_from(i32_at(original, 184, "animation table")?)
        .map_err(|_| invalid("animation table is invalid"))?;
    let mut output = original.to_vec();
    for name in hidden_animations {
        let index = names[name.as_str()];
        let animation = &animation_model.animations[index];
        let summary = &pose.animations[index];
        if summary.unsupported_reason.is_some() || summary.section_count == 0 {
            return Err(invalid(format!(
                "local animation {name} uses an unsupported source path"
            )));
        }
        let base = table
            .checked_add(index * ANIM_DESC_BYTES)
            .ok_or_else(|| invalid("animation descriptor offset overflows"))?;
        let chunk = usize::try_from(i32_at(original, base + 84, "section frames")?)
            .map_err(|_| invalid("animation section frame count is invalid"))?;
        let sections = active_sections(animation.frames, chunk)?;
        let section_table = if chunk == 0 {
            None
        } else {
            let relative = usize::try_from(i32_at(original, base + 80, "section table")?)
                .ok()
                .filter(|relative| *relative > 0)
                .ok_or_else(|| invalid("animation section table is invalid"))?;
            Some(
                base.checked_add(relative)
                    .ok_or_else(|| invalid("animation section table overflows"))?,
            )
        };
        for (section, frames) in sections {
            if section >= summary.section_count {
                return Err(invalid("active animation section exceeds its table"));
            }
            let pointer_at = if let Some(section_table) = section_table {
                let entry = section_table
                    .checked_add(section * 8)
                    .ok_or_else(|| invalid("animation section entry overflows"))?;
                if i32_at(original, entry, "animation section block")? != 0 {
                    return Err(invalid("animation section uses an external block"));
                }
                entry + 4
            } else {
                base + 56
            };
            let source_relative = usize::try_from(i32_at(original, pointer_at, "animation data")?)
                .ok()
                .filter(|offset| *offset > 0)
                .ok_or_else(|| invalid("animation data pointer is invalid"))?;
            let source_start = base
                .checked_add(source_relative)
                .ok_or_else(|| invalid("animation data pointer overflows"))?;
            let (mut records, marker) =
                read_chain(original, source_start, bone_model.bones.len(), frames)?;
            let source_records = records.clone();
            let chain = hide_chain(&mut records, &weapon_bones, marker)?;
            let (rebuilt_records, rebuilt_marker) =
                read_chain(&chain, 0, bone_model.bones.len(), frames)?;
            if rebuilt_marker != marker || rebuilt_records.len() != records.len() {
                return Err(invalid("weapon chain changed the source record layout"));
            }
            for (bone, source) in &source_records {
                if !weapon_bones.contains(bone) {
                    let rebuilt = &rebuilt_records[bone];
                    if source[..2] != rebuilt[..2] || source[4..] != rebuilt[4..] {
                        return Err(invalid("weapon chain changed a hand or other bone"));
                    }
                }
            }
            for bone in &weapon_bones {
                let rebuilt = &rebuilt_records[bone];
                if rebuilt[1] != 0x01 || rebuilt[4..] != HIDE_POSITION {
                    return Err(invalid("weapon chain did not replace a weapon bone"));
                }
            }
            let aligned = output.len().saturating_add(3) & !3;
            if aligned.saturating_add(chain.len()) > MAX_MDL_BYTES {
                return Err(invalid("weapon candidate exceeds the model limit"));
            }
            output.resize(aligned, 0);
            let pointer = i32::try_from(aligned - base)
                .map_err(|_| invalid("weapon animation pointer exceeds i32"))?;
            output.extend_from_slice(&chain);
            patch_i32(&mut output, pointer_at, pointer)?;
        }
    }
    let model_length =
        i32::try_from(output.len()).map_err(|_| invalid("model length exceeds i32"))?;
    patch_i32(&mut output, 76, model_length)?;
    let rebuilt_animations = parse_stock_animation_mdl(&output)?;
    let rebuilt_bones = parse_stock_bone_mdl(&output)?;
    let rebuilt_pose = parse_stock_pose_mdl(&output, &rebuilt_animations, &rebuilt_bones)?;
    if rebuilt_animations.animations != animation_model.animations
        || rebuilt_animations.sequences != animation_model.sequences
        || rebuilt_bones.bones != bone_model.bones
    {
        return Err(invalid(
            "candidate model changed stock animation or bone metadata",
        ));
    }
    for name in hidden_animations {
        let summary = &rebuilt_pose.animations[names[name.as_str()]];
        if summary.weapon.raw < weapon_bones.len() {
            return Err(invalid(format!(
                "candidate model did not hide the weapon bones in {name}"
            )));
        }
    }
    Ok(output)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn copies_non_weapon_payload_and_replaces_only_weapon_bone() {
        let mut source = vec![0, 0x21, 10, 0];
        source.extend_from_slice(&[1, 2, 3, 4, 5, 6]);
        source.extend_from_slice(&[1, 0x01, 0, 0]);
        source.extend_from_slice(&[7, 8, 9, 10, 11, 12]);
        let (mut records, marker) = read_chain(&source, 0, 2, 1).unwrap();
        assert!(!marker);
        let root = records[&0].clone();
        let rewritten = hide_chain(&mut records, &BTreeSet::from([1]), false).unwrap();
        assert_eq!(&rewritten[..10], root.as_slice());
        assert_eq!(
            &rewritten[10..],
            &[1, 1, 0, 0, 0x40, 0xd6, 0x40, 0xd6, 0x40, 0xd6]
        );
        assert_eq!(read_chain(&rewritten, 0, 2, 1).unwrap().0[&0], root);
    }

    #[test]
    fn preserves_terminal_marker_and_refuses_malformed_source() {
        let mut source = vec![0, 0x01, 10, 0];
        source.extend_from_slice(&[1, 2, 3, 4, 5, 6]);
        source.extend_from_slice(&[255, 0, 0, 0]);
        let (mut records, marker) = read_chain(&source, 0, 2, 1).unwrap();
        assert!(marker);
        let rewritten = hide_chain(&mut records, &BTreeSet::from([1]), marker).unwrap();
        assert_eq!(&rewritten[rewritten.len() - 4..], &[255, 0, 0, 0]);
        assert!(read_chain(&rewritten, 0, 2, 1).unwrap().1);
        assert!(read_chain(&source[..8], 0, 2, 1).is_err());
    }
}
