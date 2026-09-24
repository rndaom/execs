//! Bounded reader for Source's run-length animation value channels.
//!
//! `mstudioanimvalue_t` stores a count of explicit 16-bit samples followed by
//! a count of frames covered by that run. The final explicit sample repeats
//! for the rest of the run. This module only reads those integer samples; bone
//! scale, base pose, blending and model writes belong to later builder work.

use crate::viewmodel_pose::parse_stock_pose_mdl;
use crate::viewmodel_source::{StockAnimationModel, StockBoneModel, StockSourceError};

const ANIM_DESC_BYTES: usize = 100;

#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct PositionValueAudit {
    pub bounded_records: usize,
    pub unbounded_records: usize,
    pub decoded_channels: usize,
    pub decoded_frames: usize,
    pub repeated_frames: usize,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct DecodedAnimValues {
    pub samples: Vec<i16>,
    pub runs: usize,
    pub repeated_frames: usize,
    /// Bytes consumed through the run that covers the requested frames.
    pub consumed_bytes: usize,
}

fn invalid(message: impl Into<String>) -> StockSourceError {
    StockSourceError(message.into())
}

/// Decode whole-frame values from a single bounded `mstudioanimvalue_t`
/// channel. `source` must end no later than the containing bone record; bytes
/// after the requested frame range may contain another channel.
pub fn decode_anim_values(
    source: &[u8],
    frame_count: u16,
) -> Result<DecodedAnimValues, StockSourceError> {
    let target = usize::from(frame_count);
    if target == 0 {
        return Err(invalid("animation value channel has no frames"));
    }
    let mut samples = Vec::with_capacity(target);
    let mut offset = 0usize;
    let mut runs = 0usize;
    let mut repeated_frames = 0usize;
    while samples.len() < target {
        let header = source
            .get(offset..offset.saturating_add(2))
            .ok_or_else(|| invalid("animation value run header exceeds its bone record"))?;
        let valid = usize::from(header[0]);
        let total = usize::from(header[1]);
        if valid == 0 || total == 0 || valid > total {
            return Err(invalid(
                "animation value run has invalid valid/total counts",
            ));
        }
        let payload_bytes = valid
            .checked_mul(2)
            .ok_or_else(|| invalid("animation value run length overflows"))?;
        let end = offset
            .checked_add(2)
            .and_then(|start| start.checked_add(payload_bytes))
            .ok_or_else(|| invalid("animation value run length overflows"))?;
        let payload = source
            .get(offset + 2..end)
            .ok_or_else(|| invalid("animation value run samples exceed its bone record"))?;
        let remaining = target - samples.len();
        let covered = total.min(remaining);
        let explicit = valid.min(covered);
        for sample in 0..explicit {
            let at = sample * 2;
            samples.push(i16::from_le_bytes([payload[at], payload[at + 1]]));
        }
        if covered > explicit {
            let last = i16::from_le_bytes([payload[payload_bytes - 2], payload[payload_bytes - 1]]);
            samples.resize(samples.len() + covered - explicit, last);
            repeated_frames += covered - explicit;
        }
        offset = end;
        runs += 1;
    }
    Ok(DecodedAnimValues {
        samples,
        runs,
        repeated_frames,
        consumed_bytes: offset,
    })
}

