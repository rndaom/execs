//! Dev tool: exercise the Yttrium-style build pipeline against a real TF2
//! install. `cargo run --example viewmodel_build_probe -- <animations.zip>
//! <tf2 root> <staging dir> <group id...>`. Writes nothing outside staging.

use std::collections::BTreeSet;

fn main() {
    let args: Vec<String> = std::env::args().skip(1).collect();
    if args.len() < 4 {
        eprintln!("usage: <animations.zip> <tf2 root> <staging dir> <group id...>");
        std::process::exit(2);
    }
    let zip = std::fs::read(&args[0]).expect("read animations zip");
    let tf2_root = std::path::Path::new(&args[1]);
    let staging = std::path::Path::new(&args[2]);
    let hidden: BTreeSet<String> = args[3..].iter().cloned().collect();

    let studiomdl = tf2_root.join("bin").join("studiomdl.exe");
    println!(
        "studiomdl: {} (exists: {})",
        studiomdl.display(),
        studiomdl.is_file()
    );

    let started = std::time::Instant::now();
    // EXECS_HIDE_MODE=weapon to probe the keep-hands variant.
    let mode_arg = std::env::var("EXECS_HIDE_MODE").ok();
    let mode = execs_core::ViewmodelHideMode::from_str_or_default(mode_arg.as_deref());
    println!("hide mode: {}", mode.as_str());
    let staging_root = staging.parent().expect("staging dir needs a parent");
    match execs_core::viewmodel_build::build_viewmodel_pack_vpk(
        &zip,
        &hidden,
        mode,
        &studiomdl,
        staging_root,
        staging,
    ) {
        Ok(vpk) => {
            println!("OK in {:?} — vpk bytes: {}", started.elapsed(), vpk.len());
            let archive = execs_core::vpk::read_vpk_dir_bytes(&vpk).expect("vpk parses");
            for (path, bytes) in &archive.files {
                println!(
                    "  {} ({} bytes, starts {:02x?})",
                    path,
                    bytes.len(),
                    &bytes[..4.min(bytes.len())]
                );
            }
        }
        Err(err) => {
            println!("FAILED in {:?}: {}", started.elapsed(), err.message());
            std::process::exit(1);
        }
    }
}
