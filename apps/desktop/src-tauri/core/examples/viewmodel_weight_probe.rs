//! Read-only sequence bone-weight audit for installed class animation MDLs.
//! Usage: cargo run --example viewmodel_weight_probe --features probes -- <tf2-root>

use std::path::Path;

use execs_core::hash::sha256_hex;
use execs_core::viewmodel_source::{read_stock_animation_index, read_stock_bone_index};
use execs_core::viewmodel_weights::read_sequence_bone_weights_mdl;
use execs_core::vpk::{map_vpk_entries, read_vpk_entry};

fn main() {
    let root = std::env::args()
        .nth(1)
        .expect("provide the confirmed TF2 root");
    let root = Path::new(&root);
    let animations = read_stock_animation_index(root).expect("verified class animations");
    let bones = read_stock_bone_index(root).expect("verified class bones");
    let vpk_path = root.join("tf/tf2_misc_dir.vpk");
    let entries = map_vpk_entries(&vpk_path).expect("stock VPK tree");
    println!("TF2 patch {}", animations.patch_version);
    for (class, animation_model) in &animations.models {
        let rel = format!("models/weapons/c_models/c_{class}_animations.mdl");
        let bytes = read_vpk_entry(&vpk_path, &entries[&rel]).expect("class MDL bytes");
        assert_eq!(sha256_hex(&bytes), animation_model.sha256);
        let bone_model = &bones.models[class];
        let weapon_bones: Vec<_> = bone_model
            .bones
            .iter()
            .enumerate()
            .filter(|(_, bone)| {
                let name = bone.name.to_ascii_lowercase();
                name.starts_with("weapon_bone") || name.starts_with("vm_weapon_bone")
            })
            .map(|(index, _)| index)
            .collect();
        let sequences = read_sequence_bone_weights_mdl(&bytes, animation_model, bone_model)
            .expect("verified sequence bone weights");
        let mut zero_root = Vec::new();
        let mut zero_weapon = Vec::new();
        let mut min_root = f32::INFINITY;
        let mut min_weapon = f32::INFINITY;
        for sequence in &sequences {
            min_root = min_root.min(sequence.weights[0]);
            if sequence.weights[0] <= 0.0 {
                zero_root.push(sequence.label.as_str());
            }
            for &bone in &weapon_bones {
                min_weapon = min_weapon.min(sequence.weights[bone]);
                if sequence.weights[bone] <= 0.0 {
                    zero_weapon.push(sequence.label.as_str());
                }
            }
        }
        zero_weapon.sort_unstable();
        zero_weapon.dedup();
        println!(
            "{class}: {} sequences, root min {min_root}, weapon min {min_weapon}, zero-root {:?}, zero-weapon {:?}",
            sequences.len(),
            zero_root,
            zero_weapon,
        );
    }
    assert_eq!(
        read_stock_animation_index(root).expect("source recheck"),
        animations
    );
    assert_eq!(read_stock_bone_index(root).expect("bone recheck"), bones);
}
