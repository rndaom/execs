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

/// Valve's placeholder for "no folder" and "no extension" in the directory
/// tree: an empty string there would read as the end of the group, so the
/// writer emits a single space and the reader maps it back to nothing.
const NONE_MARKER: &str = " ";

/// Materialized bytes a read may produce beyond twice what is on disk. Entries
/// in the directory tree may overlap, so a crafted file with fifty entries each
/// covering the whole data region would otherwise allocate fifty copies of it.
const MATERIALIZE_HEADROOM: u64 = 1024 * 1024;

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

/// What a validate-only pass learned about a single-file VPK.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub struct VpkSummary {
    pub files: usize,
    /// Sum of every entry's stored length. Overlapping entries count twice, so
    /// this may exceed the file size; it is what a full read would allocate.
    pub bytes: u64,
}

/// Check a single-file VPK the way `read_vpk_dir_bytes` would, without copying
/// a single entry body: header, tree, every entry inside the data region, no
/// split-archive references, and no more overlap between entries than a full
/// read would tolerate. The cheap gate for a pack the user is importing.
pub fn validate_vpk_dir_bytes(bytes: &[u8]) -> Result<VpkSummary, VpkError> {
    let mut summary = VpkSummary::default();
    let budget = materialize_budget(bytes.len() as u64);
    walk_vpk_tree(bytes, &mut |entry| {
        let length = entry.length as usize;
        if length > 0 {
            if entry.archive_index != DIR_ARCHIVE {
                return Err(VpkError(
                    "Refusing an in-memory split VPK (need the *_dir.vpk path).".into(),
                ));
            }
            let start = entry.data_base + entry.offset as usize;
            let end = start.saturating_add(length);
            if end > bytes.len() {
                return Err(VpkError("VPK file data is truncated.".into()));
            }
        }
        summary.files += 1;
        charge(&mut summary.bytes, budget, entry.preload.len() + length)?;
        Ok(())
    })?;
    Ok(summary)
}

/// Twice what is on disk, plus headroom. Anything past that is entries
/// overlapping each other, never a real pack.
fn materialize_budget(on_disk: u64) -> u64 {
    on_disk
        .saturating_mul(2)
        .saturating_add(MATERIALIZE_HEADROOM)
}

/// One directory-tree entry as the walker hands it out: where its bytes live,
/// nothing copied yet.
struct RawEntry<'a> {
    rel: String,
    crc: u32,
    /// Byte offset of the CRC field inside the directory bytes.
    crc_pos: u64,
    preload: &'a [u8],
    archive_index: u16,
    offset: u32,
    length: u32,
    /// Absolute offset of the post-tree data region in the directory bytes.
    data_base: usize,
}

/// Parse the header and walk the extension / folder / name tree, calling
/// `visit` once per entry. Every reader goes through here so the bounds checks
/// on the tree are written once. Returns where the tree ends.
fn walk_vpk_tree<'a>(
    bytes: &'a [u8],
    visit: &mut dyn FnMut(RawEntry<'a>) -> Result<(), VpkError>,
) -> Result<usize, VpkError> {
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
    let header_size: usize = match version {
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
    let tree_end = header_size.saturating_add(tree_size);
    if bytes.len() < tree_end {
        return Err(VpkError("VPK directory tree is truncated.".into()));
    }
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
                let crc_pos = cur.position();
                let crc = read_u32(&mut cur)?;
                let preload_len = read_u16(&mut cur)? as usize;
                let archive_index = read_u16(&mut cur)?;
                let offset = read_u32(&mut cur)?;
                let length = read_u32(&mut cur)?;
                let term = read_u16(&mut cur)?;
                if term != 0xffff {
                    return Err(VpkError("VPK entry terminator missing.".into()));
                }
                let preload_start = cur.position() as usize;
                let preload_end = preload_start.saturating_add(preload_len);
                if preload_end > tree_end {
                    return Err(VpkError("VPK preload is truncated.".into()));
                }
                let preload = &bytes[preload_start..preload_end];
                cur.set_position(preload_end as u64);
                let file = if ext == NONE_MARKER {
                    name
                } else {
                    format!("{name}.{ext}")
                };
                let rel = if path == NONE_MARKER || path.is_empty() {
                    file
                } else {
                    format!("{path}/{file}")
                };
                if rel.contains("..") {
                    return Err(VpkError("Refusing a VPK path that escapes.".into()));
                }
                visit(RawEntry {
                    rel: rel.replace('\\', "/"),
                    crc,
                    crc_pos,
                    preload,
                    archive_index,
                    offset,
                    length,
                    data_base: tree_end,
                })?;
            }
        }
    }
    Ok(tree_end)
}

