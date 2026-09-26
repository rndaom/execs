//! Read-only provisional group candidates from a confirmed TF2 install.
//! Usage: cargo run --example viewmodel_group_probe --features probes -- <tf2-root>

use std::collections::BTreeMap;
use std::path::Path;

use execs_core::viewmodel_graph::candidate_activity_graph;
use execs_core::viewmodel_group_selection::provisional_group_catalog_identity;
use execs_core::viewmodel_groups::derive_group_candidates;
use execs_core::viewmodel_items::read_stock_item_catalog;
use execs_core::viewmodel_scripts::read_stock_weapon_scripts;
use execs_core::viewmodel_source::read_stock_animation_index;

fn main() {
    let root = std::env::args()
        .nth(1)
        .expect("provide the confirmed TF2 root");
    let root = Path::new(&root);
    let items = read_stock_item_catalog(root).expect("stock item catalog");
    let scripts = read_stock_weapon_scripts(root).expect("stock weapon scripts");
    let models = read_stock_animation_index(root).expect("stock animation index");
    let graph = candidate_activity_graph(&items, &scripts, &models).expect("activity candidates");
    let candidates = derive_group_candidates(&graph).expect("bounded provisional groups");
    let identity = provisional_group_catalog_identity(&candidates).expect("catalog identity");
    println!(
        "TF2 patch {}: {} provisional groups, {} unresolved item/class pairs",
        candidates.patch_version,
        candidates.groups.len(),
        candidates.unresolved_items.len()
    );
    println!(
        "unresolved item/class pairs: {:?}",
        candidates.unresolved_items
    );
    println!("provisional catalog SHA-256: {}", identity.catalog_sha256);
    let mut by_class = BTreeMap::<&str, (usize, usize, usize)>::new();
    for group in &candidates.groups {
        let count = by_class.entry(&group.class).or_default();
        count.0 += 1;
        count.1 += usize::from(!group.overlaps.is_empty());
        count.2 += usize::from(group.team_variants_differ);
    }
    for (class, (total, overlapping, team_variants)) in by_class {
        println!(
            "{class}: {total} groups, {overlapping} share animations with another group, {team_variants} differ by team"
        );
    }
}
