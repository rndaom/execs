//! Source VPK v1/v2 reader and a small v1 writer. Read-only against official TF2 VPKs.

use std::collections::{BTreeMap, BTreeSet};
use std::fs::{self, File, OpenOptions};
use std::io::{Cursor, Read, Seek, SeekFrom};
use std::path::{Path, PathBuf};

use same_file::Handle as SameFileHandle;

use crate::hash::metadata_is_link;

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

/// Imported packs are also archive members from the Mods pane, whose public
/// limit is 20,000 files. A VPK is one archive member, so its own directory
/// needs the same independent limit.
const MAX_IMPORTED_VPK_ENTRIES: usize = 20_000;
const MAX_IMPORTED_PATH_BYTES: usize = 8 * 1024 * 1024;
const MAX_IMPORTED_TREE_BYTES: usize = 16 * 1024 * 1024;

/// Valve's directory archives are much larger than community packs. Keep a
/// generous, finite ceiling so a corrupt `_dir.vpk` still cannot grow an
/// unbounded map merely by being opened by a status call.
const MAX_DIRECTORY_VPK_ENTRIES: usize = 500_000;
const MAX_DIRECTORY_PATH_BYTES: usize = 64 * 1024 * 1024;
const MAX_VPK_TREE_BYTES: usize = 64 * 1024 * 1024;
const MAX_VPK_ENTRY_BYTES: u64 = 512 * 1024 * 1024;
const MAX_MATERIALIZED_VPK_BYTES: u64 = 512 * 1024 * 1024;

#[derive(Clone, Copy)]
struct MaterializationLimits {
    entry_bytes: u64,
    total_bytes: u64,
}

const DEFAULT_MATERIALIZATION_LIMITS: MaterializationLimits = MaterializationLimits {
    entry_bytes: MAX_VPK_ENTRY_BYTES,
    total_bytes: MAX_MATERIALIZED_VPK_BYTES,
};

#[derive(Clone, Copy)]
struct TreeLimits {
    entries: usize,
    path_bytes: usize,
    tree_bytes: usize,
}

const IMPORT_LIMITS: TreeLimits = TreeLimits {
    entries: MAX_IMPORTED_VPK_ENTRIES,
    path_bytes: MAX_IMPORTED_PATH_BYTES,
    tree_bytes: MAX_IMPORTED_TREE_BYTES,
};
const DIRECTORY_LIMITS: TreeLimits = TreeLimits {
    entries: MAX_DIRECTORY_VPK_ENTRIES,
    path_bytes: MAX_DIRECTORY_PATH_BYTES,
    tree_bytes: MAX_VPK_TREE_BYTES,
};

pub fn read_vpk_dir_file(path: &Path) -> Result<VpkArchive, VpkError> {
    let limits = limits_for_path(path);
    let (tree, on_disk_len) = read_tree_from_path(path, limits)?;
    read_vpk(
        &tree,
        Some(path),
        None,
        on_disk_len,
        limits,
        DEFAULT_MATERIALIZATION_LIMITS,
    )
}

/// Read only the entries whose relative path passes `keep`. Skipped entries
/// never touch the sibling archives, so filtering `tf2_misc_dir.vpk` down to
/// weapon scripts stays cheap instead of materializing gigabytes.
pub fn read_vpk_dir_file_filtered(
    path: &Path,
    keep: &dyn Fn(&str) -> bool,
) -> Result<VpkArchive, VpkError> {
    let limits = limits_for_path(path);
    let (tree, on_disk_len) = read_tree_from_path(path, limits)?;
    read_vpk(
        &tree,
        Some(path),
        Some(keep),
        on_disk_len,
        limits,
        DEFAULT_MATERIALIZATION_LIMITS,
    )
}

/// Read selected entries while enforcing a caller-specific allocation
/// ceiling. This is for narrow consumers such as one particle source: the
/// general VPK limit is intentionally much larger than their actual format.
pub fn read_vpk_dir_file_filtered_bounded(
    path: &Path,
    keep: &dyn Fn(&str) -> bool,
    max_entry_bytes: u64,
    max_total_bytes: u64,
) -> Result<VpkArchive, VpkError> {
    let limits = limits_for_path(path);
    let (tree, on_disk_len) = read_tree_from_path(path, limits)?;
    read_vpk(
        &tree,
        Some(path),
        Some(keep),
        on_disk_len,
        limits,
        MaterializationLimits {
            entry_bytes: max_entry_bytes.min(MAX_VPK_ENTRY_BYTES),
            total_bytes: max_total_bytes.min(MAX_MATERIALIZED_VPK_BYTES),
        },
    )
}

pub fn read_vpk_dir_bytes(bytes: &[u8]) -> Result<VpkArchive, VpkError> {
    read_vpk(
        bytes,
        None,
        None,
        bytes.len() as u64,
        IMPORT_LIMITS,
        DEFAULT_MATERIALIZATION_LIMITS,
    )
}

