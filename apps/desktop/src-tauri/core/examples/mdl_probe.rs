//! Verify the MDL header offsets against the game's own models.
//!
//! Usage: cargo run --example mdl_probe -- <tf2-root> [limit]
//!
//! Reads models straight out of tf2_misc_dir.vpk and prints the material
//! directories each one declares, then round-trips a rewrite in memory. Every
//! model that parses is evidence the header offsets are right; a model that
//! fails is evidence they are not.

use std::path::PathBuf;

use execs_core::mdl;
use execs_core::vpk::read_vpk_dir_file_filtered;

fn main() {
    let mut args = std::env::args().skip(1);
    let root = PathBuf::from(args.next().expect("usage: mdl_probe <tf2-root> [limit]"));
    let limit: usize = args
        .next()
        .and_then(|value| value.parse().ok())
        .unwrap_or(40);

    let vpk = root.join("tf").join("tf2_misc_dir.vpk");
    let keep = |rel: &str| rel.to_ascii_lowercase().ends_with(".mdl");
    let archive = read_vpk_dir_file_filtered(&vpk, &keep).expect("read tf2_misc_dir.vpk");

    let (mut ok, mut failed, mut shown) = (0usize, 0usize, 0usize);
    for (path, bytes) in &archive.files {
        if !mdl::is_mdl(bytes) {
            continue;
        }
        match mdl::material_dirs(bytes) {
            Some(dirs) => {
                ok += 1;
                if shown < limit {
                    shown += 1;
                    println!("{path}\n  dirs: {dirs:?}");
                    let mut next: Vec<String> =
                        dirs.iter().map(|dir| format!("console/{dir}")).collect();
                    next.extend(dirs.iter().cloned());
                    match mdl::rewrite_material_dirs(bytes, &next) {
                        Some(out) => {
                            let back = mdl::material_dirs(&out);
                            println!(
                                "  rewrite: {} bytes -> {} bytes, reads back {}",
                                bytes.len(),
                                out.len(),
                                if back.as_deref() == Some(next.as_slice()) {
                                    "OK"
                                } else {
                                    "MISMATCH"
                                }
                            );
                        }
                        None => println!("  rewrite: REFUSED"),
                    }
                }
            }
            None => {
                failed += 1;
                if failed <= 10 {
                    println!("UNPARSED {path}");
                }
            }
        }
    }
    println!("\nparsed {ok} models, {failed} unparsed");
}
