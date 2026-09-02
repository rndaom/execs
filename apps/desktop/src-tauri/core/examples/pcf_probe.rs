//! Dump particle-system renderer operators from a PCF, wherever it lives.
//!
//! Read-only field tool for chasing the engine's
//! `C_OP_RenderSprites::RenderUnsorted: Attempting to use an unimplemented
//! sprite renderer for system "..."` warning. Verified against the engine
//! source (builtin_particle_render_ops.cpp): `RenderUnsorted` is the batched
//! render-cache path, and its non-`IsSpriteCard()` branch has `case 0`
//! (orientation_type 0, the default) unimplemented — so the warning means "this
//! system's material is not a SpriteCard", which in practice is the engine's
//! `___error` UnlitGeneric stand-in for a material that failed to load. A
//! wrong `orientation_type` is the other, rarer way in; this dumps every
//! attribute of every renderer (and, with `--all-ops`, every operator) with its
//! DMX type code and raw value so both can be ruled in or out, and
//! `--attribute` names the library mod each modified live entry came from.
//!
//! Sources (pick one):
//!   --file <path>                       loose .pcf on disk
//!   --live <tf2_root> <rel>             entry from the live tf2_misc_dir.vpk
//!   --snapshot <data_dir> <rel>         pristine snapshot under <data_dir>/preloader/originals
//!   --zip <mods.zip> <inner path>       file inside the cached mod library
//!   --find <tf2_root> [data_dir]        which particles/*.pcf define the named systems
//!   --crc-check <tf2_root> [data_dir]   every live entry vs the directory's stock CRC
//!   --attribute <tf2_root> <mods.zip>   which library mod each modified entry came from
//!
//! Filters:
//!   --system <name> (repeatable)        only these systems (default: all)
//!   --all-ops                           dump every operator array, not just renderers
//!   --list                              only list system names
//!
//! `rel` is the VPK-relative path, e.g. `particles/item_fx.pcf`.

use std::collections::{BTreeMap, HashMap};
use std::io::Read;
use std::path::{Path, PathBuf};

use execs_core::pcf::{decode_pcf, PcfElement, PcfFile, PcfValue, NO_ELEMENT};
use execs_core::vpk::{map_vpk_entries, read_vpk_entry};

const OPERATOR_ARRAYS: [&str; 7] = [
    "renderers",
    "operators",
    "initializers",
    "emitters",
    "forces",
    "constraints",
    "children",
];

fn lossy(bytes: &[u8]) -> String {
    String::from_utf8_lossy(bytes).into_owned()
}

fn fmt_value(value: &PcfValue) -> String {
    fn f(bits: u32) -> String {
        format!("{}", f32::from_bits(bits))
    }
    match value {
        PcfValue::Element(v) if *v == NO_ELEMENT => "elem(NONE)".into(),
        PcfValue::Element(v) => format!("elem({v})"),
        PcfValue::Integer(v) => format!("int({v})"),
        PcfValue::Float(bits) => format!("float({}) [0x{bits:08x}]", f(*bits)),
        PcfValue::Boolean(v) => format!("bool({v})"),
        PcfValue::String(bytes) => format!("str({:?})", lossy(bytes)),
        PcfValue::Binary(bytes) => format!("bin({} bytes)", bytes.len()),
        PcfValue::Color(rgba) => format!("color({rgba:?})"),
        PcfValue::Vector2(c) => format!("vec2({}, {})", f(c[0]), f(c[1])),
        PcfValue::Vector3(c) => format!("vec3({}, {}, {})", f(c[0]), f(c[1]), f(c[2])),
        PcfValue::Vector4(c) => format!("vec4({}, {}, {}, {})", f(c[0]), f(c[1]), f(c[2]), f(c[3])),
        PcfValue::Matrix(_) => "matrix".into(),
        PcfValue::Array(items) => {
            let inner: Vec<String> = items.iter().map(fmt_value).collect();
            format!("[{}]", inner.join(", "))
        }
    }
}

