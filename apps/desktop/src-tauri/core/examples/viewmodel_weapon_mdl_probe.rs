//! Construct Weapon-hide candidate MDLs from verified installed class models.
//! Usage: cargo run --example viewmodel_weapon_mdl_probe --features probes -- <tf2-root>
//! This keeps candidate bytes in memory and writes no model or game file.

use std::collections::BTreeSet;
use std::path::Path;

use execs_core::hash::sha256_hex;
use execs_core::viewmodel_pose::parse_stock_pose_mdl;
use execs_core::viewmodel_source::{read_stock_animation_index, read_stock_bone_index};
use execs_core::viewmodel_weapon_mdl::prototype_weapon_hide_mdl;
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
    let mut total = 0;
    for (class, animation_model) in &animations.models {
        let rel = format!("models/weapons/c_models/c_{class}_animations.mdl");
        let bytes = read_vpk_entry(&vpk_path, &entries[&rel]).expect("class MDL bytes");
        assert_eq!(sha256_hex(&bytes), animation_model.sha256);
        let bone_model = &bones.models[class];
        let pose = parse_stock_pose_mdl(&bytes, animation_model, bone_model)
            .expect("verified local pose inventory");
        let names: BTreeSet<_> = pose
            .animations
            .iter()
            .filter(|animation| animation.unsupported_reason.is_none())
            .map(|animation| animation.name.clone())
            .collect();
        let candidate = prototype_weapon_hide_mdl(&bytes, animation_model, bone_model, &names)
            .unwrap_or_else(|error| panic!("{class}: {error}"));
        println!(
            "{class}: {} ordinary animations, {} -> {} candidate bytes",
            names.len(),
            bytes.len(),
            candidate.len()
        );
        total += names.len();
    }
    println!("{total} ordinary animations have parseable Weapon-hide candidates");
    assert_eq!(
        read_stock_animation_index(root).expect("source recheck"),
        animations
    );
}