/// Read the three position axes of a compressed, bounded `mstudioanim_t` bone
/// record. A zero axis offset means Source uses that bone's base position.
/// The caller supplies exactly the bytes through `nextoffset`; an unbounded
/// final record cannot be decoded by this function.
pub fn decode_compressed_position_record(
    record: &[u8],
    frame_count: u16,
) -> Result<[Option<DecodedAnimValues>; 3], StockSourceError> {
    let header = record
        .get(..4)
        .ok_or_else(|| invalid("compressed bone record header is truncated"))?;
    let flags = header[1];
    if flags & 0x04 == 0 || flags & 0x01 != 0 {
        return Err(invalid("bone record is not compressed position data"));
    }
    let next = i16::from_le_bytes([header[2], header[3]]);
    if usize::try_from(next).ok() != Some(record.len()) {
        return Err(invalid(
            "compressed bone record is not bounded by nextoffset",
        ));
    }
    // Source places the rotation value pointers first when ANIMROT is set.
    let position_ptr = 4 + if flags & 0x08 != 0 { 6 } else { 0 };
    let pointer_end = position_ptr + 6;
    let pointers = record
        .get(position_ptr..pointer_end)
        .ok_or_else(|| invalid("compressed position pointers are truncated"))?;
    let mut axes = [None, None, None];
    for axis in 0..3 {
        let offset = i16::from_le_bytes([pointers[axis * 2], pointers[axis * 2 + 1]]);
        if offset == 0 {
            continue;
        }
        let start = usize::try_from(offset)
            .ok()
            .and_then(|offset| position_ptr.checked_add(offset))
            .filter(|start| *start >= pointer_end && *start < record.len())
            .ok_or_else(|| invalid("compressed position axis offset is invalid"))?;
        axes[axis] = Some(decode_anim_values(&record[start..], frame_count)?);
    }
    Ok(axes)
}

fn i32_at(bytes: &[u8], offset: usize, name: &str) -> Result<i32, StockSourceError> {
    let value = bytes
        .get(offset..offset.saturating_add(4))
        .ok_or_else(|| invalid(format!("{name} extends outside the MDL")))?;
    Ok(i32::from_le_bytes(value.try_into().unwrap()))
}

fn local_offset(base: usize, offset: i32, name: &str) -> Result<usize, StockSourceError> {
    let offset = usize::try_from(offset)
        .ok()
        .filter(|offset| *offset > 0)
        .ok_or_else(|| invalid(format!("{name} offset is invalid")))?;
    base.checked_add(offset)
        .ok_or_else(|| invalid(format!("{name} offset overflows")))
}