fn dump_element(pcf: &PcfFile, index: usize, indent: &str) {
    let element = &pcf.elements[index];
    let function = element
        .attr(b"functionName")
        .map(|attr| fmt_value(&attr.value))
        .unwrap_or_default();
    println!(
        "{indent}#{index} type={:?} name={:?} {function} sig={}",
        lossy(pcf.type_name(element)),
        lossy(&element.name),
        element
            .signature
            .iter()
            .map(|b| format!("{b:02x}"))
            .collect::<String>()
    );
    for (name, attr) in &element.attributes {
        println!(
            "{indent}    {:<48} t={:<2} {}",
            lossy(name),
            attr.type_code,
            fmt_value(&attr.value)
        );
    }
}

fn array_indices(element: &PcfElement, name: &str) -> Vec<u32> {
    match element.attr(name.as_bytes()) {
        Some(attr) => match &attr.value {
            PcfValue::Array(items) => items
                .iter()
                .filter_map(|item| match item {
                    PcfValue::Element(v) => Some(*v),
                    _ => None,
                })
                .collect(),
            _ => Vec::new(),
        },
        None => Vec::new(),
    }
}

fn dump_systems(pcf: &PcfFile, wanted: &[String], all_ops: bool, list_only: bool) {
    println!(
        "header={:?} strings={} elements={}",
        pcf.version,
        pcf.string_dictionary.len(),
        pcf.elements.len()
    );
    for (index, element) in pcf.elements.iter().enumerate() {
        if pcf.type_name(element) != b"DmeParticleSystemDefinition" {
            continue;
        }
        let name = lossy(&element.name);
        if !wanted.is_empty() && !wanted.contains(&name) {
            continue;
        }
        if list_only {
            println!("system #{index} {name}");
            continue;
        }
        println!("==== system #{index} {name}");
        for (attr_name, attr) in &element.attributes {
            if OPERATOR_ARRAYS.contains(&lossy(attr_name).as_str()) {
                continue;
            }
            println!(
                "    {:<48} t={:<2} {}",
                lossy(attr_name),
                attr.type_code,
                fmt_value(&attr.value)
            );
        }
        let arrays: &[&str] = if all_ops {
            &OPERATOR_ARRAYS
        } else {
            &["renderers"]
        };
        for array in arrays {
            let refs = array_indices(element, array);
            let attr_type = element
                .attr(array.as_bytes())
                .map(|attr| attr.type_code)
                .unwrap_or(0);
            if element.attr(array.as_bytes()).is_none() {
                continue;
            }
            println!("  -- {array} (t={attr_type}, {} refs)", refs.len());
            for r in refs {
                if r == NO_ELEMENT || (r as usize) >= pcf.elements.len() {
                    println!("     #{r} <out of range>");
                    continue;
                }
                dump_element(pcf, r as usize, "     ");
            }
        }
    }
}

fn read_zip_entry(zip_path: &Path, inner: &str) -> Vec<u8> {
    let file = std::fs::File::open(zip_path).expect("open zip");
    let mut archive = zip::ZipArchive::new(file).expect("read zip");
    let want = inner.replace('\\', "/");
    for index in 0..archive.len() {
        let mut entry = archive.by_index(index).expect("zip entry");
        if entry.name().replace('\\', "/") == want {
            let mut bytes = Vec::new();
            entry.read_to_end(&mut bytes).expect("zip read");
            return bytes;
        }
    }
    panic!("{inner} not in {}", zip_path.display());
}

fn read_live(tf2_root: &Path, rel: &str) -> Vec<u8> {
    let vpk = tf2_root.join("tf").join("tf2_misc_dir.vpk");
    let entries = map_vpk_entries(&vpk).expect("map vpk");
    let entry = entries.get(rel).expect("entry in vpk");
    read_vpk_entry(&vpk, entry).expect("read entry")
}

fn read_snapshot(data_dir: &Path, rel: &str) -> Vec<u8> {
    let name = execs_core::hash::sha256_hex(rel.as_bytes());
    let path = data_dir.join("preloader").join("originals").join(name);
    std::fs::read(&path).unwrap_or_else(|err| panic!("{}: {err}", path.display()))
}