/// Validate and materialize only selected entries from an in-memory community
/// VPK. Strict imported-pack entry and metadata budgets still apply.
pub fn read_vpk_dir_bytes_filtered(
    bytes: &[u8],
    keep: &dyn Fn(&str) -> bool,
) -> Result<VpkArchive, VpkError> {
    read_vpk(
        bytes,
        None,
        Some(keep),
        bytes.len() as u64,
        IMPORT_LIMITS,
        DEFAULT_MATERIALIZATION_LIMITS,
    )
}

/// What a validate-only pass learned about a single-file VPK.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub struct VpkSummary {
    pub files: usize,
    /// Sum of every entry's stored length. Overlapping entries count twice, so
    /// this may exceed the file size; it is what a full read would allocate.
    pub bytes: u64,
}

fn limits_for_path(path: &Path) -> TreeLimits {
    let is_directory = path
        .file_name()
        .and_then(|name| name.to_str())
        .is_some_and(|name| name.to_ascii_lowercase().ends_with("_dir.vpk"));
    if is_directory {
        DIRECTORY_LIMITS
    } else {
        IMPORT_LIMITS
    }
}

/// Read only the fixed header and directory tree from a path. A 500 MiB
/// single-file community VPK can therefore be inspected for one PCF without
/// first copying all 500 MiB into memory.
fn read_tree_from_path(path: &Path, limits: TreeLimits) -> Result<(Vec<u8>, u64), VpkError> {
    let (mut file, metadata, identity, canonical_parent) = open_regular_no_follow(path, false)?;
    let on_disk_len = file
        .metadata()
        .map_err(|err| VpkError(err.to_string()))?
        .len();
    let mut fixed = [0u8; 12];
    file.read_exact(&mut fixed)
        .map_err(|_| VpkError("VPK header is too short.".into()))?;
    let signature = u32::from_le_bytes(fixed[0..4].try_into().expect("fixed slice"));
    if signature != SIGNATURE {
        return Err(VpkError("Not a VPK archive.".into()));
    }
    let version = u32::from_le_bytes(fixed[4..8].try_into().expect("fixed slice"));
    let header_size = match version {
        1 => 12usize,
        2 => 28usize,
        _ => return Err(VpkError(format!("unsupported VPK version {version}"))),
    };
    let tree_size = u32::from_le_bytes(fixed[8..12].try_into().expect("fixed slice")) as usize;
    if tree_size > limits.tree_bytes {
        return Err(VpkError(format!(
            "VPK directory tree is larger than {} MiB.",
            limits.tree_bytes / (1024 * 1024)
        )));
    }
    let tree_end = header_size
        .checked_add(tree_size)
        .ok_or_else(|| VpkError("VPK directory tree size overflows.".into()))?;
    if tree_end as u64 > on_disk_len {
        return Err(VpkError("VPK directory tree is truncated.".into()));
    }
    let mut bytes = Vec::new();
    bytes
        .try_reserve_exact(tree_end)
        .map_err(|_| VpkError("Not enough memory for the VPK directory tree.".into()))?;
    bytes.resize(tree_end, 0);
    file.seek(SeekFrom::Start(0))
        .map_err(|err| VpkError(err.to_string()))?;
    file.read_exact(&mut bytes)
        .map_err(|err| VpkError(err.to_string()))?;
    verify_open_identity(path, &file, &metadata, &identity, &canonical_parent)?;
    Ok((bytes, on_disk_len))
}

/// Open a VPK component without following a final symlink/reparse point and
/// retain enough identity information to detect a replacement while it is
/// being inspected. Writes use the same gate: a crafted `_000.vpk` link must
/// never turn the in-place particle patch into a write outside the TF2 VPK
/// directory.
fn open_regular_no_follow(
    path: &Path,
    write: bool,
) -> Result<(File, fs::Metadata, SameFileHandle, PathBuf), VpkError> {
    let canonical_parent = canonical_regular_parent(path)?;
    let before = fs::symlink_metadata(path).map_err(|err| VpkError(err.to_string()))?;
    if metadata_is_link(&before) || !before.is_file() {
        return Err(VpkError(format!(
            "Refusing a linked or non-regular VPK file: {}",
            path.display()
        )));
    }

    let mut options = OpenOptions::new();
    options.read(true).write(write);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        // Linux O_NOFOLLOW. The post-open identity checks below cover a path
        // replacement on every supported platform as well.
        options.custom_flags(0x0002_0000);
    }
    #[cfg(windows)]
    {
        use std::os::windows::fs::OpenOptionsExt;
        const FILE_FLAG_OPEN_REPARSE_POINT: u32 = 0x0020_0000;
        options.custom_flags(FILE_FLAG_OPEN_REPARSE_POINT);
    }
    let file = options
        .open(path)
        .map_err(|err| VpkError(err.to_string()))?;
    let opened = file.metadata().map_err(|err| VpkError(err.to_string()))?;
    if metadata_is_link(&opened) || !opened.is_file() {
        return Err(VpkError(format!(
            "Refusing a linked or non-regular VPK file: {}",
            path.display()
        )));
    }
    if write {
        refuse_multiple_hard_links(&file, path)?;
    }
    let identity =
        SameFileHandle::from_file(file.try_clone().map_err(|err| VpkError(err.to_string()))?)
            .map_err(|err| VpkError(err.to_string()))?;
    verify_open_identity(path, &file, &opened, &identity, &canonical_parent)?;
    Ok((file, opened, identity, canonical_parent))
}

