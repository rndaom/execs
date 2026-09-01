//! Preloader tests. They exercise the pipeline end to end, so they stay
//! together rather than being split across the module they cover.

use std::collections::BTreeMap;
use std::path::Path;

use crate::pcf::{decode_pcf, encode_pcf, PcfFile};
use crate::vpk::map_vpk_entries;

use super::apply::*;
use super::gameinfo::*;
use super::pack::*;
use super::state::*;
use super::*;
use crate::pcf::{PcfAttr, PcfElement, PcfValue, PCF_HEADERS};
use crate::test_temp_dir;
use crate::vpk::read_vpk_dir_file;
use std::io::Write;

fn tiny_pcf(system: &str, radius: f32) -> Vec<u8> {
    let file = PcfFile {
        version: PCF_HEADERS[1].to_string(),
        string_dictionary: vec![
            b"DmeElement".to_vec(),
            b"DmeParticleSystemDefinition".to_vec(),
            b"particleSystemDefinitions".to_vec(),
            b"radius".to_vec(),
        ],
        elements: vec![
            PcfElement {
                type_name_index: 0,
                name: b"root".to_vec(),
                signature: [1; 16],
                attributes: vec![(
                    b"particleSystemDefinitions".to_vec(),
                    PcfAttr {
                        type_code: crate::pcf::ELEMENT_ARRAY_TYPE,
                        value: PcfValue::Array(vec![PcfValue::Element(1)]),
                    },
                )],
            },
            PcfElement {
                type_name_index: 1,
                name: system.as_bytes().to_vec(),
                signature: [2; 16],
                attributes: vec![(
                    b"radius".to_vec(),
                    PcfAttr {
                        type_code: 3,
                        value: PcfValue::Float(radius.to_bits()),
                    },
                )],
            },
        ],
    };
    encode_pcf(&file).unwrap()
}

fn fake_root() -> (std::path::PathBuf, std::path::PathBuf) {
    let dir = test_temp_dir();
    let root = dir.join("game");
    let data = dir.join("data");
    std::fs::create_dir_all(root.join("tf/custom")).unwrap();
    std::fs::write(
        root.join("tf/gameinfo.txt"),
        "\"GameInfo\"\r\n{\r\n\ttype multiplayer_only\r\n}\r\n",
    )
    .unwrap();

    let mut files = BTreeMap::new();
    let vanilla = tiny_pcf("water_effect", 9.0);
    // Padded stock entry so a same-or-smaller mod fits.
    let mut stock = vanilla.clone();
    stock.resize(stock.len() + 64, b' ');
    files.insert("particles/water.pcf".to_string(), stock.clone());
    files.insert("particles/water_dx80.pcf".to_string(), stock.clone());
    files.insert("particles/disguise.pcf".to_string(), {
        let mut disguise = tiny_pcf("spy_smoke", 3.0);
        disguise.resize(disguise.len() + 32, b' ');
        disguise
    });
    write_split_vpk(&root.join("tf").join(MISC_VPK), &files);
    (root, data)
}

/// A split VPK like the real tf2_misc: entries in the `_dir.vpk` tree,
/// data in a `_000.vpk` sibling — the layout the patcher requires.
fn write_split_vpk(dir_path: &Path, files: &BTreeMap<String, Vec<u8>>) {
    let mut grouped: BTreeMap<String, BTreeMap<String, BTreeMap<String, Vec<u8>>>> =
        BTreeMap::new();
    for (rel, bytes) in files {
        let (path, file) = rel.rsplit_once('/').unwrap_or((" ", rel.as_str()));
        let (name, ext) = file.rsplit_once('.').unwrap_or((file, " "));
        grouped
            .entry(ext.to_string())
            .or_default()
            .entry(path.to_string())
            .or_default()
            .insert(name.to_string(), bytes.clone());
    }
    let mut tree = Vec::new();
    let mut archive = Vec::new();
    let cstr = |tree: &mut Vec<u8>, s: &str| {
        tree.extend_from_slice(s.as_bytes());
        tree.push(0);
    };
    for (ext, paths) in &grouped {
        cstr(&mut tree, ext);
        for (path, names) in paths {
            cstr(&mut tree, path);
            for (name, bytes) in names {
                cstr(&mut tree, name);
                tree.extend_from_slice(&crate::vpk::crc32(bytes).to_le_bytes());
                tree.extend_from_slice(&0u16.to_le_bytes());
                tree.extend_from_slice(&0u16.to_le_bytes());
                tree.extend_from_slice(&(archive.len() as u32).to_le_bytes());
                tree.extend_from_slice(&(bytes.len() as u32).to_le_bytes());
                tree.extend_from_slice(&0xffffu16.to_le_bytes());
                archive.extend_from_slice(bytes);
            }
            tree.push(0);
        }
        tree.push(0);
    }
    tree.push(0);
    let mut dir = Vec::with_capacity(12 + tree.len());
    dir.extend_from_slice(&0x55aa_1234u32.to_le_bytes());
    dir.extend_from_slice(&1u32.to_le_bytes());
    dir.extend_from_slice(&(tree.len() as u32).to_le_bytes());
    dir.extend_from_slice(&tree);
    std::fs::write(dir_path, dir).unwrap();
    let name = dir_path.file_name().unwrap().to_str().unwrap();
    let sibling = dir_path
        .parent()
        .unwrap()
        .join(name.replace("_dir.vpk", "_000.vpk"));
    std::fs::write(sibling, archive).unwrap();
}

