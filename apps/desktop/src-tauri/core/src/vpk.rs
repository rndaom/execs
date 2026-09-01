//! Source VPK v1/v2 reader and a small v1 writer. Read-only against official TF2 VPKs.

use std::collections::BTreeMap;
use std::io::{Cursor, Read, Seek, SeekFrom};
use std::path::Path;

const SIGNATURE: u32 = 0x55AA_1234;
const DIR_ARCHIVE: u16 = 0x7fff;

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct VpkError(pub String);

impl VpkError {
    pub fn message(&self) -> String {
        self.0.clone()
    }
}

#[derive(Debug, Clone)]
pub struct VpkArchive {
    pub files: BTreeMap<String, Vec<u8>>,
}

pub fn read_vpk_dir_file(path: &Path) -> Result<VpkArchive, VpkError> {
    let bytes = std::fs::read(path).map_err(|err| VpkError(err.to_string()))?;
    read_vpk(&bytes, Some(path), None)
}

/// Read only the entries whose relative path passes `keep`. Skipped entries
/// never touch the sibling archives, so filtering `tf2_misc_dir.vpk` down to
/// weapon scripts stays cheap instead of materializing gigabytes.
pub fn read_vpk_dir_file_filtered(
    path: &Path,
    keep: &dyn Fn(&str) -> bool,
) -> Result<VpkArchive, VpkError> {
    let bytes = std::fs::read(path).map_err(|err| VpkError(err.to_string()))?;
    read_vpk(&bytes, Some(path), Some(keep))
}

pub fn read_vpk_dir_bytes(bytes: &[u8]) -> Result<VpkArchive, VpkError> {
    read_vpk(bytes, None, None)
}

fn read_vpk(
    bytes: &[u8],
    dir_path: Option<&Path>,
    keep: Option<&dyn Fn(&str) -> bool>,
) -> Result<VpkArchive, VpkError> {
    if bytes.len() < 12 {
        return Err(VpkError("VPK header is too short.".into()));
    }
    let mut cur = Cursor::new(bytes);
    let signature = read_u32(&mut cur)?;
    if signature != SIGNATURE {
        return Err(VpkError("Not a VPK archive.".into()));
    }
    let version = read_u32(&mut cur)?;
    let tree_size = read_u32(&mut cur)? as usize;
    let header_size = match version {
        1 => 12,
        2 => {
            if bytes.len() < 28 {
                return Err(VpkError("VPK v2 header is too short.".into()));
            }
            let _file_data = read_u32(&mut cur)?;
            let _archive_md5 = read_u32(&mut cur)?;
            let _other_md5 = read_u32(&mut cur)?;
            let _signature = read_u32(&mut cur)?;
            28
        }
        _ => return Err(VpkError(format!("unsupported VPK version {version}"))),
    };
    let tree_end = header_size + tree_size;
    if bytes.len() < tree_end {
        return Err(VpkError("VPK directory tree is truncated.".into()));
    }
    let data_base = tree_end;
    let mut archives: BTreeMap<u16, std::fs::File> = BTreeMap::new();
    let mut files = BTreeMap::new();
    while cur.position() < tree_end as u64 {
        let ext = read_cstring(&mut cur, tree_end)?;
        if ext.is_empty() {
            break;
        }
        loop {
            let path = read_cstring(&mut cur, tree_end)?;
            if path.is_empty() {
                break;
            }
            loop {
                let name = read_cstring(&mut cur, tree_end)?;
                if name.is_empty() {
                    break;
                }
                if cur.position() as usize + 18 > tree_end {
                    return Err(VpkError("VPK entry is truncated.".into()));
                }
                let _crc = read_u32(&mut cur)?;
                let preload_len = read_u16(&mut cur)? as usize;
                let archive_index = read_u16(&mut cur)?;
                let offset = read_u32(&mut cur)? as usize;
                let length = read_u32(&mut cur)? as usize;
                let term = read_u16(&mut cur)?;
                if term != 0xffff {
                    return Err(VpkError("VPK entry terminator missing.".into()));
                }
                if (cur.position() as usize) + preload_len > tree_end {
                    return Err(VpkError("VPK preload is truncated.".into()));
                }
                let mut preload = vec![0u8; preload_len];
                cur.read_exact(&mut preload)
                    .map_err(|err| VpkError(err.to_string()))?;
                let rel = if path == " " || path.is_empty() {
                    format!("{name}.{ext}")
                } else {
                    format!("{path}/{name}.{ext}")
                };
                if rel.contains("..") {
                    return Err(VpkError("Refusing a VPK path that escapes.".into()));
                }
                let rel = rel.replace('\\', "/");
                if let Some(keep) = keep {
                    if !keep(&rel) {
                        continue;
                    }
                }
                let mut body = preload;
                if length > 0 {
                    if archive_index == DIR_ARCHIVE {
                        let start = data_base + offset;
                        let end = start.saturating_add(length);
                        if end > bytes.len() {
                            return Err(VpkError("VPK file data is truncated.".into()));
                        }
                        body.extend_from_slice(&bytes[start..end]);
                    } else {
                        let Some(dir_path) = dir_path else {
                            return Err(VpkError(
                                "Refusing an in-memory split VPK (need the *_dir.vpk path).".into(),
                            ));
                        };
                        if !archives.contains_key(&archive_index) {
                            let sibling = sibling_archive_path(dir_path, archive_index)?;
                            let opened = std::fs::File::open(&sibling)
                                .map_err(|err| VpkError(err.to_string()))?;
                            archives.insert(archive_index, opened);
                        }
                        let archive = archives.get_mut(&archive_index).expect("archive opened");
                        let end = (offset as u64).saturating_add(length as u64);
                        let available = archive
                            .metadata()
                            .map_err(|err| VpkError(err.to_string()))?
                            .len();
                        if end > available {
                            return Err(VpkError("VPK archive data is truncated.".into()));
                        }
                        archive
                            .seek(SeekFrom::Start(offset as u64))
                            .map_err(|err| VpkError(err.to_string()))?;
                        let mut chunk = vec![0u8; length];
                        archive
                            .read_exact(&mut chunk)
                            .map_err(|err| VpkError(err.to_string()))?;
                        body.extend_from_slice(&chunk);
                    }
                }
                files.insert(rel, body);
            }
        }
    }
    Ok(VpkArchive { files })
}

