//! Bounded reader for Source's constant raw bone rotations.
//!
//! This interprets the `Quaternion48` and `Quaternion64` fields of a verified
//! local animation record. Animated angle channels, section interpolation,
//! bone weights, and model writes remain separate builder work.

use crate::viewmodel_pose_values::{
    decode_anim_values, i32_at, local_offset, vector3_at, verified_bone_tables,
};
use crate::viewmodel_source::{StockBoneModel, StockSourceError};

const BONE_DESC_BYTES: usize = 216;
const BONE_FIXED_ALIGNMENT: i32 = 0x0010_0000;

#[derive(Debug, Clone, PartialEq)]
pub struct BoneRotationBasis {
    pub base_quaternion: [f32; 4],
    pub base_angles: [f32; 3],
    pub scale: [f32; 3],
    pub alignment: [f32; 4],
    pub fixed_alignment: bool,
}

fn invalid(message: &str) -> StockSourceError {
    StockSourceError(message.into())
}

fn quaternion_at(bytes: &[u8], offset: usize, name: &str) -> Result<[f32; 4], StockSourceError> {
    let value = bytes
        .get(offset..offset.saturating_add(16))
        .ok_or_else(|| StockSourceError(format!("{name} extends outside the MDL")))?;
    let mut quaternion = [0.0; 4];
    for (axis, component) in quaternion.iter_mut().enumerate() {
        let at = axis * 4;
        *component = f32::from_le_bytes(value[at..at + 4].try_into().unwrap());
        if !component.is_finite() {
            return Err(StockSourceError(format!("{name} is not finite")));
        }
    }
    Ok(quaternion)
}

/// Extract rotation bases from the verified ordinary or linear-bone table of
/// an installed class MDL. The caller must use these with the same MDL bytes
/// and animation index; no game bytes are copied into the output.
pub fn parse_bone_rotation_bases(
    bytes: &[u8],
    bone_model: &StockBoneModel,
) -> Result<Vec<BoneRotationBasis>, StockSourceError> {
    let tables = verified_bone_tables(bytes, bone_model)?;
    let mut bases = Vec::with_capacity(bone_model.bones.len());
    for bone in 0..bone_model.bones.len() {
        let (quat, rot, scale, alignment, flags) = if let Some(table) = tables.linear {
            let column =
                |at: usize, name: &str| local_offset(table, i32_at(bytes, table + at, name)?, name);
            (
                column(16, "linear quaternions")? + bone * 16,
                column(20, "linear rotations")? + bone * 12,
                column(32, "linear rotation scales")? + bone * 12,
                column(36, "linear alignments")? + bone * 16,
                column(4, "linear flags")? + bone * 4,
            )
        } else {
            let entry = tables.ordinary + bone * BONE_DESC_BYTES;
            (entry + 44, entry + 60, entry + 84, entry + 144, entry + 160)
        };
        bases.push(BoneRotationBasis {
            base_quaternion: quaternion_at(bytes, quat, "bone base quaternion")?,
            base_angles: vector3_at(bytes, rot, "bone base rotation")?,
            scale: vector3_at(bytes, scale, "bone rotation scale")?,
            alignment: quaternion_at(bytes, alignment, "bone alignment")?,
            fixed_alignment: i32_at(bytes, flags, "bone flags")? & BONE_FIXED_ALIGNMENT != 0,
        });
    }
    Ok(bases)
}

fn complete_quaternion(
    x: f32,
    y: f32,
    z: f32,
    negative_w: bool,
) -> Result<[f32; 4], StockSourceError> {
    let square = 1.0 - x * x - y * y - z * z;
    if !square.is_finite() || square < 0.0 {
        return Err(invalid(
            "raw rotation does not encode a real unit quaternion",
        ));
    }
    let w = square.sqrt() * if negative_w { -1.0 } else { 1.0 };
    Ok([x, y, z, w])
}