fn read_vpk(
    bytes: &[u8],
    dir_path: Option<&Path>,
    keep: Option<&dyn Fn(&str) -> bool>,
) -> Result<VpkArchive, VpkError> {
    let mut archives: BTreeMap<u16, std::fs::File> = BTreeMap::new();
    let mut files = BTreeMap::new();
    // The directory bytes up front, each sibling archive as it is opened.
    let mut budget = materialize_budget(bytes.len() as u64);
    let mut materialized: u64 = 0;
    walk_vpk_tree(bytes, &mut |entry| {
        if let Some(keep) = keep {
            if !keep(&entry.rel) {
                return Ok(());
            }
        }
        let length = entry.length as usize;
        let mut body = entry.preload.to_vec();
        if length > 0 {
            if entry.archive_index == DIR_ARCHIVE {
                let start = entry.data_base + entry.offset as usize;
                let end = start.saturating_add(length);
                if end > bytes.len() {
                    return Err(VpkError("VPK file data is truncated.".into()));
                }
                charge(&mut materialized, budget, length)?;
                body.extend_from_slice(&bytes[start..end]);
            } else {
                let Some(dir_path) = dir_path else {
                    return Err(VpkError(
                        "Refusing an in-memory split VPK (need the *_dir.vpk path).".into(),
                    ));
                };
                if let std::collections::btree_map::Entry::Vacant(e) =
                    archives.entry(entry.archive_index)
                {
                    let sibling = sibling_archive_path(dir_path, entry.archive_index)?;
                    let opened =
                        std::fs::File::open(&sibling).map_err(|err| VpkError(err.to_string()))?;
                    let len = opened
                        .metadata()
                        .map_err(|err| VpkError(err.to_string()))?
                        .len();
                    budget = budget.saturating_add(len.saturating_mul(2));
                    e.insert(opened);
                }
                let archive = archives
                    .get_mut(&entry.archive_index)
                    .expect("archive opened");
                let end = u64::from(entry.offset).saturating_add(length as u64);
                let available = archive
                    .metadata()
                    .map_err(|err| VpkError(err.to_string()))?
                    .len();
                if end > available {
                    return Err(VpkError("VPK archive data is truncated.".into()));
                }
                charge(&mut materialized, budget, length)?;
                archive
                    .seek(SeekFrom::Start(u64::from(entry.offset)))
                    .map_err(|err| VpkError(err.to_string()))?;
                let mut chunk = vec![0u8; length];
                archive
                    .read_exact(&mut chunk)
                    .map_err(|err| VpkError(err.to_string()))?;
                body.extend_from_slice(&chunk);
            }
        }
        files.insert(entry.rel, body);
        Ok(())
    })?;
    Ok(VpkArchive { files })
}