/// Where one entry's bytes live, plus where its CRC sits in the directory
/// file — everything needed to rewrite the entry in place.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct VpkEntryLocation {
    pub rel: String,
    pub crc: u32,
    /// Byte offset of the CRC field inside the `_dir.vpk` file.
    pub crc_pos: u64,
    pub preload_len: u16,
    pub archive_index: u16,
    pub offset: u32,
    pub length: u32,
    /// Absolute offset of the post-tree data region in the `_dir.vpk` file
    /// (start for `archive_index == 0x7fff` entries).
    pub data_base: u64,
}

impl VpkEntryLocation {
    pub fn total_len(&self) -> usize {
        self.preload_len as usize + self.length as usize
    }
}

/// Map every entry to its physical location without reading any file bodies.
pub fn map_vpk_entries(path: &Path) -> Result<BTreeMap<String, VpkEntryLocation>, VpkError> {
    let bytes = std::fs::read(path).map_err(|err| VpkError(err.to_string()))?;
    if bytes.len() < 12 {
        return Err(VpkError("VPK header is too short.".into()));
    }
    let mut cur = Cursor::new(bytes.as_slice());
    let signature = read_u32(&mut cur)?;
    if signature != SIGNATURE {
        return Err(VpkError("Not a VPK archive.".into()));
    }
    let version = read_u32(&mut cur)?;
    let tree_size = read_u32(&mut cur)? as usize;
    let header_size = match version {
        1 => 12,
        2 => {
            if bytes.len() < 28 {
                return Err(VpkError("VPK v2 header is too short.".into()));
            }
            cur.set_position(28);
            28
        }
        _ => return Err(VpkError(format!("unsupported VPK version {version}"))),
    };
    let tree_end = header_size + tree_size;
    if bytes.len() < tree_end {
        return Err(VpkError("VPK directory tree is truncated.".into()));
    }
    let mut entries = BTreeMap::new();
    while cur.position() < tree_end as u64 {
        let ext = read_cstring(&mut cur, tree_end)?;
        if ext.is_empty() {
            break;
        }
        loop {
            let path_part = read_cstring(&mut cur, tree_end)?;
            if path_part.is_empty() {
                break;
            }
            loop {
                let name = read_cstring(&mut cur, tree_end)?;
                if name.is_empty() {
                    break;
                }
                if cur.position() as usize + 18 > tree_end {
                    return Err(VpkError("VPK entry is truncated.".into()));
                }
                let crc_pos = cur.position();
                let crc = read_u32(&mut cur)?;
                let preload_len = read_u16(&mut cur)?;
                let archive_index = read_u16(&mut cur)?;
                let offset = read_u32(&mut cur)?;
                let length = read_u32(&mut cur)?;
                let term = read_u16(&mut cur)?;
                if term != 0xffff {
                    return Err(VpkError("VPK entry terminator missing.".into()));
                }
                if (cur.position() as usize) + preload_len as usize > tree_end {
                    return Err(VpkError("VPK preload is truncated.".into()));
                }
                cur.set_position(cur.position() + u64::from(preload_len));
                let rel = if path_part == " " || path_part.is_empty() {
                    format!("{name}.{ext}")
                } else {
                    format!("{path_part}/{name}.{ext}")
                };
                if rel.contains("..") {
                    return Err(VpkError("Refusing a VPK path that escapes.".into()));
                }
                entries.insert(
                    rel.replace('\\', "/"),
                    VpkEntryLocation {
                        rel: rel.replace('\\', "/"),
                        crc,
                        crc_pos,
                        preload_len,
                        archive_index,
                        offset,
                        length,
                        data_base: tree_end as u64,
                    },
                );
            }
        }
    }
    Ok(entries)
}

