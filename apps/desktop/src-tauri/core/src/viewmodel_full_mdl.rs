//! In-memory prototype for a locally derived Full-hide Viewmodels model.
//!
//! Source stores local animation bone chains at offsets relative to each
//! animation descriptor. This appends replacement chains and changes only the
//! selected descriptors' pointers. It never writes to the TF2 install. Engine
//! acceptance and visual behavior still need retail verification before use.

use std::collections::{BTreeMap, BTreeSet};

use crate::viewmodel_pose::parse_stock_pose_mdl;
use crate::viewmodel_source::{
    parse_stock_animation_mdl, parse_stock_bone_mdl, StockAnimationModel, StockBoneModel,
    StockSourceError,
};

const MAX_MDL_BYTES: usize = 8 * 1024 * 1024;
const ANIM_DESC_BYTES: usize = 100;
const FULL_HIDE_POSITION: [u8; 6] = [0x40, 0xd6, 0x40, 0xd6, 0x40, 0xd6]; // Vector48(-100,-100,-100)

fn invalid(message: impl Into<String>) -> StockSourceError {
    StockSourceError(message.into())
}

fn i32_at(bytes: &[u8], offset: usize, field: &str) -> Result<i32, StockSourceError> {
    let value = bytes
        .get(offset..offset.saturating_add(4))
        .ok_or_else(|| invalid(format!("{field} extends outside the MDL")))?;
    Ok(i32::from_le_bytes(value.try_into().unwrap()))
}

fn patch_i32(bytes: &mut [u8], offset: usize, value: i32) -> Result<(), StockSourceError> {
    let destination = bytes
        .get_mut(offset..offset.saturating_add(4))
        .ok_or_else(|| invalid("animation pointer extends outside the MDL"))?;
    destination.copy_from_slice(&value.to_le_bytes());
    Ok(())
}

fn append_full_hide_chain(
    bytes: &mut Vec<u8>,
    bone_count: usize,
) -> Result<usize, StockSourceError> {
    let chain_bytes = bone_count
        .checked_mul(10)
        .ok_or_else(|| invalid("full-hide bone chain size overflows"))?;
    if bone_count == 0
        || bone_count > 128
        || bytes.len().saturating_add(chain_bytes) > MAX_MDL_BYTES
    {
        return Err(invalid("full-hide bone chain exceeds the model limit"));
    }
    let start = bytes.len();
    for bone in 0..bone_count {
        bytes.push(bone as u8);
        bytes.push(0x01); // STUDIO_ANIM_RAWPOS
        bytes.extend_from_slice(&(if bone + 1 == bone_count { 0i16 } else { 10i16 }).to_le_bytes());
        bytes.extend_from_slice(&FULL_HIDE_POSITION);
    }
    Ok(start)
}

