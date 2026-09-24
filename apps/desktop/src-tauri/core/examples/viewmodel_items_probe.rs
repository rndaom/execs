//! Read-only item-schema inspection on a confirmed TF2 install.
//! Usage: cargo run --example viewmodel_items_probe --features probes -- <tf2-root>

use std::path::Path;

use execs_core::viewmodel_items::{explicit_replacement_candidates, read_stock_item_catalog};
use execs_core::viewmodel_source::read_stock_animation_index;

fn main() {
    let root = std::env::args()
        .nth(1)
        .expect("provide the confirmed TF2 root");
    let catalog = read_stock_item_catalog(Path::new(&root)).expect("stock item catalog");
    println!(
        "TF2 patch {}, schema sha256 {}, {} class-eligible items",
        catalog.patch_version,
        catalog.schema_sha256,
        catalog.items.len()
    );
    for id in [220, 140] {
        let item = catalog.items.get(&id).expect("expected installed item");
        println!(
            "{id} {}: classes {:?}, loadout {:?}, animation role {:?}, common/red/blu replacements {}/{}/{}, team visuals {}",
            item.name,
            item.classes,
            item.loadout_slot,
            item.animation_slot,
            item.common_replacements.len(),
            item.red_replacements.len(),
            item.blu_replacements.len(),
            item.has_team_visuals,
        );
    }
    let models = read_stock_animation_index(Path::new(&root)).expect("stock animation index");
    let links = explicit_replacement_candidates(&catalog, &models)
        .expect("same-patch explicit replacement candidates");
    let matched = links
        .iter()
        .filter(|link| !link.sequences.is_empty())
        .count();
    println!(
        "{} explicit item/class/activity replacements, {} with direct local MDL sequences",
        links.len(),
        matched
    );
}