/// Read one entry's bytes via its location (no full-archive materialization).
pub fn read_vpk_entry(dir_path: &Path, entry: &VpkEntryLocation) -> Result<Vec<u8>, VpkError> {
    if entry.preload_len != 0 {
        return Err(VpkError(format!(
            "{} keeps preload bytes in the directory; not supported.",
            entry.rel
        )));
    }
    let (path, start) = if entry.archive_index == DIR_ARCHIVE {
        (dir_path.to_path_buf(), entry.data_base + u64::from(entry.offset))
    } else {
        (
            sibling_archive_path(dir_path, entry.archive_index)?,
            u64::from(entry.offset),
        )
    };
    let mut file = std::fs::File::open(&path).map_err(|err| VpkError(err.to_string()))?;
    file.seek(SeekFrom::Start(start))
        .map_err(|err| VpkError(err.to_string()))?;
    let mut body = vec![0u8; entry.length as usize];
    file.read_exact(&mut body)
        .map_err(|err| VpkError(err.to_string()))?;
    Ok(body)
}

/// Rewrite one entry's DATA in place. `data` must exactly match the stored
/// length — callers pad shrunk files up to size first.
///
/// The `_dir.vpk` file is NEVER touched — not even the entry's CRC. That is
/// load-bearing, not sloppiness: the directory carries Valve's tree checksum
/// and signature, and sv_pure validates files against the directory's stock
/// CRCs. Leaving the directory byte-pristine (stale CRC over modded data) is
/// exactly what lets patched content pass the pure check; rewriting the CRC
/// both breaks the tree checksum and advertises the modded hash, and the
/// engine then rejects the entire archive on pure servers.
pub fn patch_vpk_entry(
    dir_path: &Path,
    entry: &VpkEntryLocation,
    data: &[u8],
) -> Result<(), VpkError> {
    use std::io::Write;
    if entry.preload_len != 0 {
        return Err(VpkError(format!(
            "{} keeps preload bytes in the directory; not supported.",
            entry.rel
        )));
    }
    if data.len() != entry.length as usize {
        return Err(VpkError(format!(
            "{}: replacement is {} bytes but the entry stores {}.",
            entry.rel,
            data.len(),
            entry.length
        )));
    }
    if entry.archive_index == DIR_ARCHIVE {
        // Data stored inside the _dir.vpk itself would force a write to the
        // directory file; no stock particle uses this layout, and keeping the
        // directory byte-pristine matters more than supporting it.
        return Err(VpkError(format!(
            "{} stores its data in the directory file; not supported.",
            entry.rel
        )));
    }
    let data_path = sibling_archive_path(dir_path, entry.archive_index)?;
    let start = u64::from(entry.offset);
    let mut data_file = std::fs::OpenOptions::new()
        .write(true)
        .open(&data_path)
        .map_err(|err| VpkError(err.to_string()))?;
    let available = data_file
        .metadata()
        .map_err(|err| VpkError(err.to_string()))?
        .len();
    if start.saturating_add(data.len() as u64) > available {
        return Err(VpkError(format!("{}: entry runs past the archive.", entry.rel)));
    }
    data_file
        .seek(SeekFrom::Start(start))
        .map_err(|err| VpkError(err.to_string()))?;
    data_file
        .write_all(data)
        .map_err(|err| VpkError(err.to_string()))?;
    data_file
        .sync_all()
        .map_err(|err| VpkError(err.to_string()))?;
    Ok(())
}