fn find_systems(tf2_root: &Path, data_dir: Option<&Path>, wanted: &[String]) {
    let vpk = tf2_root.join("tf").join("tf2_misc_dir.vpk");
    let entries = map_vpk_entries(&vpk).expect("map vpk");
    let mut hits: BTreeMap<String, Vec<String>> = BTreeMap::new();
    for (rel, entry) in &entries {
        if !rel.starts_with("particles/") || !rel.ends_with(".pcf") {
            continue;
        }
        let live = read_vpk_entry(&vpk, entry).expect("read entry");
        let snapshot = data_dir.and_then(|dir| {
            let name = execs_core::hash::sha256_hex(rel.as_bytes());
            std::fs::read(dir.join("preloader").join("originals").join(name)).ok()
        });
        for (label, bytes) in [("live", Some(live)), ("snapshot", snapshot)] {
            let Some(bytes) = bytes else { continue };
            let Ok(pcf) = decode_pcf(&bytes) else {
                println!("{rel} [{label}]: undecodable");
                continue;
            };
            for (index, element) in pcf.elements.iter().enumerate() {
                if pcf.type_name(element) != b"DmeParticleSystemDefinition" {
                    continue;
                }
                let name = lossy(&element.name);
                if wanted.contains(&name) {
                    hits.entry(name)
                        .or_default()
                        .push(format!("{rel} [{label}] #{index}"));
                }
            }
        }
    }
    for name in wanted {
        println!("{name}:");
        for hit in hits.get(name).map(|v| v.as_slice()).unwrap_or(&[]) {
            println!("    {hit}");
        }
    }
}

fn crc32(bytes: &[u8]) -> u32 {
    let mut table = [0u32; 256];
    for (i, slot) in table.iter_mut().enumerate() {
        let mut c = i as u32;
        for _ in 0..8 {
            c = if c & 1 != 0 {
                0xEDB8_8320 ^ (c >> 1)
            } else {
                c >> 1
            };
        }
        *slot = c;
    }
    let mut crc = 0xFFFF_FFFFu32;
    for b in bytes {
        crc = table[((crc ^ u32::from(*b)) & 0xff) as usize] ^ (crc >> 8);
    }
    !crc
}

/// Every particles/*.pcf entry whose live bytes no longer hash to the stock
/// CRC recorded in the directory (which we never rewrite), plus the same check
/// on each snapshot under the data dir — a snapshot that fails it is not
/// pristine.
fn crc_check(tf2_root: &Path, data_dir: Option<&Path>, loose: Option<&Path>) {
    let vpk = tf2_root.join("tf").join("tf2_misc_dir.vpk");
    let entries = map_vpk_entries(&vpk).expect("map vpk");
    let mut modified = 0;
    for (rel, entry) in &entries {
        if !rel.starts_with("particles/") || !rel.ends_with(".pcf") {
            continue;
        }
        if let Some(dir) = loose {
            // A loose copy (e.g. another tool's backup folder) checked against
            // the stock CRC; only mismatches and missing files are printed.
            let file = dir.join(rel.trim_start_matches("particles/"));
            match std::fs::read(&file) {
                Ok(bytes) if crc32(&bytes) == entry.crc => {}
                Ok(bytes) => println!(
                    "{rel}: loose copy NOT PRISTINE ({} bytes, trailing spaces {})",
                    bytes.len(),
                    bytes.iter().rev().take_while(|b| **b == b' ').count()
                ),
                Err(_) => println!("{rel}: no loose copy"),
            }
            continue;
        }
        let live = read_vpk_entry(&vpk, entry).expect("read entry");
        let live_crc = crc32(&live);
        let trailing = live.iter().rev().take_while(|b| **b == b' ').count();
        let snapshot = data_dir.and_then(|dir| {
            let name = execs_core::hash::sha256_hex(rel.as_bytes());
            std::fs::read(dir.join("preloader").join("originals").join(name)).ok()
        });
        let snap_note = match &snapshot {
            Some(bytes) => {
                let ok = crc32(bytes) == entry.crc;
                let t = bytes.iter().rev().take_while(|b| **b == b' ').count();
                format!(
                    "  snapshot: {} (trailing spaces {t})",
                    if ok { "PRISTINE" } else { "NOT PRISTINE" }
                )
            }
            None => String::new(),
        };
        if live_crc != entry.crc || snapshot.is_some() {
            modified += usize::from(live_crc != entry.crc);
            println!(
                "{rel}: live {} (dir crc {:08x}, live crc {live_crc:08x}, {} bytes, trailing spaces {trailing}){snap_note}",
                if live_crc == entry.crc {
                    "stock"
                } else {
                    "MODIFIED"
                },
                entry.crc,
                live.len()
            );
        }
    }
    println!("{modified} modified particle entries");
}

