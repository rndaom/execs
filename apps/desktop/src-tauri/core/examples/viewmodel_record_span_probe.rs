//! Infer minimum terminal bone-record spans in verified installed class MDLs.
//! Usage: cargo run --example viewmodel_record_span_probe --features probes -- <tf2-root>
//! This reads only stock VPK entries and writes no candidate model.

use std::collections::BTreeMap;
use std::path::Path;

use execs_core::hash::sha256_hex;
use execs_core::viewmodel_pose::parse_stock_pose_mdl;
use execs_core::viewmodel_record_span::infer_terminal_record_span;
use execs_core::viewmodel_source::{read_stock_animation_index, read_stock_bone_index};
use execs_core::vpk::{map_vpk_entries, read_vpk_entry};

fn i32_at(bytes: &[u8], at: usize) -> i32 {
    i32::from_le_bytes(bytes[at..at + 4].try_into().unwrap())
}

fn section_frames(frames: usize, chunk: usize) -> BTreeMap<usize, u16> {
    if chunk == 0 {
        return BTreeMap::from([(0, frames.try_into().unwrap())]);
    }
    let mut sections = BTreeMap::<usize, u16>::new();
    for frame in 0..frames {
        // Source pAnim stores the final frame of long animations separately.
        let (section, local) = if frames > chunk && frame == frames - 1 {
            (frames / chunk + 1, 0)
        } else {
            (frame / chunk, frame % chunk)
        };
        let count = sections.entry(section).or_default();
        *count = (*count).max((local + 1).try_into().unwrap());
    }
    sections
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
    for (class, animation_model) in &animations.models {
        let rel = format!("models/weapons/c_models/c_{class}_animations.mdl");
        let bytes = read_vpk_entry(&vpk_path, &entries[&rel]).expect("class MDL bytes");
        assert_eq!(sha256_hex(&bytes), animation_model.sha256);
        let pose = parse_stock_pose_mdl(&bytes, animation_model, &bones.models[class])
            .expect("verified local pose inventory");
        let table = usize::try_from(i32_at(&bytes, 184)).unwrap();
        let mut by_flag = BTreeMap::<u8, usize>::new();
        let mut channels = 0usize;
        for (index, animation) in animation_model.animations.iter().enumerate() {
            if pose.animations[index].unsupported_reason.is_some() {
                continue;
            }
            let base = table + index * 100;
            let chunk = usize::try_from(i32_at(&bytes, base + 84)).unwrap();
            let active = section_frames(usize::from(animation.frames), chunk);
            let section_table = if chunk == 0 {
                0
            } else {
                base + usize::try_from(i32_at(&bytes, base + 80)).unwrap()
            };
            for (section, frames) in active {
                assert!(section < pose.animations[index].section_count);
                let offset = if chunk == 0 {
                    i32_at(&bytes, base + 56)
                } else {
                    i32_at(&bytes, section_table + section * 8 + 4)
                };
                let mut at = base + usize::try_from(offset).unwrap();
                loop {
                    let next = i16::from_le_bytes([bytes[at + 2], bytes[at + 3]]);
                    if next == 0 {
                        let span = infer_terminal_record_span(&bytes[at..], frames).unwrap_or_else(
                            |error| {
                                panic!(
                                    "{class} {} section {section} bone {} flags {:#x}: {error}",
                                    animation.name,
                                    bytes[at],
                                    bytes[at + 1]
                                )
                            },
                        );
                        *by_flag.entry(bytes[at + 1]).or_default() += 1;
                        channels += span.decoded_channels;
                        break;
                    }
                    at += usize::try_from(next).unwrap();
                }
            }
        }
        println!("{class}: terminal records by flag {by_flag:?}; decoded channels {channels}");
    }
    assert_eq!(
        read_stock_animation_index(root).expect("source recheck"),
        animations
    );
}
