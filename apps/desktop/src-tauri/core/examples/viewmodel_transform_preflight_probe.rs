//! Read-only structural preflight for provisional Full and Weapon hide groups.
//! Usage: cargo run --example viewmodel_transform_preflight_probe --features probes -- <tf2-root>

use std::collections::BTreeMap;
use std::path::Path;

use execs_core::hash::sha256_hex;
use execs_core::viewmodel_graph::candidate_activity_graph;
use execs_core::viewmodel_groups::derive_group_candidates;
use execs_core::viewmodel_items::read_stock_item_catalog;
use execs_core::viewmodel_pose::{parse_stock_pose_mdl, StockPoseIndex};
use execs_core::viewmodel_scripts::read_stock_weapon_scripts;
use execs_core::viewmodel_source::{read_stock_animation_index, read_stock_bone_index};
use execs_core::viewmodel_transform_preflight::{assess_transform_candidates, HideMode, PoseRoute};
use execs_core::vpk::{map_vpk_entries, read_vpk_entry};

fn route_name(route: PoseRoute) -> &'static str {
    match route {
        PoseRoute::RawCandidate => "raw candidate",
        PoseRoute::SpecialAnimation => "special animation",
        PoseRoute::MissingAnimation => "missing animation",
        PoseRoute::NoWeaponBones => "no weapon bones",
        PoseRoute::MissingPositionRecords => "missing position records",
        PoseRoute::CompressedPosition => "compressed position",
        PoseRoute::UnboundedTail => "unbounded tail",
    }
}

fn main() {
    let root = std::env::args()
        .nth(1)
        .expect("provide the confirmed TF2 root");
    let root = Path::new(&root);
    let items = read_stock_item_catalog(root).expect("stock item catalog");
    let scripts = read_stock_weapon_scripts(root).expect("stock weapon scripts");
    let animations = read_stock_animation_index(root).expect("stock class animations");
    let bones = read_stock_bone_index(root).expect("stock class bones");
    let graph = candidate_activity_graph(&items, &scripts, &animations).expect("activity links");
    let groups = derive_group_candidates(&graph).expect("provisional groups");
    let vpk_path = root.join("tf/tf2_misc_dir.vpk");
    let entries = map_vpk_entries(&vpk_path).expect("stock VPK tree");
    let mut poses = BTreeMap::<String, StockPoseIndex>::new();
    for (class, animation_model) in &animations.models {
        let rel = format!("models/weapons/c_models/c_{class}_animations.mdl");
        let entry = entries.get(&rel).expect("class model entry");
        let bytes = read_vpk_entry(&vpk_path, entry).expect("class MDL bytes");
        assert_eq!(sha256_hex(&bytes), animation_model.sha256);
        poses.insert(
            class.clone(),
            parse_stock_pose_mdl(&bytes, animation_model, &bones.models[class])
                .expect("bounded pose inventory"),
        );
    }
    for mode in [HideMode::Full, HideMode::Weapon] {
        let candidates = assess_transform_candidates(&groups, &animations, &poses, mode)
            .expect("same-patch transform preflight");
        let raw_groups = candidates
            .iter()
            .filter(|group| {
                group
                    .animations
                    .iter()
                    .all(|animation| animation.route == PoseRoute::RawCandidate)
            })
            .count();
        let mut routes = BTreeMap::<&str, usize>::new();
        for group in &candidates {
            for animation in &group.animations {
                *routes.entry(route_name(animation.route)).or_default() += 1;
            }
        }
        println!(
            "TF2 patch {} {mode:?}: {raw_groups}/{} provisional groups have only raw-record candidates; animation routes {routes:?}",
            groups.patch_version,
            candidates.len()
        );
    }
    assert_eq!(
        read_stock_animation_index(root).expect("source recheck"),
        animations
    );
}