/// Decode a little-endian Source `Quaternion48` as a whole-frame local rotation.
/// The stored high bit of z is the sign of the reconstructed w component.
pub fn decode_quaternion48(bytes: &[u8]) -> Result<[f32; 4], StockSourceError> {
    let value: [u8; 6] = bytes
        .try_into()
        .map_err(|_| invalid("Quaternion48 requires exactly six bytes"))?;
    let x = f32::from(u16::from_le_bytes([value[0], value[1]])) / 32768.0 - 1.0;
    let y = f32::from(u16::from_le_bytes([value[2], value[3]])) / 32768.0 - 1.0;
    let z_bits = u16::from_le_bytes([value[4], value[5]]);
    let z = f32::from(z_bits & 0x7fff) / 16384.0 - 1.0;
    complete_quaternion(x, y, z, z_bits & 0x8000 != 0)
}

/// Decode a little-endian Source `Quaternion64`. Each signed component uses
/// 21 low-order bits; bit 63 stores the sign of the reconstructed w component.
pub fn decode_quaternion64(bytes: &[u8]) -> Result<[f32; 4], StockSourceError> {
    let value: [u8; 8] = bytes
        .try_into()
        .map_err(|_| invalid("Quaternion64 requires exactly eight bytes"))?;
    let packed = u64::from_le_bytes(value);
    let component = |shift: u32| {
        let bits = ((packed >> shift) & 0x1f_ffff) as f32;
        (bits - 1_048_576.0) * (1.0 / 1_048_576.5)
    };
    complete_quaternion(
        component(0),
        component(21),
        component(42),
        packed & (1 << 63) != 0,
    )
}

/// Read a constant raw rotation from a bounded `mstudioanim_t` record.
/// A record using animated rotation channels is intentionally rejected.
pub fn decode_raw_rotation_record(record: &[u8]) -> Result<[f32; 4], StockSourceError> {
    let header = record
        .get(..4)
        .ok_or_else(|| invalid("bone record header is truncated"))?;
    let flags = header[1];
    let next = i16::from_le_bytes([header[2], header[3]]);
    if usize::try_from(next).ok() != Some(record.len()) {
        return Err(invalid("rotation bone record is not bounded by nextoffset"));
    }
    if flags & 0x08 != 0 || flags & 0x02 != 0 && flags & 0x20 != 0 {
        return Err(invalid("bone record has incompatible rotation encodings"));
    }
    if flags & 0x02 != 0 {
        decode_quaternion48(
            record
                .get(4..10)
                .ok_or_else(|| invalid("raw Quaternion48 is truncated"))?,
        )
    } else if flags & 0x20 != 0 {
        decode_quaternion64(
            record
                .get(4..12)
                .ok_or_else(|| invalid("raw Quaternion64 is truncated"))?,
        )
    } else {
        Err(invalid("bone record has no raw rotation"))
    }
}

/// Fixed byte count for a terminal raw-rotation record. Source's raw
/// quaternion and optional raw position have fixed sizes, so a zero
/// `nextoffset` does not prevent reading those values. Animated channels
/// still require separate bounds and are rejected here.
pub fn terminal_raw_rotation_len(flags: u8) -> Result<usize, StockSourceError> {
    if flags & !(0x01 | 0x02 | 0x10 | 0x20) != 0
        || flags & 0x02 != 0 && flags & 0x20 != 0
        || flags & 0x22 == 0
    {
        return Err(invalid("terminal record is not fixed-size raw rotation"));
    }
    Ok(4 + if flags & 0x02 != 0 { 6 } else { 8 } + if flags & 0x01 != 0 { 6 } else { 0 })
}

/// Decode a terminal record supplied at its exact fixed size. The caller
/// must have verified its MDL and bone-chain start before taking this slice.
pub fn decode_terminal_raw_rotation_record(record: &[u8]) -> Result<[f32; 4], StockSourceError> {
    let header = record
        .get(..4)
        .ok_or_else(|| invalid("terminal bone record header is truncated"))?;
    if header[2] != 0 || header[3] != 0 || record.len() != terminal_raw_rotation_len(header[1])? {
        return Err(invalid(
            "terminal raw rotation size or nextoffset is invalid",
        ));
    }
    if header[1] & 0x02 != 0 {
        decode_quaternion48(&record[4..10])
    } else {
        decode_quaternion64(&record[4..12])
    }
}

