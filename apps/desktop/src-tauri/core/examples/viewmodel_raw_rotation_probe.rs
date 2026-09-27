//! Read-only raw-rotation audit from a confirmed TF2 installation.
//! Usage: cargo run --example viewmodel_raw_rotation_probe --features probes -- <tf2-root>

use std::path::Path;

use execs_core::viewmodel_pose::parse_stock_pose_mdl;
use execs_core::viewmodel_rotation_values::{
    decode_animated_rotation_frames, decode_raw_rotation_record,
    decode_terminal_raw_rotation_record, parse_bone_rotation_bases, terminal_raw_rotation_len,
};
use execs_core::viewmodel_source::{read_stock_animation_index, read_stock_bone_index};
use execs_core::vpk::{map_vpk_entries, read_vpk_entry};

fn integer(bytes: &[u8], at: usize) -> i32 {
    i32::from_le_bytes(bytes[at..at + 4].try_into().expect("verified MDL offset"))
}

fn audit(
    bytes: &[u8],
    model: &execs_core::viewmodel_source::StockAnimationModel,
    bone: &execs_core::viewmodel_source::StockBoneModel,
) -> (usize, usize, usize, usize) {
    let pose = parse_stock_pose_mdl(bytes, model, bone).expect("verified pose inventory");
    let bases = parse_bone_rotation_bases(bytes, bone).expect("verified bone rotations");
    let table = usize::try_from(integer(bytes, 184)).expect("animation table");
    let mut decoded = 0;
    let mut terminal = 0;
    let mut animated = 0;
    let mut animated_terminal = 0;
    for (index, animation) in model.animations.iter().enumerate() {
        if pose.animations[index].unsupported_reason.is_some() {
            continue;
        }
        let descriptor = table + index * 100;
        let section_frames = integer(bytes, descriptor + 84);
        let starts = if section_frames == 0 {
            vec![(
                descriptor + usize::try_from(integer(bytes, descriptor + 56)).expect("local data"),
                animation.frames,
            )]
        } else {
            let section_frames = usize::try_from(section_frames).expect("section frame count");
            let section_table = descriptor
                + usize::try_from(integer(bytes, descriptor + 80)).expect("section table");
            (0..pose.animations[index].section_count)
                .filter(|section| section * section_frames < usize::from(animation.frames))
                .map(|section| {
                    (
                        descriptor
                            + usize::try_from(integer(bytes, section_table + section * 8 + 4))
                                .expect("section data"),
                        u16::try_from(
                            section_frames
                                .min(usize::from(animation.frames) - section * section_frames),
                        )
                        .expect("section frame count"),
                    )
                })
                .collect()
        };
        for (start, frames) in starts {
            let mut at = start;
            for _ in 0..=bone.bones.len() {
                let header = &bytes[at..at + 4];
                if header[0] == 255 {
                    break;
                }
                let next = i16::from_le_bytes([header[2], header[3]]);
                if header[1] & 0x22 != 0 {
                    if next == 0 {
                        let len =
                            terminal_raw_rotation_len(header[1]).expect("fixed terminal rotation");
                        decode_terminal_raw_rotation_record(&bytes[at..at + len])
                            .expect("terminal raw rotation");
                        terminal += 1;
                    } else {
                        let end = at + usize::try_from(next).expect("bounded record");
                        decode_raw_rotation_record(&bytes[at..end]).expect("raw rotation");
                        decoded += 1;
                    }
                }
                if header[1] & 0x08 != 0 {
                    if next == 0 {
                        animated_terminal += 1;
                    } else {
                        let end = at + usize::try_from(next).expect("bounded record");
                        let basis = &bases[usize::from(header[0])];
                        decode_animated_rotation_frames(
                            &bytes[at..end],
                            frames,
                            basis.base_angles,
                            basis.scale,
                            basis.fixed_alignment.then_some(basis.alignment),
                        )
                        .expect("animated rotation frames");
                        animated += 1;
                    }
                }
                if next == 0 {
                    break;
                }
                at += usize::try_from(next).expect("bounded record");
            }
        }
    }
    (decoded, terminal, animated, animated_terminal)
}

fn main() {
    let root = std::env::args()
        .nth(1)
        .expect("provide the confirmed TF2 root");
    let root = Path::new(&root);
    let animations = read_stock_animation_index(root).expect("verified class animations");
    let bones = read_stock_bone_index(root).expect("verified class bones");
    assert_eq!(animations.patch_version, bones.patch_version);
    let vpk_path = root.join("tf/tf2_misc_dir.vpk");
    let entries = map_vpk_entries(&vpk_path).expect("stock VPK tree");
    println!("TF2 patch {}", animations.patch_version);
    let mut totals = (0, 0, 0, 0);
    for (class, model) in &animations.models {
        let rel = format!("models/weapons/c_models/c_{class}_animations.mdl");
        let bytes = read_vpk_entry(&vpk_path, entries.get(&rel).expect("class MDL entry"))
            .expect("class MDL bytes");
        let (decoded, terminal, animated, animated_terminal) =
            audit(&bytes, model, &bones.models[class]);
        println!("{class}: {decoded} bounded raw, {terminal} terminal raw, {animated} bounded animated, {animated_terminal} terminal animated");
        totals.0 += decoded;
        totals.1 += terminal;
        totals.2 += animated;
        totals.3 += animated_terminal;
    }
    println!(
        "total: {} bounded raw, {} terminal raw, {} bounded animated, {} terminal animated",
        totals.0, totals.1, totals.2, totals.3
    );
    assert_eq!(
        read_stock_animation_index(root).expect("source recheck"),
        animations
    );
}