fn canonical_regular_parent(path: &Path) -> Result<PathBuf, VpkError> {
    let parent = path
        .parent()
        .ok_or_else(|| VpkError("VPK file has no parent folder.".into()))?;
    let metadata = fs::symlink_metadata(parent).map_err(|err| VpkError(err.to_string()))?;
    if metadata_is_link(&metadata) || !metadata.is_dir() {
        return Err(VpkError(format!(
            "Refusing a linked or non-directory VPK parent: {}",
            parent.display()
        )));
    }
    fs::canonicalize(parent).map_err(|err| VpkError(err.to_string()))
}

fn verify_open_identity(
    path: &Path,
    file: &File,
    opened_metadata: &fs::Metadata,
    opened_identity: &SameFileHandle,
    canonical_parent: &Path,
) -> Result<(), VpkError> {
    let current = fs::symlink_metadata(path).map_err(|err| VpkError(err.to_string()))?;
    let handle_metadata = file.metadata().map_err(|err| VpkError(err.to_string()))?;
    let current_identity =
        SameFileHandle::from_path(path).map_err(|err| VpkError(err.to_string()))?;
    let resolved = fs::canonicalize(path).map_err(|err| VpkError(err.to_string()))?;
    if metadata_is_link(&current)
        || !current.is_file()
        || &current_identity != opened_identity
        || metadata_changed(opened_metadata, &handle_metadata)
        || metadata_changed(&handle_metadata, &current)
        || resolved.parent() != Some(canonical_parent)
    {
        return Err(VpkError(format!(
            "{} changed or escaped its VPK directory; retry after Steam finishes.",
            path.display()
        )));
    }
    Ok(())
}

fn metadata_changed(left: &fs::Metadata, right: &fs::Metadata) -> bool {
    left.len() != right.len()
        || matches!((left.modified(), right.modified()), (Ok(a), Ok(b)) if a != b)
}

fn refuse_multiple_hard_links(file: &File, path: &Path) -> Result<(), VpkError> {
    #[cfg(unix)]
    let links = {
        use std::os::unix::fs::MetadataExt;
        file.metadata()
            .map_err(|err| VpkError(err.to_string()))?
            .nlink()
    };
    #[cfg(windows)]
    let links = windows_file_link_count(file)?;
    #[cfg(not(any(unix, windows)))]
    let links = 1u64;

    if links > 1 {
        return Err(VpkError(format!(
            "Refusing to patch a hard-linked VPK file: {}",
            path.display()
        )));
    }
    Ok(())
}

#[cfg(windows)]
fn windows_file_link_count(file: &File) -> Result<u64, VpkError> {
    use std::mem::MaybeUninit;
    use std::os::windows::io::AsRawHandle;

    #[repr(C)]
    struct FileTime {
        low: u32,
        high: u32,
    }
    #[repr(C)]
    struct ByHandleFileInformation {
        attributes: u32,
        creation_time: FileTime,
        last_access_time: FileTime,
        last_write_time: FileTime,
        volume_serial_number: u32,
        file_size_high: u32,
        file_size_low: u32,
        number_of_links: u32,
        file_index_high: u32,
        file_index_low: u32,
    }
    #[link(name = "kernel32")]
    extern "system" {
        #[link_name = "GetFileInformationByHandle"]
        fn get_file_information_by_handle(
            handle: *mut std::ffi::c_void,
            information: *mut ByHandleFileInformation,
        ) -> i32;
    }

    let mut information = MaybeUninit::<ByHandleFileInformation>::uninit();
    // SAFETY: the handle belongs to the live `File`, the output points to a
    // correctly laid-out uninitialized structure, and it is read only after
    // the OS reports success.
    let result =
        unsafe { get_file_information_by_handle(file.as_raw_handle(), information.as_mut_ptr()) };
    if result == 0 {
        return Err(VpkError(std::io::Error::last_os_error().to_string()));
    }
    // SAFETY: a successful call initialized the complete structure.
    Ok(u64::from(
        unsafe { information.assume_init() }.number_of_links,
    ))
}

fn ensure_same_archive_parent(dir_path: &Path, data_path: &Path) -> Result<(), VpkError> {
    if canonical_regular_parent(dir_path)? != canonical_regular_parent(data_path)? {
        return Err(VpkError(
            "Refusing a split VPK component outside the directory archive's folder.".into(),
        ));
    }
    Ok(())
}