/// Expand whole-frame integer samples from a bounded animated-rotation record.
/// A zero axis pointer contributes zero. Bone rotation scales and base angles
/// are applied by a later pose step; this returns only the stored channels.
pub fn decode_animated_rotation_samples(
    record: &[u8],
    frame_count: u16,
) -> Result<Vec<[i16; 3]>, StockSourceError> {
    if frame_count == 0 {
        return Err(invalid("animated rotation has no frames"));
    }
    let header = record
        .get(..4)
        .ok_or_else(|| invalid("animated rotation header is truncated"))?;
    let flags = header[1];
    let next = i16::from_le_bytes([header[2], header[3]]);
    if usize::try_from(next).ok() != Some(record.len()) {
        return Err(invalid("animated rotation is not bounded by nextoffset"));
    }
    if flags & 0x08 == 0 || flags & 0x22 != 0 || flags & !(0x01 | 0x04 | 0x08 | 0x10) != 0 {
        return Err(invalid("bone record has incompatible rotation encodings"));
    }
    let pointer_end = 10 + if flags & 0x04 != 0 { 6 } else { 0 };
    let pointers = record
        .get(4..10)
        .ok_or_else(|| invalid("animated rotation pointers are truncated"))?;
    if record.len() < pointer_end {
        return Err(invalid("animated rotation overlaps position pointers"));
    }
    let mut frames = vec![[0; 3]; usize::from(frame_count)];
    for axis in 0..3 {
        let offset = i16::from_le_bytes([pointers[axis * 2], pointers[axis * 2 + 1]]);
        if offset == 0 {
            continue;
        }
        let start = usize::try_from(offset)
            .ok()
            .and_then(|offset| 4usize.checked_add(offset))
            .filter(|start| *start >= pointer_end && *start < record.len())
            .ok_or_else(|| invalid("animated rotation axis pointer is invalid"))?;
        let decoded = decode_anim_values(&record[start..], frame_count)?;
        for (frame, sample) in decoded.samples.into_iter().enumerate() {
            frames[frame][axis] = sample;
        }
    }
    Ok(frames)
}

/// Convert Source's right-handed radian Euler angles into a local quaternion.
/// The axes are X, Y, Z in that order; this is distinct from engine QAngle.
pub fn radian_euler_quaternion(angles: [f32; 3]) -> Result<[f32; 4], StockSourceError> {
    if !angles.iter().all(|value| value.is_finite()) {
        return Err(invalid("rotation angles are not finite"));
    }
    let (sr, cr) = (angles[0] * 0.5).sin_cos();
    let (sp, cp) = (angles[1] * 0.5).sin_cos();
    let (sy, cy) = (angles[2] * 0.5).sin_cos();
    let sr_cp = sr * cp;
    let cr_sp = cr * sp;
    let cr_cp = cr * cp;
    let sr_sp = sr * sp;
    Ok([
        sr_cp * cy - cr_sp * sy,
        cr_sp * cy + sr_cp * sy,
        cr_cp * sy - sr_sp * cy,
        cr_cp * cy + sr_sp * sy,
    ])
}

