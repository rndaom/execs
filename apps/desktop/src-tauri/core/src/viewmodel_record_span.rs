//! Infer the bytes actually read by a terminal Source bone record.
//!
//! `mstudioanim_t.nextoffset = 0` terminates a chain, so it does not state a
//! payload length. Fixed raw values and self-delimiting animated value runs
//! provide a minimum span. This is read-only evidence for a later writer; it
//! does not certify that unrelated trailing bytes may be overwritten.

use crate::viewmodel_pose_values::decode_anim_values;
use crate::viewmodel_source::StockSourceError;

const RAWPOS: u8 = 0x01;
const RAWROT: u8 = 0x02;
const ANIMPOS: u8 = 0x04;
const ANIMROT: u8 = 0x08;
const DELTA: u8 = 0x10;
const RAWROT2: u8 = 0x20;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct TerminalRecordSpan {
    /// Smallest complete span containing every declared value channel.
    pub used_bytes: usize,
    pub decoded_channels: usize,
}

fn invalid(message: impl Into<String>) -> StockSourceError {
    StockSourceError(message.into())
}

fn animated_channels(
    record: &[u8],
    pointer_base: usize,
    pointer_end: usize,
    frame_count: u16,
) -> Result<(usize, usize), StockSourceError> {
    let pointers = record
        .get(pointer_base..pointer_base + 6)
        .ok_or_else(|| invalid("terminal animated value pointers are truncated"))?;
    let mut used = pointer_end;
    let mut channels = 0;
    for axis in 0..3 {
        let offset = i16::from_le_bytes([pointers[axis * 2], pointers[axis * 2 + 1]]);
        if offset == 0 {
            continue;
        }
        let start = usize::try_from(offset)
            .ok()
            .and_then(|offset| pointer_base.checked_add(offset))
            .filter(|start| *start >= pointer_end && *start < record.len())
            .ok_or_else(|| invalid("terminal animated value offset is invalid"))?;
        let decoded = decode_anim_values(&record[start..], frame_count)?;
        used = used.max(start + decoded.consumed_bytes);
        channels += 1;
    }
    Ok((used, channels))
}

/// Infer a terminal record's minimum payload span from Source's fixed raw
/// layouts and animated run counts. The caller must have verified the MDL,
/// local animation, section and bone-chain start. `record` may extend to the
/// end of that MDL; only `used_bytes` belongs to this record by inference.
pub fn infer_terminal_record_span(
    record: &[u8],
    frame_count: u16,
) -> Result<TerminalRecordSpan, StockSourceError> {
    let header = record
        .get(..4)
        .ok_or_else(|| invalid("terminal bone header is truncated"))?;
    if frame_count == 0 || header[2] != 0 || header[3] != 0 {
        return Err(invalid("terminal bone frames or nextoffset are invalid"));
    }
    let flags = header[1];
    if header[0] == 255 {
        return if flags == 0 {
            Ok(TerminalRecordSpan {
                used_bytes: 4,
                decoded_channels: 0,
            })
        } else {
            Err(invalid("animation end marker has a payload"))
        };
    }
    if flags & !(RAWPOS | RAWROT | ANIMPOS | ANIMROT | DELTA | RAWROT2) != 0
        || flags & RAWPOS != 0 && flags & ANIMPOS != 0
        || flags & RAWROT != 0 && flags & RAWROT2 != 0
        || flags & (RAWROT | RAWROT2) != 0 && flags & ANIMROT != 0
        || flags & (RAWPOS | RAWROT | RAWROT2) != 0 && flags & (ANIMPOS | ANIMROT) != 0
    {
        return Err(invalid(
            "terminal bone has conflicting or unknown encodings",
        ));
    }
    let mut used = 4usize;
    let mut channels = 0usize;
    if flags & (ANIMPOS | ANIMROT) != 0 {
        let pointer_end =
            4 + if flags & ANIMROT != 0 { 6 } else { 0 } + if flags & ANIMPOS != 0 { 6 } else { 0 };
        record
            .get(..pointer_end)
            .ok_or_else(|| invalid("terminal animated pointer table is truncated"))?;
        used = pointer_end;
        if flags & ANIMROT != 0 {
            let (end, count) = animated_channels(record, 4, pointer_end, frame_count)?;
            used = used.max(end);
            channels += count;
        }
        if flags & ANIMPOS != 0 {
            let base = 4 + if flags & ANIMROT != 0 { 6 } else { 0 };
            let (end, count) = animated_channels(record, base, pointer_end, frame_count)?;
            used = used.max(end);
            channels += count;
        }
    } else {
        used += if flags & RAWROT != 0 { 6 } else { 0 };
        used += if flags & RAWROT2 != 0 { 8 } else { 0 };
        used += if flags & RAWPOS != 0 { 6 } else { 0 };
        record
            .get(..used)
            .ok_or_else(|| invalid("terminal fixed payload is truncated"))?;
    }
    if used > i16::MAX as usize || !used.is_multiple_of(2) {
        return Err(invalid(
            "terminal record span cannot become a bone nextoffset",
        ));
    }
    Ok(TerminalRecordSpan {
        used_bytes: used,
        decoded_channels: channels,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn measures_fixed_and_empty_terminal_records() {
        assert_eq!(
            infer_terminal_record_span(
                &[
                    0,
                    RAWPOS | RAWROT2,
                    0,
                    0,
                    0,
                    0,
                    0,
                    0,
                    0,
                    0,
                    0,
                    0,
                    0,
                    0,
                    0,
                    0,
                    0,
                    0
                ],
                2
            )
            .unwrap()
            .used_bytes,
            18
        );
        assert_eq!(
            infer_terminal_record_span(&[0, 0, 0, 0], 1)
                .unwrap()
                .used_bytes,
            4
        );
        assert_eq!(
            infer_terminal_record_span(&[255, 0, 0, 0], 1)
                .unwrap()
                .used_bytes,
            4
        );
        assert!(infer_terminal_record_span(&[0, RAWPOS, 0, 0, 0, 0], 1).is_err());
    }

    #[test]
    fn measures_self_delimiting_rotation_and_position_runs() {
        let record = [
            1,
            ANIMROT | ANIMPOS,
            0,
            0, // terminal header
            12,
            0,
            0,
            0,
            0,
            0, // rotation x starts at 16
            0,
            0,
            0,
            0,
            10,
            0, // position z starts at 20
            1,
            3,
            10,
            0, // rotation x repeats across three frames
            1,
            3,
            20,
            0, // position z repeats across three frames
            0xaa,
            0xbb, // unrelated bytes after the complete record
        ];
        assert_eq!(
            infer_terminal_record_span(&record, 3).unwrap(),
            TerminalRecordSpan {
                used_bytes: 24,
                decoded_channels: 2,
            }
        );
        let mut invalid_offset = record;
        invalid_offset[4] = 1;
        assert!(infer_terminal_record_span(&invalid_offset, 3).is_err());
        assert!(infer_terminal_record_span(&record[..22], 3).is_err());
    }

    #[test]
    fn refuses_ambiguous_terminal_layouts_and_bad_frame_counts() {
        assert!(infer_terminal_record_span(&[0, RAWPOS | ANIMPOS, 0, 0], 1).is_err());
        assert!(infer_terminal_record_span(&[0, RAWROT | RAWROT2, 0, 0], 1).is_err());
        assert!(infer_terminal_record_span(&[0, 0x80, 0, 0], 1).is_err());
        assert!(infer_terminal_record_span(&[0, 0, 0, 0], 0).is_err());
        assert!(infer_terminal_record_span(&[0, 0, 4, 0], 1).is_err());
    }
}
