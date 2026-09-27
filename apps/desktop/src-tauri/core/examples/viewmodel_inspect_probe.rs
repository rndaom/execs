//! Read-only inspect activity candidates from a confirmed TF2 install.
//! Usage: cargo run --example viewmodel_inspect_probe --features probes -- <tf2-root>

use std::collections::BTreeMap;
use std::path::Path;

use execs_core::viewmodel_inspect::inspect_candidates;
use execs_core::viewmodel_items::read_stock_item_catalog;
use execs_core::viewmodel_source::read_stock_animation_index;

fn main() {
    let root = std::env::args()
        .nth(1)
        .expect("provide the confirmed TF2 root");
    let root = Path::new(&root);
    let items = read_stock_item_catalog(root).expect("stock item catalog");
    let models = read_stock_animation_index(root).expect("stock animation index");
    let candidates = inspect_candidates(&items, &models).expect("same-patch inspect candidates");
    let direct = candidates
        .iter()
        .filter(|candidate| !candidate.sequences.is_empty())
        .count();
    let mut by_family = BTreeMap::<&str, (usize, usize)>::new();
    let mut unmatched = BTreeMap::<(&str, &str), usize>::new();
    for candidate in &candidates {
        let family = candidate
            .target_activity
            .split('_')
            .nth(1)
            .expect("well-formed inspect activity");
        let counts = by_family.entry(family).or_default();
        counts.0 += 1;
        counts.1 += usize::from(!candidate.sequences.is_empty());
        if candidate.sequences.is_empty() {
            *unmatched
                .entry((&candidate.class, &candidate.target_activity))
                .or_default() += 1;
        }
    }
    println!(
        "TF2 patch {}: {} inspect candidates, {} with direct local MDL sequences",
        items.patch_version,
        candidates.len(),
        direct
    );
    println!("family candidates/direct: {by_family:?}");
    println!("unmatched class/activity candidates: {unmatched:?}");
    for (item_id, class) in [(220, "scout"), (140, "engineer")] {
        for candidate in candidates.iter().filter(|candidate| {
            candidate.item_id == item_id
                && candidate.class == class
                && candidate.stage == execs_core::viewmodel_inspect::InspectStage::Start
        }) {
            println!(
                "item {item_id} {class} {} inspect: {} -> {}, {} direct sequences",
                candidate.visual,
                candidate.base_activity,
                candidate.target_activity,
                candidate.sequences.len()
            );
        }
    }
}