/// Construct a candidate MDL using only the caller's verified installed
/// model bytes. Unknown names, special/external animations, or mismatched
/// indexes fail before an output is returned. No asset bytes are bundled.
pub fn prototype_full_hide_mdl(
    original: &[u8],
    animation_model: &StockAnimationModel,
    bone_model: &StockBoneModel,
    hidden_animations: &BTreeSet<String>,
) -> Result<Vec<u8>, StockSourceError> {
    let pose = parse_stock_pose_mdl(original, animation_model, bone_model)?;
    if bone_model.bones.len() > 128
        || bone_model
            .bones
            .iter()
            .skip(1)
            .any(|bone| bone.parent.is_none())
    {
        return Err(invalid("full-hide model has more than one root bone"));
    }
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
        let animation = &pose.animations[index];
        if animation.unsupported_reason.is_some() || animation.section_count == 0 {
            return Err(invalid(format!(
                "local animation {name} uses an unsupported source path"
            )));
        }
        let base = table
            .checked_add(index * ANIM_DESC_BYTES)
            .ok_or_else(|| invalid("animation descriptor offset overflows"))?;
        let section_frames = i32_at(original, base + 84, "section frames")?;
        if section_frames == 0 {
            let chain = append_full_hide_chain(&mut output, bone_model.bones.len())?;
            let pointer = i32::try_from(chain - base)
                .map_err(|_| invalid("local animation pointer exceeds i32"))?;
            patch_i32(&mut output, base + 56, pointer)?;
        } else {
            let section_offset = usize::try_from(i32_at(original, base + 80, "section table")?)
                .ok()
                .filter(|offset| *offset > 0)
                .ok_or_else(|| invalid("animation section table is invalid"))?;
            let section_table = base
                .checked_add(section_offset)
                .ok_or_else(|| invalid("animation section table overflows"))?;
            for section in 0..animation.section_count {
                let entry = section_table
                    .checked_add(section * 8)
                    .ok_or_else(|| invalid("animation section entry overflows"))?;
                if i32_at(original, entry, "section block")? != 0 {
                    return Err(invalid("animation section is external"));
                }
                let chain = append_full_hide_chain(&mut output, bone_model.bones.len())?;
                let pointer = i32::try_from(chain - base)
                    .map_err(|_| invalid("local animation section pointer exceeds i32"))?;
                patch_i32(&mut output, entry + 4, pointer)?;
            }
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
        if summary.bone_records != summary.section_count * bone_model.bones.len()
            || summary.root.raw != summary.section_count
        {
            return Err(invalid(format!(
                "candidate model did not replace every {name} section"
            )));
        }
    }
    Ok(output)
}

#[cfg(test)]
mod tests {
    use super::*;

    const HEADER: usize = 408;
    const BONE: usize = 216;
    const SEQUENCE: usize = 212;

    fn write_i32(bytes: &mut [u8], at: usize, value: i32) {
        bytes[at..at + 4].copy_from_slice(&value.to_le_bytes());
    }

    fn append_name(bytes: &mut Vec<u8>, base: usize, name: &str) -> i32 {
        let offset = (bytes.len() - base) as i32;
        bytes.extend_from_slice(name.as_bytes());
        bytes.push(0);
        offset
    }