/// Check a single-file VPK the way `read_vpk_dir_bytes` would, without copying
/// a single entry body: header, tree, every entry inside the data region, no
/// split-archive references, and no more overlap between entries than a full
/// read would tolerate. The cheap gate for a pack the user is importing.
pub fn validate_vpk_dir_bytes(bytes: &[u8]) -> Result<VpkSummary, VpkError> {
    let mut summary = VpkSummary::default();
    let budget = materialize_budget(bytes.len() as u64);
    walk_vpk_tree(bytes, bytes.len() as u64, IMPORT_LIMITS, &mut |entry| {
        let length = entry.length as usize;
        let total_len = entry
            .preload
            .len()
            .checked_add(length)
            .ok_or_else(|| VpkError("VPK entry size overflows.".into()))?;
        if total_len as u64 > MAX_VPK_ENTRY_BYTES {
            return Err(VpkError(format!(
                "VPK entry is larger than {} MiB.",
                MAX_VPK_ENTRY_BYTES / (1024 * 1024)
            )));
        }
        if length > 0 {
            if entry.archive_index != DIR_ARCHIVE {
                return Err(VpkError(
                    "Refusing an in-memory split VPK (need the *_dir.vpk path).".into(),
                ));
            }
            let start = entry
                .data_base
                .checked_add(u64::from(entry.offset))
                .ok_or_else(|| VpkError("VPK file data offset overflows.".into()))?;
            let end = start
                .checked_add(length as u64)
                .ok_or_else(|| VpkError("VPK file data size overflows.".into()))?;
            if end > entry.data_end {
                return Err(VpkError("VPK entry leaves its data section.".into()));
            }
            if end > bytes.len() as u64 {
                return Err(VpkError("VPK file data is truncated.".into()));
            }
        }
        summary.files += 1;
        charge(&mut summary.bytes, budget, total_len)?;
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
        .min(MAX_MATERIALIZED_VPK_BYTES)
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
    data_base: u64,
    /// End of the directory-resident data section. VPK v2 declares this
    /// explicitly; entries may not point into checksum/signature sections.
    data_end: u64,
}

/// Parse the header and walk the extension / folder / name tree, calling
/// `visit` once per entry. Every reader goes through here so the bounds checks
/// on the tree are written once. Returns where the tree ends.
fn walk_vpk_tree<'a>(
    bytes: &'a [u8],
    on_disk_len: u64,
    limits: TreeLimits,
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
    let (header_size, declared_data_size): (usize, Option<u64>) = match version {
        1 => (12, None),
        2 => {
            if bytes.len() < 28 {
                return Err(VpkError("VPK v2 header is too short.".into()));
            }
            let file_data_size = read_u32(&mut cur)? as u64;
            let archive_md5_size = read_u32(&mut cur)? as u64;
            let other_md5_size = read_u32(&mut cur)? as u64;
            let signature_size = read_u32(&mut cur)? as u64;
            let declared_end = [
                28u64,
                tree_size as u64,
                file_data_size,
                archive_md5_size,
                other_md5_size,
                signature_size,
            ]
            .into_iter()
            .try_fold(0u64, |total, size| total.checked_add(size))
            .ok_or_else(|| VpkError("VPK section sizes overflow.".into()))?;
            if declared_end > on_disk_len {
                return Err(VpkError("VPK sections run past the archive.".into()));
            }
            (28, Some(file_data_size))
        }
        _ => return Err(VpkError(format!("unsupported VPK version {version}"))),
    };
    if tree_size > limits.tree_bytes {
        return Err(VpkError(format!(
            "VPK directory tree is larger than {} MiB.",
            limits.tree_bytes / (1024 * 1024)
        )));
    }
    let tree_end = header_size
        .checked_add(tree_size)
        .ok_or_else(|| VpkError("VPK directory tree size overflows.".into()))?;
    if bytes.len() < tree_end {
        return Err(VpkError("VPK directory tree is truncated.".into()));
    }
    if tree_end as u64 > on_disk_len {
        return Err(VpkError("VPK directory tree runs past the archive.".into()));
    }
    let data_base = tree_end as u64;
    let data_end = match declared_data_size {
        Some(size) => data_base
            .checked_add(size)
            .ok_or_else(|| VpkError("VPK data section size overflows.".into()))?,
        None => on_disk_len,
    };
    let mut entry_count = 0usize;
    let mut path_bytes = 0usize;
    let mut seen_paths = BTreeSet::new();
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
                if archive_index == DIR_ARCHIVE {
                    let start = data_base
                        .checked_add(u64::from(offset))
                        .ok_or_else(|| VpkError("VPK file data offset overflows.".into()))?;
                    let end = start
                        .checked_add(u64::from(length))
                        .ok_or_else(|| VpkError("VPK file data size overflows.".into()))?;
                    if end > data_end {
                        return Err(VpkError("VPK entry leaves its data section.".into()));
                    }
                }
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
                entry_count = entry_count
                    .checked_add(1)
                    .ok_or_else(|| VpkError("VPK entry count overflows.".into()))?;
                if entry_count > limits.entries {
                    return Err(VpkError(format!(
                        "VPK contains more than {} entries.",
                        limits.entries
                    )));
                }
                path_bytes = path_bytes
                    .checked_add(rel.len())
                    .ok_or_else(|| VpkError("VPK path metadata size overflows.".into()))?;
                if path_bytes > limits.path_bytes {
                    return Err(VpkError("VPK path metadata is too large.".into()));
                }
                let normalized_rel = rel.replace('\\', "/");
                let portable_key = normalized_rel.to_lowercase();
                if !seen_paths.insert(portable_key) {
                    return Err(VpkError(format!(
                        "VPK contains duplicate or portable-colliding path: {normalized_rel}"
                    )));
                }
                visit(RawEntry {
                    rel: normalized_rel,
                    crc,
                    crc_pos,
                    preload,
                    archive_index,
                    offset,
                    length,
                    data_base,
                    data_end,
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
    on_disk_len: u64,
    limits: TreeLimits,
    materialization_limits: MaterializationLimits,
) -> Result<VpkArchive, VpkError> {
    let mut archives: BTreeMap<u16, std::fs::File> = BTreeMap::new();
    let mut files = BTreeMap::new();
    // The directory file on disk, then each sibling archive as it is opened.
    let mut budget = materialize_budget(on_disk_len);
    let mut materialized: u64 = 0;
    walk_vpk_tree(bytes, on_disk_len, limits, &mut |entry| {
        if let Some(keep) = keep {
            if !keep(&entry.rel) {
                return Ok(());
            }
        }
        let length = entry.length as usize;
        let total_len = entry
            .preload
            .len()
            .checked_add(length)
            .ok_or_else(|| VpkError("VPK entry size overflows.".into()))?;
        if total_len as u64 > materialization_limits.entry_bytes {
            return Err(VpkError(format!(
                "{} is larger than {} MiB.",
                entry.rel,
                materialization_limits.entry_bytes / (1024 * 1024)
            )));
        }
        charge(
            &mut materialized,
            budget.min(materialization_limits.total_bytes),
            entry.preload.len(),
        )?;
        let mut body = entry.preload.to_vec();
        if length > 0 {
            if entry.archive_index == DIR_ARCHIVE {
                charge(
                    &mut materialized,
                    budget.min(materialization_limits.total_bytes),
                    length,
                )?;
                let start = entry
                    .data_base
                    .checked_add(u64::from(entry.offset))
                    .ok_or_else(|| VpkError("VPK file data offset overflows.".into()))?;
                let end = start
                    .checked_add(length as u64)
                    .ok_or_else(|| VpkError("VPK file data size overflows.".into()))?;
                if end > entry.data_end {
                    return Err(VpkError("VPK entry leaves its data section.".into()));
                }
                if let Some(path) = dir_path {
                    if end > on_disk_len {
                        return Err(VpkError("VPK file data is truncated.".into()));
                    }
                    let archive = match archives.entry(DIR_ARCHIVE) {
                        std::collections::btree_map::Entry::Occupied(entry) => entry.into_mut(),
                        std::collections::btree_map::Entry::Vacant(entry) => {
                            let (opened, _, _, _) = open_regular_no_follow(path, false)?;
                            entry.insert(opened)
                        }
                    };
                    archive
                        .seek(SeekFrom::Start(start))
                        .map_err(|err| VpkError(err.to_string()))?;
                    append_exact(archive, &mut body, length)?;
                } else {
                    if end > bytes.len() as u64 {
                        return Err(VpkError("VPK file data is truncated.".into()));
                    }
                    body.extend_from_slice(&bytes[start as usize..end as usize]);
                }
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
                    ensure_same_archive_parent(dir_path, &sibling)?;
                    let (opened, _, _, _) = open_regular_no_follow(&sibling, false)?;
                    let len = opened
                        .metadata()
                        .map_err(|err| VpkError(err.to_string()))?
                        .len();
                    budget = add_split_archive_budget(budget, len);
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
                charge(
                    &mut materialized,
                    budget.min(materialization_limits.total_bytes),
                    length,
                )?;
                archive
                    .seek(SeekFrom::Start(u64::from(entry.offset)))
                    .map_err(|err| VpkError(err.to_string()))?;
                append_exact(archive, &mut body, length)?;
            }
        }
        files.insert(entry.rel, body);
        Ok(())
    })?;
    Ok(VpkArchive { files })
}

fn add_split_archive_budget(current: u64, archive_len: u64) -> u64 {
    current
        .saturating_add(archive_len.saturating_mul(2))
        .min(MAX_MATERIALIZED_VPK_BYTES)
}

fn append_exact(
    reader: &mut std::fs::File,
    body: &mut Vec<u8>,
    length: usize,
) -> Result<(), VpkError> {
    body.try_reserve_exact(length)
        .map_err(|_| VpkError("Not enough memory for a VPK entry.".into()))?;
    let start = body.len();
    body.resize(start + length, 0);
    reader
        .read_exact(&mut body[start..])
        .map_err(|err| VpkError(err.to_string()))
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
    let (bytes, on_disk_len) = read_tree_from_path(path, DIRECTORY_LIMITS)?;
    let mut entries = BTreeMap::new();
    walk_vpk_tree(&bytes, on_disk_len, DIRECTORY_LIMITS, &mut |entry| {
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
                data_base: entry.data_base,
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
            entry
                .data_base
                .checked_add(u64::from(entry.offset))
                .ok_or_else(|| VpkError(format!("{}: entry offset overflows.", entry.rel)))?,
        )
    } else {
        (
            sibling_archive_path(dir_path, entry.archive_index)?,
            u64::from(entry.offset),
        )
    };
    ensure_same_archive_parent(dir_path, &path)?;
    let (mut file, opened_metadata, identity, canonical_parent) =
        open_regular_no_follow(&path, false)?;
    let available = file
        .metadata()
        .map_err(|err| VpkError(err.to_string()))?
        .len();
    let length = u64::from(entry.length);
    let end = start
        .checked_add(length)
        .ok_or_else(|| VpkError(format!("{}: entry offset overflows.", entry.rel)))?;
    if end > available {
        return Err(VpkError(format!(
            "{}: entry runs past the archive.",
            entry.rel
        )));
    }
    if length > MAX_VPK_ENTRY_BYTES {
        return Err(VpkError(format!(
            "{}: entry is larger than {} MiB.",
            entry.rel,
            MAX_VPK_ENTRY_BYTES / (1024 * 1024)
        )));
    }
    file.seek(SeekFrom::Start(start))
        .map_err(|err| VpkError(err.to_string()))?;
    let mut body = Vec::new();
    body.try_reserve_exact(entry.length as usize)
        .map_err(|_| VpkError("Not enough memory for a VPK entry.".into()))?;
    body.resize(entry.length as usize, 0);
    file.read_exact(&mut body)
        .map_err(|err| VpkError(err.to_string()))?;
    verify_open_identity(&path, &file, &opened_metadata, &identity, &canonical_parent)?;
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
    patch_vpk_entry_if_unchanged(dir_path, entry, None, data, || Ok(()))
}

/// Patch an entry only if both its directory mapping and, when supplied, its
/// current body still match what the caller inspected. `before_write` runs
/// after those checks and immediately before the write on the already-open
/// sibling handle; the preloader uses it for a fresh game-process check.
pub fn patch_vpk_entry_if_unchanged<F>(
    dir_path: &Path,
    expected_entry: &VpkEntryLocation,
    expected_current: Option<&[u8]>,
    data: &[u8],
    before_write: F,
) -> Result<(), VpkError>
where
    F: FnOnce() -> Result<(), VpkError>,
{
    use std::io::Write;
    if expected_entry.preload_len != 0 {
        return Err(VpkError(format!(
            "{} keeps preload bytes in the directory; not supported.",
            expected_entry.rel
        )));
    }
    if data.len() != expected_entry.length as usize {
        return Err(VpkError(format!(
            "{}: replacement is {} bytes but the entry stores {}.",
            expected_entry.rel,
            data.len(),
            expected_entry.length
        )));
    }
    if expected_entry.archive_index == DIR_ARCHIVE {
        // Data stored inside the _dir.vpk itself would force a write to the
        // directory file; no stock particle uses this layout, and keeping the
        // directory byte-pristine matters more than supporting it.
        return Err(VpkError(format!(
            "{} stores its data in the directory file; not supported.",
            expected_entry.rel
        )));
    }
    // Steam verification and game updates can replace the directory and data
    // archives independently. Never use an offset mapped before lengthy PCF
    // processing without confirming that the directory still says exactly the
    // same thing about this entry.
    let remapped = map_vpk_entries(dir_path)?;
    let current_entry = remapped.get(&expected_entry.rel).ok_or_else(|| {
        VpkError(format!(
            "{} disappeared while the VPK was being prepared; retry after Steam finishes.",
            expected_entry.rel
        ))
    })?;
    if current_entry != expected_entry {
        return Err(VpkError(format!(
            "{} changed location or CRC while the VPK was being prepared; retry after Steam finishes.",
            expected_entry.rel
        )));
    }

    let data_path = sibling_archive_path(dir_path, current_entry.archive_index)?;
    ensure_same_archive_parent(dir_path, &data_path)?;
    let start = u64::from(current_entry.offset);
    let (mut data_file, opened_metadata, identity, canonical_parent) =
        open_regular_no_follow(&data_path, true)?;
    let available = data_file
        .metadata()
        .map_err(|err| VpkError(err.to_string()))?
        .len();
    let end = start
        .checked_add(data.len() as u64)
        .ok_or_else(|| VpkError(format!("{}: entry size overflows.", current_entry.rel)))?;
    if end > available {
        return Err(VpkError(format!(
            "{}: entry runs past the archive.",
            current_entry.rel
        )));
    }
    if let Some(expected) = expected_current {
        if expected.len() != current_entry.length as usize {
            return Err(VpkError(format!(
                "{}: inspected entry length no longer matches.",
                current_entry.rel
            )));
        }
        data_file
            .seek(SeekFrom::Start(start))
            .map_err(|err| VpkError(err.to_string()))?;
        let mut current = Vec::new();
        current
            .try_reserve_exact(expected.len())
            .map_err(|_| VpkError("Not enough memory to verify a VPK entry.".into()))?;
        current.resize(expected.len(), 0);
        data_file
            .read_exact(&mut current)
            .map_err(|err| VpkError(err.to_string()))?;
        if current != expected {
            return Err(VpkError(format!(
                "{} changed while the replacement was being prepared; leaving it alone.",
                current_entry.rel
            )));
        }
    }
    verify_open_identity(
        &data_path,
        &data_file,
        &opened_metadata,
        &identity,
        &canonical_parent,
    )?;
    refuse_multiple_hard_links(&data_file, &data_path)?;
    before_write()?;
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
    fn v2_entries_cannot_point_into_checksum_sections() {
        let mut files = BTreeMap::new();
        files.insert("particles/test.pcf".into(), b"payload".to_vec());
        let mut bytes = write_vpk_v2(&files);
        // Claim the directory-resident data section is empty while leaving the
        // bytes (and following checksum block) physically present.
        bytes[12..16].copy_from_slice(&0u32.to_le_bytes());

        let err = validate_vpk_dir_bytes(&bytes).unwrap_err();
        assert!(err.0.contains("data section"), "{}", err.0);
        let err = read_vpk_dir_bytes(&bytes).unwrap_err();
        assert!(err.0.contains("data section"), "{}", err.0);
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
    fn caller_materialization_limits_are_exact_and_aggregate() {
        let dir = std::env::temp_dir().join(format!(
            "execs-vpk-bounded-{}-{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        std::fs::create_dir_all(&dir).unwrap();
        let path = dir.join("community.vpk");
        let mut files = BTreeMap::new();
        files.insert("particles/one.pcf".into(), b"12345".to_vec());
        files.insert("particles/two.pcf".into(), b"67890".to_vec());
        std::fs::write(&path, write_vpk_v2(&files)).unwrap();

        let archive =
            read_vpk_dir_file_filtered_bounded(&path, &|rel| rel == "particles/one.pcf", 5, 5)
                .unwrap();
        assert_eq!(archive.files["particles/one.pcf"], b"12345");

        let err =
            read_vpk_dir_file_filtered_bounded(&path, &|rel| rel == "particles/one.pcf", 4, 5)
                .unwrap_err();
        assert!(err.0.contains("larger"), "{}", err.0);

        let err =
            read_vpk_dir_file_filtered_bounded(&path, &|rel| rel.starts_with("particles/"), 5, 9)
                .unwrap_err();
        assert!(err.0.contains("overlap"), "{}", err.0);
        let _ = std::fs::remove_dir_all(dir);
    }

    #[test]
    fn split_archive_budget_never_grows_past_the_global_ceiling() {
        assert_eq!(
            add_split_archive_budget(MAX_MATERIALIZED_VPK_BYTES - 1, u64::MAX),
            MAX_MATERIALIZED_VPK_BYTES
        );
        assert_eq!(add_split_archive_budget(1024, 2048), 1024 + 2 * 2048);
    }

    fn patch_fixture(root: &Path) -> (PathBuf, PathBuf, VpkEntryLocation, &'static [u8]) {
        let dir = root.join("game-vpks");
        std::fs::create_dir_all(&dir).unwrap();
        let payload: &'static [u8] = b"stock-particle";
        let sibling = dir.join("tf2_misc_000.vpk");
        std::fs::write(&sibling, payload).unwrap();

        let mut tree = Vec::new();
        write_cstring(&mut tree, "pcf");
        write_cstring(&mut tree, "particles");
        write_cstring(&mut tree, "test");
        tree.extend_from_slice(&crc32(payload).to_le_bytes());
        tree.extend_from_slice(&0u16.to_le_bytes());
        tree.extend_from_slice(&0u16.to_le_bytes());
        tree.extend_from_slice(&0u32.to_le_bytes());
        tree.extend_from_slice(&(payload.len() as u32).to_le_bytes());
        tree.extend_from_slice(&0xffffu16.to_le_bytes());
        tree.extend_from_slice(&[0, 0, 0]);
        let mut dir_bytes = Vec::new();
        dir_bytes.extend_from_slice(&SIGNATURE.to_le_bytes());
        dir_bytes.extend_from_slice(&1u32.to_le_bytes());
        dir_bytes.extend_from_slice(&(tree.len() as u32).to_le_bytes());
        dir_bytes.extend_from_slice(&tree);
        let dir_path = dir.join("tf2_misc_dir.vpk");
        std::fs::write(&dir_path, dir_bytes).unwrap();
        let entry = map_vpk_entries(&dir_path)
            .unwrap()
            .remove("particles/test.pcf")
            .unwrap();
        (dir_path, sibling, entry, payload)
    }

    #[cfg(unix)]
    #[test]
    fn patch_refuses_a_linked_split_archive_and_preserves_the_victim() {
        use std::os::unix::fs::symlink;

        let root = std::env::temp_dir().join(format!(
            "execs-vpk-link-{}-{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        let (dir_path, sibling, entry, payload) = patch_fixture(&root);

        let victim = root.join("outside-victim.vpk");
        std::fs::write(&victim, payload).unwrap();
        std::fs::remove_file(&sibling).unwrap();
        symlink(&victim, &sibling).unwrap();
        let err = patch_vpk_entry_if_unchanged(
            &dir_path,
            &entry,
            Some(payload),
            b"new-particle!!",
            || Ok(()),
        )
        .unwrap_err();
        assert!(err.0.contains("linked"), "{}", err.0);
        assert_eq!(std::fs::read(&victim).unwrap(), payload);
        let _ = std::fs::remove_dir_all(root);
    }

    #[test]
    fn patch_refuses_a_hard_linked_split_archive_and_preserves_the_victim() {
        let root = std::env::temp_dir().join(format!(
            "execs-vpk-hardlink-{}-{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        let (dir_path, sibling, entry, payload) = patch_fixture(&root);
        let victim = root.join("outside-victim.vpk");
        std::fs::remove_file(&sibling).unwrap();
        std::fs::write(&victim, payload).unwrap();
        std::fs::hard_link(&victim, &sibling).unwrap();

        let err = patch_vpk_entry_if_unchanged(
            &dir_path,
            &entry,
            Some(payload),
            b"new-particle!!",
            || Ok(()),
        )
        .unwrap_err();
        assert!(err.0.contains("hard-linked"), "{}", err.0);
        assert_eq!(std::fs::read(&victim).unwrap(), payload);
        let _ = std::fs::remove_dir_all(root);
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

    #[test]
    fn imported_vpk_inner_entry_count_is_bounded_even_for_empty_bodies() {
        let bytes = overlapping_vpk(MAX_IMPORTED_VPK_ENTRIES + 1, b"");
        let err = validate_vpk_dir_bytes(&bytes).unwrap_err();
        assert!(err.0.contains("entries"), "{}", err.0);
        let err = read_vpk_dir_bytes_filtered(&bytes, &|_| true).unwrap_err();
        assert!(err.0.contains("entries"), "{}", err.0);
    }

    #[test]
    fn portable_colliding_vpk_paths_are_rejected_before_cfg_filtering() {
        let benign = b"echo benign\n";
        let hostile = b"connect bad.example\n";
        let mut tree = Vec::new();
        write_cstring(&mut tree, "cfg");
        for (path, name, offset, body) in [
            ("cfg\\overrides", "AutoExec", 0u32, benign.as_slice()),
            (
                "cfg/overrides",
                "autoexec",
                benign.len() as u32,
                hostile.as_slice(),
            ),
        ] {
            write_cstring(&mut tree, path);
            write_cstring(&mut tree, name);
            tree.extend_from_slice(&crc32(body).to_le_bytes());
            tree.extend_from_slice(&0u16.to_le_bytes());
            tree.extend_from_slice(&DIR_ARCHIVE.to_le_bytes());
            tree.extend_from_slice(&offset.to_le_bytes());
            tree.extend_from_slice(&(body.len() as u32).to_le_bytes());
            tree.extend_from_slice(&0xffffu16.to_le_bytes());
            tree.push(0);
        }
        tree.push(0);
        tree.push(0);
        let mut bytes = Vec::new();
        bytes.extend_from_slice(&SIGNATURE.to_le_bytes());
        bytes.extend_from_slice(&1u32.to_le_bytes());
        bytes.extend_from_slice(&(tree.len() as u32).to_le_bytes());
        bytes.extend_from_slice(&tree);
        bytes.extend_from_slice(benign);
        bytes.extend_from_slice(hostile);

        let err = validate_vpk_dir_bytes(&bytes).unwrap_err();
        assert!(err.0.contains("colliding"), "{}", err.0);
        let err = read_vpk_dir_bytes_filtered(&bytes, &|path| {
            path.to_lowercase().ends_with("autoexec.cfg")
        })
        .unwrap_err();
        assert!(err.0.contains("colliding"), "{}", err.0);
    }

    #[test]
    fn filtered_path_read_streams_single_file_vpk_data() {
        let dir = std::env::temp_dir().join(format!(
            "execs-vpk-stream-{}-{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        std::fs::create_dir_all(&dir).unwrap();
        let path = dir.join("community.vpk");
        let mut files = BTreeMap::new();
        files.insert("materials/large.vtf".into(), vec![7; 4 * 1024 * 1024]);
        files.insert("particles/wanted.pcf".into(), b"small".to_vec());
        std::fs::write(&path, write_vpk_v2(&files)).unwrap();

        let archive =
            read_vpk_dir_file_filtered(&path, &|rel| rel == "particles/wanted.pcf").unwrap();
        assert_eq!(archive.files.len(), 1);
        assert_eq!(archive.files["particles/wanted.pcf"], b"small");
        let _ = std::fs::remove_dir_all(dir);
    }

    #[test]
    fn entry_length_is_checked_before_allocation() {
        let dir = std::env::temp_dir().join(format!(
            "execs-vpk-length-{}-{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        std::fs::create_dir_all(&dir).unwrap();
        let dir_path = dir.join("tf2_misc_dir.vpk");
        std::fs::write(&dir_path, b"not used").unwrap();
        std::fs::write(dir.join("tf2_misc_000.vpk"), [0u8]).unwrap();
        let entry = VpkEntryLocation {
            rel: "particles/bad.pcf".into(),
            crc: 0,
            crc_pos: 0,
            preload_len: 0,
            archive_index: 0,
            offset: 0,
            length: u32::MAX,
            data_base: 0,
        };
        let err = read_vpk_entry(&dir_path, &entry).unwrap_err();
        assert!(err.0.contains("past the archive"), "{}", err.0);
        let _ = std::fs::remove_dir_all(dir);
    }
}
