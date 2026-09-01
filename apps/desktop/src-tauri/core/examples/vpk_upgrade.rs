//! Rewrite a v1 pack as v2 without changing a single file it carries.
//!
//! Usage: cargo run --example vpk_upgrade -- <pack.vpk> [more.vpk ...]
//!
//! For packs already installed: the engine misreads v1 directories, so this
//! reseats them in the format the game itself ships. Contents are compared
//! before and after, and the file is only replaced if they match exactly.

use std::path::PathBuf;

use execs_core::vpk::{read_vpk_dir_bytes, read_vpk_dir_file, write_vpk_v2};

fn main() {
    for arg in std::env::args().skip(1) {
        let path = PathBuf::from(&arg);
        let before = match read_vpk_dir_file(&path) {
            Ok(archive) => archive.files,
            Err(err) => {
                println!("SKIP {arg}: {}", err.message());
                continue;
            }
        };
        let out = write_vpk_v2(&before);
        let after = read_vpk_dir_bytes(&out)
            .expect("reread rewritten pack")
            .files;
        if after != before {
            println!("REFUSED {arg}: contents would change");
            continue;
        }
        std::fs::write(&path, &out).expect("write pack");
        println!(
            "OK {arg}: {} entries, v1 -> v2 ({} bytes)",
            before.len(),
            out.len()
        );
    }
}