/// Audit compressed position channels in the same locally verified MDL that
/// produced the animation and bone indexes. The pose inventory validates the
/// full record graph first; this then decodes only records with a bounded
/// `nextoffset`. It does not apply bone scales or change model bytes.
pub fn audit_stock_position_values_mdl(
    bytes: &[u8],
    animation_model: &StockAnimationModel,
    bone_model: &StockBoneModel,
) -> Result<PositionValueAudit, StockSourceError> {
    let pose = parse_stock_pose_mdl(bytes, animation_model, bone_model)?;
    let table = usize::try_from(i32_at(bytes, 184, "animation table")?)
        .map_err(|_| invalid("animation table offset is invalid"))?;
    let mut audit = PositionValueAudit::default();
    for (index, source_animation) in animation_model.animations.iter().enumerate() {
        if pose.animations[index].unsupported_reason.is_some() {
            continue;
        }
        let base = table + index * ANIM_DESC_BYTES;
        let section_frames = i32_at(bytes, base + 84, "section frame count")?;
        let mut sections = Vec::new();
        if section_frames == 0 {
            sections.push((
                local_offset(
                    base,
                    i32_at(bytes, base + 56, "animation data")?,
                    "animation data",
                )?,
                source_animation.frames,
            ));
        } else {
            let section_frames = usize::try_from(section_frames)
                .map_err(|_| invalid("section frame count is invalid"))?;
            let section_table = local_offset(
                base,
                i32_at(bytes, base + 80, "animation sections")?,
                "animation sections",
            )?;
            for section in 0..pose.animations[index].section_count {
                let first_frame = section
                    .checked_mul(section_frames)
                    .ok_or_else(|| invalid("section frame index overflows"))?;
                if first_frame >= usize::from(source_animation.frames) {
                    continue;
                }
                let section_entry = section_table + section * 8;
                let start = local_offset(
                    base,
                    i32_at(bytes, section_entry + 4, "section data")?,
                    "section data",
                )?;
                let frames = section_frames.min(usize::from(source_animation.frames) - first_frame);
                sections.push((start, u16::try_from(frames).unwrap()));
            }
        }
        for (section, (start, frames)) in sections.into_iter().enumerate() {
            let mut at = start;
            for _ in 0..=bone_model.bones.len() {
                let header = bytes.get(at..at.saturating_add(4)).ok_or_else(|| {
                    invalid(format!(
                        "{} section {section} bone header exceeds MDL",
                        source_animation.name
                    ))
                })?;
                if header[0] == 255 {
                    break;
                }
                let next = i16::from_le_bytes([header[2], header[3]]);
                if header[1] & 0x04 != 0 {
                    if next == 0 {
                        audit.unbounded_records += 1;
                    } else {
                        let end = at
                            + usize::try_from(next)
                                .map_err(|_| invalid("bone record offset is invalid"))?;
                        let record = bytes
                            .get(at..end)
                            .ok_or_else(|| invalid("compressed position record exceeds MDL"))?;
                        let axes =
                            decode_compressed_position_record(record, frames).map_err(|error| {
                                invalid(format!(
                                    "{} section {section} bone {}: {error}",
                                    source_animation.name, header[0]
                                ))
                            })?;
                        audit.bounded_records += 1;
                        for channel in axes.into_iter().flatten() {
                            audit.decoded_channels += 1;
                            audit.decoded_frames += channel.samples.len();
                            audit.repeated_frames += channel.repeated_frames;
                        }
                    }
                }
                if next == 0 {
                    break;
                }
                at +=
                    usize::try_from(next).map_err(|_| invalid("bone record offset is invalid"))?;
            }
        }
    }
    Ok(audit)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn decodes_explicit_and_repeated_frames_across_runs() {
        // Two explicit frames, then two repeats; a second run covers three.
        let source = [2, 4, 10, 0, 20, 0, 2, 3, 30, 0, 40, 0, 99];
        let decoded = decode_anim_values(&source, 7).unwrap();
        assert_eq!(decoded.samples, [10, 20, 20, 20, 30, 40, 40]);
        assert_eq!(decoded.runs, 2);
        assert_eq!(decoded.repeated_frames, 3);
        assert_eq!(decoded.consumed_bytes, 12);
    }

    #[test]
    fn stops_at_requested_frames_without_reading_the_next_channel() {
        let source = [1, 255, 254, 255, 0, 0];
        let decoded = decode_anim_values(&source, 3).unwrap();
        assert_eq!(decoded.samples, [-2, -2, -2]);
        assert_eq!(decoded.consumed_bytes, 4);
    }

    #[test]
    fn rejects_malformed_or_truncated_runs() {
        for source in [&[0, 1, 0, 0][..], &[2, 1, 0, 0, 0, 0], &[1, 0, 0, 0]] {
            assert!(decode_anim_values(source, 1).is_err());
        }
        assert!(decode_anim_values(&[1, 2, 10], 2).is_err());
        assert!(decode_anim_values(&[1, 1, 10, 0], 2).is_err());
        assert!(decode_anim_values(&[1, 1, 10, 0], 0).is_err());
    }

    #[test]
    fn follows_position_pointers_after_rotation_pointers() {
        let mut record = [0u8; 24];
        record[..4].copy_from_slice(&[3, 0x0c, 24, 0]);
        // The first six bytes are rotation pointers. Position starts at 10.
        record[10..16].copy_from_slice(&[6, 0, 0, 0, 10, 0]);
        record[16..20].copy_from_slice(&[1, 2, 5, 0]);
        record[20..24].copy_from_slice(&[1, 2, 251, 255]);
        let axes = decode_compressed_position_record(&record, 2).unwrap();
        assert_eq!(axes[0].as_ref().unwrap().samples, [5, 5]);
        assert!(axes[1].is_none());
        assert_eq!(axes[2].as_ref().unwrap().samples, [-5, -5]);
        record[2] = 0;
        assert!(decode_compressed_position_record(&record, 2).is_err());
    }
}