/// Account `length` bytes against the materialization budget before they are
/// allocated. An allocation failure aborts the process, so the check has to
/// come first.
fn charge(materialized: &mut u64, budget: u64, length: usize) -> Result<(), VpkError> {
    *materialized = materialized.saturating_add(length as u64);
    if *materialized > budget {
        return Err(VpkError(
            "VPK entries overlap far beyond the archive's size; refusing to load it.".into(),
        ));
    }
    Ok(())
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
    let mut entries = BTreeMap::new();
    walk_vpk_tree(&bytes, &mut |entry| {
        entries.insert(
            entry.rel.clone(),
            VpkEntryLocation {
                rel: entry.rel,
                crc: entry.crc,
                crc_pos: entry.crc_pos,
                preload_len: entry.preload.len() as u16,
                archive_index: entry.archive_index,
                offset: entry.offset,
                length: entry.length,
                data_base: entry.data_base as u64,
            },
        );
        Ok(())
    })?;
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
        (
            dir_path.to_path_buf(),
            entry.data_base + u64::from(entry.offset),
        )
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
        return Err(VpkError(format!(
            "{}: entry runs past the archive.",
            entry.rel
        )));
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
/// VPK v1. The game loads v2 packs (commit 7017510); this remains only so the
/// reader keeps a v1 fixture to parse.
#[cfg(test)]
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

/// Why `rel` cannot go into a pack this writer builds, or `None` when it can.
///
/// The tree stores extension, folder and name as NUL-terminated strings and
/// reads an empty one as the end of a group, so a dotfile (`materials/.foo`,
/// empty name) or a trailing-dot name (empty extension) would end the group
/// early and corrupt every entry after it. OS and VCS droppings are refused
/// outright: they never belong in a pack the game loads.
pub fn unwritable_reason(rel: &str) -> Option<&'static str> {
    let normalized = rel.replace('\\', "/");
    if normalized.is_empty() {
        return Some("has no path");
    }
    let mut segments = normalized.split('/').peekable();
    let mut file = "";
    while let Some(segment) = segments.next() {
        if segment.is_empty() {
            return Some("has an empty folder segment");
        }
        if crate::archive::is_junk_name(segment) {
            return Some("is an OS or VCS junk file");
        }
        if segments.peek().is_none() {
            file = segment;
        }
    }
    if file.starts_with("._") {
        return Some("is an OS or VCS junk file");
    }
    match file.rfind('.') {
        Some(0) => Some("has no file name before its extension"),
        Some(idx) if idx + 1 == file.len() => Some("ends with a dot"),
        _ => None,
    }
}

/// Split a pack path into the tree's `(folder, name, extension)` triple, with
/// [`NONE_MARKER`] standing in for a missing folder or extension. Source
/// lowercases every lookup, so the path is lowercased here once rather than
/// relying on each caller to have done it.
fn split_pack_path(rel: &str) -> Option<(String, String, String)> {
    if unwritable_reason(rel).is_some() {
        return None;
    }
    let normalized = rel.replace('\\', "/").to_ascii_lowercase();
    let (path, file) = match normalized.rfind('/') {
        Some(idx) => (&normalized[..idx], &normalized[idx + 1..]),
        None => (NONE_MARKER, normalized.as_str()),
    };
    let (name, ext) = match file.rfind('.') {
        Some(idx) => (&file[..idx], &file[idx + 1..]),
        None => (file, NONE_MARKER),
    };
    Some((path.to_string(), name.to_string(), ext.to_string()))
}

