//! Read-only compressed position-channel audit from a confirmed TF2 install.
//! Usage: cargo run --example viewmodel_pose_values_probe --features probes -- <tf2-root>

use std::path::Path;

use execs_core::viewmodel_pose_values::audit_stock_position_values_mdl;
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
        let report = audit_stock_position_values_mdl(&bytes, animation_model, &bones.models[class])
            .expect("bounded position values");
        println!("{class}: {report:?}");
    }
    assert_eq!(
        read_stock_animation_index(root).expect("source recheck"),
        animations
    );
}
