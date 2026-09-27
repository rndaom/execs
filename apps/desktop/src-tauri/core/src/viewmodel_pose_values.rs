//! Bounded reader for Source's run-length animation value channels.
//!
//! `mstudioanimvalue_t` stores a count of explicit 16-bit samples followed by
//! a count of frames covered by that run. The final explicit sample repeats
//! for the rest of the run. This module only reads those integer samples; bone
//! scale, base pose, blending and model writes belong to later builder work.

use crate::hash::sha256_hex;
use crate::viewmodel_pose::parse_stock_pose_mdl;
use crate::viewmodel_source::{
    parse_stock_bone_mdl, StockAnimationModel, StockBoneModel, StockSourceError,
};

const ANIM_DESC_BYTES: usize = 100;
const BONE_DESC_BYTES: usize = 216;

#[derive(Debug, Clone, PartialEq)]
pub struct BonePositionBasis {
    pub base: [f32; 3],
    pub scale: [f32; 3],
}

#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct PositionValueAudit {
    pub bounded_records: usize,
    pub unbounded_records: usize,
    pub bounded_raw_records: usize,
    pub decoded_terminal_raw_records: usize,
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

/// Source's `float16` decoder used by `Vector48`. Its infinity and NaN cases
/// intentionally match Valve's finite 65504/zero behavior instead of IEEE
/// `f32` infinity or NaN propagation.
pub fn source_float16_to_f32(bits: u16) -> f32 {
    let negative = bits & 0x8000 != 0;
    let exponent = u32::from((bits >> 10) & 0x1f);
    let mantissa = u32::from(bits & 0x03ff);
    let sign = if negative { -1.0 } else { 1.0 };
    match exponent {
        0 if mantissa == 0 => f32::from_bits(u32::from(bits & 0x8000) << 16),
        0 => sign * (mantissa as f32 / 1024.0) * (1.0 / 16384.0),
        31 if mantissa == 0 => sign * 65504.0,
        31 => 0.0,
        _ => f32::from_bits(
            (u32::from(bits & 0x8000) << 16) | ((exponent + 112) << 23) | (mantissa << 13),
        ),
    }
}

fn raw_vector48(bytes: &[u8]) -> Result<[f32; 3], StockSourceError> {
    let bytes: [u8; 6] = bytes
        .try_into()
        .map_err(|_| invalid("raw Vector48 position requires six bytes"))?;
    let mut position = [0.0; 3];
    for axis in 0..3 {
        position[axis] =
            source_float16_to_f32(u16::from_le_bytes([bytes[axis * 2], bytes[axis * 2 + 1]]));
    }
    Ok(position)
}

/// Fixed size for a terminal raw-position bone record. Animated channels
/// cannot be bounded from `nextoffset=0` and are rejected here.
pub fn terminal_raw_position_len(flags: u8) -> Result<usize, StockSourceError> {
    if flags & 0x01 == 0
        || flags & !(0x01 | 0x02 | 0x10 | 0x20) != 0
        || flags & 0x02 != 0 && flags & 0x20 != 0
    {
        return Err(invalid("terminal record is not fixed-size raw position"));
    }
    Ok(4 + if flags & 0x02 != 0 { 6 } else { 0 } + if flags & 0x20 != 0 { 8 } else { 0 } + 6)
}

/// Decode a terminal raw position at its exact Source-defined fixed size.
/// The caller must have verified the MDL and bone-chain start first.
pub fn decode_terminal_raw_position_record(
    record: &[u8],
    frame_count: u16,
) -> Result<Vec<[f32; 3]>, StockSourceError> {
    let header = record
        .get(..4)
        .ok_or_else(|| invalid("terminal bone record header is truncated"))?;
    if frame_count == 0
        || header[2] != 0
        || header[3] != 0
        || record.len() != terminal_raw_position_len(header[1])?
    {
        return Err(invalid(
            "terminal raw position size, frames or nextoffset is invalid",
        ));
    }
    let position_start = record.len() - 6;
    let position = raw_vector48(&record[position_start..])?;
    Ok(vec![position; usize::from(frame_count)])
}

