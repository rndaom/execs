//! Read-only check of the independent stock animation index on an installed TF2.
//! Usage: cargo run --example viewmodel_source_probe --features probes -- <tf2-root>

use std::path::Path;

use execs_core::viewmodel_source::read_stock_animation_index;

fn main() {
    let root = std::env::args().nth(1).expect("provide the confirmed TF2 root");
    let index = read_stock_animation_index(Path::new(&root)).expect("stock animation index");
    println!("TF2 patch: {}", index.patch_version);
    let (mut animations, mut sequences, mut blends) = (0, 0, 0);
    for (class_id, model) in index.models {
        animations += model.animations.len();
        sequences += model.sequences.len();
        blends += model
            .sequences
            .iter()
            .map(|sequence| sequence.animation_indexes.len())
            .sum::<usize>();
        let activities = model
            .sequences
            .iter()
            .filter(|sequence| sequence.activity.is_some())
            .count();
        println!(
            "{class_id}: {} animations, {} sequences, {activities} activities, sha256 {}",
            model.animations.len(),
            model.sequences.len(),
            model.sha256
        );
    }
    println!("total: {animations} animations, {sequences} sequences, {blends} blend references");
}
