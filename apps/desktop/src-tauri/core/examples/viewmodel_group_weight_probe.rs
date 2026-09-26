//! Audit provisional group candidates against installed sequence bone weights.
//! Usage: cargo run --example viewmodel_group_weight_probe --features probes -- <tf2-root>
//! Static source candidates only; this cannot prove retail item reachability.

use std::collections::{BTreeMap, BTreeSet};
use std::path::Path;

use execs_core::hash::sha256_hex;
use execs_core::viewmodel_graph::candidate_activity_graph;
use execs_core::viewmodel_groups::derive_group_candidates;
use execs_core::viewmodel_items::read_stock_item_catalog;
use execs_core::viewmodel_scripts::read_stock_weapon_scripts;
use execs_core::viewmodel_source::{read_stock_animation_index, read_stock_bone_index};
use execs_core::viewmodel_weights::read_sequence_bone_weights_mdl;
use execs_core::vpk::{map_vpk_entries, read_vpk_entry};

fn main() {
    let root = std::env::args()
        .nth(1)
        .expect("provide the confirmed TF2 root");
    let root = Path::new(&root);
    let items = read_stock_item_catalog(root).expect("stock item catalog");
    let scripts = read_stock_weapon_scripts(root).expect("stock weapon scripts");
    let animations = read_stock_animation_index(root).expect("stock animation index");
    let bones = read_stock_bone_index(root).expect("stock bone index");
    let graph = candidate_activity_graph(&items, &scripts, &animations).expect("activity graph");
    let groups = derive_group_candidates(&graph).expect("provisional groups");
    let vpk_path = root.join("tf/tf2_misc_dir.vpk");
    let entries = map_vpk_entries(&vpk_path).expect("stock VPK tree");
    let mut total_sequences = BTreeSet::new();
    let mut zero_root = BTreeSet::new();
    let mut zero_any_weapon = BTreeSet::new();
    let mut zero_all_weapon = BTreeSet::new();
    let mut matched_groups = 0usize;
    for (class, animation_model) in &animations.models {
        let rel = format!("models/weapons/c_models/c_{class}_animations.mdl");
        let bytes = read_vpk_entry(&vpk_path, &entries[&rel]).expect("class MDL bytes");
        assert_eq!(sha256_hex(&bytes), animation_model.sha256);
        let bone_model = &bones.models[class];
        let weights = read_sequence_bone_weights_mdl(&bytes, animation_model, bone_model)
            .expect("verified sequence weights");
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
        assert!(!weapon_bones.is_empty(), "{class} has no weapon bones");
        let name_to_index: BTreeMap<_, _> = animation_model
            .animations
            .iter()
            .enumerate()
            .map(|(index, animation)| (animation.name.as_str(), index))
            .collect();
        let mut class_sequences = BTreeSet::new();
        // The item schema names this class demoman; its stock MDL stem is demo.
        let group_class = if class == "demo" {
            "demoman"
        } else {
            class.as_str()
        };
        for group in groups
            .groups
            .iter()
            .filter(|group| group.class == group_class)
        {
            matched_groups += 1;
            for name in &group.animations {
                let index = name_to_index[name.as_str()];
                let mut referenced = false;
                for (sequence_index, sequence) in animation_model.sequences.iter().enumerate() {
                    if sequence.animation_indexes.contains(&index) {
                        class_sequences.insert(sequence_index);
                        referenced = true;
                    }
                }
                assert!(referenced, "{class} {name} has no local sequence reference");
            }
        }
        for index in class_sequences {
            let sequence = &animation_model.sequences[index];
            let weight = &weights[index].weights;
            assert_eq!(weights[index].label, sequence.label);
            total_sequences.insert((class.clone(), index));
            if weight[0] == 0.0 {
                zero_root.insert((class.clone(), sequence.label.clone()));
            }
            if weapon_bones.iter().any(|&bone| weight[bone] == 0.0) {
                zero_any_weapon.insert((class.clone(), sequence.label.clone()));
            }
            if weapon_bones.iter().all(|&bone| weight[bone] == 0.0) {
                zero_all_weapon.insert((class.clone(), sequence.label.clone()));
            }
        }
    }
    assert_eq!(matched_groups, groups.groups.len());
    println!(
        "TF2 patch {}: {} candidate groups reference {} distinct class/sequence pairs",
        groups.patch_version,
        groups.groups.len(),
        total_sequences.len()
    );
    println!("zero root: {} {zero_root:?}", zero_root.len());
    println!(
        "at least one zero weapon bone: {} {zero_any_weapon:?}",
        zero_any_weapon.len()
    );
    println!(
        "all weapon bones zero: {} {zero_all_weapon:?}",
        zero_all_weapon.len()
    );
    assert_eq!(
        read_stock_animation_index(root).expect("source recheck"),
        animations
    );
}