/// Decode the whole-frame local position of one bounded Source bone record.
/// `base_position` and `position_scale` must come from the same verified MDL
/// bone (or its linear-bone table). Rotation, sequence weights, blending,
/// section interpolation and model writing are outside this reader.
pub fn decode_position_frames(
    record: &[u8],
    frame_count: u16,
    base_position: [f32; 3],
    position_scale: [f32; 3],
) -> Result<Vec<[f32; 3]>, StockSourceError> {
    if frame_count == 0
        || !base_position
            .iter()
            .chain(&position_scale)
            .all(|x| x.is_finite())
    {
        return Err(invalid("position basis or frame count is invalid"));
    }
    let header = record
        .get(..4)
        .ok_or_else(|| invalid("bone record header is truncated"))?;
    let flags = header[1];
    let next = i16::from_le_bytes([header[2], header[3]]);
    if usize::try_from(next).ok() != Some(record.len()) {
        return Err(invalid("position bone record is not bounded by nextoffset"));
    }
    if flags & 0x01 != 0 && flags & 0x04 != 0 {
        return Err(invalid("bone record mixes raw and compressed position"));
    }
    if flags & 0x01 != 0 {
        if flags & 0x02 != 0 && flags & 0x20 != 0 {
            return Err(invalid("bone record has two raw rotation encodings"));
        }
        let position_start =
            4 + if flags & 0x02 != 0 { 6 } else { 0 } + if flags & 0x20 != 0 { 8 } else { 0 };
        let payload = record
            .get(position_start..position_start + 6)
            .ok_or_else(|| invalid("raw Vector48 position is truncated"))?;
        let position = raw_vector48(payload)?;
        return Ok(vec![position; usize::from(frame_count)]);
    }
    let mut frames = vec![
        if flags & 0x10 != 0 {
            [0.0; 3]
        } else {
            base_position
        };
        usize::from(frame_count)
    ];
    if flags & 0x04 != 0 {
        let axes = decode_compressed_position_record(record, frame_count)?;
        for (axis, samples) in axes.into_iter().enumerate() {
            if let Some(samples) = samples {
                for (frame, sample) in samples.samples.into_iter().enumerate() {
                    frames[frame][axis] += f32::from(sample) * position_scale[axis];
                    if !frames[frame][axis].is_finite() {
                        return Err(invalid("decoded bone position is not finite"));
                    }
                }
            }
        }
    }
    Ok(frames)
}

pub(crate) fn i32_at(bytes: &[u8], offset: usize, name: &str) -> Result<i32, StockSourceError> {
    let value = bytes
        .get(offset..offset.saturating_add(4))
        .ok_or_else(|| invalid(format!("{name} extends outside the MDL")))?;
    Ok(i32::from_le_bytes(value.try_into().unwrap()))
}

pub(crate) fn local_offset(
    base: usize,
    offset: i32,
    name: &str,
) -> Result<usize, StockSourceError> {
    let offset = usize::try_from(offset)
        .ok()
        .filter(|offset| *offset > 0)
        .ok_or_else(|| invalid(format!("{name} offset is invalid")))?;
    base.checked_add(offset)
        .ok_or_else(|| invalid(format!("{name} offset overflows")))
}

pub(crate) fn vector3_at(
    bytes: &[u8],
    offset: usize,
    name: &str,
) -> Result<[f32; 3], StockSourceError> {
    let value = bytes
        .get(offset..offset.saturating_add(12))
        .ok_or_else(|| invalid(format!("{name} extends outside the MDL")))?;
    let mut result = [0.0; 3];
    for (axis, component) in result.iter_mut().enumerate() {
        let at = axis * 4;
        *component = f32::from_le_bytes(value[at..at + 4].try_into().unwrap());
        if !component.is_finite() {
            return Err(invalid(format!("{name} has a non-finite value")));
        }
    }
    Ok(result)
}

pub(crate) struct VerifiedBoneTables {
    pub ordinary: usize,
    pub linear: Option<usize>,
}