/// For every live `particles/*.pcf` whose bytes are not stock (directory
/// CRC), name the library mod whose shrunk output — the same pipeline apply.rs
/// runs — matches the live bytes byte-for-byte ahead of the space padding.
/// That attributes a stale patch to the install that left it behind, and
/// proves the bytes went through our pipeline unchanged.
fn attribute_modified(tf2_root: &Path, zip_path: &Path) {
    let vpk = tf2_root.join("tf").join("tf2_misc_dir.vpk");
    let entries = map_vpk_entries(&vpk).expect("map vpk");
    let file = std::fs::File::open(zip_path).expect("open zip");
    let mut archive = zip::ZipArchive::new(file).expect("read zip");
    // (mod name, file name, zip index) for every mod particle file.
    let mut candidates: Vec<(String, String, usize)> = Vec::new();
    for index in 0..archive.len() {
        let entry = archive.by_index(index).expect("zip entry");
        let path = entry.name().replace('\\', "/");
        let Some(rest) = path.strip_prefix("mods/particles/") else {
            continue;
        };
        let mut parts = rest.splitn(3, '/');
        let (Some(mod_name), Some("actual_particles"), Some(file)) =
            (parts.next(), parts.next(), parts.next())
        else {
            continue;
        };
        if file.contains('/') || !file.ends_with(".pcf") {
            continue;
        }
        candidates.push((mod_name.to_string(), file.to_string(), index));
    }
    let mut shrunk_cache: HashMap<usize, Option<Vec<u8>>> = HashMap::new();
    let mut counts: BTreeMap<String, usize> = BTreeMap::new();
    for (rel, entry) in &entries {
        if !rel.starts_with("particles/") || !rel.ends_with(".pcf") {
            continue;
        }
        let live = read_vpk_entry(&vpk, entry).expect("read entry");
        if live.len() == entry.length as usize && crc32(&live) == entry.crc {
            continue;
        }
        let stem = rel
            .trim_start_matches("particles/")
            .trim_end_matches(".pcf")
            .trim_end_matches("_dx80");
        let mut matches: Vec<String> = Vec::new();
        for (mod_name, file, index) in &candidates {
            let mod_stem = file.trim_end_matches(".pcf");
            // blood_trail's mod file is patched into npc_fx (apply.rs).
            if mod_stem != stem && !(mod_stem == "blood_trail" && stem == "npc_fx") {
                continue;
            }
            let shrunk = shrunk_cache.entry(*index).or_insert_with(|| {
                let mut entry = archive.by_index(*index).expect("zip entry");
                let mut bytes = Vec::new();
                entry.read_to_end(&mut bytes).expect("zip read");
                let mut pcf = decode_pcf(&bytes).ok()?;
                execs_core::pcf::remove_duplicate_elements(&mut pcf).ok()?;
                execs_core::pcf::encode_pcf(&pcf).ok()
            });
            let Some(shrunk) = shrunk else { continue };
            if live.starts_with(shrunk) && live[shrunk.len()..].iter().all(|b| *b == b' ') {
                matches.push(mod_name.clone());
            }
        }
        let verdict = if matches.is_empty() {
            "NO LIBRARY MOD MATCHES".to_string()
        } else {
            format!("== shrunk output of {}", matches.join(" / "))
        };
        *counts
            .entry(if matches.is_empty() {
                "(unattributed)".to_string()
            } else {
                matches.join(" / ")
            })
            .or_default() += 1;
        println!("{rel}: {verdict}");
    }
    println!("--");
    for (who, count) in counts {
        println!("{count:>3}  {who}");
    }
}