/// `tf2_misc_dir.vpk` + archive 0 → same-folder `tf2_misc_000.vpk`. Never leaves that folder.
pub fn sibling_archive_path(dir_path: &Path, index: u16) -> Result<std::path::PathBuf, VpkError> {
    let name = dir_path
        .file_name()
        .and_then(|name| name.to_str())
        .unwrap_or("");
    let stem = name
        .strip_suffix("_dir.vpk")
        .or_else(|| name.strip_suffix("_dir.VPK"))
        .ok_or_else(|| VpkError("Split VPK directory files must be named *_dir.vpk.".into()))?;
    if stem.is_empty() || stem.contains("..") || stem.contains('/') || stem.contains('\\') {
        return Err(VpkError("Refusing a VPK archive name that escapes.".into()));
    }
    let parent = dir_path
        .parent()
        .ok_or_else(|| VpkError("VPK directory has no parent folder.".into()))?;
    let sibling = parent.join(format!("{stem}_{index:03}.vpk"));
    if sibling.parent() != Some(parent) {
        return Err(VpkError("Refusing a VPK archive path that escapes.".into()));
    }
    Ok(sibling)
}

/// VPK v2 writer. All files live in the directory archive.
///
/// v2 is what TF2 itself ships and what every pack the game loads happily from
/// `tf/custom` uses (mastercomfig's included). A structurally valid v1 pack is
/// misread by the engine -- materials come back starting partway into the file,
/// which surfaces as `unknown shader "ric"` and `missing {` in the console --
/// so packs execs writes for the game must be v2.
pub fn write_vpk_v2(files: &BTreeMap<String, Vec<u8>>) -> Vec<u8> {
    let (tree, data) = build_vpk_tree(files);
    // Section sizes match a known-good pack: no per-archive hashes, the 48-byte
    // checksum block, no signature.
    const OTHER_MD5_SIZE: u32 = 48;
    let mut out = Vec::with_capacity(28 + tree.len() + data.len() + OTHER_MD5_SIZE as usize);
    out.extend_from_slice(&SIGNATURE.to_le_bytes());
    out.extend_from_slice(&2u32.to_le_bytes());
    out.extend_from_slice(&(tree.len() as u32).to_le_bytes());
    out.extend_from_slice(&(data.len() as u32).to_le_bytes());
    out.extend_from_slice(&0u32.to_le_bytes()); // archive MD5 section
    out.extend_from_slice(&OTHER_MD5_SIZE.to_le_bytes());
    out.extend_from_slice(&0u32.to_le_bytes()); // signature section
    out.extend_from_slice(&tree);
    out.extend_from_slice(&data);
    out.extend_from_slice(&crate::hash::md5(&tree));
    // With no archive MD5 section, its checksum is the hash of nothing.
    out.extend_from_slice(&crate::hash::md5(&[]));
    let whole = crate::hash::md5(&out);
    out.extend_from_slice(&whole);
    out
}

/// Minimal VPK v1 writer. All files live in the directory archive.
pub fn write_vpk_v1(files: &BTreeMap<String, Vec<u8>>) -> Vec<u8> {
    let (tree, data) = build_vpk_tree(files);
    let mut out = Vec::with_capacity(12 + tree.len() + data.len());
    out.extend_from_slice(&SIGNATURE.to_le_bytes());
    out.extend_from_slice(&1u32.to_le_bytes());
    out.extend_from_slice(&(tree.len() as u32).to_le_bytes());
    out.extend_from_slice(&tree);
    out.extend_from_slice(&data);
    out
}

