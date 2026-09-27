//! Verified Source sequence bone weights for Viewmodels hide preflight.
//!
//! A replacement animation record affects a bone only when its referencing
//! sequence gives that bone nonzero weight. The stock animation/bone indexes
//! and this table must all describe the same installed MDL bytes.

use crate::hash::sha256_hex;
use crate::viewmodel_source::{StockAnimationModel, StockBoneModel, StockSourceError};

const SEQUENCE_DESC_BYTES: usize = 212;
const HEADER_BYTES: usize = 408;

#[derive(Debug, Clone, PartialEq)]
pub struct SequenceBoneWeights {
    pub label: String,
    pub weights: Vec<f32>,
}

fn invalid(message: impl Into<String>) -> StockSourceError {
    StockSourceError(message.into())
}

fn i32_at(bytes: &[u8], at: usize, field: &str) -> Result<i32, StockSourceError> {
    let value = bytes
        .get(at..at.saturating_add(4))
        .ok_or_else(|| invalid(format!("{field} extends outside the MDL")))?;
    Ok(i32::from_le_bytes(value.try_into().unwrap()))
}

/// Read one weight per verified bone for each local sequence, preserving
/// sequence-table order so callers can join the existing blend indexes.
pub fn read_sequence_bone_weights_mdl(
    bytes: &[u8],
    animation_model: &StockAnimationModel,
    bone_model: &StockBoneModel,
) -> Result<Vec<SequenceBoneWeights>, StockSourceError> {
    if bytes.len() < HEADER_BYTES
        || bytes.len() > 8 * 1024 * 1024
        || &bytes[..4] != b"IDST"
        || i32_at(bytes, 4, "MDL version")? != 48
        || i32_at(bytes, 76, "MDL length")? != bytes.len() as i32
    {
        return Err(invalid("sequence weights require a bounded Source MDL v48"));
    }
    let sha256 = sha256_hex(bytes);
    if sha256 != animation_model.sha256
        || sha256 != bone_model.sha256
        || animation_model.model_name != bone_model.model_name
        || animation_model.sequences.is_empty()
        || bone_model.bones.is_empty()
        || bone_model.bones.len() > 128
        || usize::try_from(i32_at(bytes, 156, "bone count")?).ok() != Some(bone_model.bones.len())
        || usize::try_from(i32_at(bytes, 188, "sequence count")?).ok()
            != Some(animation_model.sequences.len())
    {
        return Err(invalid(
            "sequence weights differ from the verified MDL indexes",
        ));
    }
    let table = usize::try_from(i32_at(bytes, 192, "sequence table")?)
        .ok()
        .filter(|table| *table >= HEADER_BYTES && table.is_multiple_of(4))
        .ok_or_else(|| invalid("sequence table offset is invalid"))?;
    let table_size = animation_model
        .sequences
        .len()
        .checked_mul(SEQUENCE_DESC_BYTES)
        .ok_or_else(|| invalid("sequence table size overflows"))?;
    bytes
        .get(table..table.saturating_add(table_size))
        .ok_or_else(|| invalid("sequence table extends outside the MDL"))?;
    let mut sequences = Vec::with_capacity(animation_model.sequences.len());
    for (index, sequence) in animation_model.sequences.iter().enumerate() {
        let base = table + index * SEQUENCE_DESC_BYTES;
        if i32_at(bytes, base, "sequence baseptr")? != -(base as i32) {
            return Err(invalid(
                "sequence descriptor does not point to the MDL header",
            ));
        }
        let relative = usize::try_from(i32_at(bytes, base + 156, "weight list")?)
            .ok()
            .filter(|offset| *offset > 0)
            .ok_or_else(|| invalid("sequence weight-list offset is invalid"))?;
        let start = base
            .checked_add(relative)
            .ok_or_else(|| invalid("sequence weight-list offset overflows"))?;
        let count_bytes = bone_model.bones.len() * 4;
        let raw = bytes
            .get(start..start.saturating_add(count_bytes))
            .ok_or_else(|| invalid("sequence weight list extends outside the MDL"))?;
        let mut weights = Vec::with_capacity(bone_model.bones.len());
        for raw_weight in raw.as_chunks::<4>().0 {
            let weight = f32::from_le_bytes(*raw_weight);
            if !(0.0..=1.0).contains(&weight) {
                return Err(invalid(format!(
                    "sequence {} has an invalid bone weight",
                    sequence.label
                )));
            }
            weights.push(weight);
        }
        sequences.push(SequenceBoneWeights {
            label: sequence.label.clone(),
            weights,
        });
    }
    Ok(sequences)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::viewmodel_source::{StockBone, StockSequence};

    fn write_i32(bytes: &mut [u8], at: usize, value: i32) {
        bytes[at..at + 4].copy_from_slice(&value.to_le_bytes());
    }

    fn fixture() -> (Vec<u8>, StockAnimationModel, StockBoneModel) {
        let sequence = HEADER_BYTES;
        let weights = sequence + SEQUENCE_DESC_BYTES;
        let mut bytes = vec![0; weights + 8];
        bytes[..4].copy_from_slice(b"IDST");
        write_i32(&mut bytes, 4, 48);
        write_i32(&mut bytes, 76, (weights + 8) as i32);
        write_i32(&mut bytes, 156, 2);
        write_i32(&mut bytes, 188, 1);
        write_i32(&mut bytes, 192, sequence as i32);
        write_i32(&mut bytes, sequence, -(sequence as i32));
        write_i32(&mut bytes, sequence + 156, (weights - sequence) as i32);
        bytes[weights..weights + 4].copy_from_slice(&1.0f32.to_le_bytes());
        bytes[weights + 4..weights + 8].copy_from_slice(&0.0f32.to_le_bytes());
        let sha256 = sha256_hex(&bytes);
        let animation_model = StockAnimationModel {
            model_name: "fixture".into(),
            sha256: sha256.clone(),
            animations: Vec::new(),
            sequences: vec![StockSequence {
                label: "draw".into(),
                activity: None,
                animation_indexes: Vec::new(),
            }],
        };
        let bone_model = StockBoneModel {
            model_name: "fixture".into(),
            sha256,
            bones: vec![
                StockBone {
                    name: "root".into(),
                    parent: None,
                },
                StockBone {
                    name: "weapon_bone".into(),
                    parent: Some(0),
                },
            ],
        };
        (bytes, animation_model, bone_model)
    }

    #[test]
    fn preserves_zero_and_nonzero_bone_weights_by_sequence() {
        let (bytes, animations, bones) = fixture();
        assert_eq!(
            read_sequence_bone_weights_mdl(&bytes, &animations, &bones).unwrap(),
            [SequenceBoneWeights {
                label: "draw".into(),
                weights: vec![1.0, 0.0],
            }]
        );
    }

    #[test]
    fn refuses_changed_or_invalid_weight_tables() {
        let (bytes, animations, bones) = fixture();
        let mut changed = bytes.clone();
        let last = changed.len() - 1;
        changed[last] ^= 1;
        assert!(read_sequence_bone_weights_mdl(&changed, &animations, &bones).is_err());
        let mut invalid = bytes.clone();
        invalid[last - 3..last + 1].copy_from_slice(&f32::NAN.to_le_bytes());
        let mut matching_animations = animations.clone();
        let mut matching_bones = bones.clone();
        matching_animations.sha256 = sha256_hex(&invalid);
        matching_bones.sha256 = matching_animations.sha256.clone();
        assert!(
            read_sequence_bone_weights_mdl(&invalid, &matching_animations, &matching_bones)
                .unwrap_err()
                .0
                .contains("invalid bone weight")
        );
        write_i32(&mut invalid, HEADER_BYTES + 156, i32::MAX);
        matching_animations.sha256 = sha256_hex(&invalid);
        matching_bones.sha256 = matching_animations.sha256.clone();
        assert!(
            read_sequence_bone_weights_mdl(&invalid, &matching_animations, &matching_bones)
                .is_err()
        );
    }
}