fn main() {
    let args: Vec<String> = std::env::args().skip(1).collect();
    let mut wanted: Vec<String> = Vec::new();
    let mut all_ops = false;
    let mut list_only = false;
    let mut shrink = false;
    let mut dump_to: Option<PathBuf> = None;
    let mut source: Option<Vec<u8>> = None;
    let mut i = 0;
    while i < args.len() {
        match args[i].as_str() {
            "--system" => {
                wanted.push(args[i + 1].clone());
                i += 2;
            }
            "--all-ops" => {
                all_ops = true;
                i += 1;
            }
            "--list" => {
                list_only = true;
                i += 1;
            }
            "--shrink" => {
                shrink = true;
                i += 1;
            }
            "--dump-to" => {
                dump_to = Some(PathBuf::from(&args[i + 1]));
                i += 2;
            }
            "--crc-check" => {
                let root = PathBuf::from(&args[i + 1]);
                let data_dir = args
                    .get(i + 2)
                    .filter(|a| !a.starts_with("--"))
                    .map(PathBuf::from);
                crc_check(&root, data_dir.as_deref(), None);
                return;
            }
            "--attribute" => {
                // --attribute <tf2_root> <mods.zip>
                attribute_modified(Path::new(&args[i + 1]), Path::new(&args[i + 2]));
                return;
            }
            "--crc-loose" => {
                // --crc-loose <tf2_root> <dir of loose .pcf files>
                crc_check(Path::new(&args[i + 1]), None, Some(Path::new(&args[i + 2])));
                return;
            }
            "--file" => {
                source = Some(std::fs::read(&args[i + 1]).expect("read file"));
                i += 2;
            }
            "--live" => {
                source = Some(read_live(Path::new(&args[i + 1]), &args[i + 2]));
                i += 3;
            }
            "--snapshot" => {
                source = Some(read_snapshot(Path::new(&args[i + 1]), &args[i + 2]));
                i += 3;
            }
            "--zip" => {
                source = Some(read_zip_entry(Path::new(&args[i + 1]), &args[i + 2]));
                i += 3;
            }
            "--find" => {
                let root = PathBuf::from(&args[i + 1]);
                let data_dir = args
                    .get(i + 2)
                    .filter(|a| !a.starts_with("--"))
                    .map(PathBuf::from);
                i += if data_dir.is_some() { 3 } else { 2 };
                // Remaining --system flags name what to find.
                let mut names = Vec::new();
                while i < args.len() {
                    if args[i] == "--system" {
                        names.push(args[i + 1].clone());
                        i += 2;
                    } else {
                        i += 1;
                    }
                }
                find_systems(&root, data_dir.as_deref(), &names);
                return;
            }
            other => panic!("unknown argument {other}"),
        }
    }
    let bytes = source.expect("pick a source: --file / --live / --snapshot / --zip / --find");
    println!("bytes={} trailing_spaces={}", bytes.len(), {
        bytes.iter().rev().take_while(|b| **b == b' ').count()
    });
    if let Some(path) = &dump_to {
        std::fs::write(path, &bytes).expect("dump bytes");
        println!("wrote {} bytes to {}", bytes.len(), path.display());
    }
    let mut pcf = decode_pcf(&bytes).expect("decode pcf");
    if shrink {
        // The same pipeline apply.rs runs on every mod file before patching.
        execs_core::pcf::remove_duplicate_elements(&mut pcf).expect("shrink");
        let encoded = execs_core::pcf::encode_pcf(&pcf).expect("encode");
        println!("shrunk to {} bytes", encoded.len());
        if let Some(path) = &dump_to {
            let out = path.with_extension("shrunk.pcf");
            std::fs::write(&out, &encoded).expect("dump shrunk");
            println!("wrote shrunk bytes to {}", out.display());
        }
    }
    dump_systems(&pcf, &wanted, all_ops, list_only);
}
