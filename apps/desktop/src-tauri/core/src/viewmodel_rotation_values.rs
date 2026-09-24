//! Bounded reader for Source's constant raw bone rotations.
//!
//! This interprets the `Quaternion48` and `Quaternion64` fields of a verified
//! local animation record. Animated angle channels, section interpolation,
//! bone weights, and model writes remain separate builder work.

use crate::viewmodel_source::StockSourceError;

fn invalid(message: &str) -> StockSourceError {
    StockSourceError(message.into())
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

#[cfg(test)]
mod tests {
    use super::*;

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
}
