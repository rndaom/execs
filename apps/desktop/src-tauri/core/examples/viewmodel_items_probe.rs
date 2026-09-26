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
    let class_slot_overrides: Vec<_> = catalog
        .items
        .values()
        .flat_map(|item| {
            item.class_loadout_slots
                .iter()
                .filter(move |(_, slot)| *slot != &item.loadout_slot)
                .map(move |(class, slot)| (item.id, class.clone(), slot.clone()))
        })
        .collect();
    println!(
        "{} effective item/class loadout slots differ from their item default: {:?}",
        class_slot_overrides.len(),
        class_slot_overrides.iter().take(12).collect::<Vec<_>>()
    );
    let weapon_items: Vec<_> = catalog
        .items
        .values()
        .filter(|item| item.item_class.starts_with("tf_weapon_"))
        .collect();
    let shared_hands = weapon_items
        .iter()
        .filter(|item| item.attach_to_hands)
        .count();
    let vm_only = weapon_items
        .iter()
        .filter(|item| item.attach_to_hands_vm_only)
        .count();
    println!(
        "{} weapon-class items: {} request the shared hands model, {} set viewmodel-only attachment",
        weapon_items.len(),
        shared_hands,
        vm_only
    );
    for id in [220, 140] {
        let item = catalog.items.get(&id).expect("expected installed item");
        println!(
            "{id} {}: classes {:?}, loadout {:?}, animation role {:?}, neutral/effective RED/effective BLU replacements {}/{}/{}, team visuals {}",
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
        "{} effective item/class/team/activity replacements, {} with direct local MDL sequences",
        links.len(),
        matched
    );
}