/// Apply a verified bone's base radian angles and rotation scale to bounded
/// animated integer samples. `alignment`, when supplied for a bone with
/// `BONE_FIXED_ALIGNMENT`, chooses the equivalent quaternion sign closest to
/// that stored orientation. Delta records ignore both base and alignment.
pub fn decode_animated_rotation_frames(
    record: &[u8],
    frame_count: u16,
    base_angles: [f32; 3],
    rotation_scale: [f32; 3],
    alignment: Option<[f32; 4]>,
) -> Result<Vec<[f32; 4]>, StockSourceError> {
    if !base_angles
        .iter()
        .chain(&rotation_scale)
        .chain(alignment.iter().flatten())
        .all(|value| value.is_finite())
    {
        return Err(invalid("rotation basis contains a non-finite value"));
    }
    let delta = record.get(1).is_some_and(|flags| flags & 0x10 != 0);
    let samples = decode_animated_rotation_samples(record, frame_count)?;
    let mut frames = Vec::with_capacity(samples.len());
    for sample in samples {
        let mut angles = [0.0; 3];
        for axis in 0..3 {
            angles[axis] = f32::from(sample[axis]) * rotation_scale[axis]
                + if delta { 0.0 } else { base_angles[axis] };
        }
        let mut rotation = radian_euler_quaternion(angles)?;
        if let Some(alignment) = alignment.filter(|_| !delta) {
            let dot: f32 = alignment
                .iter()
                .zip(rotation)
                .map(|(reference, actual)| reference * actual)
                .sum();
            if dot < 0.0 {
                rotation
                    .iter_mut()
                    .for_each(|component| *component = -*component);
            }
        }
        frames.push(rotation);
    }
    Ok(frames)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::viewmodel_source::parse_stock_bone_mdl;

    #[test]
    fn verified_ordinary_and_linear_rotation_bases_are_distinct() {
        let mut bytes = vec![0u8; 900];
        bytes[..4].copy_from_slice(b"IDST");
        bytes[4..8].copy_from_slice(&48i32.to_le_bytes());
        bytes[12..20].copy_from_slice(b"fixture\0");
        bytes[76..80].copy_from_slice(&900i32.to_le_bytes());
        bytes[156..160].copy_from_slice(&1i32.to_le_bytes());
        bytes[160..164].copy_from_slice(&408i32.to_le_bytes());
        bytes[408..412].copy_from_slice(&216i32.to_le_bytes());
        bytes[412..416].copy_from_slice(&(-1i32).to_le_bytes());
        bytes[624..629].copy_from_slice(b"root\0");
        bytes[464..468].copy_from_slice(&1f32.to_le_bytes());
        bytes[468..472].copy_from_slice(&0.5f32.to_le_bytes());
        bytes[492..496].copy_from_slice(&0.25f32.to_le_bytes());
        bytes[564..568].copy_from_slice(&1f32.to_le_bytes());
        bytes[568..572].copy_from_slice(&BONE_FIXED_ALIGNMENT.to_le_bytes());
        let bone = parse_stock_bone_mdl(&bytes).unwrap();
        let ordinary = parse_bone_rotation_bases(&bytes, &bone).unwrap();
        assert_eq!(ordinary[0].base_quaternion, [0.0, 0.0, 0.0, 1.0]);
        assert_eq!(ordinary[0].base_angles[0], 0.5);
        assert_eq!(ordinary[0].scale[0], 0.25);
        assert!(ordinary[0].fixed_alignment);

        bytes[400..404].copy_from_slice(&640i32.to_le_bytes());
        bytes[656..660].copy_from_slice(&64i32.to_le_bytes());
        bytes[704..708].copy_from_slice(&1i32.to_le_bytes());
        for (field, offset) in [(708, 96i32), (720, 100), (724, 116), (736, 128), (740, 140)] {
            bytes[field..field + 4].copy_from_slice(&offset.to_le_bytes());
        }
        bytes[816..820].copy_from_slice(&1f32.to_le_bytes());
        bytes[820..824].copy_from_slice(&1.5f32.to_le_bytes());
        bytes[832..836].copy_from_slice(&2f32.to_le_bytes());
        bytes[856..860].copy_from_slice(&1f32.to_le_bytes());
        let bone = parse_stock_bone_mdl(&bytes).unwrap();
        let linear = parse_bone_rotation_bases(&bytes, &bone).unwrap();
        assert_eq!(linear[0].base_quaternion, [0.0, 0.0, 0.0, 1.0]);
        assert_eq!(linear[0].base_angles[0], 1.5);
        assert_eq!(linear[0].scale[0], 2.0);
        assert!(!linear[0].fixed_alignment);
    }

    #[test]
    fn quaternion48_center_and_negative_w() {
        assert_eq!(
            decode_quaternion48(&[0, 128, 0, 128, 0, 64]).unwrap(),
            [0.0, 0.0, 0.0, 1.0]
        );
        assert_eq!(
            decode_quaternion48(&[0, 128, 0, 128, 0, 192]).unwrap(),
            [0.0, 0.0, 0.0, -1.0]
        );
        assert!(decode_quaternion48(&[0; 6]).is_err());
        assert!(decode_quaternion48(&[0; 5]).is_err());
        let tilted = decode_quaternion48(&[0, 192, 0, 64, 0, 64]).unwrap();
        assert_eq!(tilted[..3], [0.5, -0.5, 0.0]);
        assert!((tilted[3] - 0.5_f32.sqrt()).abs() < 0.000_001);
    }

    #[test]
    fn quaternion64_packing_and_bounds() {
        let center = (1_048_576_u64 << 42) | (1_048_576_u64 << 21) | 1_048_576;
        assert_eq!(
            decode_quaternion64(&center.to_le_bytes()).unwrap(),
            [0.0, 0.0, 0.0, 1.0]
        );
        assert_eq!(
            decode_quaternion64(&(center | 1 << 63).to_le_bytes()).unwrap(),
            [0.0, 0.0, 0.0, -1.0]
        );
        assert!(decode_quaternion64(&[0; 8]).is_err());
        assert!(decode_quaternion64(&[0; 7]).is_err());
        let tilted = (1_048_576_u64 << 42) | (524_288_u64 << 21) | 1_572_864;
        let tilted = decode_quaternion64(&tilted.to_le_bytes()).unwrap();
        assert!((tilted[0] - 0.5).abs() < 0.000_001);
        assert!((tilted[1] + 0.5).abs() < 0.000_001);
        assert_eq!(tilted[2], 0.0);
    }

    #[test]
    fn raw_record_requires_matching_bound_and_unambiguous_flags() {
        let mut raw = vec![0, 0x20, 12, 0];
        let center = (1_048_576_u64 << 42) | (1_048_576_u64 << 21) | 1_048_576;
        raw.extend_from_slice(&center.to_le_bytes());
        assert_eq!(
            decode_raw_rotation_record(&raw).unwrap(),
            [0.0, 0.0, 0.0, 1.0]
        );
        raw[1] = 0x28;
        assert!(decode_raw_rotation_record(&raw).is_err());
        raw[1] = 0x22;
        assert!(decode_raw_rotation_record(&raw).is_err());
        raw[1] = 0x20;
        raw[2] = 0;
        assert!(decode_raw_rotation_record(&raw).is_err());
        assert_eq!(
            decode_terminal_raw_rotation_record(&raw).unwrap(),
            [0.0, 0.0, 0.0, 1.0]
        );
        assert_eq!(terminal_raw_rotation_len(0x21).unwrap(), 18);
        assert!(terminal_raw_rotation_len(0x28).is_err());
        assert!(decode_terminal_raw_rotation_record(&raw[..11]).is_err());
    }

    #[test]
    fn animated_axes_expand_independent_runs_after_position_pointers() {
        let mut record = [0u8; 24];
        record[..4].copy_from_slice(&[3, 0x0c, 24, 0]);
        record[4..10].copy_from_slice(&[12, 0, 0, 0, 16, 0]);
        record[16..20].copy_from_slice(&[1, 3, 5, 0]);
        record[20..24].copy_from_slice(&[1, 3, 251, 255]);
        assert_eq!(
            decode_animated_rotation_samples(&record, 3).unwrap(),
            [[5, 0, -5]; 3]
        );
        record[4] = 4;
        assert!(decode_animated_rotation_samples(&record, 3).is_err());
        record[4] = 12;
        record[1] |= 0x20;
        assert!(decode_animated_rotation_samples(&record, 3).is_err());
        record[1] = 0x0c;
        record[2] = 0;
        assert!(decode_animated_rotation_samples(&record, 3).is_err());
    }

    #[test]
    fn animated_frames_apply_base_scale_delta_and_fixed_alignment() {
        let record = [0, 0x08, 14, 0, 6, 0, 0, 0, 0, 0, 1, 2, 1, 0];
        let half_pi = std::f32::consts::FRAC_PI_2;
        let frames = decode_animated_rotation_frames(
            &record,
            2,
            [half_pi, 0.0, 0.0],
            [half_pi, 1.0, 1.0],
            Some([-1.0, 0.0, 0.0, 0.0]),
        )
        .unwrap();
        assert!(frames[0][0] < -0.999_999);
        assert!(frames[0][3].abs() < 0.000_001);
        assert_eq!(frames[0], frames[1]);
        let mut delta_record = record;
        delta_record[1] |= 0x10;
        let delta = decode_animated_rotation_frames(
            &delta_record,
            2,
            [half_pi, 0.0, 0.0],
            [half_pi, 1.0, 1.0],
            Some([-1.0, 0.0, 0.0, 0.0]),
        )
        .unwrap();
        assert!((delta[0][0] - half_pi.sin()).abs() > 0.1);
        assert!(delta[0][0] > 0.7);
        assert!(delta[0][3] > 0.7);
    }
}