/// The directory tree and file-data blob both versions share: entries grouped
/// extension/path/name, data offsets relative to the end of the tree.
fn build_vpk_tree(files: &BTreeMap<String, Vec<u8>>) -> (Vec<u8>, Vec<u8>) {
    let mut grouped: BTreeMap<String, BTreeMap<String, BTreeMap<String, Vec<u8>>>> =
        BTreeMap::new();
    for (rel, bytes) in files {
        let normalized = rel.replace('\\', "/");
        let (path, file) = match normalized.rfind('/') {
            Some(idx) => (&normalized[..idx], &normalized[idx + 1..]),
            None => (" ", normalized.as_str()),
        };
        let (name, ext) = match file.rfind('.') {
            Some(idx) => (&file[..idx], &file[idx + 1..]),
            None => (file, " "),
        };
        grouped
            .entry(ext.to_string())
            .or_default()
            .entry(path.to_string())
            .or_default()
            .insert(name.to_string(), bytes.clone());
    }

    let mut tree = Vec::new();
    let mut data = Vec::new();
    for (ext, paths) in &grouped {
        write_cstring(&mut tree, ext);
        for (path, names) in paths {
            write_cstring(&mut tree, path);
            for (name, bytes) in names {
                write_cstring(&mut tree, name);
                tree.extend_from_slice(&crc32(bytes).to_le_bytes());
                tree.extend_from_slice(&0u16.to_le_bytes());
                tree.extend_from_slice(&DIR_ARCHIVE.to_le_bytes());
                tree.extend_from_slice(&(data.len() as u32).to_le_bytes());
                tree.extend_from_slice(&(bytes.len() as u32).to_le_bytes());
                tree.extend_from_slice(&0xffffu16.to_le_bytes());
                data.extend_from_slice(bytes);
            }
            tree.push(0);
        }
        tree.push(0);
    }
    tree.push(0);

    (tree, data)
}

fn read_u32(cur: &mut Cursor<&[u8]>) -> Result<u32, VpkError> {
    let mut buf = [0u8; 4];
    cur.read_exact(&mut buf)
        .map_err(|err| VpkError(err.to_string()))?;
    Ok(u32::from_le_bytes(buf))
}

fn read_u16(cur: &mut Cursor<&[u8]>) -> Result<u16, VpkError> {
    let mut buf = [0u8; 2];
    cur.read_exact(&mut buf)
        .map_err(|err| VpkError(err.to_string()))?;
    Ok(u16::from_le_bytes(buf))
}

fn read_cstring(cur: &mut Cursor<&[u8]>, limit: usize) -> Result<String, VpkError> {
    let mut bytes = Vec::new();
    loop {
        if cur.position() as usize >= limit {
            return Err(VpkError("VPK string overran the directory tree.".into()));
        }
        let mut one = [0u8; 1];
        cur.read_exact(&mut one)
            .map_err(|err| VpkError(err.to_string()))?;
        if one[0] == 0 {
            break;
        }
        bytes.push(one[0]);
    }
    String::from_utf8(bytes).map_err(|_| VpkError("VPK path is not UTF-8.".into()))
}

fn write_cstring(out: &mut Vec<u8>, s: &str) {
    out.extend_from_slice(s.as_bytes());
    out.push(0);
}