/// Locate ordinary and optional linear bone tables against an exact verified
/// MDL fingerprint. Position and rotation readers share this validation.
pub(crate) fn verified_bone_tables(
    bytes: &[u8],
    bone_model: &StockBoneModel,
) -> Result<VerifiedBoneTables, StockSourceError> {
    if sha256_hex(bytes) != bone_model.sha256 || parse_stock_bone_mdl(bytes)? != *bone_model {
        return Err(invalid("bone basis differs from the verified bone index"));
    }
    let count = bone_model.bones.len();
    let ordinary_table = usize::try_from(i32_at(bytes, 160, "bone table")?)
        .map_err(|_| invalid("bone table offset is invalid"))?;
    let header2_offset = i32_at(bytes, 400, "studiohdr2 index")?;
    let linear_table = if header2_offset == 0 {
        None
    } else {
        let header2 = local_offset(0, header2_offset, "studiohdr2")?;
        let linear_offset = i32_at(bytes, header2 + 16, "linear bone index")?;
        if linear_offset == 0 {
            None
        } else {
            let table = local_offset(header2, linear_offset, "linear bone table")?;
            if usize::try_from(i32_at(bytes, table, "linear bone count")?).ok() != Some(count) {
                return Err(invalid("linear bone count differs from the bone index"));
            }
            Some(table)
        }
    };
    Ok(VerifiedBoneTables {
        ordinary: ordinary_table,
        linear: linear_table,
    })
}

