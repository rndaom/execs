//! Round-trip a mixed Full/Weapon Viewmodels VPK candidate in memory.
//! Usage: cargo run --example viewmodel_vpk_candidate_probe --features probes -- <tf2-root>
//! This reads the verified installed models but writes no pack or game file.

use std::collections::{BTreeMap, BTreeSet};
use std::path::Path;

use execs_core::hash::sha256_hex;
use execs_core::viewmodel_pose::parse_stock_pose_mdl;
use execs_core::viewmodel_source::{read_stock_animation_index, read_stock_bone_index};
use execs_core::viewmodel_vpk_candidate::{
    prototype_viewmodel_vpk, HideSelection, VerifiedClassModel,
};
use execs_core::vpk::{map_vpk_entries, read_vpk_dir_bytes, read_vpk_entry};

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
    let mut source_bytes = BTreeMap::new();
    let mut selections = BTreeMap::new();
    for (class, animation_model) in &animations.models {
        let rel = format!("models/weapons/c_models/c_{class}_animations.mdl");
        let bytes = read_vpk_entry(&vpk_path, &entries[&rel]).expect("class MDL bytes");
        assert_eq!(sha256_hex(&bytes), animation_model.sha256);
        let pose = parse_stock_pose_mdl(&bytes, animation_model, &bones.models[class])
            .expect("verified local pose inventory");
        let mut ordinary = pose
            .animations
            .iter()
            .filter(|animation| animation.unsupported_reason.is_none());
        let full = ordinary.next().expect("Full example").name.clone();
        let weapon = ordinary.next().expect("Weapon example").name.clone();
        let group_class = if class == "demo" {
            "demoman"
        } else {
            class.as_str()
        };
        selections.insert(
            group_class.to_string(),
            HideSelection {
                full: BTreeSet::from([full]),
                weapon: BTreeSet::from([weapon]),
            },
        );
        source_bytes.insert(class.clone(), bytes);
    }
    let models = animations
        .models
        .iter()
        .map(|(class, animation_model)| {
            (
                class.clone(),
                VerifiedClassModel {
                    bytes: &source_bytes[class],
                    animations: animation_model,
                    bones: &bones.models[class],
                },
            )
        })
        .collect();
    let candidate =
        prototype_viewmodel_vpk(&models, &selections).expect("mixed Full/Weapon VPK candidate");
    let archive = read_vpk_dir_bytes(&candidate).expect("VPK round trip");
    assert_eq!(archive.files.len(), 9);
    println!(
        "TF2 patch {}: mixed Full/Weapon candidate has {} models in {} VPK bytes",
        animations.patch_version,
        archive.files.len(),
        candidate.len()
    );
    assert_eq!(
        read_stock_animation_index(root).expect("source recheck"),
        animations
    );
}
