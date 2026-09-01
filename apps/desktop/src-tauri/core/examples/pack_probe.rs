//! Summarize what an execs pack actually shipped.
//!
//! Usage: cargo run --example pack_probe -- <path-to.vpk>
//!
//! Answers the questions that matter after an install: did model materials get
//! relocated under console/, are any textures still missing a material, and
//! which top-level trees are present.

use std::collections::{BTreeMap, BTreeSet};
use std::path::PathBuf;

use execs_core::vpk::read_vpk_dir_file;

fn main() {
    let path = PathBuf::from(
        std::env::args()
            .nth(1)
            .expect("usage: pack_probe <path-to.vpk>"),
    );
    let archive = read_vpk_dir_file(&path).expect("read vpk");
    let names: BTreeSet<&String> = archive.files.keys().collect();

    let mut roots: BTreeMap<String, usize> = BTreeMap::new();
    for rel in &names {
        let root = rel.split('/').take(2).collect::<Vec<_>>().join("/");
        *roots.entry(root).or_default() += 1;
    }

    let vtfs: Vec<&&String> = names
        .iter()
        .filter(|rel| rel.ends_with(".vtf"))
        .collect::<Vec<_>>();
    let orphans: Vec<String> = vtfs
        .iter()
        .map(|rel| format!("{}.vmt", rel.trim_end_matches(".vtf")))
        .filter(|vmt| !names.contains(vmt))
        .collect();
    let relocated = names
        .iter()
        .filter(|rel| rel.starts_with("materials/console/"))
        .count();
    let mdls = names.iter().filter(|rel| rel.ends_with(".mdl")).count();

    if let Some(want) = std::env::args().nth(2) {
        let want = want.to_ascii_lowercase();
        for (rel, bytes) in &archive.files {
            if rel.to_ascii_lowercase().contains(&want) {
                println!("--- {rel} ({} bytes)", bytes.len());
                println!("{}", String::from_utf8_lossy(&bytes[..bytes.len().min(400)]));
                println!("--- hex: {:02x?}", &bytes[..bytes.len().min(48)]);
            }
        }
        return;
    }

    println!("{} entries in {}", names.len(), path.display());
    println!("  vtf: {}   vmt orphans: {}", vtfs.len(), orphans.len());
    println!("  materials/console/: {relocated}   models(.mdl): {mdls}");
    println!("\ntop trees:");
    for (root, count) in roots.iter().take(25) {
        println!("  {count:>6}  {root}");
    }
    if !orphans.is_empty() {
        println!("\nfirst orphan textures (no material beside them):");
        for vmt in orphans.iter().take(10) {
            println!("  {vmt}");
        }
    }
}