/// Read position bases from ordinary `mstudiobone_t` entries, or the MDL's
/// `mstudiolinearbone_t` table when present. The verified bone index and these
/// bytes must have the same fingerprint before any basis is returned.
pub fn parse_bone_position_bases(
    bytes: &[u8],
    bone_model: &StockBoneModel,
) -> Result<Vec<BonePositionBasis>, StockSourceError> {
    let tables = verified_bone_tables(bytes, bone_model)?;
    let count = bone_model.bones.len();
    let mut bases = Vec::with_capacity(count);
    for bone in 0..count {
        let (base_offset, scale_offset) = if let Some(table) = tables.linear {
            let positions = local_offset(
                table,
                i32_at(bytes, table + 12, "linear positions")?,
                "linear positions",
            )?;
            let scales = local_offset(
                table,
                i32_at(bytes, table + 28, "linear position scales")?,
                "linear position scales",
            )?;
            (positions + bone * 12, scales + bone * 12)
        } else {
            let entry = tables.ordinary + bone * BONE_DESC_BYTES;
            (entry + 32, entry + 72)
        };
        bases.push(BonePositionBasis {
            base: vector3_at(bytes, base_offset, "bone base position")?,
            scale: vector3_at(bytes, scale_offset, "bone position scale")?,
        });
    }
    Ok(bases)
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
    let bases = parse_bone_position_bases(bytes, bone_model)?;
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
                if header[1] & 0x01 != 0 {
                    if next == 0 {
                        let len = terminal_raw_position_len(header[1])?;
                        let record = bytes
                            .get(at..at.saturating_add(len))
                            .ok_or_else(|| invalid("terminal raw position exceeds MDL"))?;
                        decode_terminal_raw_position_record(record, frames)?;
                        audit.decoded_terminal_raw_records += 1;
                    } else {
                        let end = at
                            + usize::try_from(next)
                                .map_err(|_| invalid("bone record offset is invalid"))?;
                        let record = bytes
                            .get(at..end)
                            .ok_or_else(|| invalid("raw position record exceeds MDL"))?;
                        let basis = &bases[usize::from(header[0])];
                        decode_position_frames(record, frames, basis.base, basis.scale)?;
                        audit.bounded_raw_records += 1;
                    }
                }
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
                        let basis = &bases[usize::from(header[0])];
                        decode_position_frames(record, frames, basis.base, basis.scale)?;
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

    #[test]
    fn raw_vector48_ignores_base_pose_and_preserves_signed_values() {
        let mut record = [0u8; 18];
        record[..4].copy_from_slice(&[0, 0x21, 18, 0]);
        record[12..18].copy_from_slice(&[0, 0x3c, 0, 0xc0, 0, 0x38]);
        let positions = decode_position_frames(&record, 2, [10.0; 3], [2.0; 3]).unwrap();
        assert_eq!(positions, [[1.0, -2.0, 0.5]; 2]);
        assert_eq!(source_float16_to_f32(0x7c00), 65504.0);
        assert_eq!(source_float16_to_f32(0x7e00), 0.0);
        assert_eq!(source_float16_to_f32(0x0001), 2f32.powi(-24));
    }

    #[test]
    fn terminal_raw_vector48_uses_its_fixed_payload_size() {
        let mut record = [0u8; 18];
        record[..4].copy_from_slice(&[0, 0x21, 0, 0]);
        record[12..18].copy_from_slice(&[0, 0x3c, 0, 0xc0, 0, 0x38]);
        assert_eq!(terminal_raw_position_len(0x21).unwrap(), 18);
        assert_eq!(
            decode_terminal_raw_position_record(&record, 3).unwrap(),
            [[1.0, -2.0, 0.5]; 3]
        );
        assert!(decode_terminal_raw_position_record(&record[..17], 3).is_err());
        assert!(decode_terminal_raw_position_record(&record, 0).is_err());
        assert!(terminal_raw_position_len(0x0d).is_err());
        record[2] = 18;
        assert!(decode_terminal_raw_position_record(&record, 3).is_err());
    }

    #[test]
    fn compressed_position_uses_base_and_scale_and_delta_uses_zero() {
        let mut record = [0u8; 24];
        record[..4].copy_from_slice(&[3, 0x0c, 24, 0]);
        record[10..16].copy_from_slice(&[6, 0, 0, 0, 10, 0]);
        record[16..20].copy_from_slice(&[1, 2, 5, 0]);
        record[20..24].copy_from_slice(&[1, 2, 251, 255]);
        let position =
            decode_position_frames(&record, 2, [10.0, 20.0, 30.0], [2.0, 3.0, 4.0]).unwrap();
        assert_eq!(position, [[20.0, 20.0, 10.0]; 2]);
        record[1] |= 0x10;
        let delta =
            decode_position_frames(&record, 2, [10.0, 20.0, 30.0], [2.0, 3.0, 4.0]).unwrap();
        assert_eq!(delta, [[10.0, 0.0, -20.0]; 2]);
    }

    #[test]
    fn verified_ordinary_and_linear_bone_bases_are_distinct() {
        let mut bytes = vec![0u8; 800];
        bytes[..4].copy_from_slice(b"IDST");
        bytes[4..8].copy_from_slice(&48i32.to_le_bytes());
        bytes[12..20].copy_from_slice(b"fixture\0");
        bytes[76..80].copy_from_slice(&800i32.to_le_bytes());
        bytes[156..160].copy_from_slice(&1i32.to_le_bytes());
        bytes[160..164].copy_from_slice(&408i32.to_le_bytes());
        bytes[408..412].copy_from_slice(&216i32.to_le_bytes());
        bytes[412..416].copy_from_slice(&(-1i32).to_le_bytes());
        bytes[624..629].copy_from_slice(b"root\0");
        bytes[440..444].copy_from_slice(&10f32.to_le_bytes());
        bytes[480..484].copy_from_slice(&0.5f32.to_le_bytes());
        let bone = parse_stock_bone_mdl(&bytes).unwrap();
        let ordinary = parse_bone_position_bases(&bytes, &bone).unwrap();
        assert_eq!(ordinary[0].base[0], 10.0);
        assert_eq!(ordinary[0].scale[0], 0.5);

        bytes[400..404].copy_from_slice(&640i32.to_le_bytes());
        bytes[656..660].copy_from_slice(&64i32.to_le_bytes());
        bytes[704..708].copy_from_slice(&1i32.to_le_bytes());
        bytes[716..720].copy_from_slice(&64i32.to_le_bytes());
        bytes[732..736].copy_from_slice(&76i32.to_le_bytes());
        bytes[768..772].copy_from_slice(&25f32.to_le_bytes());
        bytes[780..784].copy_from_slice(&2f32.to_le_bytes());
        assert!(parse_bone_position_bases(&bytes, &bone).is_err());
        let bone = parse_stock_bone_mdl(&bytes).unwrap();
        let linear = parse_bone_position_bases(&bytes, &bone).unwrap();
        assert_eq!(linear[0].base[0], 25.0);
        assert_eq!(linear[0].scale[0], 2.0);
    }
}
