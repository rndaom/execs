//! Read-only animation bone-record inventory from a confirmed TF2 install.
//! Usage: cargo run --example viewmodel_pose_probe --features probes -- <tf2-root>

use std::path::Path;

use execs_core::hash::sha256_hex;
use execs_core::viewmodel_pose::parse_stock_pose_mdl;
use execs_core::viewmodel_source::{read_stock_animation_index, read_stock_bone_index};
use execs_core::vpk::{map_vpk_entries, read_vpk_entry};

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
        let entry = entries.get(&rel).expect("class model entry");
        let bytes = read_vpk_entry(&vpk_path, entry).expect("class MDL bytes");
        assert_eq!(sha256_hex(&bytes), animation_model.sha256);
        let pose = parse_stock_pose_mdl(&bytes, animation_model, &bones.models[class])
            .expect("bounded pose record inventory");
        let root_raw: usize = pose.animations.iter().map(|row| row.root.raw).sum();
        let root_compressed: usize = pose.animations.iter().map(|row| row.root.compressed).sum();
        let weapon_raw: usize = pose.animations.iter().map(|row| row.weapon.raw).sum();
        let weapon_compressed: usize = pose
            .animations
            .iter()
            .map(|row| row.weapon.compressed)
            .sum();
        let root_tail: usize = pose
            .animations
            .iter()
            .map(|row| row.root.unbounded_tail)
            .sum();
        let weapon_tail: usize = pose
            .animations
            .iter()
            .map(|row| row.weapon.unbounded_tail)
            .sum();
        let unknown_flags: usize = pose
            .animations
            .iter()
            .map(|row| row.unknown_flag_records)
            .sum();
        let unsupported: Vec<_> = pose
            .animations
            .iter()
            .filter_map(|row| row.unsupported_reason.as_ref().map(|why| (&row.name, why)))
            .collect();
        println!(
            "{class}: {} animations, {} weapon bones; root raw/compressed/tail {root_raw}/{root_compressed}/{root_tail}; weapon raw/compressed/tail {weapon_raw}/{weapon_compressed}/{weapon_tail}; unknown flags {unknown_flags}; shared chains {}; unsupported {:?}",
            pose.animations.len(),
            pose.weapon_bones.len(),
            pose.shared_chain_starts,
            unsupported
        );
    }
    assert_eq!(
        read_stock_animation_index(root).expect("source recheck"),
        animations
    );
}
