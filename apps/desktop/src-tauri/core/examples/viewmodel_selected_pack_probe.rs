//! Compose one provisional group choice from the installed TF2 sources.
//! Usage: cargo run -p execs-core --example viewmodel_selected_pack_probe --features probes -- <tf2-root>
//! The candidate remains in memory; this never installs or saves a VPK.

use std::path::Path;

use execs_core::viewmodel_graph::candidate_activity_graph;
use execs_core::viewmodel_group_selection::{
    provisional_group_catalog_identity, ProvisionalGroupChoice, ProvisionalGroupRequest,
    ProvisionalHideMode,
};
use execs_core::viewmodel_groups::derive_group_candidates;
use execs_core::viewmodel_items::read_stock_item_catalog;
use execs_core::viewmodel_pose::parse_stock_pose_mdl;
use execs_core::viewmodel_scripts::read_stock_weapon_scripts;
use execs_core::viewmodel_selected_pack::prototype_selected_group_vpk_from_install;
use execs_core::viewmodel_source::{read_stock_animation_index, read_stock_bone_index};
use execs_core::vpk::{map_vpk_entries, read_vpk_entry};

fn main() {
    let root = std::env::args()
        .nth(1)
        .expect("provide the confirmed TF2 root");
    let root = Path::new(&root);
    let items = read_stock_item_catalog(root).expect("installed item schema");
    let scripts = read_stock_weapon_scripts(root).expect("installed weapon scripts");
    let animations = read_stock_animation_index(root).expect("installed class animations");
    let bones = read_stock_bone_index(root).expect("installed class bones");
    let graph = candidate_activity_graph(&items, &scripts, &animations).expect("activity graph");
    let catalog = derive_group_candidates(&graph).expect("provisional group catalog");
    let identity = provisional_group_catalog_identity(&catalog).expect("catalog identity");
    let vpk_path = root.join("tf/tf2_misc_dir.vpk");
    let entries = map_vpk_entries(&vpk_path).expect("stock VPK directory");
    let mut selected = None;
    for group in &catalog.groups {
        let key = if group.class == "demoman" {
            "demo"
        } else {
            group.class.as_str()
        };
        let path = format!("models/weapons/c_models/c_{key}_animations.mdl");
        let bytes = read_vpk_entry(&vpk_path, &entries[&path]).expect("stock class MDL");
        let pose = parse_stock_pose_mdl(&bytes, &animations.models[key], &bones.models[key])
            .expect("stock pose inventory");
        if group.animations.iter().all(|name| {
            pose.animations
                .iter()
                .any(|animation| animation.name == *name && animation.unsupported_reason.is_none())
        }) {
            selected = Some(group);
            break;
        }
    }
    let selected = selected.expect("one source-supported provisional group");
    let request = ProvisionalGroupRequest {
        catalog: identity,
        choices: vec![ProvisionalGroupChoice {
            group_id: selected.id.clone(),
            mode: ProvisionalHideMode::Full,
        }],
    };
    let candidate = prototype_selected_group_vpk_from_install(root, &request)
        .expect("installed-source group VPK candidate");
    assert_eq!(candidate.catalog, request.catalog);
    assert_eq!(candidate.sources.class_model_sha256.len(), 9);
    println!(
        "TF2 patch {}: group {} with {} animations produced {} in-memory VPK bytes",
        candidate.sources.patch_version,
        selected.id,
        selected.animations.len(),
        candidate.vpk_bytes.len()
    );
}