    fn fixture(sectioned: bool) -> Vec<u8> {
        let bone_table = HEADER;
        let animation_table = bone_table + 2 * BONE;
        let sequence = animation_table + 2 * ANIM_DESC_BYTES;
        let mut bytes = vec![0; sequence + SEQUENCE];
        bytes[..4].copy_from_slice(b"IDST");
        bytes[12..19].copy_from_slice(b"fixture");
        write_i32(&mut bytes, 4, 48);
        write_i32(&mut bytes, 156, 2);
        write_i32(&mut bytes, 160, bone_table as i32);
        write_i32(&mut bytes, 180, 2);
        write_i32(&mut bytes, 184, animation_table as i32);
        write_i32(&mut bytes, 188, 1);
        write_i32(&mut bytes, 192, sequence as i32);
        for (index, (name, parent)) in [("root", -1), ("weapon_bone", 0)].into_iter().enumerate() {
            let base = bone_table + index * BONE;
            let offset = append_name(&mut bytes, base, name);
            write_i32(&mut bytes, base, offset);
            write_i32(&mut bytes, base + 4, parent);
        }
        for (index, name) in ["@hide", "@keep"].into_iter().enumerate() {
            let base = animation_table + index * ANIM_DESC_BYTES;
            let offset = append_name(&mut bytes, base, name);
            write_i32(&mut bytes, base, -(base as i32));
            write_i32(&mut bytes, base + 4, offset);
            bytes[base + 8..base + 12].copy_from_slice(&30f32.to_le_bytes());
            write_i32(&mut bytes, base + 16, 3);
        }
        write_i32(&mut bytes, sequence, -(sequence as i32));
        let seq_name = append_name(&mut bytes, sequence, "draw");
        let seq_activity = append_name(&mut bytes, sequence, "ACT_VM_DRAW");
        let grid = bytes.len() - sequence;
        bytes.extend_from_slice(&0i16.to_le_bytes());
        write_i32(&mut bytes, sequence + 4, seq_name);
        write_i32(&mut bytes, sequence + 8, seq_activity);
        write_i32(&mut bytes, sequence + 56, 1);
        write_i32(&mut bytes, sequence + 60, grid as i32);
        write_i32(&mut bytes, sequence + 68, 1);
        write_i32(&mut bytes, sequence + 72, 1);
        let first = animation_table;
        let second = animation_table + ANIM_DESC_BYTES;
        if sectioned {
            let table = bytes.len();
            bytes.resize(table + 5 * 8, 0);
            write_i32(&mut bytes, first + 80, (table - first) as i32);
            write_i32(&mut bytes, first + 84, 1);
            let chain = bytes.len();
            bytes.extend_from_slice(&[0, 0x01, 10, 0, 0, 0, 0, 0, 0, 0]);
            bytes.extend_from_slice(&[1, 0x20, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
            for section in 0..5 {
                write_i32(&mut bytes, table + section * 8 + 4, (chain - first) as i32);
            }
        } else {
            let chain = bytes.len();
            bytes.extend_from_slice(&[0, 0x01, 10, 0, 0, 0, 0, 0, 0, 0]);
            bytes.extend_from_slice(&[1, 0x20, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
            write_i32(&mut bytes, first + 56, (chain - first) as i32);
        }
        let kept_chain = bytes.len();
        bytes.extend_from_slice(&[0, 0x01, 0, 0, 0, 0, 0, 0, 0, 0]);
        write_i32(&mut bytes, second + 56, (kept_chain - second) as i32);
        let length = bytes.len() as i32;
        write_i32(&mut bytes, 76, length);
        bytes
    }

    fn build_fixture(sectioned: bool) -> (Vec<u8>, StockAnimationModel, StockBoneModel) {
        let bytes = fixture(sectioned);
        let animations = parse_stock_animation_mdl(&bytes).unwrap();
        let bones = parse_stock_bone_mdl(&bytes).unwrap();
        parse_stock_pose_mdl(&bytes, &animations, &bones).unwrap();
        (bytes, animations, bones)
    }

    #[test]
    fn appends_full_hide_chains_without_changing_other_animation_data() {
        assert_eq!(
            crate::viewmodel_pose_values::source_float16_to_f32(0xd640),
            -100.0
        );
        for sectioned in [false, true] {
            let (bytes, animations, bones) = build_fixture(sectioned);
            let output = prototype_full_hide_mdl(
                &bytes,
                &animations,
                &bones,
                &BTreeSet::from(["@hide".to_string()]),
            )
            .unwrap();
            let original_len = bytes.len();
            assert_eq!(
                &output[original_len..original_len + 10],
                &[0, 1, 10, 0, 0x40, 0xd6, 0x40, 0xd6, 0x40, 0xd6]
            );
            assert_eq!(
                &output[original_len + 10..original_len + 20],
                &[1, 1, 0, 0, 0x40, 0xd6, 0x40, 0xd6, 0x40, 0xd6]
            );
            let new_animations = parse_stock_animation_mdl(&output).unwrap();
            let new_bones = parse_stock_bone_mdl(&output).unwrap();
            let pose = parse_stock_pose_mdl(&output, &new_animations, &new_bones).unwrap();
            assert_eq!(
                pose.animations[0].root.raw,
                pose.animations[0].section_count
            );
            assert_eq!(
                pose.animations[0].weapon.raw,
                pose.animations[0].section_count
            );
            assert_eq!(pose.animations[1].root.raw, 1);
            assert_eq!(
                i32_at(&output, 940 + 56, "kept pointer").unwrap(),
                i32_at(&bytes, 940 + 56, "kept pointer").unwrap()
            );
        }
    }

    #[test]
    fn rejects_unknown_or_changed_sources() {
        let (bytes, animations, bones) = build_fixture(false);
        assert!(prototype_full_hide_mdl(
            &bytes,
            &animations,
            &bones,
            &BTreeSet::from(["@unknown".into()])
        )
        .is_err());
        let mut changed = bytes.clone();
        let last = changed.len() - 1;
        changed[last] ^= 1;
        assert!(prototype_full_hide_mdl(
            &changed,
            &animations,
            &bones,
            &BTreeSet::from(["@hide".into()])
        )
        .is_err());
    }
}
