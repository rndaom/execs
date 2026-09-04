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
use std::io::{Read, Seek, SeekFrom, Write};

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

#[cfg(unix)]
fn link_dir(target: &Path, link: &Path) {
    std::os::unix::fs::symlink(target, link).unwrap();
}

#[cfg(windows)]
fn link_dir(target: &Path, link: &Path) {
    let status = std::process::Command::new("cmd")
        .args(["/d", "/c", "mklink", "/j"])
        .arg(link)
        .arg(target)
        .status()
        .unwrap();
    assert!(status.success(), "could not create test junction");
}

#[cfg(unix)]
fn unlink_dir(link: &Path) {
    std::fs::remove_file(link).unwrap();
}

#[cfg(windows)]
fn unlink_dir(link: &Path) {
    std::fs::remove_dir(link).unwrap();
}

fn assert_link_refusal(error: &str) {
    assert!(
        error.contains("link") || error.contains("reparse"),
        "expected a linked-path refusal, got: {error}"
    );
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

#[derive(Debug, PartialEq, Eq)]
struct InstalledBytes {
    gameinfo: Vec<u8>,
    misc_dir: Vec<u8>,
    misc_data: Vec<u8>,
    custom: Option<Vec<u8>>,
    state: Option<Vec<u8>>,
    gameinfo_backup: Option<Vec<u8>>,
    originals: BTreeMap<String, Vec<u8>>,
}

fn optional_bytes(path: &Path) -> Option<Vec<u8>> {
    std::fs::read(path).ok()
}

fn installed_bytes(root: &Path, data: &Path) -> InstalledBytes {
    let originals = std::fs::read_dir(originals_dir(data))
        .map(|entries| {
            entries
                .map(|entry| {
                    let entry = entry.unwrap();
                    (
                        entry.file_name().to_string_lossy().into_owned(),
                        std::fs::read(entry.path()).unwrap(),
                    )
                })
                .collect()
        })
        .unwrap_or_default();
    InstalledBytes {
        gameinfo: std::fs::read(root.join("tf/gameinfo.txt")).unwrap(),
        misc_dir: std::fs::read(root.join("tf").join(MISC_VPK)).unwrap(),
        misc_data: std::fs::read(root.join("tf/tf2_misc_000.vpk")).unwrap(),
        custom: optional_bytes(&root.join("tf/custom").join(PRELOADER_VPK)),
        state: optional_bytes(&state_path(data)),
        gameinfo_backup: optional_bytes(&gameinfo_backup_path(data)),
        originals,
    }
}

fn corrupt_zip_payload(path: &Path, name: &str) {
    let file = std::fs::File::open(path).unwrap();
    let mut archive = zip::ZipArchive::new(file).unwrap();
    let entry = archive.by_name(name).unwrap();
    let at = entry.data_start() + entry.compressed_size() / 2;
    drop(entry);
    drop(archive);

    let mut file = std::fs::OpenOptions::new()
        .read(true)
        .write(true)
        .open(path)
        .unwrap();
    file.seek(SeekFrom::Start(at)).unwrap();
    let mut byte = [0u8; 1];
    file.read_exact(&mut byte).unwrap();
    byte[0] ^= 0x80;
    file.seek(SeekFrom::Start(at)).unwrap();
    file.write_all(&byte).unwrap();
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

#[test]
fn gameinfo_reads_and_writes_refuse_a_linked_tf_parent() {
    let dir = test_temp_dir();
    let root = dir.join("game");
    let data = dir.join("data");
    let outside = dir.join("outside-tf");
    std::fs::create_dir_all(&root).unwrap();
    std::fs::create_dir_all(&outside).unwrap();
    let outside_gameinfo = outside.join("gameinfo.txt");
    let pristine = b"\"GameInfo\"\n{\n\ttype multiplayer_only\n}\n";
    std::fs::write(&outside_gameinfo, pristine).unwrap();
    link_dir(&outside, &root.join("tf"));

    let err = gameinfo_bypass_state(&root).unwrap_err();
    assert_link_refusal(&err);
    let err = set_gameinfo_bypass(&root, &data, true, &[]).unwrap_err();
    assert_link_refusal(&err);
    assert_eq!(std::fs::read(&outside_gameinfo).unwrap(), pristine);
    assert!(!gameinfo_backup_path(&data).exists());

    unlink_dir(&root.join("tf"));
}

#[test]
fn preloader_pack_reads_writes_and_removals_refuse_a_linked_custom_parent() {
    let (root, data) = fake_root();
    let zip_path = fake_mods_zip(root.parent().unwrap());
    let custom = root.join("tf").join("custom");
    let outside = root.parent().unwrap().join("outside-custom");
    std::fs::remove_dir(&custom).unwrap();
    std::fs::create_dir_all(&outside).unwrap();
    let outside_pack = outside.join(PRELOADER_VPK);
    std::fs::write(&outside_pack, b"outside must survive").unwrap();
    link_dir(&outside, &custom);

    let selection = PreloaderSelection {
        addons: vec!["Flat Look".into()],
        particle_mods: Vec::new(),
        profile_particle_mods: Vec::new(),
    };
    let err = apply_preloader_selection(&root, &data, &zip_path, &selection, &[]).unwrap_err();
    assert_link_refusal(&err);
    assert_eq!(
        std::fs::read(&outside_pack).unwrap(),
        b"outside must survive"
    );

    let err = preloader_status(&root, &data).unwrap_err();
    assert_link_refusal(&err);
    let err = revert_preloader(&root, &data, &[]).unwrap_err();
    assert_link_refusal(&err);
    assert_eq!(
        std::fs::read(&outside_pack).unwrap(),
        b"outside must survive"
    );

    unlink_dir(&custom);
}

#[test]
fn all_preloader_app_data_mutations_refuse_a_linked_preloader_parent() {
    let (root, data) = fake_root();
    let outside = root.parent().unwrap().join("outside-preloader-data");
    std::fs::create_dir_all(&data).unwrap();
    std::fs::create_dir_all(outside.join("apply-transaction")).unwrap();
    let victim = outside.join("victim.txt");
    std::fs::write(&victim, b"outside must survive").unwrap();
    link_dir(&outside, &data.join("preloader"));
    let live_before = std::fs::read(root.join("tf/gameinfo.txt")).unwrap();

    let error = save_state(&data, &PreloaderState::default()).unwrap_err();
    assert_link_refusal(&error);
    let error = set_gameinfo_bypass(&root, &data, true, &[]).unwrap_err();
    assert_link_refusal(&error);
    let error = recover_pending_preloader(&root, &data, &[]).unwrap_err();
    assert_link_refusal(&error);

    assert_eq!(std::fs::read(&victim).unwrap(), b"outside must survive");
    assert_eq!(
        std::fs::read(root.join("tf/gameinfo.txt")).unwrap(),
        live_before
    );
    assert!(!outside.join("state.json").exists());
    assert!(!outside.join("gameinfo.original.txt").exists());
    unlink_dir(&data.join("preloader"));
}

#[test]
fn gameinfo_status_does_not_create_a_missing_tf_parent() {
    let dir = test_temp_dir();
    let root = dir.join("game");
    std::fs::create_dir(&root).unwrap();

    assert_eq!(
        gameinfo_bypass_state(&root).unwrap(),
        GameinfoBypass {
            found: false,
            enabled: false,
        }
    );
    assert!(!root.join("tf").exists());
}

#[test]
fn preloader_status_does_not_create_a_missing_custom_directory() {
    let (root, data) = fake_root();
    let custom = root.join("tf").join("custom");
    std::fs::remove_dir(&custom).unwrap();

    let status = preloader_status(&root, &data).unwrap();
    assert!(!status.custom_vpk_present);
    assert!(!custom.exists());
    assert!(!preload_is_wanted(&data, &root).unwrap());
    assert!(!custom.exists());
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

#[test]
fn gameinfo_does_not_toggle_prefixes_or_lines_with_extra_tokens() {
    let (root, data) = fake_root();
    let path = root.join("tf/gameinfo.txt");
    let before = b"\"GameInfo\"\n{\n\ttype multiplayer_only_extra\n\ttype multiplayer_only / not-a-comment\n}\n".to_vec();
    std::fs::write(&path, &before).unwrap();

    let err = set_gameinfo_bypass(&root, &data, true, &[]).unwrap_err();
    assert!(err.contains("expected GameInfo"), "{err}");
    assert_eq!(std::fs::read(path).unwrap(), before);
    assert!(!gameinfo_backup_path(&data).exists());
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
        profile_particle_mods: Vec::new(),
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

#[test]
fn gameinfo_rechecks_a_fresh_process_sample_at_the_write_boundary() {
    let (root, data) = fake_root();
    let path = root.join("tf/gameinfo.txt");
    let before = std::fs::read(&path).unwrap();
    let sample = || running_names();

    let err = set_gameinfo_bypass_with_sampler(&root, &data, true, &[], &sample).unwrap_err();
    assert!(super::is_game_running_error(&err), "{err}");
    assert_eq!(std::fs::read(path).unwrap(), before);
}

#[test]
fn an_already_bypassed_gameinfo_without_a_pristine_backup_is_refused() {
    let (root, data) = fake_root();
    let path = root.join("tf/gameinfo.txt");
    let bypassed = b"\"GameInfo\"\n{\n\t//type multiplayer_only\n}\n".to_vec();
    std::fs::write(&path, &bypassed).unwrap();

    let err = set_gameinfo_bypass(&root, &data, true, &[]).unwrap_err();
    assert!(err.contains("no pristine backup"), "{err}");
    assert_eq!(std::fs::read(path).unwrap(), bypassed);
    assert!(!gameinfo_backup_path(&data).exists());
}

#[test]
fn malformed_gameinfo_status_is_an_error_not_a_clean_disabled_state() {
    let (root, _data) = fake_root();
    std::fs::write(root.join("tf/gameinfo.txt"), b"not a GameInfo file").unwrap();
    let err = gameinfo_bypass_state(&root).unwrap_err();
    assert!(err.contains("expected GameInfo"), "{err}");
}

#[test]
fn particle_patch_rechecks_the_process_at_its_live_write_boundary() {
    let (root, data) = fake_root();
    let zip_path = fake_mods_zip(root.parent().unwrap());
    let sibling = root.join("tf/tf2_misc_000.vpk");
    let sibling_before = std::fs::read(&sibling).unwrap();
    let gameinfo = root.join("tf/gameinfo.txt");
    let gameinfo_before = std::fs::read(&gameinfo).unwrap();
    let sample = || running_names();

    let err = apply_preloader_selection_with_sampler(
        &root,
        &data,
        &zip_path,
        &blue_water(),
        &[],
        &sample,
    )
    .unwrap_err();
    assert!(super::is_game_running_error(&err), "{err}");
    assert_eq!(std::fs::read(sibling).unwrap(), sibling_before);
    assert_eq!(std::fs::read(gameinfo).unwrap(), gameinfo_before);
    assert!(!root.join("tf/custom").join(PRELOADER_VPK).exists());
    // Snapshot/state deliberately precede the official write. A retry can
    // now observe stock in place and consume this recovery record safely.
    assert_eq!(load_state(&data).unwrap().patched.len(), 1);
}

#[test]
fn custom_pack_write_rechecks_the_process_at_its_live_write_boundary() {
    let (root, data) = fake_root();
    let zip_path = fake_mods_zip(root.parent().unwrap());
    let gameinfo = root.join("tf/gameinfo.txt");
    let gameinfo_before = std::fs::read(&gameinfo).unwrap();
    let sample = || running_names();
    let selection = PreloaderSelection {
        addons: vec!["Flat Look".into()],
        particle_mods: Vec::new(),
        profile_particle_mods: Vec::new(),
    };

    let err =
        apply_preloader_selection_with_sampler(&root, &data, &zip_path, &selection, &[], &sample)
            .unwrap_err();
    assert!(super::is_game_running_error(&err), "{err}");
    assert!(!root.join("tf/custom").join(PRELOADER_VPK).exists());
    assert_eq!(std::fs::read(gameinfo).unwrap(), gameinfo_before);
    assert!(load_state(&data).unwrap().addons.is_empty());
}

#[test]
fn restore_rechecks_the_process_and_keeps_support_for_a_retry() {
    let (root, data) = fake_root();
    let zip_path = fake_mods_zip(root.parent().unwrap());
    apply_preloader_selection(&root, &data, &zip_path, &blue_water(), &[]).unwrap();
    let sibling = root.join("tf/tf2_misc_000.vpk");
    let sibling_before = std::fs::read(&sibling).unwrap();
    let sample = || running_names();

    let err = revert_preloader_with_sampler(&root, &data, &[], &sample).unwrap_err();
    assert!(super::is_game_running_error(&err), "{err}");
    assert_eq!(std::fs::read(sibling).unwrap(), sibling_before);
    assert_eq!(load_state(&data).unwrap().particle_mods, vec!["Blue Water"]);
    assert!(gameinfo_bypass_state(&root).unwrap().enabled);
    assert!(root.join("tf/custom").join(PRELOADER_VPK).is_file());
}

#[test]
fn status_never_treats_an_unreadable_sibling_as_clean() {
    let (root, data) = fake_root();
    std::fs::remove_file(root.join("tf/tf2_misc_000.vpk")).unwrap();
    let err = preloader_status(&root, &data).unwrap_err();
    assert!(err.contains("Could not verify particles/"), "{err}");
}

#[test]
fn patch_refuses_a_directory_mapping_that_changed_after_inspection() {
    let (root, _data) = fake_root();
    let path = root.join("tf").join(MISC_VPK);
    let entries = map_vpk_entries(&path).unwrap();
    let old = entries.get("particles/water.pcf").unwrap().clone();
    let mut files = BTreeMap::new();
    let mut replacement_stock = tiny_pcf("water_effect", 11.0);
    replacement_stock.resize(old.length as usize, b' ');
    files.insert("particles/water.pcf".to_string(), replacement_stock);
    write_split_vpk(&path, &files);

    let err = crate::vpk::patch_vpk_entry(&path, &old, &vec![0; old.length as usize]).unwrap_err();
    assert!(err.0.contains("changed location or CRC"), "{}", err.0);
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
            profile_particle_mods: Vec::new(),
        },
        &[],
    )
    .unwrap();
    let patched_sibling = std::fs::read(&sibling_path).unwrap();
    // A game update lands in between: the "game updated" hint must survive
    // the refused apply below, which used to save the new length first.
    let mut sibling = std::fs::read(&sibling_path).unwrap();
    sibling.extend_from_slice(b"appended by an update");
    std::fs::write(&sibling_path, &sibling).unwrap();
    let patched_sibling = {
        let mut grown = patched_sibling;
        grown.extend_from_slice(b"appended by an update");
        grown
    };
    let patched_status = preloader_status(&root, &data).unwrap();
    assert_eq!(patched_status.particle_mods, vec!["Blue Water".to_string()]);
    assert!(patched_status.stale);

    let err = apply_preloader_selection(
        &root,
        &data,
        &zip_path,
        &PreloaderSelection {
            addons: vec!["no-such-addon".into()],
            particle_mods: vec![],
            profile_particle_mods: Vec::new(),
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
    assert!(
        after.stale,
        "a refused apply must not clear the update hint"
    );
}

/// A hard failure after the restore pass must roll the previous selection all
/// the way back, including its support pack and logical state.
#[test]
fn a_failure_after_the_restore_pass_restores_the_previous_pack_and_state() {
    let (root, data) = fake_root();
    let zip_path = fake_mods_zip(root.parent().unwrap());
    let vpk_path = root.join("tf").join(MISC_VPK);
    let custom_vpk = root.join("tf/custom").join(PRELOADER_VPK);

    apply_preloader_selection(&root, &data, &zip_path, &blue_water(), &[]).unwrap();
    assert!(custom_vpk.is_file());

    // The next apply restores, then fails hard: the archive no longer holds
    // disguise.pcf, which the parent-collision rule needs.
    let mut files = BTreeMap::new();
    let mut stock = tiny_pcf("water_effect", 9.0);
    stock.resize(stock.len() + 64, b' ');
    files.insert("particles/water.pcf".to_string(), stock.clone());
    files.insert("particles/water_dx80.pcf".to_string(), stock);
    write_split_vpk(&vpk_path, &files);
    let err = apply_preloader_selection(&root, &data, &zip_path, &blue_water(), &[]).unwrap_err();
    assert!(err.contains("disguise.pcf"), "{err}");

    assert!(custom_vpk.exists(), "the previous pack must be rolled back");
    let status = preloader_status(&root, &data).unwrap();
    assert_eq!(status.particle_mods, vec!["Blue Water"]);
    assert!(status.addons.is_empty());
}

/// With the archive gone (a reinstall in progress), Restore cannot prove the
/// patched entries are stock. It must fail before removing the bypass, support
/// pack, selection, or recovery snapshots.
#[test]
fn revert_without_the_archive_keeps_everything_needed_for_a_retry() {
    let (root, data) = fake_root();
    let zip_path = fake_mods_zip(root.parent().unwrap());
    let gameinfo_before = std::fs::read(root.join("tf/gameinfo.txt")).unwrap();

    apply_preloader_selection(&root, &data, &zip_path, &blue_water(), &[]).unwrap();
    let vpk_len = load_state(&data).unwrap().vpk_len;
    std::fs::remove_file(root.join("tf").join(MISC_VPK)).unwrap();
    std::fs::remove_file(root.join("tf").join("tf2_misc_000.vpk")).unwrap();

    let bypassed_gameinfo = std::fs::read(root.join("tf/gameinfo.txt")).unwrap();
    assert_ne!(bypassed_gameinfo, gameinfo_before);
    let err = revert_preloader(&root, &data, &[]).unwrap_err();
    assert!(err.contains("Could not verify"), "{err}");
    assert_eq!(
        std::fs::read(root.join("tf/gameinfo.txt")).unwrap(),
        bypassed_gameinfo
    );
    assert!(root.join("tf/custom").join(PRELOADER_VPK).is_file());
    let state = load_state(&data).unwrap();
    assert_eq!(state.particle_mods, vec!["Blue Water"]);
    // The patches stay tracked, with their snapshots, for when the archive is
    // back; the hint keeps the length they were taken against.
    assert_eq!(state.patched.len(), 2);
    assert_eq!(state.vpk_len, vpk_len);
    assert!(snapshot_path(&data, "particles/water.pcf").is_file());
}

/// The shared preload cfg belongs to the mods preloader too.
#[test]
fn preload_is_wanted_tracks_installed_mods() {
    let (root, data) = fake_root();
    assert!(!preload_is_wanted(&data, &root).unwrap());

    let zip_path = fake_mods_zip(root.parent().unwrap());
    apply_preloader_selection(
        &root,
        &data,
        &zip_path,
        &PreloaderSelection {
            addons: vec![],
            particle_mods: vec!["Blue Water".into()],
            profile_particle_mods: Vec::new(),
        },
        &[],
    )
    .unwrap();
    assert!(preload_is_wanted(&data, &root).unwrap());

    revert_preloader(&root, &data, &[]).unwrap();
    assert!(!preload_is_wanted(&data, &root).unwrap());

    // A stray pack on disk alone is enough.
    std::fs::write(root.join("tf/custom").join(PRELOADER_VPK), b"vpk").unwrap();
    assert!(preload_is_wanted(&data, &root).unwrap());
}

#[test]
fn preload_profile_cleanup_is_acknowledged_one_success_at_a_time() {
    let (_root, data) = fake_root();
    record_preload_profile(&data, "profile-a").unwrap();
    record_preload_profile(&data, "profile-b").unwrap();
    record_preload_profile(&data, "profile-a").unwrap();
    assert_eq!(
        preload_profiles(&data).unwrap(),
        vec!["profile-a", "profile-b"]
    );

    forget_preload_profile(&data, "profile-a").unwrap();
    assert_eq!(preload_profiles(&data).unwrap(), vec!["profile-b"]);
    // A failed profile cleanup would omit this acknowledgement; its id stays
    // durable for the next command retry.
    assert_eq!(
        load_state(&data).unwrap().preload_profiles,
        vec!["profile-b"]
    );
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
        profile_particle_mods: Vec::new(),
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

    let written = synthesize_missing_vmts(&stock_entry_tables(&root), &mut custom);

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

/// A texture-only model mod (model + VTF, no VMT) gets a synthesized model
/// material, and that material follows the texture under console/. With the
/// steps the other way round the texture had already moved when synthesis
/// looked for it, and the material it got was a world shader at a path the
/// model never searches. The mod's own letter case is not trusted either:
/// the pack stores the paths the way the engine looks them up.
#[test]
fn a_texture_only_model_mod_gets_a_model_material_that_follows_the_relocation() {
    let (root, data) = fake_root();
    let zip_path = root.parent().unwrap().join("props.zip");
    let file = std::fs::File::create(&zip_path).unwrap();
    let mut writer = zip::ZipWriter::new(file);
    let options = zip::write::SimpleFileOptions::default();
    writer
        .start_file("mods/addons/Prop Skin/mod.json", options)
        .unwrap();
    writer
        .write_all(br#"{"addon_name":"Prop Skin","type":"Model","description":"Crate."}"#)
        .unwrap();
    writer
        .start_file("mods/addons/Prop Skin/models/props/Crate.MDL", options)
        .unwrap();
    writer.write_all(&fake_mdl(r"\models\props\")).unwrap();
    writer
        .start_file(
            "mods/addons/Prop Skin/materials/models/props/Crate.VTF",
            options,
        )
        .unwrap();
    writer.write_all(b"VTF ").unwrap();
    writer.finish().unwrap();

    let report = apply_preloader_selection(
        &root,
        &data,
        &zip_path,
        &PreloaderSelection {
            addons: vec!["Prop Skin".into()],
            particle_mods: Vec::new(),
            profile_particle_mods: Vec::new(),
        },
        &[],
    )
    .unwrap();
    assert_eq!(report.synthesized_vmts, 1);
    assert_eq!(
        report.relocated_model_materials, 2,
        "the vtf and its new vmt"
    );
    assert!(report.skipped.is_empty(), "{:?}", report.skipped);

    let custom = read_vpk_dir_file(&root.join("tf/custom").join(PRELOADER_VPK)).unwrap();
    let keys: Vec<&String> = custom.files.keys().collect();
    assert_eq!(
        keys,
        vec![
            "materials/console/models/props/crate.vmt",
            "materials/console/models/props/crate.vtf",
            "models/props/crate.mdl"
        ],
        "{keys:?}"
    );
    let vmt = String::from_utf8(custom.files["materials/console/models/props/crate.vmt"].clone())
        .unwrap();
    assert!(vmt.contains("VertexLitGeneric"), "{vmt}");
    assert!(vmt.contains("console/models/props/crate"), "{vmt}");
    let dirs = crate::mdl::material_dirs(&custom.files["models/props/crate.mdl"]).unwrap();
    assert_eq!(dirs[0], "console/models/props/");
}

/// Mods spell extensions however they like; every check compares lowercased.
#[test]
fn extension_checks_ignore_letter_case() {
    assert!(has_ext("materials/a/b.VTF", ".vtf"));
    assert!(has_ext("models/c.Mdl", ".mdl"));
    assert!(!has_ext("vtf", ".vtf"));
    assert!(!has_ext("materials/a/b.vtf.bak", ".vtf"));

    let mut custom: BTreeMap<String, Vec<u8>> = BTreeMap::new();
    custom.insert("materials/world/rock.VTF".into(), b"VTF ".to_vec());
    assert_eq!(synthesize_missing_vmts(&[], &mut custom), 1);
    assert!(custom.contains_key("materials/world/rock.vmt"));

    let generated = String::from_utf8(default_vmt("materials/console/models/props/x.vmt")).unwrap();
    assert!(generated.contains("VertexLitGeneric"), "{generated}");
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
        profile_particle_mods: Vec::new(),
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

#[test]
fn corrupt_replacement_payload_leaves_the_installed_selection_byte_exact() {
    let (root, data) = fake_root();
    let zip_path = fake_mods_zip(root.parent().unwrap());
    let selection_a = PreloaderSelection {
        addons: vec!["Flat Look".into()],
        particle_mods: vec!["Blue Water".into()],
        profile_particle_mods: Vec::new(),
    };
    apply_preloader_selection(&root, &data, &zip_path, &selection_a, &[]).unwrap();
    let before = installed_bytes(&root, &data);

    corrupt_zip_payload(
        &zip_path,
        "mods/particles/Blue Water/actual_particles/water.pcf",
    );
    let error = apply_preloader_selection(
        &root,
        &data,
        &zip_path,
        &PreloaderSelection {
            addons: Vec::new(),
            particle_mods: vec!["Blue Water".into()],
            profile_particle_mods: Vec::new(),
        },
        &[],
    )
    .unwrap_err();
    assert!(
        error.contains("Could not read") || error.contains("checksum"),
        "{error}"
    );
    assert_eq!(installed_bytes(&root, &data), before);
    assert!(!data.join("preloader/apply-transaction").exists());
}

#[test]
fn final_state_failure_rolls_the_installed_selection_back_byte_exact() {
    let (root, data) = fake_root();
    let zip_path = fake_mods_zip(root.parent().unwrap());
    apply_preloader_selection(&root, &data, &zip_path, &blue_water(), &[]).unwrap();
    let before = installed_bytes(&root, &data);

    let error = apply_preloader_selection_with_final_state_hook(
        &root,
        &data,
        &zip_path,
        &PreloaderSelection {
            addons: vec!["Flat Look".into()],
            particle_mods: Vec::new(),
            profile_particle_mods: Vec::new(),
        },
        &[],
        &Vec::new,
        &|| Err("injected final state failure".into()),
    )
    .unwrap_err();
    assert!(error.contains("injected final state failure"), "{error}");
    assert_eq!(installed_bytes(&root, &data), before);
    assert!(!data.join("preloader/apply-transaction").exists());
}

#[test]
fn reopen_recovers_a_final_state_crash_to_the_exact_previous_selection() {
    let (root, data) = fake_root();
    let zip_path = fake_mods_zip(root.parent().unwrap());
    apply_preloader_selection(&root, &data, &zip_path, &blue_water(), &[]).unwrap();
    let before = installed_bytes(&root, &data);
    let block_rollback = std::cell::Cell::new(false);
    let sample = || {
        if block_rollback.get() {
            running_names()
        } else {
            Vec::new()
        }
    };
    let fail_at_commit = || {
        block_rollback.set(true);
        Err("injected crash before final state".into())
    };

    let error = apply_preloader_selection_with_final_state_hook(
        &root,
        &data,
        &zip_path,
        &PreloaderSelection {
            addons: vec!["Flat Look".into()],
            particle_mods: Vec::new(),
            profile_particle_mods: Vec::new(),
        },
        &[],
        &sample,
        &fail_at_commit,
    )
    .unwrap_err();
    assert!(error.contains("recovery remains pending"), "{error}");
    assert!(data
        .join("preloader/apply-transaction/intent.json")
        .is_file());

    block_rollback.set(false);
    assert!(recover_pending_preloader_with_sampler(&root, &data, &[], &sample).unwrap());
    assert_eq!(installed_bytes(&root, &data), before);
    assert!(!data.join("preloader/apply-transaction").exists());
}

#[test]
fn a_published_committed_marker_is_not_rolled_back_on_sync_ambiguity() {
    use std::sync::atomic::{AtomicUsize, Ordering};
    use std::sync::Arc;

    let (root, data) = fake_root();
    let zip_path = fake_mods_zip(root.parent().unwrap());
    apply_preloader_selection(&root, &data, &zip_path, &blue_water(), &[]).unwrap();
    let intent_syncs = Arc::new(AtomicUsize::new(0));
    let seen = Arc::clone(&intent_syncs);

    let report = crate::hash::with_sync_parent_fault(
        move |path| path.ends_with("intent.json") && seen.fetch_add(1, Ordering::SeqCst) == 1,
        || {
            apply_preloader_selection(
                &root,
                &data,
                &zip_path,
                &PreloaderSelection {
                    addons: vec!["Flat Look".into()],
                    particle_mods: Vec::new(),
                    profile_particle_mods: Vec::new(),
                },
                &[],
            )
        },
    )
    .unwrap();
    assert_eq!(report.addons_installed, vec!["Flat Look"]);
    assert!(report.particle_mods_installed.is_empty());
    let state = load_state(&data).unwrap();
    assert_eq!(state.addons, vec!["Flat Look"]);
    assert!(state.particle_mods.is_empty());
    assert!(!data.join("preloader/apply-transaction").exists());
}

#[test]
fn recovery_refuses_a_same_size_archive_entry_from_a_new_game_version() {
    let (root, data) = fake_root();
    let zip_path = fake_mods_zip(root.parent().unwrap());
    apply_preloader_selection(&root, &data, &zip_path, &blue_water(), &[]).unwrap();
    let block_rollback = std::cell::Cell::new(false);
    let sample = || {
        if block_rollback.get() {
            running_names()
        } else {
            Vec::new()
        }
    };
    let fail_at_commit = || {
        block_rollback.set(true);
        Err("leave prepared journal".into())
    };
    apply_preloader_selection_with_final_state_hook(
        &root,
        &data,
        &zip_path,
        &PreloaderSelection {
            addons: vec!["Flat Look".into()],
            particle_mods: Vec::new(),
            profile_particle_mods: Vec::new(),
        },
        &[],
        &sample,
        &fail_at_commit,
    )
    .unwrap_err();
    assert!(data
        .join("preloader/apply-transaction/intent.json")
        .is_file());

    let old_entries = map_vpk_entries(&root.join("tf").join(MISC_VPK)).unwrap();
    let mut replacement = BTreeMap::new();
    for (rel, entry) in &old_entries {
        let mut bytes = tiny_pcf(
            if rel.ends_with("disguise.pcf") {
                "spy_smoke"
            } else {
                "water_effect"
            },
            17.0,
        );
        bytes.resize(entry.length as usize, b' ');
        replacement.insert(rel.clone(), bytes);
    }
    write_split_vpk(&root.join("tf").join(MISC_VPK), &replacement);
    let new_dir = std::fs::read(root.join("tf").join(MISC_VPK)).unwrap();
    let new_data = std::fs::read(root.join("tf/tf2_misc_000.vpk")).unwrap();

    block_rollback.set(false);
    let error = recover_pending_preloader_with_sampler(&root, &data, &[], &sample).unwrap_err();
    assert!(error.contains("archive mapping changed"), "{error}");
    assert_eq!(
        std::fs::read(root.join("tf").join(MISC_VPK)).unwrap(),
        new_dir
    );
    assert_eq!(
        std::fs::read(root.join("tf/tf2_misc_000.vpk")).unwrap(),
        new_data
    );
    assert!(data
        .join("preloader/apply-transaction/intent.json")
        .is_file());
    assert_eq!(
        preloader_transaction_status(&root, &data).unwrap(),
        PreloaderTransactionStatus::Prepared
    );
}

#[test]
fn verified_current_stock_reconciles_a_mapping_changed_preloader_transaction() {
    let (root, data) = fake_root();
    let zip_path = fake_mods_zip(root.parent().unwrap());
    apply_preloader_selection(&root, &data, &zip_path, &blue_water(), &[]).unwrap();
    let selection_a_custom = std::fs::read(root.join("tf/custom").join(PRELOADER_VPK)).ok();
    let block_rollback = std::cell::Cell::new(false);
    let sample = || {
        if block_rollback.get() {
            running_names()
        } else {
            Vec::new()
        }
    };
    let fail_at_commit = || {
        block_rollback.set(true);
        Err("leave prepared journal".into())
    };
    apply_preloader_selection_with_final_state_hook(
        &root,
        &data,
        &zip_path,
        &PreloaderSelection {
            addons: vec!["Flat Look".into()],
            particle_mods: Vec::new(),
            profile_particle_mods: Vec::new(),
        },
        &[],
        &sample,
        &fail_at_commit,
    )
    .unwrap_err();

    let before_incomplete_repair = installed_bytes(&root, &data);
    let error = reconcile_preloader_after_steam_repair_with_sampler(&root, &data, &[], &sample)
        .unwrap_err();
    assert!(error.contains("gameinfo.txt"), "{error}");
    assert_eq!(installed_bytes(&root, &data), before_incomplete_repair);
    assert_eq!(
        preloader_transaction_status(&root, &data).unwrap(),
        PreloaderTransactionStatus::Prepared
    );

    let old_entries = map_vpk_entries(&root.join("tf").join(MISC_VPK)).unwrap();
    let mut replacement = BTreeMap::new();
    for (rel, entry) in &old_entries {
        let mut bytes = tiny_pcf(
            if rel.ends_with("disguise.pcf") {
                "spy_smoke"
            } else {
                "water_effect"
            },
            17.0,
        );
        bytes.resize(entry.length as usize, b' ');
        replacement.insert(rel.clone(), bytes);
    }
    write_split_vpk(&root.join("tf").join(MISC_VPK), &replacement);
    std::fs::write(
        root.join("tf/gameinfo.txt"),
        b"\"GameInfo\"\n{\n\ttype multiplayer_only\n}\n",
    )
    .unwrap();

    assert!(prepare_preloader_steam_repair(&root, &data).unwrap());
    // Starting/cancelling verification never discards a Prepared marker.
    assert_eq!(
        preloader_transaction_status(&root, &data).unwrap(),
        PreloaderTransactionStatus::Prepared
    );
    block_rollback.set(false);
    assert!(
        reconcile_preloader_after_steam_repair_with_sampler(&root, &data, &[], &sample).unwrap()
    );
    assert_eq!(
        preloader_transaction_status(&root, &data).unwrap(),
        PreloaderTransactionStatus::None
    );
    let repaired = preloader_status(&root, &data).unwrap();
    assert!(repaired.stale);
    assert_eq!(repaired.particle_mods, vec!["Blue Water"]);
    assert_eq!(
        std::fs::read(root.join("tf/custom").join(PRELOADER_VPK)).ok(),
        selection_a_custom
    );

    let reapplied = apply_preloader_selection(&root, &data, &zip_path, &blue_water(), &[]).unwrap();
    assert!(!reapplied.patched_files.is_empty());
    assert!(!preloader_status(&root, &data).unwrap().stale);
}

#[test]
fn invalid_late_original_name_refuses_recovery_before_any_live_mutation() {
    let (root, data) = fake_root();
    let zip_path = fake_mods_zip(root.parent().unwrap());
    apply_preloader_selection(&root, &data, &zip_path, &blue_water(), &[]).unwrap();
    let block_rollback = std::cell::Cell::new(false);
    let sample = || {
        if block_rollback.get() {
            running_names()
        } else {
            Vec::new()
        }
    };
    let fail_at_commit = || {
        block_rollback.set(true);
        Err("leave prepared journal".into())
    };
    apply_preloader_selection_with_final_state_hook(
        &root,
        &data,
        &zip_path,
        &PreloaderSelection {
            addons: vec!["Flat Look".into()],
            particle_mods: Vec::new(),
            profile_particle_mods: Vec::new(),
        },
        &[],
        &sample,
        &fail_at_commit,
    )
    .unwrap_err();
    let intent_path = data.join("preloader/apply-transaction/intent.json");
    let mut intent: serde_json::Value =
        serde_json::from_slice(&std::fs::read(&intent_path).unwrap()).unwrap();
    intent["originals"][0]["name"] = serde_json::Value::String("../escape".into());
    std::fs::write(&intent_path, serde_json::to_vec_pretty(&intent).unwrap()).unwrap();
    let before = installed_bytes(&root, &data);

    block_rollback.set(false);
    let error = recover_pending_preloader_with_sampler(&root, &data, &[], &sample).unwrap_err();
    assert!(error.contains("invalid snapshot name"), "{error}");
    assert_eq!(installed_bytes(&root, &data), before);
    assert!(intent_path.is_file());
}

#[test]
fn oversized_state_and_gameinfo_inputs_fail_closed_without_unbounded_reads() {
    let (root, data) = fake_root();
    let state = state_path(&data);
    std::fs::create_dir_all(state.parent().unwrap()).unwrap();
    std::fs::File::create(&state)
        .unwrap()
        .set_len(4 * 1024 * 1024 + 1)
        .unwrap();
    let error = load_state(&data).unwrap_err();
    assert!(error.contains("safety limit"), "{error}");

    let gameinfo = root.join("tf/gameinfo.txt");
    std::fs::File::create(&gameinfo)
        .unwrap()
        .set_len(4 * 1024 * 1024 + 1)
        .unwrap();
    let error = gameinfo_bypass_state(&root).unwrap_err();
    assert!(error.contains("safety limit"), "{error}");
}

#[test]
fn crafted_non_particle_state_cannot_authorize_an_official_archive_write() {
    let (root, data) = fake_root();
    let zip_path = fake_mods_zip(root.parent().unwrap());
    apply_preloader_selection(&root, &data, &zip_path, &blue_water(), &[]).unwrap();
    let directory = misc_vpk_path(&root);
    let sibling = root.join("tf/tf2_misc_000.vpk");
    let before_directory = std::fs::read(&directory).unwrap();
    let before_sibling = std::fs::read(&sibling).unwrap();

    let mut state = load_state(&data).unwrap();
    let rel = "materials/console/execs_should_never_write.vmt".to_string();
    state.patched.insert(
        rel.clone(),
        PatchedEntry {
            owner: "crafted".into(),
            original_sha256: "0".repeat(64),
            patched_sha256: "1".repeat(64),
            rel,
            pristine: true,
        },
    );
    std::fs::write(
        state_path(&data),
        serde_json::to_vec_pretty(&state).unwrap(),
    )
    .unwrap();

    let error = revert_preloader(&root, &data, &[]).unwrap_err();
    assert!(error.contains("unsafe patched entry"), "{error}");
    assert_eq!(std::fs::read(&directory).unwrap(), before_directory);
    assert_eq!(std::fs::read(&sibling).unwrap(), before_sibling);
}

#[test]
fn oversized_gameinfo_backup_and_particle_snapshot_are_rejected() {
    let (root, data) = fake_root();
    let zip_path = fake_mods_zip(root.parent().unwrap());
    apply_preloader_selection(&root, &data, &zip_path, &blue_water(), &[]).unwrap();

    std::fs::File::create(gameinfo_backup_path(&data))
        .unwrap()
        .set_len(4 * 1024 * 1024 + 1)
        .unwrap();
    let error = set_gameinfo_bypass(&root, &data, true, &[]).unwrap_err();
    assert!(error.contains("safety limit"), "{error}");

    std::fs::File::create(snapshot_path(&data, "particles/water.pcf"))
        .unwrap()
        .set_len(crate::pcf::MAX_PCF_BYTES as u64 + 1)
        .unwrap();
    let error = preloader_status(&root, &data).unwrap_err();
    assert!(error.contains("safety limit"), "{error}");
}

#[test]
fn oversized_transaction_backup_is_rejected_before_recovery_writes() {
    let (root, data) = fake_root();
    let zip_path = fake_mods_zip(root.parent().unwrap());
    apply_preloader_selection(&root, &data, &zip_path, &blue_water(), &[]).unwrap();
    let block_rollback = std::cell::Cell::new(false);
    let sample = || {
        if block_rollback.get() {
            running_names()
        } else {
            Vec::new()
        }
    };
    let fail_at_commit = || {
        block_rollback.set(true);
        Err("leave prepared journal".into())
    };
    apply_preloader_selection_with_final_state_hook(
        &root,
        &data,
        &zip_path,
        &PreloaderSelection {
            addons: vec!["Flat Look".into()],
            particle_mods: Vec::new(),
            profile_particle_mods: Vec::new(),
        },
        &[],
        &sample,
        &fail_at_commit,
    )
    .unwrap_err();
    let transaction = data.join("preloader/apply-transaction");
    let entry_backup = std::fs::read_dir(&transaction)
        .unwrap()
        .map(Result::unwrap)
        .find(|entry| entry.file_name().to_string_lossy().starts_with("entry-"))
        .unwrap()
        .path();
    std::fs::OpenOptions::new()
        .write(true)
        .open(&entry_backup)
        .unwrap()
        .set_len(crate::pcf::MAX_PCF_BYTES as u64 + 1)
        .unwrap();
    let live_before = installed_bytes(&root, &data);

    block_rollback.set(false);
    let error = recover_pending_preloader_with_sampler(&root, &data, &[], &sample).unwrap_err();
    assert!(error.contains("wrong size"), "{error}");
    assert_eq!(installed_bytes(&root, &data), live_before);
    assert!(transaction.join("intent.json").is_file());
}

/// An interrupted apply can leave patched entries with state.json saying
/// nothing is patched. The pristine snapshots on disk must survive the
/// retry (never re-snapshotted from modded bytes). Without the saved hash of
/// the patch, recovery must keep both live bytes and snapshots for Steam
/// verification instead of guessing that it is safe to write stock bytes.
#[test]
fn interrupted_apply_cannot_clobber_or_trust_unmatched_snapshots() {
    let (root, data) = fake_root();
    let zip_path = fake_mods_zip(root.parent().unwrap());
    let sibling_path = root.join("tf").join("tf2_misc_000.vpk");
    let pristine_sibling = std::fs::read(&sibling_path).unwrap();

    let selection = PreloaderSelection {
        addons: vec![],
        particle_mods: vec!["Blue Water".into()],
        profile_particle_mods: Vec::new(),
    };
    apply_preloader_selection(&root, &data, &zip_path, &selection, &[]).unwrap();

    // Simulate the crash: patches and snapshots exist, but tracking was
    // lost before the state save.
    let mut state = load_state(&data).unwrap();
    assert!(!state.patched.is_empty());
    state.patched.clear();
    save_state(&data, &state).unwrap();
    let patched_sibling = std::fs::read(&sibling_path).unwrap();

    let error = apply_preloader_selection(&root, &data, &zip_path, &selection, &[]).unwrap_err();
    assert!(error.contains("cannot prove"), "{error}");
    assert_eq!(std::fs::read(&sibling_path).unwrap(), patched_sibling);
    assert_ne!(patched_sibling, pristine_sibling);
    assert!(!originals_listing(&data).is_empty());
}

#[test]
fn particle_snapshots_keep_preload_wanted_when_state_is_missing() {
    let (root, data) = fake_root();
    let zip_path = fake_mods_zip(root.parent().unwrap());
    apply_preloader_selection(&root, &data, &zip_path, &blue_water(), &[]).unwrap();
    assert!(originals_dir(&data).is_dir());

    std::fs::remove_file(state_path(&data)).unwrap();

    assert!(preload_is_wanted(&data, &root).unwrap());
}

fn originals_listing(data: &Path) -> Vec<String> {
    let mut names: Vec<String> = std::fs::read_dir(originals_dir(data))
        .map(|dir| {
            dir.flatten()
                .map(|entry| entry.file_name().to_string_lossy().into_owned())
                .collect()
        })
        .unwrap_or_default();
    names.sort();
    names
}

/// A crash in the middle of writing state.json used to truncate it, which
/// loaded as "nothing patched" and let Restore delete every pristine snapshot
/// while the patches stayed in the archive. The save is atomic now, and even
/// a torn file loses nothing: status can identify the entries, but restore
/// keeps the live bytes and snapshots because the patch hashes are gone.
#[test]
fn a_torn_state_file_reports_recovery_without_authorizing_archive_writes() {
    let (root, data) = fake_root();
    let zip_path = fake_mods_zip(root.parent().unwrap());
    let vpk_path = root.join("tf").join(MISC_VPK);
    let sibling_path = root.join("tf").join("tf2_misc_000.vpk");
    let pristine_dir = std::fs::read(&vpk_path).unwrap();
    let pristine_sibling = std::fs::read(&sibling_path).unwrap();

    apply_preloader_selection(&root, &data, &zip_path, &blue_water(), &[]).unwrap();
    let patched_dir = std::fs::read(&vpk_path).unwrap();
    let patched_sibling = std::fs::read(&sibling_path).unwrap();
    assert!(!snapshot_path(&data, "particles/water.pcf")
        .with_extension("execs-part")
        .exists());
    assert!(sidecar_path(&data, "particles/water.pcf").is_file());

    // Tear the index in half.
    let state_file = state_path(&data);
    let json = std::fs::read(&state_file).unwrap();
    std::fs::write(&state_file, &json[..json.len() / 2]).unwrap();
    assert!(
        load_state(&data).is_err(),
        "a torn state file must not authorize an empty-state mutation"
    );
    assert!(
        preload_is_wanted(&data, &root).is_err(),
        "viewmodel mutations must fail closed while state is corrupt"
    );

    let status = preloader_status(&root, &data).unwrap();
    assert_eq!(
        status.patched_files,
        vec![
            "particles/water.pcf".to_string(),
            "particles/water_dx80.pcf".to_string()
        ],
        "tracking is rebuilt from the sidecars"
    );
    assert!(
        status.untracked_modified.is_empty(),
        "{:?}",
        status.untracked_modified
    );
    assert!(
        load_state(&data).is_err(),
        "status must not overwrite state.json while the UI polls it"
    );

    let error = revert_preloader(&root, &data, &[]).unwrap_err();
    assert!(error.contains("cannot prove"), "{error}");
    assert_eq!(std::fs::read(&vpk_path).unwrap(), patched_dir);
    assert_eq!(std::fs::read(&sibling_path).unwrap(), patched_sibling);
    assert_eq!(
        patched_dir, pristine_dir,
        "the directory VPK is never written"
    );
    assert_ne!(patched_sibling, pristine_sibling);
    assert!(
        !originals_listing(&data).is_empty(),
        "{:?}",
        originals_listing(&data)
    );
    assert!(originals_dir(&data).is_dir());
}

/// Snapshots written before sidecars existed carry nothing but their hashed
/// name. The archive still explains them: the name is the hash of an entry
/// path, and the directory's CRC says whether the bytes are stock.
#[test]
fn a_snapshot_without_a_sidecar_is_reported_but_not_trusted_for_restore() {
    let (root, data) = fake_root();
    let zip_path = fake_mods_zip(root.parent().unwrap());
    let sibling_path = root.join("tf").join("tf2_misc_000.vpk");
    let pristine_sibling = std::fs::read(&sibling_path).unwrap();

    apply_preloader_selection(&root, &data, &zip_path, &blue_water(), &[]).unwrap();
    let patched_sibling = std::fs::read(&sibling_path).unwrap();
    for rel in ["particles/water.pcf", "particles/water_dx80.pcf"] {
        std::fs::remove_file(sidecar_path(&data, rel)).unwrap();
    }
    std::fs::write(state_path(&data), b"{").unwrap();

    let status = preloader_status(&root, &data).unwrap();
    assert_eq!(status.patched_files.len(), 2, "{:?}", status.patched_files);
    assert!(
        load_state(&data).is_err(),
        "status reports recovery without replacing corrupt state"
    );
    assert!(
        !sidecar_path(&data, "particles/water.pcf").exists(),
        "status must not write a missing sidecar"
    );

    let error = revert_preloader(&root, &data, &[]).unwrap_err();
    assert!(error.contains("cannot prove"), "{error}");
    assert_eq!(std::fs::read(&sibling_path).unwrap(), patched_sibling);
    assert_ne!(patched_sibling, pristine_sibling);
    assert!(!originals_listing(&data).is_empty());
}

/// Restore deletes exactly the snapshots it consumed. A file nothing can
/// explain may be the only copy of a stock file, so it stays — along with the
/// folder — while torn part files and orphaned sidecars are cleared away.
#[test]
fn an_unexplained_snapshot_survives_restore_and_torn_writes_do_not() {
    let (root, data) = fake_root();
    let zip_path = fake_mods_zip(root.parent().unwrap());
    let sibling_path = root.join("tf").join("tf2_misc_000.vpk");
    let pristine_sibling = std::fs::read(&sibling_path).unwrap();

    apply_preloader_selection(&root, &data, &zip_path, &blue_water(), &[]).unwrap();
    let originals = originals_dir(&data);
    let stranger = originals.join(crate::hash::sha256_hex(b"particles/nothing_like_this.pcf"));
    std::fs::write(&stranger, b"someone else's snapshot").unwrap();
    let torn = originals.join(format!(
        "{}{}",
        crate::hash::sha256_hex(b"particles/torn.pcf"),
        crate::hash::PART_SUFFIX
    ));
    std::fs::write(&torn, b"half").unwrap();
    let orphan_sidecar = originals.join(format!(
        "{}.json",
        crate::hash::sha256_hex(b"particles/gone.pcf")
    ));
    std::fs::write(&orphan_sidecar, b"{}").unwrap();

    let report = revert_preloader(&root, &data, &[]).unwrap();
    assert!(report.failures.is_empty(), "{:?}", report.failures);
    assert_eq!(std::fs::read(&sibling_path).unwrap(), pristine_sibling);
    assert!(load_state(&data).unwrap().patched.is_empty());
    assert_eq!(
        originals_listing(&data),
        vec![stranger.file_name().unwrap().to_str().unwrap().to_string()]
    );
    assert!(originals.is_dir());
}

/// The pristine backup is only worth restoring when it is a gameinfo file.
#[test]
fn a_backup_that_is_not_a_gameinfo_file_is_refused() {
    let (root, data) = fake_root();
    let path = root.join("tf/gameinfo.txt");
    let before = std::fs::read(&path).unwrap();
    let backup = data.join("preloader/gameinfo.original.txt");
    std::fs::create_dir_all(backup.parent().unwrap()).unwrap();
    std::fs::write(&backup, b"corrupted").unwrap();

    let err = restore_gameinfo_from_backup(&root, &data, &[]).unwrap_err();
    assert!(err.contains("not a GameInfo file"), "{err}");
    assert_eq!(std::fs::read(&path).unwrap(), before);
    assert!(!crate::hash::part_path(&path).exists());
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
            profile_particle_mods: Vec::new(),
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

/// A library zip whose one particle mod carries a pcf with an un-shrinkable
/// `payload` bytes of binary attribute.
fn big_mod_zip(dir: &Path, payload: usize) -> std::path::PathBuf {
    let zip_path = dir.join("big.zip");
    let file = std::fs::File::create(&zip_path).unwrap();
    let mut writer = zip::ZipWriter::new(file);
    let options = zip::write::SimpleFileOptions::default();
    writer
        .start_file("mods/particles/Big/actual_particles/water.pcf", options)
        .unwrap();
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
            value: PcfValue::Binary(vec![b' '; payload]),
        },
    ));
    writer.write_all(&encode_pcf(&big).unwrap()).unwrap();
    writer.finish().unwrap();
    zip_path
}

#[test]
fn oversized_mod_is_skipped_with_notice() {
    let (root, data) = fake_root();
    let zip_path = big_mod_zip(root.parent().unwrap(), 4096);
    // Some stock particle file is big enough that the mod is worth decoding;
    // the slot it targets is not.
    let vpk_path = root.join("tf").join(MISC_VPK);
    let mut files = BTreeMap::new();
    let mut stock = tiny_pcf("water_effect", 9.0);
    stock.resize(stock.len() + 64, b' ');
    files.insert("particles/water.pcf".to_string(), stock.clone());
    files.insert("particles/water_dx80.pcf".to_string(), stock);
    files.insert(
        "particles/disguise.pcf".to_string(),
        tiny_pcf("spy_smoke", 3.0),
    );
    let mut room = tiny_pcf("room_glow", 2.0);
    room.resize(8192, b' ');
    files.insert("particles/room.pcf".to_string(), room);
    write_split_vpk(&vpk_path, &files);

    let vpk_before = std::fs::read(root.join("tf").join(MISC_VPK)).unwrap();
    let sibling_before = std::fs::read(root.join("tf").join("tf2_misc_000.vpk")).unwrap();
    let report = apply_preloader_selection(
        &root,
        &data,
        &zip_path,
        &PreloaderSelection {
            addons: vec![],
            particle_mods: vec!["Big".into()],
            profile_particle_mods: Vec::new(),
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

/// Decoding amplifies a crafted particle file many times over, so a mod file
/// bigger than every stock slot it could land in is reported without being
/// parsed at all.
#[test]
fn a_mod_larger_than_every_stock_particle_file_is_not_decoded() {
    let (root, data) = fake_root();
    let zip_path = big_mod_zip(root.parent().unwrap(), 4096);
    let sibling_before = std::fs::read(root.join("tf").join("tf2_misc_000.vpk")).unwrap();

    let report = apply_preloader_selection(
        &root,
        &data,
        &zip_path,
        &PreloaderSelection {
            addons: vec![],
            particle_mods: vec!["Big".into()],
            profile_particle_mods: Vec::new(),
        },
        &[],
    )
    .unwrap();
    assert!(report.patched_files.is_empty());
    let notice = report
        .skipped
        .iter()
        .find(|notice| notice.file == "water.pcf")
        .expect("the oversized file is reported");
    assert!(
        notice
            .reason
            .contains("larger than any stock particle file"),
        "{}",
        notice.reason
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

/// The patched bytes live in the sibling archives, so a content update that
/// rewrites `_000.vpk` while the directory file keeps its length must not be
/// invisible: the restore would then write stale snapshot bytes at stale
/// offsets into fresh game data.
#[test]
fn fingerprint_covers_the_sibling_archives() {
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
            profile_particle_mods: Vec::new(),
        },
        &[],
    )
    .unwrap();
    assert!(!preloader_status(&root, &data).unwrap().stale);

    // Grow only the sibling; the directory file is untouched.
    let mut sibling = std::fs::read(&sibling_path).unwrap();
    sibling.extend_from_slice(b"an update rewrote this archive");
    std::fs::write(&sibling_path, &sibling).unwrap();

    assert!(
        preloader_status(&root, &data).unwrap().stale,
        "a resized sibling archive is a game update"
    );
}

/// `rel.replace('/', "__")` was not injective: any entry path containing `__`
/// round-tripped to a different rel, so the adopt pass inserted a bogus entry
/// while the real snapshot was orphaned and never restored.
#[test]
fn snapshot_names_are_hashed_and_legacy_names_migrate() {
    let (root, data) = fake_root();
    let rel = "particles/blue__water.pcf";
    let hashed = snapshot_path(&data, rel);
    assert_eq!(
        hashed.file_name().unwrap().to_str().unwrap(),
        crate::hash::sha256_hex(rel.as_bytes())
    );
    // Distinct rels get distinct snapshot names.
    assert_ne!(hashed, snapshot_path(&data, "particles/blue/water.pcf"));

    // A snapshot written by an older build is adopted, migrated to the hashed
    // name, and carries its rel forward.
    let legacy = legacy_snapshot_path(&data, "particles/water.pcf");
    std::fs::create_dir_all(legacy.parent().unwrap()).unwrap();
    std::fs::write(&legacy, b"pristine").unwrap();
    let mut state = PreloaderState::default();
    let entries = map_vpk_entries(&misc_vpk_path(&root)).unwrap();
    adopt_orphaned_snapshots(&data, &mut state, Some(&entries));

    let entry = state
        .patched
        .get("particles/water.pcf")
        .expect("legacy snapshot adopted");
    assert_eq!(entry.rel, "particles/water.pcf");
    assert_eq!(entry.original_sha256, crate::hash::sha256_hex(b"pristine"));
    assert!(!legacy.exists(), "the legacy file is moved, not copied");
    assert_eq!(
        std::fs::read(snapshot_path(&data, "particles/water.pcf")).unwrap(),
        b"pristine"
    );
}

/// A same-size replacement passes the length check, so the restore has to
/// confirm the entry still holds exactly what we wrote before putting the
/// snapshot back over it.
#[test]
fn restore_refuses_an_entry_the_game_replaced_in_place() {
    let (root, data) = fake_root();
    let zip_path = fake_mods_zip(root.parent().unwrap());
    let vpk_path = root.join("tf").join(MISC_VPK);

    apply_preloader_selection(
        &root,
        &data,
        &zip_path,
        &PreloaderSelection {
            addons: vec![],
            particle_mods: vec!["Blue Water".into()],
            profile_particle_mods: Vec::new(),
        },
        &[],
    )
    .unwrap();

    let state = load_state(&data).unwrap();
    let (rel, tracked) = state.patched.iter().next().expect("something was patched");
    assert!(
        !tracked.patched_sha256.is_empty(),
        "the patched hash is recorded so the restore can verify it"
    );
    let snapshot_before = std::fs::read(snapshot_path(&data, rel)).unwrap();

    // Overwrite the entry in place with different bytes of the same length,
    // exactly as a same-size content update would.
    let entries = map_vpk_entries(&vpk_path).unwrap();
    let entry = entries.get(rel).unwrap();
    let replacement = vec![b'Z'; entry.length as usize];
    crate::vpk::patch_vpk_entry(&vpk_path, entry, &replacement).unwrap();

    assert!(
        preloader_status(&root, &data).unwrap().stale,
        "same-size content replacement must be visible in status"
    );
    let err = revert_preloader(&root, &data, &[]).unwrap_err();
    assert!(err.contains("replaced this entry"), "{err}");
    // Fresh game data is left exactly as it was, and the snapshot is kept.
    let after = crate::vpk::read_vpk_entry(&vpk_path, entry).unwrap();
    assert_eq!(after, replacement);
    assert_eq!(
        std::fs::read(snapshot_path(&data, rel)).unwrap(),
        snapshot_before
    );
    let kept = load_state(&data).unwrap();
    assert!(kept.patched.contains_key(rel));
    assert_eq!(kept.particle_mods, vec!["Blue Water"]);
    assert!(gameinfo_bypass_state(&root).unwrap().enabled);
    assert!(root.join("tf/custom").join(PRELOADER_VPK).is_file());
}

/// "Uncheck everything, Apply" must not leave an edited official file behind
/// with nothing installed.
#[test]
fn an_empty_selection_does_not_force_the_bypass_on() {
    let (root, data) = fake_root();
    let zip_path = fake_mods_zip(root.parent().unwrap());
    let before = std::fs::read(root.join("tf").join("gameinfo.txt")).unwrap();

    let report =
        apply_preloader_selection(&root, &data, &zip_path, &PreloaderSelection::default(), &[])
            .unwrap();
    assert!(report.patched_files.is_empty());
    assert!(!report.gameinfo_bypassed);
    assert_eq!(
        std::fs::read(root.join("tf").join("gameinfo.txt")).unwrap(),
        before,
        "gameinfo.txt must be byte-identical"
    );
}

fn blue_water() -> PreloaderSelection {
    PreloaderSelection {
        addons: vec![],
        particle_mods: vec!["Blue Water".into()],
        profile_particle_mods: Vec::new(),
    }
}

fn entry_bytes(vpk_path: &Path, rel: &str) -> Vec<u8> {
    let entries = map_vpk_entries(vpk_path).unwrap();
    crate::vpk::read_vpk_entry(vpk_path, entries.get(rel).unwrap()).unwrap()
}

/// Judged the way the game does: by the directory's stock CRC.
fn entry_is_stock(vpk_path: &Path, rel: &str) -> bool {
    let entries = map_vpk_entries(vpk_path).unwrap();
    let entry = entries.get(rel).unwrap();
    is_stock(&crate::vpk::read_vpk_entry(vpk_path, entry).unwrap(), entry)
}

/// Write `content` (space-padded to the stock size) straight into an entry,
/// the way another tool — or Steam's verify, when given stock bytes — would.
fn overwrite_entry(vpk_path: &Path, rel: &str, content: &[u8]) -> Vec<u8> {
    let entries = map_vpk_entries(vpk_path).unwrap();
    let entry = entries.get(rel).unwrap();
    let mut padded = content.to_vec();
    padded.resize(entry.length as usize, b' ');
    crate::vpk::patch_vpk_entry(vpk_path, entry, &padded).unwrap();
    padded
}

/// A resized VPK must restore, not discard. Clearing the tracking and deleting
/// every snapshot on that signal leaves patched particle files nothing can put
/// back, and a change in how the fingerprint is measured reads as a resize
/// too.
#[test]
fn a_resized_vpk_restores_tracked_patches_instead_of_discarding_them() {
    let (root, data) = fake_root();
    let zip_path = fake_mods_zip(root.parent().unwrap());
    let vpk_path = root.join("tf").join(MISC_VPK);
    let sibling_path = root.join("tf").join("tf2_misc_000.vpk");
    let pristine_sibling = std::fs::read(&sibling_path).unwrap();

    apply_preloader_selection(&root, &data, &zip_path, &blue_water(), &[]).unwrap();
    assert!(!entry_is_stock(&vpk_path, "particles/water.pcf"));

    // Grow the archive without moving an entry: an update that only appends,
    // and also exactly what a re-measured fingerprint looks like.
    let grow = |sibling_path: &Path| {
        let mut sibling = std::fs::read(sibling_path).unwrap();
        sibling.extend_from_slice(b"appended by an update");
        std::fs::write(sibling_path, &sibling).unwrap();
    };
    grow(&sibling_path);

    let report =
        apply_preloader_selection(&root, &data, &zip_path, &PreloaderSelection::default(), &[])
            .unwrap();
    assert!(report.baseline_reset);
    assert!(report.skipped.is_empty(), "{:?}", report.skipped);
    assert!(entry_is_stock(&vpk_path, "particles/water.pcf"));
    assert!(entry_is_stock(&vpk_path, "particles/water_dx80.pcf"));
    assert_eq!(
        &std::fs::read(&sibling_path).unwrap()[..pristine_sibling.len()],
        &pristine_sibling[..]
    );
    assert!(load_state(&data).unwrap().patched.is_empty());
    // Every snapshot was consumed by the restore (the folder itself may stay).
    let leftover = std::fs::read_dir(originals_dir(&data))
        .map(|dir| dir.count())
        .unwrap_or(0);
    assert_eq!(leftover, 0, "no snapshot may survive a full restore");

    // The same through Restore stock files.
    apply_preloader_selection(&root, &data, &zip_path, &blue_water(), &[]).unwrap();
    grow(&sibling_path);
    assert!(preloader_status(&root, &data).unwrap().stale);
    let report = revert_preloader(&root, &data, &[]).unwrap();
    assert!(report.failures.is_empty(), "{:?}", report.failures);
    assert_eq!(report.restored_files.len(), 2);
    assert!(entry_is_stock(&vpk_path, "particles/water.pcf"));
    assert!(load_state(&data).unwrap().patched.is_empty());
}

/// An entry already modified before execs touches it is never accepted as a
/// carrier or snapshotted as stock. The whole apply is refused until Steam's
/// verification puts stock bytes back.
#[test]
fn an_entry_modified_before_execs_touched_it_blocks_apply_until_repaired() {
    let (root, data) = fake_root();
    let zip_path = fake_mods_zip(root.parent().unwrap());
    let vpk_path = root.join("tf").join(MISC_VPK);
    let foreign = overwrite_entry(
        &vpk_path,
        "particles/water.pcf",
        &tiny_pcf("water_effect", 1.0),
    );
    assert!(!entry_is_stock(&vpk_path, "particles/water.pcf"));

    let err = apply_preloader_selection(&root, &data, &zip_path, &blue_water(), &[]).unwrap_err();
    assert!(err.contains("repair the game through Steam"), "{err}");
    assert!(err.contains("particles/water.pcf"), "{err}");
    assert_eq!(entry_bytes(&vpk_path, "particles/water.pcf"), foreign);
    assert!(entry_is_stock(&vpk_path, "particles/water_dx80.pcf"));
    assert!(load_state(&data).unwrap().patched.is_empty());
    assert!(!gameinfo_bypass_state(&root).unwrap().enabled);
    assert!(!root.join("tf/custom").join(PRELOADER_VPK).exists());

    // Steam's verify puts stock bytes back; the next install sees them.
    overwrite_entry(
        &vpk_path,
        "particles/water.pcf",
        &tiny_pcf("water_effect", 9.0),
    );
    assert!(entry_is_stock(&vpk_path, "particles/water.pcf"));
    let report = apply_preloader_selection(&root, &data, &zip_path, &blue_water(), &[]).unwrap();
    assert!(report.skipped.is_empty(), "{:?}", report.skipped);
    assert!(load_state(&data).unwrap().patched["particles/water.pcf"].pristine);
    let report = revert_preloader(&root, &data, &[]).unwrap();
    assert!(report.failures.is_empty(), "{:?}", report.failures);
    assert!(entry_is_stock(&vpk_path, "particles/water.pcf"));
}

/// A patched particle file execs holds no snapshot for is a stale patch
/// nothing here can undo — and, when its materials are gone, the source of
/// the "unimplemented sprite renderer" console flood. Status names it, while
/// apply and revert fail until the user repairs the official archive.
#[test]
fn stale_patches_execs_does_not_track_are_reported_everywhere() {
    let (root, data) = fake_root();
    let zip_path = fake_mods_zip(root.parent().unwrap());
    let vpk_path = root.join("tf").join(MISC_VPK);
    overwrite_entry(
        &vpk_path,
        "particles/disguise.pcf",
        &tiny_pcf("spy_smoke", 1.0),
    );

    assert_eq!(
        preloader_status(&root, &data).unwrap().untracked_modified,
        vec!["particles/disguise.pcf".to_string()]
    );

    let err = apply_preloader_selection(&root, &data, &zip_path, &blue_water(), &[]).unwrap_err();
    assert!(err.contains("particles/disguise.pcf"), "{err}");
    assert!(entry_is_stock(&vpk_path, "particles/water.pcf"));
    assert!(load_state(&data).unwrap().particle_mods.is_empty());
    assert_eq!(
        preloader_status(&root, &data).unwrap().untracked_modified,
        vec!["particles/disguise.pcf".to_string()]
    );

    let err = revert_preloader(&root, &data, &[]).unwrap_err();
    assert!(err.contains("particles/disguise.pcf"), "{err}");
}

/// After Steam's verify (or an update) has already put stock bytes back,
/// the restore has nothing to write: the entry is simply untracked. It used
/// to be reported as "the game replaced this entry" and kept its snapshot
/// forever, which a later install would then write back over fresh files.
#[test]
fn restore_untracks_an_entry_that_already_holds_stock_bytes() {
    let (root, data) = fake_root();
    let zip_path = fake_mods_zip(root.parent().unwrap());
    let vpk_path = root.join("tf").join(MISC_VPK);

    apply_preloader_selection(&root, &data, &zip_path, &blue_water(), &[]).unwrap();
    overwrite_entry(
        &vpk_path,
        "particles/water.pcf",
        &tiny_pcf("water_effect", 9.0),
    );
    assert!(entry_is_stock(&vpk_path, "particles/water.pcf"));

    let report = revert_preloader(&root, &data, &[]).unwrap();
    assert!(report.failures.is_empty(), "{:?}", report.failures);
    assert!(load_state(&data).unwrap().patched.is_empty());
    assert!(!snapshot_path(&data, "particles/water.pcf").exists());
    assert!(entry_is_stock(&vpk_path, "particles/water.pcf"));
}

/// The game ships new stock content for a file at the same size (the
/// directory CRC moves) while our patched bytes survive in place. The old
/// snapshot is no longer a restore — writing it would plant outdated stock
/// bytes under the new CRC — so it is discarded and reported.
#[test]
fn a_pristine_snapshot_the_game_outdated_is_discarded_not_written_back() {
    let (root, data) = fake_root();
    let zip_path = fake_mods_zip(root.parent().unwrap());
    let vpk_path = root.join("tf").join(MISC_VPK);

    apply_preloader_selection(&root, &data, &zip_path, &blue_water(), &[]).unwrap();
    let patched = entry_bytes(&vpk_path, "particles/water.pcf");

    // Rebuild the archive as fake_root does, with new stock water content of
    // the same length.
    let mut files = BTreeMap::new();
    let stock_len = patched.len();
    let mut new_stock = tiny_pcf("water_effect", 12.0);
    new_stock.resize(stock_len, b' ');
    let mut old_stock = tiny_pcf("water_effect", 9.0);
    old_stock.resize(stock_len, b' ');
    let mut disguise = tiny_pcf("spy_smoke", 3.0);
    disguise.resize(disguise.len() + 32, b' ');
    files.insert("particles/water.pcf".to_string(), new_stock);
    files.insert("particles/water_dx80.pcf".to_string(), old_stock);
    files.insert("particles/disguise.pcf".to_string(), disguise);
    write_split_vpk(&vpk_path, &files);
    // ...and our patch is still sitting there.
    overwrite_entry(&vpk_path, "particles/water.pcf", &patched);

    assert!(
        preloader_status(&root, &data).unwrap().stale,
        "a same-size stock CRC change must be detected"
    );
    let err = revert_preloader(&root, &data, &[]).unwrap_err();
    assert!(err.contains("particles/water.pcf:"), "{err}");
    assert!(err.contains("discarded"), "{err}");
    assert_eq!(
        entry_bytes(&vpk_path, "particles/water.pcf"),
        patched,
        "outdated stock bytes must not be written under the new CRC"
    );
    assert!(!snapshot_path(&data, "particles/water.pcf").exists());
    assert!(!load_state(&data)
        .unwrap()
        .patched
        .contains_key("particles/water.pcf"));
    // The twin, whose stock content did not change, was restored normally.
    assert!(entry_is_stock(&vpk_path, "particles/water_dx80.pcf"));
    let kept = load_state(&data).unwrap();
    assert_eq!(kept.particle_mods, vec!["Blue Water"]);
    assert!(gameinfo_bypass_state(&root).unwrap().enabled);
    assert!(root.join("tf/custom").join(PRELOADER_VPK).is_file());
}
