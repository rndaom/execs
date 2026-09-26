//! Read-only local-animation bone-record inventory for the independent builder.
//!
//! Offsets follow Valve's pinned `mstudioanimdesc_t`, `mstudioanim_t` and
//! `mstudioanimsection_t` layouts. This records encoding and bounds evidence;
//! it does not decode frames, change an MDL, or assert retail rendering.

use std::collections::BTreeSet;

use crate::hash::sha256_hex;
use crate::viewmodel_source::{StockAnimationModel, StockBoneModel, StockSourceError};

const MAX_MDL_BYTES: usize = 8 * 1024 * 1024;
const HEADER_BYTES: usize = 408;
const ANIM_DESC_BYTES: usize = 100;
const MAX_SECTIONS: usize = 64;

#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct PositionEncodings {
    pub raw: usize,
    pub compressed: usize,
    pub none: usize,
    /// The record has no following offset to bound its payload for a writer.
    pub unbounded_tail: usize,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct AnimationPoseSummary {
    pub name: String,
    pub section_count: usize,
    pub bone_records: usize,
    pub root: PositionEncodings,
    pub weapon: PositionEncodings,
    pub unknown_flag_records: usize,
    pub unsupported_reason: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct StockPoseIndex {
    pub model_name: String,
    pub sha256: String,
    pub weapon_bones: Vec<String>,
    pub animations: Vec<AnimationPoseSummary>,
    pub shared_chain_starts: usize,
}

fn invalid(message: impl Into<String>) -> StockSourceError {
    StockSourceError(message.into())
}

fn span(bytes: &[u8], offset: usize, size: usize, name: &str) -> Result<(), StockSourceError> {
    if offset > bytes.len() || size > bytes.len() - offset {
        return Err(invalid(format!("{name} extends outside the MDL")));
    }
    Ok(())
}

fn i32_at(bytes: &[u8], offset: usize, name: &str) -> Result<i32, StockSourceError> {
    span(bytes, offset, 4, name)?;
    Ok(i32::from_le_bytes(
        bytes[offset..offset + 4].try_into().unwrap(),
    ))
}

fn positive(value: i32, name: &str) -> Result<usize, StockSourceError> {
    usize::try_from(value)
        .ok()
        .filter(|value| *value > 0)
        .ok_or_else(|| invalid(format!("{name} offset is invalid")))
}

fn relative(base: usize, value: i32, name: &str) -> Result<usize, StockSourceError> {
    base.checked_add(positive(value, name)?)
        .ok_or_else(|| invalid(format!("{name} offset overflows")))
}

fn record_encoding(
    counts: &mut PositionEncodings,
    flags: u8,
    bounded: bool,
) -> Result<(), StockSourceError> {
    let raw = flags & 0x01 != 0;
    let compressed = flags & 0x04 != 0;
    if raw && compressed {
        return Err(invalid("bone record has two position encodings"));
    }
    if raw {
        counts.raw += 1;
    } else if compressed {
        counts.compressed += 1;
    } else {
        counts.none += 1;
    }
    if !bounded {
        counts.unbounded_tail += 1;
    }
    Ok(())
}

fn chain(
    bytes: &[u8],
    start: usize,
    bone_count: usize,
    weapon_indexes: &BTreeSet<usize>,
    summary: &mut AnimationPoseSummary,
) -> Result<(), StockSourceError> {
    let mut at = start;
    let mut seen = BTreeSet::new();
    // A chain may encode every bone and then terminate with Valve's bone=255
    // marker, so allow one more header than the number of real bones.
    for _ in 0..=bone_count {
        span(bytes, at, 4, "animation bone record")?;
        let bone = usize::from(bytes[at]);
        let flags = bytes[at + 1];
        let next = i16::from_le_bytes(bytes[at + 2..at + 4].try_into().unwrap());
        if bone == 255 {
            return if flags == 0 && next == 0 {
                Ok(())
            } else {
                Err(invalid("animation end marker has a payload"))
            };
        }
        if bone >= bone_count || !seen.insert(bone) {
            return Err(invalid(
                "animation bone record has an invalid or repeated index",
            ));
        }
        if next < 0 || (next != 0 && next < 4) {
            return Err(invalid("animation bone record does not advance"));
        }
        let bounded = next > 0;
        if bounded {
            span(bytes, at, next as usize, "animation bone record payload")?;
        }
        if !matches!(flags, 0x01 | 0x08 | 0x0c | 0x20 | 0x21) {
            summary.unknown_flag_records += 1;
        }
        if bone == 0 {
            record_encoding(&mut summary.root, flags, bounded)?;
        }
        if weapon_indexes.contains(&bone) {
            record_encoding(&mut summary.weapon, flags, bounded)?;
        }
        summary.bone_records += 1;
        if next == 0 {
            return Ok(());
        }
        at += next as usize;
    }
    Err(invalid("animation bone chain exceeds the model bone count"))
}

/// Inventory sectioned and unsectioned local bone-record headers. The two
/// independently verified indexes must fingerprint exactly these MDL bytes.
/// Position payloads remain undecoded; counts are an engineering feasibility
/// measure, not a safe-edit certificate or a preview source.
pub fn parse_stock_pose_mdl(
    bytes: &[u8],
    animation_model: &StockAnimationModel,
    bone_model: &StockBoneModel,
) -> Result<StockPoseIndex, StockSourceError> {
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
    let sha256 = sha256_hex(bytes);
    if sha256 != animation_model.sha256
        || sha256 != bone_model.sha256
        || animation_model.model_name != bone_model.model_name
    {
        return Err(invalid(
            "pose input differs from its animation or bone index",
        ));
    }
    let bone_count = bone_model.bones.len();
    if usize::try_from(i32_at(bytes, 156, "bone count")?).ok() != Some(bone_count) {
        return Err(invalid(
            "pose input bone count differs from the verified index",
        ));
    }
    let animation_count = animation_model.animations.len();
    if usize::try_from(i32_at(bytes, 180, "animation count")?).ok() != Some(animation_count) {
        return Err(invalid(
            "pose input animation count differs from the verified index",
        ));
    }
    let table = positive(i32_at(bytes, 184, "animation table")?, "animation table")?;
    span(
        bytes,
        table,
        animation_count * ANIM_DESC_BYTES,
        "animation table",
    )?;
    let weapon_indexes: BTreeSet<_> = bone_model
        .bones
        .iter()
        .enumerate()
        .filter(|(_, bone)| {
            let name = bone.name.to_ascii_lowercase();
            name.starts_with("weapon_bone") || name.starts_with("vm_weapon_bone")
        })
        .map(|(index, _)| index)
        .collect();
    let mut chain_starts = BTreeSet::new();
    let mut shared_chain_starts = 0;
    let mut animations = Vec::with_capacity(animation_count);
    for (index, source_animation) in animation_model.animations.iter().enumerate() {
        let base = table + index * ANIM_DESC_BYTES;
        if i32_at(bytes, base, "animation baseptr")? != -(base as i32) {
            return Err(invalid(
                "animation descriptor does not point back to the header",
            ));
        }
        let frames = i32_at(bytes, base + 16, "animation frames")?;
        if frames != i32::from(source_animation.frames) {
            return Err(invalid(
                "pose animation frames differ from the verified index",
            ));
        }
        let flags = i32_at(bytes, base + 12, "animation flags")?;
        let block = i32_at(bytes, base + 52, "animation block")?;
        let animation_offset = i32_at(bytes, base + 56, "animation offset")?;
        let section_offset = i32_at(bytes, base + 80, "animation section offset")?;
        let section_frames = i32_at(bytes, base + 84, "animation section frames")?;
        span(bytes, base + 90, 2, "animation zero-frame count")?;
        let zero_frame_count = i16::from_le_bytes(bytes[base + 90..base + 92].try_into().unwrap());
        let zero_frame_offset = i32_at(bytes, base + 92, "animation zero-frame offset")?;
        let mut summary = AnimationPoseSummary {
            name: source_animation.name.clone(),
            section_count: 0,
            bone_records: 0,
            root: PositionEncodings::default(),
            weapon: PositionEncodings::default(),
            unknown_flag_records: 0,
            unsupported_reason: None,
        };
        if !matches!(flags, 0 | 1) || block != 0 || zero_frame_count != 0 || zero_frame_offset != 0
        {
            summary.unsupported_reason = Some(format!(
                "animation flags {flags:#x}, external block {block}, or zero-frame data {zero_frame_count}/{zero_frame_offset} need another source path"
            ));
            animations.push(summary);
            continue;
        }
        let mut starts = Vec::new();
        if section_frames == 0 {
            if section_offset != 0 {
                return Err(invalid("unsectioned animation has a section table"));
            }
            starts.push(relative(base, animation_offset, "animation data")?);
        } else {
            let section_frames = usize::try_from(section_frames)
                .ok()
                .filter(|size| *size > 0 && *size < frames as usize)
                .ok_or_else(|| invalid("animation section frame count is invalid"))?;
            let section_count = (frames as usize / section_frames)
                .checked_add(2)
                .filter(|count| *count <= MAX_SECTIONS)
                .ok_or_else(|| invalid("animation section count exceeds the limit"))?;
            let section_table = relative(base, section_offset, "animation sections")?;
            span(
                bytes,
                section_table,
                section_count * 8,
                "animation section table",
            )?;
            let mut external_section = false;
            for section in 0..section_count {
                let entry = section_table + section * 8;
                if i32_at(bytes, entry, "animation section block")? != 0 {
                    external_section = true;
                    break;
                }
                starts.push(relative(
                    base,
                    i32_at(bytes, entry + 4, "animation section offset")?,
                    "animation section data",
                )?);
            }
            if external_section {
                summary.unsupported_reason =
                    Some("animation section uses an external block".into());
                animations.push(summary);
                continue;
            }
        }
        summary.section_count = starts.len();
        for (section, start) in starts.into_iter().enumerate() {
            if !chain_starts.insert(start) {
                shared_chain_starts += 1;
            }
            chain(bytes, start, bone_count, &weapon_indexes, &mut summary).map_err(|error| {
                invalid(format!(
                    "animation {} section {section} (flags {flags:#x}, offset {animation_offset}, start {start}, first {:?}): {error}",
                    source_animation.name,
                    &bytes[start..bytes.len().min(start + 4)]
                ))
            })?;
        }
        animations.push(summary);
    }
    Ok(StockPoseIndex {
        model_name: animation_model.model_name.clone(),
        sha256,
        weapon_bones: weapon_indexes
            .into_iter()
            .map(|index| bone_model.bones[index].name.clone())
            .collect(),
        animations,
        shared_chain_starts,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::viewmodel_source::{StockAnimation, StockBone};

    fn fixture() -> (Vec<u8>, StockAnimationModel, StockBoneModel) {
        let base = HEADER_BYTES;
        let mut bytes = vec![0u8; base + ANIM_DESC_BYTES + 34];
        bytes[..4].copy_from_slice(b"IDST");
        bytes[12..19].copy_from_slice(b"fixture");
        bytes[4..8].copy_from_slice(&48i32.to_le_bytes());
        let length = bytes.len() as i32;
        bytes[76..80].copy_from_slice(&length.to_le_bytes());
        bytes[156..160].copy_from_slice(&3i32.to_le_bytes());
        bytes[180..184].copy_from_slice(&1i32.to_le_bytes());
        bytes[184..188].copy_from_slice(&(base as i32).to_le_bytes());
        bytes[base..base + 4].copy_from_slice(&(-(base as i32)).to_le_bytes());
        bytes[base + 16..base + 20].copy_from_slice(&2i32.to_le_bytes());
        bytes[base + 56..base + 60].copy_from_slice(&(ANIM_DESC_BYTES as i32).to_le_bytes());
        let record = base + ANIM_DESC_BYTES;
        bytes[record..record + 4].copy_from_slice(&[0, 0x21, 18, 0]);
        bytes[record + 18..record + 22].copy_from_slice(&[1, 0x20, 12, 0]);
        bytes[record + 30..record + 34].copy_from_slice(&[2, 0x0c, 0, 0]);
        let sha256 = sha256_hex(&bytes);
        let model_name = "fixture".to_string();
        let animation = StockAnimationModel {
            model_name: model_name.clone(),
            sha256: sha256.clone(),
            animations: vec![StockAnimation {
                name: "@draw".into(),
                frames: 2,
                fps: 30.0,
            }],
            sequences: Vec::new(),
        };
        let bone = StockBoneModel {
            model_name,
            sha256,
            bones: vec![
                StockBone {
                    name: "root".into(),
                    parent: None,
                },
                StockBone {
                    name: "bip_hand_L".into(),
                    parent: Some(0),
                },
                StockBone {
                    name: "weapon_bone_L".into(),
                    parent: Some(1),
                },
            ],
        };
        (bytes, animation, bone)
    }

    #[test]
    fn counts_position_encodings_and_unbounded_tail() {
        let (bytes, animation, bone) = fixture();
        let parsed = parse_stock_pose_mdl(&bytes, &animation, &bone).unwrap();
        assert_eq!(parsed.animations[0].bone_records, 3);
        assert_eq!(parsed.animations[0].root.raw, 1);
        assert_eq!(parsed.animations[0].weapon.compressed, 1);
        assert_eq!(parsed.animations[0].weapon.unbounded_tail, 1);
    }

    #[test]
    fn refuses_mismatched_snapshot_and_nonadvancing_record() {
        let (mut bytes, animation, bone) = fixture();
        bytes[HEADER_BYTES + ANIM_DESC_BYTES + 2] = 2;
        assert!(parse_stock_pose_mdl(&bytes, &animation, &bone).is_err());
        let digest = sha256_hex(&bytes);
        let mut animation = animation;
        let mut bone = bone;
        animation.sha256 = digest.clone();
        bone.sha256 = digest;
        assert!(parse_stock_pose_mdl(&bytes, &animation, &bone).is_err());
    }

    #[test]
    fn source_end_marker_and_special_delta_are_kept_distinct() {
        let (mut bytes, mut animation, mut bone) = fixture();
        let record = HEADER_BYTES + ANIM_DESC_BYTES;
        bytes[record..record + 4].copy_from_slice(&[255, 0, 0, 0]);
        let digest = sha256_hex(&bytes);
        animation.sha256 = digest.clone();
        bone.sha256 = digest;
        let marker = parse_stock_pose_mdl(&bytes, &animation, &bone).unwrap();
        assert_eq!(marker.animations[0].bone_records, 0);
        assert!(marker.animations[0].unsupported_reason.is_none());

        bytes[HEADER_BYTES + 12..HEADER_BYTES + 16].copy_from_slice(&4i32.to_le_bytes());
        let digest = sha256_hex(&bytes);
        animation.sha256 = digest.clone();
        bone.sha256 = digest;
        let special = parse_stock_pose_mdl(&bytes, &animation, &bone).unwrap();
        assert!(special.animations[0].unsupported_reason.is_some());
    }

    #[test]
    fn accepts_end_marker_after_every_bone_record() {
        let (mut bytes, mut animation, mut bone) = fixture();
        let last = HEADER_BYTES + ANIM_DESC_BYTES + 30;
        bytes[last + 2..last + 4].copy_from_slice(&4i16.to_le_bytes());
        bytes.extend_from_slice(&[255, 0, 0, 0]);
        let length = bytes.len() as i32;
        bytes[76..80].copy_from_slice(&length.to_le_bytes());
        let digest = sha256_hex(&bytes);
        animation.sha256 = digest.clone();
        bone.sha256 = digest;
        let parsed = parse_stock_pose_mdl(&bytes, &animation, &bone).unwrap();
        assert_eq!(parsed.animations[0].bone_records, 3);
        assert_eq!(parsed.animations[0].weapon.unbounded_tail, 0);
    }
}