/// The directory tree and file-data blob both versions share: entries grouped
/// extension/path/name, data offsets relative to the end of the tree.
///
/// Paths are lowercased, and entries [`unwritable_reason`] refuses are left
/// out rather than written as a tree the reader would misparse. Callers that
/// need to report them check first — `write_vpk_v2` itself stays infallible
/// for the packs whose paths this app mints.
fn build_vpk_tree(files: &BTreeMap<String, Vec<u8>>) -> (Vec<u8>, Vec<u8>) {
    let mut grouped: BTreeMap<String, BTreeMap<String, BTreeMap<String, Vec<u8>>>> =
        BTreeMap::new();
    for (rel, bytes) in files {
        let Some((path, name, ext)) = split_pack_path(rel) else {
            continue;
        };
        grouped
            .entry(ext)
            .or_default()
            .entry(path)
            .or_default()
            .insert(name, bytes.clone());
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
        files.insert(
            "materials/a/b.vmt".to_string(),
            b"\"UnlitGeneric\"
{
}
"
            .to_vec(),
        );
        files.insert("root.txt".to_string(), b"hello".to_vec());
        let bytes = write_vpk_v2(&files);

        let u32_at = |at: usize| u32::from_le_bytes(bytes[at..at + 4].try_into().unwrap()) as usize;
        assert_eq!(u32_at(0), SIGNATURE as usize);
        assert_eq!(u32_at(4), 2, "version");
        let (tree, data) = (u32_at(8), u32_at(12));
        let (archive_md5, other_md5, signature) = (u32_at(16), u32_at(20), u32_at(24));
        assert_eq!((archive_md5, other_md5, signature), (0, 48, 0));
        // The section sizes must account for every byte, as they do in the
        // game's own directory files.
        assert_eq!(
            28 + tree + data + archive_md5 + other_md5 + signature,
            bytes.len()
        );

        // The checksum block: tree, archive-md5 section, whole file.
        let block = bytes.len() - 48;
        assert_eq!(
            bytes[block..block + 16],
            crate::hash::md5(&bytes[28..28 + tree])
        );
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

    /// A v1 directory whose tree holds `count` entries that all point at the
    /// same `body` in the data region. Every entry is in bounds, so only the
    /// sum of what a read would copy tells it apart from a real pack.
    fn overlapping_vpk(count: usize, body: &[u8]) -> Vec<u8> {
        let mut tree = Vec::new();
        write_cstring(&mut tree, "vtf");
        write_cstring(&mut tree, "materials");
        for index in 0..count {
            write_cstring(&mut tree, &format!("tex{index}"));
            tree.extend_from_slice(&crc32(body).to_le_bytes());
            tree.extend_from_slice(&0u16.to_le_bytes());
            tree.extend_from_slice(&DIR_ARCHIVE.to_le_bytes());
            tree.extend_from_slice(&0u32.to_le_bytes());
            tree.extend_from_slice(&(body.len() as u32).to_le_bytes());
            tree.extend_from_slice(&0xffffu16.to_le_bytes());
        }
        tree.push(0);
        tree.push(0);
        tree.push(0);
        let mut out = Vec::new();
        out.extend_from_slice(&SIGNATURE.to_le_bytes());
        out.extend_from_slice(&1u32.to_le_bytes());
        out.extend_from_slice(&(tree.len() as u32).to_le_bytes());
        out.extend_from_slice(&tree);
        out.extend_from_slice(body);
        out
    }

    /// Entries may overlap in a real pack (deduplicated textures), but a
    /// crafted directory can point fifty entries at one data region and make
    /// a 512 MiB file materialize 25 GiB. Both readers stop at the budget,
    /// before the allocation that would abort the process.
    #[test]
    fn overlapping_entries_far_past_the_file_size_are_refused_before_allocating() {
        let body = vec![0xabu8; 256 * 1024];
        // 40 entries × 256 KiB = 10 MiB against a budget of 2 × 256 KiB + 1 MiB.
        let bytes = overlapping_vpk(40, &body);
        let err = read_vpk_dir_bytes(&bytes).unwrap_err();
        assert!(err.0.contains("overlap"), "{}", err.0);
        let err = validate_vpk_dir_bytes(&bytes).unwrap_err();
        assert!(err.0.contains("overlap"), "{}", err.0);

        // Modest overlap is a real layout and still reads.
        let bytes = overlapping_vpk(3, &body);
        let summary = validate_vpk_dir_bytes(&bytes).unwrap();
        assert_eq!(summary.files, 3);
        assert_eq!(summary.bytes, 3 * body.len() as u64);
        assert_eq!(read_vpk_dir_bytes(&bytes).unwrap().files.len(), 3);
    }

    /// The validate pass is a pure bounds check: a truncated body, a split
    /// reference and a bad terminator all fail exactly as a read would.
    #[test]
    fn validate_reports_what_a_read_would_refuse() {
        let mut files = BTreeMap::new();
        files.insert("materials/a.vmt".to_string(), b"hello".to_vec());
        let bytes = write_vpk_v2(&files);
        assert_eq!(validate_vpk_dir_bytes(&bytes).unwrap().files, 1);

        let truncated = &bytes[..bytes.len() - 60];
        assert!(validate_vpk_dir_bytes(truncated).is_err());
        assert!(read_vpk_dir_bytes(truncated).is_err());
        assert!(validate_vpk_dir_bytes(b"not a vpk").is_err());
    }

    /// The tree reads an empty string as the end of a group, so a dotfile or
    /// a trailing-dot name used to write a lone NUL that ended the group early
    /// and corrupted every entry after it. Those are left out; the rest of the
    /// pack round-trips, lowercased the way the engine looks paths up.
    #[test]
    fn junk_and_unwritable_names_are_left_out_and_paths_are_lowercased() {
        let mut files = BTreeMap::new();
        for rel in [
            "materials/.DS_Store",
            "materials/a/.hidden",
            "materials/a/dangling.",
            "materials/a/Thumbs.db",
            "materials/a/._resource.vmt",
            "materials/a/desktop.ini",
            "__MACOSX/materials/a/x.vmt",
        ] {
            files.insert(rel.to_string(), b"junk".to_vec());
        }
        files.insert("materials/a/good.vmt".to_string(), b"one".to_vec());
        files.insert("Materials/B/Upper.VMT".to_string(), b"two".to_vec());
        files.insert("readme".to_string(), b"three".to_vec());
        files.insert("materials/a/zed.vtf".to_string(), b"four".to_vec());

        for bytes in [write_vpk_v2(&files), write_vpk_v1(&files)] {
            let archive = read_vpk_dir_bytes(&bytes).unwrap();
            let keys: Vec<&String> = archive.files.keys().collect();
            assert_eq!(
                keys,
                vec![
                    "materials/a/good.vmt",
                    "materials/a/zed.vtf",
                    "materials/b/upper.vmt",
                    "readme"
                ],
                "{keys:?}"
            );
            assert_eq!(archive.files["materials/a/good.vmt"], b"one");
            assert_eq!(archive.files["materials/b/upper.vmt"], b"two");
            assert_eq!(archive.files["readme"], b"three");
            assert_eq!(archive.files["materials/a/zed.vtf"], b"four");
        }

        assert_eq!(unwritable_reason("materials/a/good.vmt"), None);
        assert_eq!(unwritable_reason("readme"), None);
        assert!(unwritable_reason("materials/.DS_Store").is_some());
        assert!(unwritable_reason("materials/a/.hidden").is_some());
        assert!(unwritable_reason("materials/a/dangling.").is_some());
        assert!(unwritable_reason("materials/a/._resource.vmt").is_some());
        assert!(unwritable_reason("materials//a.vmt").is_some());
        assert!(unwritable_reason("").is_some());
    }

    /// Valve's own directories spell "no extension" as a single space; the
    /// reader must give such an entry back without a trailing dot.
    #[test]
    fn a_space_extension_reads_back_as_no_extension() {
        let mut tree = Vec::new();
        let payload = b"license";
        write_cstring(&mut tree, " ");
        write_cstring(&mut tree, " ");
        write_cstring(&mut tree, "readme");
        tree.extend_from_slice(&crc32(payload).to_le_bytes());
        tree.extend_from_slice(&0u16.to_le_bytes());
        tree.extend_from_slice(&DIR_ARCHIVE.to_le_bytes());
        tree.extend_from_slice(&0u32.to_le_bytes());
        tree.extend_from_slice(&(payload.len() as u32).to_le_bytes());
        tree.extend_from_slice(&0xffffu16.to_le_bytes());
        tree.push(0);
        tree.push(0);
        tree.push(0);
        let mut bytes = Vec::new();
        bytes.extend_from_slice(&SIGNATURE.to_le_bytes());
        bytes.extend_from_slice(&1u32.to_le_bytes());
        bytes.extend_from_slice(&(tree.len() as u32).to_le_bytes());
        bytes.extend_from_slice(&tree);
        bytes.extend_from_slice(payload);
        let archive = read_vpk_dir_bytes(&bytes).unwrap();
        assert_eq!(archive.files.get("readme").unwrap(), payload);
    }
}