pub(crate) fn crc32(data: &[u8]) -> u32 {
    let mut crc = 0xffff_ffffu32;
    for byte in data {
        crc ^= u32::from(*byte);
        for _ in 0..8 {
            let mask = if crc & 1 != 0 { 0xffff_ffff } else { 0 };
            crc = (crc >> 1) ^ (0xedb8_8320 & mask);
        }
    }
    !crc
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn v2_header_matches_the_layout_the_game_ships() {
        let mut files = BTreeMap::new();
        files.insert("materials/a/b.vmt".to_string(), b"\"UnlitGeneric\"
{
}
".to_vec());
        files.insert("root.txt".to_string(), b"hello".to_vec());
        let bytes = write_vpk_v2(&files);

        let u32_at = |at: usize| {
            u32::from_le_bytes(bytes[at..at + 4].try_into().unwrap()) as usize
        };
        assert_eq!(u32_at(0), SIGNATURE as usize);
        assert_eq!(u32_at(4), 2, "version");
        let (tree, data) = (u32_at(8), u32_at(12));
        let (archive_md5, other_md5, signature) = (u32_at(16), u32_at(20), u32_at(24));
        assert_eq!((archive_md5, other_md5, signature), (0, 48, 0));
        // The section sizes must account for every byte, as they do in the
        // game's own directory files.
        assert_eq!(28 + tree + data + archive_md5 + other_md5 + signature, bytes.len());

        // The checksum block: tree, archive-md5 section, whole file.
        let block = bytes.len() - 48;
        assert_eq!(bytes[block..block + 16], crate::hash::md5(&bytes[28..28 + tree]));
        assert_eq!(bytes[block + 16..block + 32], crate::hash::md5(&[]));
        assert_eq!(bytes[block + 32..], crate::hash::md5(&bytes[..block + 32]));
    }

    #[test]
    fn v2_round_trips_through_the_reader() {
        let mut files = BTreeMap::new();
        files.insert("materials/a/b.vmt".to_string(), b"one".to_vec());
        files.insert("models/c.mdl".to_string(), b"two".to_vec());
        let archive = read_vpk_dir_bytes(&write_vpk_v2(&files)).unwrap();
        assert_eq!(archive.files.get("materials/a/b.vmt").unwrap(), b"one");
        assert_eq!(archive.files.get("models/c.mdl").unwrap(), b"two");
    }

    #[test]
    fn writes_and_reads_a_single_file() {
        let mut files = BTreeMap::new();
        files.insert("scripts/tf_weapon_scattergun.ctx".into(), b"hello".to_vec());
        let bytes = write_vpk_v1(&files);
        let archive = read_vpk_dir_bytes(&bytes).unwrap();
        assert_eq!(
            archive
                .files
                .get("scripts/tf_weapon_scattergun.ctx")
                .unwrap(),
            b"hello"
        );
    }

    #[test]
    fn rejects_bad_signature() {
        assert!(read_vpk_dir_bytes(b"not a vpk").is_err());
    }

    #[test]
    fn reads_sibling_archive_and_refuses_escape_names() {
        let dir = std::env::temp_dir().join(format!(
            "execs-vpk-{}-{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        std::fs::create_dir_all(&dir).unwrap();
        let payload = b"weapon-script";
        std::fs::write(dir.join("tf2_misc_000.vpk"), payload).unwrap();

        let mut tree = Vec::new();
        write_cstring(&mut tree, "ctx");
        write_cstring(&mut tree, "scripts");
        write_cstring(&mut tree, "tf_weapon_scattergun");
        tree.extend_from_slice(&crc32(payload).to_le_bytes());
        tree.extend_from_slice(&0u16.to_le_bytes());
        tree.extend_from_slice(&0u16.to_le_bytes());
        tree.extend_from_slice(&0u32.to_le_bytes());
        tree.extend_from_slice(&(payload.len() as u32).to_le_bytes());
        tree.extend_from_slice(&0xffffu16.to_le_bytes());
        tree.push(0);
        tree.push(0);
        tree.push(0);

        let mut dir_bytes = Vec::new();
        dir_bytes.extend_from_slice(&SIGNATURE.to_le_bytes());
        dir_bytes.extend_from_slice(&1u32.to_le_bytes());
        dir_bytes.extend_from_slice(&(tree.len() as u32).to_le_bytes());
        dir_bytes.extend_from_slice(&tree);
        let dir_path = dir.join("tf2_misc_dir.vpk");
        std::fs::write(&dir_path, &dir_bytes).unwrap();

        let archive = read_vpk_dir_file(&dir_path).unwrap();
        assert_eq!(
            archive
                .files
                .get("scripts/tf_weapon_scattergun.ctx")
                .unwrap(),
            payload
        );
        assert!(read_vpk_dir_bytes(&dir_bytes).is_err());
        assert!(sibling_archive_path(Path::new("not-a-dir.vpk"), 0).is_err());
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn rejects_dotdot_paths() {
        let mut files = BTreeMap::new();
        files.insert("scripts/../steam.inf".into(), b"no".to_vec());
        let bytes = write_vpk_v1(&files);
        assert!(read_vpk_dir_bytes(&bytes).is_err());
    }
}