fn fake_mods_zip(dir: &Path) -> std::path::PathBuf {
    let path = dir.join("mods.zip");
    let file = std::fs::File::create(&path).unwrap();
    let mut writer = zip::ZipWriter::new(file);
    let options = zip::write::SimpleFileOptions::default()
        .compression_method(zip::CompressionMethod::Deflated);
    writer
        .start_file(
            "mods/particles/Blue Water/actual_particles/water.pcf",
            options,
        )
        .unwrap();
    writer.write_all(&tiny_pcf("water_effect", 4.0)).unwrap();
    writer
        .start_file(
            "mods/particles/Blue Water/materials/water/blue.vmt",
            options,
        )
        .unwrap();
    writer.write_all(b"\"LightmappedGeneric\" {}").unwrap();
    writer
        .start_file("mods/addons/Flat Look/mod.json", options)
        .unwrap();
    writer
        .write_all(br#"{"addon_name":"Flat Look Pro","type":"Texture","description":"Flat."}"#)
        .unwrap();
    writer
        .start_file("mods/addons/Flat Look/materials/models/flat.vmt", options)
        .unwrap();
    writer
        .write_all(b"\"VertexlitGeneric\"\n{\n\t\"$ignorez\" \"1\"\n}\n")
        .unwrap();
    writer
        .start_file(
            "mods/addons/Flat Look/scripts/game_sounds_custom.txt",
            options,
        )
        .unwrap();
    writer.write_all(b"ignored").unwrap();
    writer.finish().unwrap();
    path
}

#[test]
fn gameinfo_toggle_roundtrips() {
    let (root, data) = fake_root();
    let before = std::fs::read(root.join("tf/gameinfo.txt")).unwrap();
    assert!(!gameinfo_bypass_state(&root).unwrap().enabled);
    assert!(set_gameinfo_bypass(&root, &data, true, &[]).unwrap());
    assert!(gameinfo_bypass_state(&root).unwrap().enabled);
    let bypassed = std::fs::read(root.join("tf/gameinfo.txt")).unwrap();
    assert!(bypassed
        .windows(b"//type multiplayer_only".len())
        .any(|window| window == b"//type multiplayer_only"));
    // Idempotent, and the pristine backup exists.
    assert!(!set_gameinfo_bypass(&root, &data, true, &[]).unwrap());
    assert_eq!(
        std::fs::read(data.join("preloader/gameinfo.original.txt")).unwrap(),
        before
    );
    assert!(set_gameinfo_bypass(&root, &data, false, &[]).unwrap());
    assert_eq!(std::fs::read(root.join("tf/gameinfo.txt")).unwrap(), before);
}

fn running_names() -> Vec<String> {
    // The lock matches on the current platform's process name, so a Linux
    // test run needs the Linux name to exercise the same branch.
    let name = if cfg!(windows) {
        "tf_win64.exe"
    } else {
        "tf_linux64"
    };
    vec!["explorer".to_string(), name.to_string()]
}

/// A gameinfo.txt line carrying a trailing comment must round-trip
/// byte-for-byte, and must never be read as "already bypassed".
#[test]
fn gameinfo_trailing_comment_is_not_a_bypass_and_survives_the_round_trip() {
    let (root, data) = fake_root();
    let path = root.join("tf/gameinfo.txt");
    let before =
        b"\"GameInfo\"\r\n{\r\n\ttype\tmultiplayer_only\t// annotated by hand\r\n}\r\n".to_vec();
    std::fs::write(&path, &before).unwrap();

    // The trailing `//` sits AFTER `type`, so the key is still live.
    assert!(!gameinfo_bypass_state(&root).unwrap().enabled);

    assert!(set_gameinfo_bypass(&root, &data, true, &[]).unwrap());
    assert!(gameinfo_bypass_state(&root).unwrap().enabled);
    let bypassed = std::fs::read(&path).unwrap();
    assert!(line_has(&bypassed, b"//type\tmultiplayer_only"));
    // The annotation is untouched.
    assert!(line_has(&bypassed, b"// annotated by hand"));

    assert!(set_gameinfo_bypass(&root, &data, false, &[]).unwrap());
    assert_eq!(std::fs::read(&path).unwrap(), before);
}

/// CRLF line ends and a UTF-8 BOM are game bytes; only the two `//` bytes
/// may ever differ.
#[test]
fn gameinfo_preserves_crlf_and_bom() {
    let (root, data) = fake_root();
    let path = root.join("tf/gameinfo.txt");
    let mut before = vec![0xEF, 0xBB, 0xBF];
    before.extend_from_slice(b"\"GameInfo\"\r\n{\r\n\ttype multiplayer_only\r\n}\r\n");
    std::fs::write(&path, &before).unwrap();

    set_gameinfo_bypass(&root, &data, true, &[]).unwrap();
    let bypassed = std::fs::read(&path).unwrap();
    assert_eq!(&bypassed[0..3], &[0xEF, 0xBB, 0xBF]);
    assert_eq!(bypassed.len(), before.len() + 2);
    assert_eq!(
        bypassed.iter().filter(|byte| **byte == b'\r').count(),
        before.iter().filter(|byte| **byte == b'\r').count()
    );

    set_gameinfo_bypass(&root, &data, false, &[]).unwrap();
    assert_eq!(std::fs::read(&path).unwrap(), before);
}

/// A commented example line further down the file is Valve's, not ours.
#[test]
fn gameinfo_toggles_only_the_first_type_line() {
    let (root, data) = fake_root();
    let path = root.join("tf/gameinfo.txt");
    let before =
        b"\"GameInfo\"\n{\n\ttype multiplayer_only\n\t//type multiplayer_only\n}\n".to_vec();
    std::fs::write(&path, &before).unwrap();

    set_gameinfo_bypass(&root, &data, true, &[]).unwrap();
    let bypassed = String::from_utf8(std::fs::read(&path).unwrap()).unwrap();
    assert_eq!(bypassed.matches("//type multiplayer_only").count(), 2);

    // Reverting puts the first line back and leaves the example commented.
    assert!(set_gameinfo_bypass(&root, &data, false, &[]).unwrap());
    assert_eq!(std::fs::read(&path).unwrap(), before);
}

/// After a TF2 update replaces gameinfo.txt while the bypass is off, the
/// backup must follow the new file — and it must be restorable.
#[test]
fn gameinfo_backup_refreshes_after_a_game_update_and_restores() {
    let (root, data) = fake_root();
    let path = root.join("tf/gameinfo.txt");
    let backup = data.join("preloader/gameinfo.original.txt");
    let original = std::fs::read(&path).unwrap();

    set_gameinfo_bypass(&root, &data, true, &[]).unwrap();
    assert_eq!(std::fs::read(&backup).unwrap(), original);
    // While bypassed, the (edited) live file must NOT overwrite the backup.
    set_gameinfo_bypass(&root, &data, true, &[]).unwrap();
    assert_eq!(std::fs::read(&backup).unwrap(), original);
    set_gameinfo_bypass(&root, &data, false, &[]).unwrap();

    // A game update rewrites the file with the bypass off.
    let updated =
        b"\"GameInfo\"\r\n{\r\n\tgame \"Team Fortress\"\r\n\ttype multiplayer_only\r\n}\r\n"
            .to_vec();
    std::fs::write(&path, &updated).unwrap();
    set_gameinfo_bypass(&root, &data, true, &[]).unwrap();
    assert_eq!(std::fs::read(&backup).unwrap(), updated);

    // The backup is a real repair path.
    std::fs::write(&path, b"corrupted").unwrap();
    assert!(restore_gameinfo_from_backup(&root, &data, &[]).unwrap());
    assert_eq!(std::fs::read(&path).unwrap(), updated);
    assert!(!restore_gameinfo_from_backup(&root, &data, &[]).unwrap());
}

/// The run lock lives in core now, not only in the command layer: the
/// download between the command's check and the first write is exactly
/// the window a user can start TF2 in.
#[test]
fn preloader_writes_refuse_while_tf2_runs_and_touch_nothing() {
    let (root, data) = fake_root();
    let zip_path = fake_mods_zip(root.parent().unwrap());
    let gameinfo = root.join("tf/gameinfo.txt");
    let vpk_path = root.join("tf").join(MISC_VPK);
    let sibling_path = root.join("tf").join("tf2_misc_000.vpk");

    // Install something first so revert has real work to refuse.
    let selection = PreloaderSelection {
        addons: vec![],
        particle_mods: vec!["Blue Water".into()],
    };
    apply_preloader_selection(&root, &data, &zip_path, &selection, &[]).unwrap();

    let gameinfo_before = std::fs::read(&gameinfo).unwrap();
    let dir_before = std::fs::read(&vpk_path).unwrap();
    let sibling_before = std::fs::read(&sibling_path).unwrap();
    let running = running_names();
    let locked = crate::process_lock::WriteLockError::GameRunning.message();

    assert_eq!(
        apply_preloader_selection(&root, &data, &zip_path, &selection, &running).unwrap_err(),
        locked
    );
    assert_eq!(
        revert_preloader(&root, &data, &running).unwrap_err(),
        locked
    );
    assert_eq!(
        set_gameinfo_bypass(&root, &data, false, &running).unwrap_err(),
        locked
    );
    assert_eq!(
        restore_gameinfo_from_backup(&root, &data, &running).unwrap_err(),
        locked
    );

    assert_eq!(std::fs::read(&gameinfo).unwrap(), gameinfo_before);
    assert_eq!(std::fs::read(&vpk_path).unwrap(), dir_before);
    assert_eq!(std::fs::read(&sibling_path).unwrap(), sibling_before);
    assert!(root.join("tf/custom").join(PRELOADER_VPK).is_file());
}

/// An unknown id must fail before the restore pass has uninstalled the
/// selection the user still has.
#[test]
fn unknown_addon_fails_before_anything_is_restored() {
    let (root, data) = fake_root();
    let zip_path = fake_mods_zip(root.parent().unwrap());
    let sibling_path = root.join("tf").join("tf2_misc_000.vpk");

    apply_preloader_selection(
        &root,
        &data,
        &zip_path,
        &PreloaderSelection {
            addons: vec![],
            particle_mods: vec!["Blue Water".into()],
        },
        &[],
    )
    .unwrap();
    let patched_sibling = std::fs::read(&sibling_path).unwrap();
    let patched_status = preloader_status(&root, &data).unwrap();
    assert_eq!(patched_status.particle_mods, vec!["Blue Water".to_string()]);

    let err = apply_preloader_selection(
        &root,
        &data,
        &zip_path,
        &PreloaderSelection {
            addons: vec!["no-such-addon".into()],
            particle_mods: vec![],
        },
        &[],
    )
    .unwrap_err();
    assert!(err.contains("Unknown addon"), "{err}");

    // Nothing was unpatched, and state still describes what is installed.
    assert_eq!(std::fs::read(&sibling_path).unwrap(), patched_sibling);
    let after = preloader_status(&root, &data).unwrap();
    assert_eq!(after.particle_mods, patched_status.particle_mods);
    assert_eq!(after.patched_files, patched_status.patched_files);
}

/// The shared preload cfg belongs to the mods preloader too.
#[test]
fn preload_is_wanted_tracks_installed_mods() {
    let (root, data) = fake_root();
    assert!(!preload_is_wanted(&data, &root));

    let zip_path = fake_mods_zip(root.parent().unwrap());
    apply_preloader_selection(
        &root,
        &data,
        &zip_path,
        &PreloaderSelection {
            addons: vec![],
            particle_mods: vec!["Blue Water".into()],
        },
        &[],
    )
    .unwrap();
    assert!(preload_is_wanted(&data, &root));

    revert_preloader(&root, &data, &[]).unwrap();
    assert!(!preload_is_wanted(&data, &root));

    // A stray pack on disk alone is enough.
    std::fs::write(root.join("tf/custom").join(PRELOADER_VPK), b"vpk").unwrap();
    assert!(preload_is_wanted(&data, &root));
}

#[test]
fn addon_materials_that_replace_stock_assets_still_ship_loose() {
    // The gameinfo bypass plus the itemtest preload are what carry a
    // replaced material into Casual, so shipping it is the whole point —
    // dropping it would silently disable every texture mod.
    let (root, data) = fake_root();
    let zip_path = fake_mods_zip(root.parent().unwrap());
    let mut stock = BTreeMap::new();
    stock.insert(
        "materials/models/flat.vmt".to_string(),
        b"\"VertexlitGeneric\"
{
}
"
        .to_vec(),
    );
    write_split_vpk(&root.join("tf").join("tf2_textures_dir.vpk"), &stock);

    let selection = PreloaderSelection {
        addons: vec!["Flat Look".into()],
        particle_mods: Vec::new(),
    };
    let report = apply_preloader_selection(&root, &data, &zip_path, &selection, &[]).unwrap();
    assert!(report.skipped.is_empty(), "{:?}", report.skipped);

    let custom = root.join("tf/custom").join(PRELOADER_VPK);
    let archive = read_vpk_dir_file(&custom).unwrap();
    assert!(
        archive.files.contains_key("materials/models/flat.vmt"),
        "a material replacing a stock path must still ship for the preload"
    );
}

#[test]
fn orphan_textures_get_a_material_preferring_the_stock_one() {
    let (root, data) = fake_root();
    let zip_path = fake_mods_zip(root.parent().unwrap());
    // The stock archive owns a material for the path the mod replaces.
    let mut stock = BTreeMap::new();
    stock.insert(
        "materials/models/flat.vmt".to_string(),
        b"\"VertexLitGeneric\"
{
	\"$stockmarker\"	\"1\"
}
"
        .to_vec(),
    );
    write_split_vpk(&root.join("tf").join("tf2_textures_dir.vpk"), &stock);

    let mut custom: BTreeMap<String, Vec<u8>> = BTreeMap::new();
    custom.insert("materials/models/flat.vtf".into(), b"VTF ".to_vec());
    custom.insert("materials/world/new_rock.vtf".into(), b"VTF ".to_vec());
    custom.insert("materials/world/has_one.vtf".into(), b"VTF ".to_vec());
    custom.insert("materials/world/has_one.vmt".into(), b"mine".to_vec());

    let written = synthesize_missing_vmts(&root, &mut custom);

    assert_eq!(written, 2, "only the two orphans get a material");
    assert_eq!(
        custom.get("materials/models/flat.vmt").unwrap(),
        &b"\"VertexLitGeneric\"
{
	\"$stockmarker\"	\"1\"
}
"
        .to_vec(),
        "a replaced texture reuses the stock material verbatim"
    );
    let generated = String::from_utf8(custom["materials/world/new_rock.vmt"].clone()).unwrap();
    assert!(generated.contains("LightmappedGeneric"), "{generated}");
    assert!(generated.contains("world/new_rock"), "{generated}");
    assert_eq!(
        custom.get("materials/world/has_one.vmt").unwrap(),
        &b"mine".to_vec(),
        "a material the mod ships is never overwritten"
    );
    let _ = (zip_path, data);
}

/// A model header carrying one material directory, matching the layout
/// `mdl_probe` verified against the game's own models.
fn fake_mdl(dir: &str) -> Vec<u8> {
    let mut bytes = vec![0u8; 244];
    bytes[0..4].copy_from_slice(b"IDST");
    bytes[4..8].copy_from_slice(&49i32.to_le_bytes());
    let offset = bytes.len() as i32;
    bytes.extend_from_slice(dir.as_bytes());
    bytes.push(0);
    while !bytes.len().is_multiple_of(4) {
        bytes.push(0);
    }
    let table = bytes.len() as i32;
    bytes.extend_from_slice(&offset.to_le_bytes());
    bytes[212..216].copy_from_slice(&1i32.to_le_bytes());
    bytes[216..220].copy_from_slice(&table.to_le_bytes());
    let length = bytes.len() as i32;
    bytes[76..80].copy_from_slice(&length.to_le_bytes());
    bytes
}

#[test]
fn model_materials_move_under_console_and_the_model_follows() {
    let mut custom: BTreeMap<String, Vec<u8>> = BTreeMap::new();
    custom.insert(
        "models/props_gameplay/locker.mdl".into(),
        // Real models spell the dir with backslashes.
        fake_mdl(r"\models\props_gameplay\"),
    );
    custom.insert(
        "materials/models/props_gameplay/locker.vmt".into(),
        b"\"VertexLitGeneric\"
{
	\"$basetexture\"	\"models/props_gameplay/locker\"
}
"
        .to_vec(),
    );
    custom.insert(
        "materials/models/props_gameplay/locker.vtf".into(),
        b"VTF ".to_vec(),
    );
    // A world material the mod also ships must NOT move: it rides the
    // gameinfo bypass at its stock path.
    custom.insert("materials/wood/wall.vtf".into(), b"VTF ".to_vec());

    let moved = relocate_model_materials(&mut custom);

    assert_eq!(moved, 2, "the vmt and vtf move together");
    assert!(custom.contains_key("materials/console/models/props_gameplay/locker.vtf"));
    assert!(!custom.contains_key("materials/models/props_gameplay/locker.vtf"));
    assert!(
        custom.contains_key("materials/wood/wall.vtf"),
        "world stays"
    );

    // The material now points at the relocated texture.
    let vmt =
        String::from_utf8(custom["materials/console/models/props_gameplay/locker.vmt"].clone())
            .unwrap();
    assert!(
        vmt.contains("console/models/props_gameplay/locker"),
        "{vmt}"
    );
    assert!(vmt.contains("VertexLitGeneric"), "{vmt}");

    // The model searches the relocated dir first, stock second.
    let dirs = crate::mdl::material_dirs(&custom["models/props_gameplay/locker.mdl"]).unwrap();
    assert_eq!(dirs[0], "console/models/props_gameplay/");
    assert_eq!(dirs[1], "models/props_gameplay/");
}

#[test]
fn relocation_is_a_noop_without_models_or_matching_materials() {
    let mut only_world: BTreeMap<String, Vec<u8>> = BTreeMap::new();
    only_world.insert("materials/wood/wall.vtf".into(), b"VTF ".to_vec());
    assert_eq!(relocate_model_materials(&mut only_world), 0);

    // A model whose materials the mod does not ship must not be rewritten.
    let mut unshipped: BTreeMap<String, Vec<u8>> = BTreeMap::new();
    let model = fake_mdl("models/props_gameplay/");
    unshipped.insert("models/props_gameplay/locker.mdl".into(), model.clone());
    assert_eq!(relocate_model_materials(&mut unshipped), 0);
    assert_eq!(unshipped["models/props_gameplay/locker.mdl"], model);
}

#[test]
fn catalog_lists_addons_and_particles() {
    let dir = test_temp_dir();
    let zip_path = fake_mods_zip(&dir);
    let catalog = read_mods_catalog(&zip_path).unwrap();
    assert_eq!(catalog.addons.len(), 1);
    assert_eq!(catalog.addons[0].id, "Flat Look");
    assert_eq!(catalog.addons[0].name, "Flat Look Pro");
    assert_eq!(catalog.addons[0].kind, "Texture");
    assert_eq!(catalog.particle_mods.len(), 1);
    assert_eq!(catalog.particle_mods[0].pcf_files, vec!["water.pcf"]);
}

#[test]
fn apply_patches_and_revert_restores() {
    let (root, data) = fake_root();
    let zip_path = fake_mods_zip(root.parent().unwrap());
    let vpk_path = root.join("tf").join(MISC_VPK);
    let sibling_path = root.join("tf").join("tf2_misc_000.vpk");
    let pristine_dir = std::fs::read(&vpk_path).unwrap();
    let pristine_sibling = std::fs::read(&sibling_path).unwrap();

    let selection = PreloaderSelection {
        addons: vec!["Flat Look".into()],
        particle_mods: vec!["Blue Water".into()],
    };
    let report = apply_preloader_selection(&root, &data, &zip_path, &selection, &[]).unwrap();
    assert!(report.gameinfo_bypassed);
    assert!(report.custom_vpk_written);
    assert_eq!(
        report.patched_files,
        vec![
            "particles/water.pcf".to_string(),
            "particles/water_dx80.pcf".to_string()
        ]
    );
    assert!(report.skipped.is_empty(), "{:?}", report.skipped);

    // Patched entry decodes to the mod's content, padded to stock size.
    let archive = read_vpk_dir_file(&vpk_path).unwrap();
    let patched = archive.files.get("particles/water.pcf").unwrap();
    let decoded = decode_pcf(patched).unwrap();
    let system = &decoded.elements[1];
    assert_eq!(
        system.attr(b"radius").unwrap().value,
        PcfValue::Float(4.0f32.to_bits())
    );
    // The directory file must stay byte-pristine — the stock CRCs (over
    // the now-modded data) are what the sv_pure check reads.
    assert_eq!(
        std::fs::read(&vpk_path).unwrap(),
        pristine_dir,
        "patching must never touch the _dir.vpk"
    );
    let entries = map_vpk_entries(&vpk_path).unwrap();
    let crc_entry = entries.get("particles/water.pcf").unwrap();
    assert_ne!(
        crc_entry.crc,
        crate::vpk::crc32(patched),
        "the stock CRC stays stale over modded data by design"
    );

    // Custom VPK carries the addon material with $ignorez scrubbed and
    // skips the sound-script text file.
    let custom = read_vpk_dir_file(&root.join("tf/custom").join(PRELOADER_VPK)).unwrap();
    let vmt = custom.files.get("materials/models/flat.vmt").unwrap();
    assert!(!vmt.windows(8).any(|window| window == b"$ignorez"));
    assert!(custom.files.contains_key("materials/water/blue.vmt"));
    assert!(!custom.files.contains_key("scripts/game_sounds_custom.txt"));

    let status = preloader_status(&root, &data).unwrap();
    assert!(status.gameinfo_bypassed);
    assert!(!status.stale);
    assert_eq!(status.particle_mods, vec!["Blue Water".to_string()]);

    // Re-applying with nothing selected restores particles and drops the
    // custom VPK, but keeps the bypass on.
    let report =
        apply_preloader_selection(&root, &data, &zip_path, &PreloaderSelection::default(), &[])
            .unwrap();
    assert!(report.patched_files.is_empty());
    assert!(!report.custom_vpk_written);

    let report = revert_preloader(&root, &data, &[]).unwrap();
    assert!(report.gameinfo_restored);
    assert_eq!(std::fs::read(&vpk_path).unwrap(), pristine_dir);
    assert_eq!(std::fs::read(&sibling_path).unwrap(), pristine_sibling);
    assert!(!root.join("tf/custom").join(PRELOADER_VPK).exists());
    let status = preloader_status(&root, &data).unwrap();
    assert!(!status.gameinfo_bypassed);
    assert!(status.patched_files.is_empty());
}

/// An interrupted apply can leave patched entries with state.json saying
/// nothing is patched. The pristine snapshots on disk must survive the
/// retry (never re-snapshotted from modded bytes) so revert still reaches
/// stock files.
#[test]
fn interrupted_apply_cannot_clobber_snapshots() {
    let (root, data) = fake_root();
    let zip_path = fake_mods_zip(root.parent().unwrap());
    let sibling_path = root.join("tf").join("tf2_misc_000.vpk");
    let pristine_sibling = std::fs::read(&sibling_path).unwrap();

    let selection = PreloaderSelection {
        addons: vec![],
        particle_mods: vec!["Blue Water".into()],
    };
    apply_preloader_selection(&root, &data, &zip_path, &selection, &[]).unwrap();

    // Simulate the crash: patches and snapshots exist, but tracking was
    // lost before the state save.
    let mut state = load_state(&data);
    assert!(!state.patched.is_empty());
    state.patched.clear();
    save_state(&data, &state).unwrap();

    // Retrying must adopt the orphaned snapshots instead of snapshotting
    // the currently-modded bytes as "stock".
    apply_preloader_selection(&root, &data, &zip_path, &selection, &[]).unwrap();
    let report = revert_preloader(&root, &data, &[]).unwrap();
    assert!(report.failures.is_empty(), "{:?}", report.failures);
    assert_eq!(std::fs::read(&sibling_path).unwrap(), pristine_sibling);
}

/// mtime moves whenever we patch (and when restores half-fail); only a
/// resized VPK is a game update. Drift alone must not trigger the
/// baseline reset that throws snapshots away.
#[test]
fn mtime_drift_does_not_reset_baseline() {
    let (root, data) = fake_root();
    let zip_path = fake_mods_zip(root.parent().unwrap());
    let vpk_path = root.join("tf").join(MISC_VPK);
    let sibling_path = root.join("tf").join("tf2_misc_000.vpk");
    let pristine_sibling = std::fs::read(&sibling_path).unwrap();

    apply_preloader_selection(
        &root,
        &data,
        &zip_path,
        &PreloaderSelection {
            addons: vec![],
            particle_mods: vec!["Blue Water".into()],
        },
        &[],
    )
    .unwrap();

    // Touch the file without changing content or length.
    let current = std::fs::read(&vpk_path).unwrap();
    std::fs::write(&vpk_path, &current).unwrap();

    assert!(!preloader_status(&root, &data).unwrap().stale);
    let report = revert_preloader(&root, &data, &[]).unwrap();
    assert!(
        !report.restored_files.is_empty(),
        "drift must not skip the restore: {:?}",
        report.failures
    );
    assert_eq!(std::fs::read(&sibling_path).unwrap(), pristine_sibling);
}

#[test]
fn oversized_mod_is_skipped_with_notice() {
    let (root, data) = fake_root();
    let dir = root.parent().unwrap();
    let zip_path = dir.join("big.zip");
    let file = std::fs::File::create(&zip_path).unwrap();
    let mut writer = zip::ZipWriter::new(file);
    let options = zip::write::SimpleFileOptions::default();
    writer
        .start_file("mods/particles/Big/actual_particles/water.pcf", options)
        .unwrap();
    // A pcf with a huge un-shrinkable payload: binary attr of spaces.
    let mut big = PcfFile {
        version: PCF_HEADERS[1].to_string(),
        string_dictionary: vec![
            b"DmeElement".to_vec(),
            b"particleSystemDefinitions".to_vec(),
            b"payload".to_vec(),
        ],
        elements: vec![PcfElement {
            type_name_index: 0,
            name: b"root".to_vec(),
            signature: [0; 16],
            attributes: vec![(
                b"particleSystemDefinitions".to_vec(),
                PcfAttr {
                    type_code: crate::pcf::ELEMENT_ARRAY_TYPE,
                    value: PcfValue::Array(vec![]),
                },
            )],
        }],
    };
    big.elements[0].attributes.push((
        b"payload".to_vec(),
        PcfAttr {
            type_code: 6,
            value: PcfValue::Binary(vec![b' '; 4096]),
        },
    ));
    writer.write_all(&encode_pcf(&big).unwrap()).unwrap();
    writer.finish().unwrap();

    let vpk_before = std::fs::read(root.join("tf").join(MISC_VPK)).unwrap();
    let sibling_before = std::fs::read(root.join("tf").join("tf2_misc_000.vpk")).unwrap();
    let report = apply_preloader_selection(
        &root,
        &data,
        &zip_path,
        &PreloaderSelection {
            addons: vec![],
            particle_mods: vec!["Big".into()],
        },
        &[],
    )
    .unwrap();
    assert!(report.patched_files.is_empty());
    assert!(report.skipped.iter().any(
        |notice| notice.file == "water.pcf" && notice.reason.contains("over the stock budget")
    ));
    assert_eq!(
        std::fs::read(root.join("tf").join(MISC_VPK)).unwrap(),
        vpk_before
    );
    assert_eq!(
        std::fs::read(root.join("tf").join("tf2_misc_000.vpk")).unwrap(),
        sibling_before
    );
}

#[test]
fn rebuild_keep_lists_prefer_sole_homes() {
    let mut roots = BTreeMap::new();
    roots.insert(
        "bigboom.pcf".to_string(),
        vec![
            "boom_own".to_string(),
            "shared".to_string(),
            "dup_only".to_string(),
        ],
    );
    roots.insert("explosion.pcf".to_string(), vec!["shared".to_string()]);
    roots.insert("halloween.pcf".to_string(), vec!["dup_only".to_string()]);
    let keep = rebuild_keep_lists(&roots);
    let bigboom = &keep["bigboom.pcf"];
    assert!(bigboom.contains(&"boom_own".to_string()));
    assert!(!bigboom.contains(&"shared".to_string()));
    // Shared only among rebuild files: alphabetically first keeps it.
    assert!(bigboom.contains(&"dup_only".to_string()));
    assert!(!keep["halloween.pcf"].contains(&"dup_only".to_string()));
}
