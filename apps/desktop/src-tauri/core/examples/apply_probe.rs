//! Run the real mods install for a given selection, then report what changed.
//!
//! Usage: cargo run --example apply_probe -- <tf2-root> <mods.zip> <addon>[,<addon>...] [particle,...]
//!
//! This is the same entry point the app's Mods pane calls, so what it writes is
//! exactly what a user would get.

use std::path::PathBuf;

use execs_core::preloader::{apply_preloader_selection, PreloaderSelection};

fn main() {
    let mut args = std::env::args().skip(1);
    let root = PathBuf::from(args.next().expect("tf2 root"));
    let zip = PathBuf::from(args.next().expect("mods zip"));
    let split = |value: Option<String>| -> Vec<String> {
        value
            .filter(|text| !text.is_empty())
            .map(|text| text.split(',').map(|part| part.to_string()).collect())
            .unwrap_or_default()
    };
    let selection = PreloaderSelection {
        addons: split(args.next()),
        particle_mods: split(args.next()),
    };
    println!(
        "applying addons={:?} particles={:?}",
        selection.addons, selection.particle_mods
    );

    let report = apply_preloader_selection(
        &root,
        &execs_core::execs_data_dir(),
        &zip,
        &selection,
    )
    .expect("apply");

    println!("  custom vpk written:      {}", report.custom_vpk_written);
    println!("  gameinfo bypassed:       {}", report.gameinfo_bypassed);
    println!("  particles patched:       {}", report.patched_files.len());
    println!("  model materials moved:   {}", report.relocated_model_materials);
    println!("  materials generated:     {}", report.synthesized_vmts);
    for notice in &report.skipped {
        println!("  skipped: {} ({}) — {}", notice.file, notice.mod_name, notice.reason);
    }
}
