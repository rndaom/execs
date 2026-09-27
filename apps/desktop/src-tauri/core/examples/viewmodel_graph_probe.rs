//! Read-only item/activity/sequence candidates from a confirmed TF2 install.
//! Usage: cargo run --example viewmodel_graph_probe --features probes -- <tf2-root>

use std::collections::BTreeMap;
use std::path::Path;

use execs_core::viewmodel_graph::{candidate_activity_graph, ActivityRoute};
use execs_core::viewmodel_items::read_stock_item_catalog;
use execs_core::viewmodel_scripts::read_stock_weapon_scripts;
use execs_core::viewmodel_source::read_stock_animation_index;

fn route_name(route: ActivityRoute) -> &'static str {
    match route {
        ActivityRoute::ItemReplacement => "item replacement",
        ActivityRoute::RoleTable => "role table",
        ActivityRoute::RoleIdentity => "role identity",
        ActivityRoute::Inspect => "inspect",
    }
}

fn main() {
    let root = std::env::args()
        .nth(1)
        .expect("provide the confirmed TF2 root");
    let root = Path::new(&root);
    let items = read_stock_item_catalog(root).expect("stock item catalog");
    let scripts = read_stock_weapon_scripts(root).expect("stock weapon scripts");
    let models = read_stock_animation_index(root).expect("stock animation index");
    let graph = candidate_activity_graph(&items, &scripts, &models)
        .expect("same-patch item/activity candidates");
    let direct = graph
        .edges
        .iter()
        .filter(|edge| !edge.sequences.is_empty())
        .count();
    let mut routes = BTreeMap::<&str, (usize, usize)>::new();
    for edge in &graph.edges {
        let count = routes.entry(route_name(edge.route)).or_default();
        count.0 += 1;
        count.1 += usize::from(!edge.sequences.is_empty());
    }
    println!(
        "TF2 patch {}: {} candidate item/class/team/base-activity edges, {} with direct local sequences; {} unresolved item/class roles, {} unverified shotgun class-role routes",
        graph.patch_version,
        graph.edges.len(),
        direct,
        graph.unresolved_roles.len(),
        graph.candidate_roles.len()
    );
    println!("route candidates/direct: {routes:?}");
    for (item_id, class) in [(220, "scout"), (140, "engineer")] {
        for edge in graph.edges.iter().filter(|edge| {
            edge.item_id == item_id
                && edge.class == class
                && edge.visual == "red"
                && matches!(
                    edge.base_activity.as_str(),
                    "ACT_VM_DRAW"
                        | "ACT_PRIMARY_VM_INSPECT_START"
                        | "ACT_SECONDARY_VM_INSPECT_START"
                )
        }) {
            println!(
                "item {item_id} {class}: {} -> {} ({}, {} sequences)",
                edge.base_activity,
                edge.target_activity,
                route_name(edge.route),
                edge.sequences.len()
            );
        }
    }
}
