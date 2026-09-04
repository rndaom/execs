//! SHA-256 helpers for profile manifests and the shared blob store.

use std::fs::{self, File, OpenOptions};
use std::io::{self, Read, Write};
use std::path::{Path, PathBuf};

use sha2::{Digest, Sha256, Sha512};
use uuid::Uuid;

/// MD5, needed only for the checksum block a VPK v2 directory carries. Not a
/// security primitive — never use it for integrity decisions.
pub fn md5(bytes: &[u8]) -> [u8; 16] {
    const S: [u32; 64] = [
        7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22, 5, 9, 14, 20, 5, 9, 14, 20, 5,
        9, 14, 20, 5, 9, 14, 20, 4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23, 6, 10,
        15, 21, 6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21,
    ];
    let k: [u32; 64] =
        std::array::from_fn(|i| ((i as f64 + 1.0).sin().abs() * 4294967296.0) as u32);

    let mut msg = bytes.to_vec();
    let bit_len = (bytes.len() as u64).wrapping_mul(8);
    msg.push(0x80);
    while msg.len() % 64 != 56 {
        msg.push(0);
    }
    msg.extend_from_slice(&bit_len.to_le_bytes());

    let mut state: [u32; 4] = [0x6745_2301, 0xefcd_ab89, 0x98ba_dcfe, 0x1032_5476];
    for chunk in msg.as_chunks::<64>().0 {
        let m: [u32; 16] = std::array::from_fn(|i| {
            u32::from_le_bytes([
                chunk[i * 4],
                chunk[i * 4 + 1],
                chunk[i * 4 + 2],
                chunk[i * 4 + 3],
            ])
        });
        let [mut a, mut b, mut c, mut d] = state;
        for i in 0..64 {
            let (f, g) = match i / 16 {
                0 => ((b & c) | (!b & d), i),
                1 => ((d & b) | (!d & c), (5 * i + 1) % 16),
                2 => (b ^ c ^ d, (3 * i + 5) % 16),
                _ => (c ^ (b | !d), (7 * i) % 16),
            };
            let tmp = d;
            d = c;
            c = b;
            let sum = a.wrapping_add(f).wrapping_add(k[i]).wrapping_add(m[g]);
            b = b.wrapping_add(sum.rotate_left(S[i]));
            a = tmp;
        }
        state[0] = state[0].wrapping_add(a);
        state[1] = state[1].wrapping_add(b);
        state[2] = state[2].wrapping_add(c);
        state[3] = state[3].wrapping_add(d);
    }
    let mut out = [0u8; 16];
    for (i, word) in state.iter().enumerate() {
        out[i * 4..i * 4 + 4].copy_from_slice(&word.to_le_bytes());
    }
    out
}

pub fn sha256_hex(bytes: &[u8]) -> String {
    format!("{:x}", Sha256::digest(bytes))
}

/// Lower-case SHA-512 for sources that publish a SHA-512 content digest.
pub fn sha512_hex(bytes: &[u8]) -> String {
    let mut hasher = Sha512::new();
    hasher.update(bytes);
    format!("{:x}", hasher.finalize())
}

/// 32 lowercase hex characters from a v4 UUID: 122 random bits from the OS.
/// For names that must not collide or be guessed, such as the handles the
/// frontend gets for a picked file.
pub fn random_token() -> String {
    Uuid::new_v4().simple().to_string()
}

pub fn sha256_reader(mut reader: impl Read) -> io::Result<String> {
    let mut hasher = Sha256::new();
    let mut buf = [0u8; 64 * 1024];
    loop {
        let n = reader.read(&mut buf)?;
        if n == 0 {
            break;
        }
        hasher.update(&buf[..n]);
    }
    Ok(format!("{:x}", hasher.finalize()))
}

pub fn sha256_file(path: &Path) -> io::Result<String> {
    sha256_reader(File::open(path)?)
}

/// Hash exactly `expected_len` bytes from one opened handle. This is the
/// bounded stability check paired with `copy_and_sha256_exact_within`.
pub fn sha256_file_exact(path: &Path, expected_len: u64) -> io::Result<String> {
    let mut input = File::open(path)?;
    let mut hasher = Sha256::new();
    let mut hashed = 0u64;
    let mut buf = [0u8; 64 * 1024];
    while hashed < expected_len {
        let remaining = expected_len - hashed;
        let limit = remaining.min(buf.len() as u64) as usize;
        let n = input.read(&mut buf[..limit])?;
        if n == 0 {
            return Err(io::Error::new(
                io::ErrorKind::UnexpectedEof,
                "source became shorter than its validated length",
            ));
        }
        hasher.update(&buf[..n]);
        hashed += n as u64;
    }
    let mut extra = [0u8; 1];
    if input.read(&mut extra)? != 0 {
        return Err(io::Error::new(
            io::ErrorKind::InvalidData,
            "source grew beyond its validated length",
        ));
    }
    Ok(format!("{:x}", hasher.finalize()))
}

/// Read at most `max_bytes` from one already-opened handle. Reading through a
/// `Take(max + 1)` guard avoids both attacker-controlled allocation hints and
/// the metadata/open TOCTOU of checking a length before opening the file.
pub fn read_small_file_bounded(path: &Path, max_bytes: usize) -> io::Result<Vec<u8>> {
    let limit = u64::try_from(max_bytes)
        .ok()
        .and_then(|max| max.checked_add(1))
        .ok_or_else(|| invalid_path("bounded read limit is too large"))?;
    let mut bytes = Vec::with_capacity(max_bytes.min(64 * 1024));
    File::open(path)?.take(limit).read_to_end(&mut bytes)?;
    if bytes.len() > max_bytes {
        return Err(io::Error::new(
            io::ErrorKind::InvalidData,
            format!("file exceeds the {max_bytes}-byte safety limit"),
        ));
    }
    Ok(bytes)
}

pub fn read_small_text_bounded(path: &Path, max_bytes: usize) -> io::Result<String> {
    String::from_utf8(read_small_file_bounded(path, max_bytes)?).map_err(|_| {
        io::Error::new(
            io::ErrorKind::InvalidData,
            "bounded text file is not valid UTF-8",
        )
    })
}

/// Suffix for the side file every atomic write goes through. A crash leaves at
/// most one of these next to the destination; it is never a live game file.
pub const PART_SUFFIX: &str = ".execs-part";
/// Generous ceiling for text cfg files handled in memory. Real TF2 configs are
/// normally kilobytes; this prevents a corrupt sparse file from exhausting
/// the desktop process while leaving ample room for generated scripts.
pub const MAX_CFG_FILE_BYTES: usize = 8 * 1024 * 1024;

#[cfg(test)]
type TestSyncParentFault = Box<dyn FnMut(&Path) -> bool>;

#[cfg(test)]
thread_local! {
    static TEST_SYNC_PARENT_FAULT: std::cell::RefCell<Option<TestSyncParentFault>> =
        const { std::cell::RefCell::new(None) };
}

/// Install a thread-local durability-sync fault for a scoped test. The
/// predicate runs after the destination rename, which lets transaction tests
/// exercise the otherwise hard-to-reproduce "published but fsync errored"
/// outcome without weakening production writes.
#[cfg(test)]
pub(crate) fn with_sync_parent_fault<R>(
    fault: impl FnMut(&Path) -> bool + 'static,
    run: impl FnOnce() -> R,
) -> R {
    struct RestoreFault(Option<TestSyncParentFault>);
    impl Drop for RestoreFault {
        fn drop(&mut self) {
            TEST_SYNC_PARENT_FAULT.with(|slot| {
                *slot.borrow_mut() = self.0.take();
            });
        }
    }

    let previous = TEST_SYNC_PARENT_FAULT.with(|slot| slot.replace(Some(Box::new(fault))));
    let _restore = RestoreFault(previous);
    run()
}

/// `<dest>.execs-part`, alongside `dest` so the rename stays on one volume.
pub fn part_path(dest: &Path) -> PathBuf {
    let mut name = dest.file_name().unwrap_or_default().to_os_string();
    name.push(PART_SUFFIX);
    dest.with_file_name(name)
}

fn invalid_path(message: impl Into<String>) -> io::Error {
    io::Error::new(io::ErrorKind::InvalidInput, message.into())
}

/// `FileType::is_symlink` does not cover every Windows reparse-point kind
/// (notably directory junctions). Treat every reparse point as a link at a
/// containment boundary.
pub fn metadata_is_link(meta: &fs::Metadata) -> bool {
    #[cfg(windows)]
    {
        use std::os::windows::fs::MetadataExt;
        const FILE_ATTRIBUTE_REPARSE_POINT: u32 = 0x400;
        meta.file_type().is_symlink() || meta.file_attributes() & FILE_ATTRIBUTE_REPARSE_POINT != 0
    }
    #[cfg(not(windows))]
    {
        meta.file_type().is_symlink()
    }
}

/// Make every existing component below `root` prove that it is a real
/// directory, not a symlink/junction, before a live-surface mutation uses it.
/// Missing directories are created one component at a time so a reparse point
/// cannot be hidden behind `create_dir_all`.
fn prepare_parent_within(root: &Path, dest: &Path) -> io::Result<()> {
    let parent = dest
        .parent()
        .ok_or_else(|| invalid_path("destination has no parent"))?;
    let rel = parent
        .strip_prefix(root)
        .map_err(|_| invalid_path("destination escapes its allowed root"))?;

    fs::create_dir_all(root)?;
    let root_meta = fs::symlink_metadata(root)?;
    if metadata_is_link(&root_meta) || !root_meta.is_dir() {
        return Err(invalid_path("allowed root is a link or non-directory"));
    }
    let canonical_root = fs::canonicalize(root)?;
    let mut current = root.to_path_buf();
    for component in rel.components() {
        use std::path::Component;
        let Component::Normal(component) = component else {
            return Err(invalid_path("destination contains a non-normal component"));
        };
        current.push(component);
        match fs::symlink_metadata(&current) {
            Ok(meta) => {
                if metadata_is_link(&meta) || !meta.is_dir() {
                    return Err(invalid_path(format!(
                        "refusing to traverse a link or non-directory: {}",
                        current.display()
                    )));
                }
            }
            Err(err) if err.kind() == io::ErrorKind::NotFound => fs::create_dir(&current)?,
            Err(err) => return Err(err),
        }
        let resolved = fs::canonicalize(&current)?;
        if !resolved.starts_with(&canonical_root) {
            return Err(invalid_path(format!(
                "destination resolves outside its allowed root: {}",
                current.display()
            )));
        }
    }

    if let Ok(meta) = fs::symlink_metadata(dest) {
        if metadata_is_link(&meta) || meta.is_dir() {
            return Err(invalid_path(format!(
                "refusing to replace a link or directory: {}",
                dest.display()
            )));
        }
    }
    Ok(())
}

/// Read-only counterpart to `prepare_parent_within`. Every ancestor must
/// already exist as an ordinary directory beneath `root`; validation must
/// never manufacture a missing tree and thereby turn absence into success.
fn validate_existing_parent_within(root: &Path, path: &Path) -> io::Result<()> {
    let parent = path
        .parent()
        .ok_or_else(|| invalid_path("path has no parent"))?;
    let rel = parent
        .strip_prefix(root)
        .map_err(|_| invalid_path("path escapes its allowed root"))?;
    let root_meta = fs::symlink_metadata(root)?;
    if metadata_is_link(&root_meta) || !root_meta.is_dir() {
        return Err(invalid_path("allowed root is a link or non-directory"));
    }
    let canonical_root = fs::canonicalize(root)?;
    let mut current = root.to_path_buf();
    for component in rel.components() {
        use std::path::Component;
        let Component::Normal(component) = component else {
            return Err(invalid_path("path contains a non-normal component"));
        };
        current.push(component);
        let meta = fs::symlink_metadata(&current)?;
        if metadata_is_link(&meta) || !meta.is_dir() {
            return Err(invalid_path(format!(
                "refusing to traverse a link or non-directory: {}",
                current.display()
            )));
        }
        let resolved = fs::canonicalize(&current)?;
        if !resolved.starts_with(&canonical_root) {
            return Err(invalid_path(format!(
                "path resolves outside its allowed root: {}",
                current.display()
            )));
        }
    }
    Ok(())
}

/// Validate a prospective file destination without creating any of its
/// missing parent directories. Existing ancestors must be ordinary
/// directories beneath `root`, and an existing destination must be a regular
/// file. This lets transaction preparation reject a linked live path before a
/// durable recovery journal is published.
pub fn validate_write_target_within(root: &Path, path: &Path) -> io::Result<()> {
    let parent = path
        .parent()
        .ok_or_else(|| invalid_path("destination has no parent"))?;
    let rel = parent
        .strip_prefix(root)
        .map_err(|_| invalid_path("destination escapes its allowed root"))?;
    let root_meta = match fs::symlink_metadata(root) {
        Ok(meta) => meta,
        Err(err) if err.kind() == io::ErrorKind::NotFound => {
            if rel
                .components()
                .all(|component| matches!(component, std::path::Component::Normal(_)))
            {
                return Ok(());
            }
            return Err(invalid_path("destination contains a non-normal component"));
        }
        Err(err) => return Err(err),
    };
    if metadata_is_link(&root_meta) || !root_meta.is_dir() {
        return Err(invalid_path("allowed root is a link or non-directory"));
    }
    let canonical_root = fs::canonicalize(root)?;
    let mut current = root.to_path_buf();
    let mut ancestor_missing = false;
    for component in rel.components() {
        use std::path::Component;
        let Component::Normal(component) = component else {
            return Err(invalid_path("destination contains a non-normal component"));
        };
        current.push(component);
        if ancestor_missing {
            continue;
        }
        match fs::symlink_metadata(&current) {
            Ok(meta) => {
                if metadata_is_link(&meta) || !meta.is_dir() {
                    return Err(invalid_path(format!(
                        "refusing to traverse a link or non-directory: {}",
                        current.display()
                    )));
                }
                let resolved = fs::canonicalize(&current)?;
                if !resolved.starts_with(&canonical_root) {
                    return Err(invalid_path(format!(
                        "destination resolves outside its allowed root: {}",
                        current.display()
                    )));
                }
            }
            Err(err) if err.kind() == io::ErrorKind::NotFound => ancestor_missing = true,
            Err(err) => return Err(err),
        }
    }

    match fs::symlink_metadata(path) {
        Ok(meta) if metadata_is_link(&meta) || !meta.is_file() => Err(invalid_path(format!(
            "refusing to replace a link or non-file: {}",
            path.display()
        ))),
        Ok(_) => Ok(()),
        Err(err) if err.kind() == io::ErrorKind::NotFound => Ok(()),
        Err(err) => Err(err),
    }
}

fn prepare_part(part: &Path) -> io::Result<File> {
    match fs::symlink_metadata(part) {
        Ok(meta) if metadata_is_link(&meta) || meta.is_dir() => {
            return Err(invalid_path(format!(
                "refusing to use a linked or directory temporary file: {}",
                part.display()
            )));
        }
        Ok(_) => fs::remove_file(part)?,
        Err(err) if err.kind() == io::ErrorKind::NotFound => {}
        Err(err) => return Err(err),
    }
    // `create_new` is the important no-follow boundary: if another process
    // inserts a symlink/hardlink after the check above, opening fails rather
    // than truncating its target.
    OpenOptions::new().write(true).create_new(true).open(part)
}

fn sync_parent(path: &Path) -> io::Result<()> {
    #[cfg(test)]
    {
        let should_fail = TEST_SYNC_PARENT_FAULT.with(|slot| {
            let mut slot = slot.borrow_mut();
            slot.as_mut().is_some_and(|fault| fault(path))
        });
        if should_fail {
            return Err(io::Error::other("injected parent sync failure"));
        }
    }
    #[cfg(unix)]
    {
        if let Some(parent) = path.parent() {
            File::open(parent)?.sync_all()?;
        }
    }
    #[cfg(not(unix))]
    let _ = path;
    Ok(())
}

/// How many times a rename is retried before giving up. Antivirus scanners
/// hold a just-written file open for a few milliseconds; five tries spread
/// over ~750 ms cover that without stalling a 3,000-file HUD noticeably.
const RENAME_ATTEMPTS: u32 = 5;
const RENAME_BACKOFF: std::time::Duration = std::time::Duration::from_millis(50);

/// Rename `from` over `to`, replacing it.
///
/// On Windows this calls `MoveFileExW` with both `MOVEFILE_REPLACE_EXISTING`
/// and `MOVEFILE_WRITE_THROUGH`; Rust's `fs::rename` requests replacement but
/// not durable publication. A transient sharing violation from an antivirus
/// scanner holding `from` or `to` open, or a read-only destination, is retried;
/// the read-only bit is cleared first, since the caller has already decided the
/// file is ours to overwrite.
///
/// The destination is never deleted to make room: an earlier version did
/// exactly that as a fallback, and a rename that failed for a transient
/// reason then failed again after the delete — leaving neither the old file
/// nor the new one. For `profiles/index.json` that is the whole library.
pub fn replace_file(from: &Path, to: &Path) -> io::Result<()> {
    let mut last = None;
    for attempt in 0..RENAME_ATTEMPTS {
        match replace_file_once(from, to) {
            Ok(()) => return Ok(()),
            Err(err) => {
                if err.kind() == io::ErrorKind::NotFound && !from.exists() {
                    return Err(err);
                }
                if err.kind() == io::ErrorKind::PermissionDenied {
                    let _ = clear_readonly(to);
                }
                last = Some(err);
            }
        }
        if attempt + 1 < RENAME_ATTEMPTS {
            std::thread::sleep(RENAME_BACKOFF * (attempt + 1));
        }
    }
    Err(last.unwrap_or_else(|| io::Error::other("rename failed")))
}

#[cfg(not(windows))]
fn replace_file_once(from: &Path, to: &Path) -> io::Result<()> {
    fs::rename(from, to)
}

#[cfg(windows)]
fn replace_file_once(from: &Path, to: &Path) -> io::Result<()> {
    use std::iter;
    use std::os::windows::ffi::OsStrExt;

    const MOVEFILE_REPLACE_EXISTING: u32 = 0x1;
    const MOVEFILE_WRITE_THROUGH: u32 = 0x8;
    #[link(name = "kernel32")]
    extern "system" {
        fn MoveFileExW(existing: *const u16, new: *const u16, flags: u32) -> i32;
    }

    let from_wide: Vec<u16> = from
        .as_os_str()
        .encode_wide()
        .chain(iter::once(0))
        .collect();
    let to_wide: Vec<u16> = to.as_os_str().encode_wide().chain(iter::once(0)).collect();
    // SAFETY: both pointers reference NUL-terminated buffers that remain alive
    // for the call, and the flags require no additional structures.
    let replaced = unsafe {
        MoveFileExW(
            from_wide.as_ptr(),
            to_wide.as_ptr(),
            MOVEFILE_REPLACE_EXISTING | MOVEFILE_WRITE_THROUGH,
        )
    };
    if replaced == 0 {
        Err(io::Error::last_os_error())
    } else {
        Ok(())
    }
}

/// Move an existing directory to a previously absent path within one trusted
/// root. Windows uses a write-through move without `REPLACE_EXISTING`. Unix's
/// standard rename has no portable no-replace flag, so both endpoints and the
/// destination absence are revalidated immediately before the syscall; fully
/// eliminating an attacker-controlled path swap requires handle-relative OS
/// APIs rather than `std::fs`.
pub fn move_dir_no_replace_within(root: &Path, from: &Path, to: &Path) -> io::Result<()> {
    validate_dir_within(root, from)?;
    prepare_parent_within(root, to)?;
    match fs::symlink_metadata(to) {
        Err(err) if err.kind() == io::ErrorKind::NotFound => {}
        Ok(_) => {
            return Err(io::Error::new(
                io::ErrorKind::AlreadyExists,
                "destination exists",
            ))
        }
        Err(err) => return Err(err),
    }
    validate_dir_within(root, from)?;
    prepare_parent_within(root, to)?;
    move_dir_once(from, to)?;
    sync_parent(from)?;
    if from.parent() != to.parent() {
        sync_parent(to)?;
    }
    Ok(())
}

#[cfg(not(windows))]
fn move_dir_once(from: &Path, to: &Path) -> io::Result<()> {
    fs::rename(from, to)
}

#[cfg(windows)]
fn move_dir_once(from: &Path, to: &Path) -> io::Result<()> {
    use std::iter;
    use std::os::windows::ffi::OsStrExt;

    const MOVEFILE_WRITE_THROUGH: u32 = 0x8;
    #[link(name = "kernel32")]
    extern "system" {
        fn MoveFileExW(existing: *const u16, new: *const u16, flags: u32) -> i32;
    }

    let from_wide: Vec<u16> = from
        .as_os_str()
        .encode_wide()
        .chain(iter::once(0))
        .collect();
    let to_wide: Vec<u16> = to.as_os_str().encode_wide().chain(iter::once(0)).collect();
    // SAFETY: both pointers reference NUL-terminated buffers that remain alive
    // for the call, and the flags require no additional structures.
    let moved =
        unsafe { MoveFileExW(from_wide.as_ptr(), to_wide.as_ptr(), MOVEFILE_WRITE_THROUGH) };
    if moved == 0 {
        Err(io::Error::last_os_error())
    } else {
        Ok(())
    }
}

/// Drop the read-only attribute so `path` can be replaced or removed. Files
/// extracted from some HUD and mod archives carry it; the hash check that
/// precedes every removal has already proven the file is ours.
pub fn clear_readonly(path: &Path) -> io::Result<()> {
    let meta = fs::metadata(path)?;
    let mut perms = meta.permissions();
    if !perms.readonly() {
        return Ok(());
    }
    #[allow(clippy::permissions_set_readonly_false)]
    perms.set_readonly(false);
    fs::set_permissions(path, perms)
}

/// `fs::remove_file` that also succeeds on a read-only file (Windows refuses
/// those outright).
pub fn remove_file_force(path: &Path) -> io::Result<()> {
    match fs::remove_file(path) {
        Ok(()) => Ok(()),
        Err(err) if err.kind() == io::ErrorKind::PermissionDenied => {
            clear_readonly(path)?;
            fs::remove_file(path)
        }
        Err(err) => Err(err),
    }
}

/// Write `bytes` to `dest` via `<dest>.execs-part` + rename, so a crash can
/// never leave a truncated file where the game (or we) will read one.
pub fn write_atomic(dest: &Path, bytes: &[u8]) -> io::Result<()> {
    if let Some(parent) = dest.parent() {
        fs::create_dir_all(parent)?;
    }
    let part = part_path(dest);
    let write = (|| -> io::Result<()> {
        let mut output = prepare_part(&part)?;
        output.write_all(bytes)?;
        output.flush()?;
        output.sync_all()
    })();
    if let Err(err) = write {
        let _ = fs::remove_file(&part);
        return Err(err);
    }
    if let Err(err) = replace_file(&part, dest) {
        let _ = fs::remove_file(&part);
        return Err(err);
    }
    sync_parent(dest)?;
    Ok(())
}

/// [`write_atomic`] with an explicit containment/no-link boundary. Use this
/// for every live TF2 or Steam Cloud destination.
pub fn write_atomic_within(root: &Path, dest: &Path, bytes: &[u8]) -> io::Result<()> {
    prepare_parent_within(root, dest)?;
    let part = part_path(dest);
    let write = (|| -> io::Result<()> {
        let mut output = prepare_part(&part)?;
        output.write_all(bytes)?;
        output.flush()?;
        output.sync_all()
    })();
    if let Err(err) = write {
        let _ = fs::remove_file(&part);
        return Err(err);
    }
    // Close the remaining path-swap window as far as path-based std APIs can:
    // revalidate immediately before the atomic replacement.
    prepare_parent_within(root, dest)?;
    if let Err(err) = replace_file(&part, dest) {
        let _ = fs::remove_file(&part);
        return Err(err);
    }
    sync_parent(dest)
}

/// Copy `src` to `dest` while hashing. Does not load the whole file into memory.
/// Writes through `<dest>.execs-part` and renames, so `dest` is never observed
/// half-written — a truncated `.vpk`/`.cfg` is one the game would still mount.
pub fn copy_and_sha256(src: &Path, dest: &Path) -> io::Result<String> {
    if let Some(parent) = dest.parent() {
        fs::create_dir_all(parent)?;
    }
    let part = part_path(dest);
    let hashed = (|| -> io::Result<String> {
        let input = File::open(src)?;
        let expected_len = input.metadata()?.len();
        let mut output = prepare_part(&part)?;
        let hash = copy_open_file_exact(input, &mut output, expected_len)?;
        output.flush()?;
        output.sync_all()?;
        Ok(hash)
    })();
    let hash = match hashed {
        Ok(hash) => hash,
        Err(err) => {
            let _ = fs::remove_file(&part);
            return Err(err);
        }
    };
    if let Err(err) = replace_file(&part, dest) {
        let _ = fs::remove_file(&part);
        return Err(err);
    }
    sync_parent(dest)?;
    Ok(hash)
}

/// [`copy_and_sha256`] with an explicit containment/no-link boundary.
pub fn copy_and_sha256_within(root: &Path, src: &Path, dest: &Path) -> io::Result<String> {
    prepare_parent_within(root, dest)?;
    let part = part_path(dest);
    let hashed = (|| -> io::Result<String> {
        let input = File::open(src)?;
        let expected_len = input.metadata()?.len();
        let mut output = prepare_part(&part)?;
        let hash = copy_open_file_exact(input, &mut output, expected_len)?;
        output.flush()?;
        output.sync_all()?;
        Ok(hash)
    })();
    let hash = match hashed {
        Ok(hash) => hash,
        Err(err) => {
            let _ = fs::remove_file(&part);
            return Err(err);
        }
    };
    prepare_parent_within(root, dest)?;
    if let Err(err) = replace_file(&part, dest) {
        let _ = fs::remove_file(&part);
        return Err(err);
    }
    sync_parent(dest)?;
    Ok(hash)
}

/// Copy exactly `expected_len` bytes through one source handle while hashing.
/// The destination never grows past that bound, and either an early EOF or
/// one extra source byte aborts before publication. Callers use this when a
/// preflight size budget must remain true even if the picked file changes.
pub fn copy_and_sha256_exact_within(
    root: &Path,
    src: &Path,
    dest: &Path,
    expected_len: u64,
) -> io::Result<String> {
    prepare_parent_within(root, dest)?;
    let part = part_path(dest);
    let hashed = (|| -> io::Result<String> {
        let input = File::open(src)?;
        let mut output = prepare_part(&part)?;
        let hash = copy_open_file_exact(input, &mut output, expected_len)?;
        output.flush()?;
        output.sync_all()?;
        Ok(hash)
    })();
    let hash = match hashed {
        Ok(hash) => hash,
        Err(err) => {
            let _ = fs::remove_file(&part);
            return Err(err);
        }
    };
    prepare_parent_within(root, dest)?;
    if let Err(err) = replace_file(&part, dest) {
        let _ = fs::remove_file(&part);
        return Err(err);
    }
    sync_parent(dest)?;
    Ok(hash)
}

/// Atomically publish an already-synced staged file inside one allowed root.
pub fn move_file_within(root: &Path, from: &Path, to: &Path) -> io::Result<()> {
    validate_file_within(root, from)?;
    prepare_parent_within(root, to)?;
    replace_file(from, to)?;
    sync_parent(from)?;
    if from.parent() != to.parent() {
        sync_parent(to)?;
    }
    Ok(())
}

/// Copy a source into a contained destination and verify the exact bytes read
/// before making them visible at `dest`.
pub fn copy_verified_atomic_within(
    root: &Path,
    src: &Path,
    dest: &Path,
    expected_sha256: &str,
) -> io::Result<String> {
    prepare_parent_within(root, dest)?;
    let part = part_path(dest);
    let copied = (|| -> io::Result<String> {
        let input = File::open(src)?;
        let expected_len = input.metadata()?.len();
        let mut output = prepare_part(&part)?;
        let hash = copy_open_file_exact(input, &mut output, expected_len)?;
        output.flush()?;
        output.sync_all()?;
        Ok(hash)
    })();
    let actual = match copied {
        Ok(hash) => hash,
        Err(err) => {
            let _ = fs::remove_file(&part);
            return Err(err);
        }
    };
    if !actual.eq_ignore_ascii_case(expected_sha256) {
        let _ = fs::remove_file(&part);
        return Err(io::Error::new(
            io::ErrorKind::InvalidData,
            format!("sha256 mismatch: expected {expected_sha256}, got {actual}"),
        ));
    }
    prepare_parent_within(root, dest)?;
    if let Err(err) = replace_file(&part, dest) {
        let _ = fs::remove_file(&part);
        return Err(err);
    }
    sync_parent(dest)?;
    Ok(actual)
}

/// Stream exactly the source length captured from the same opened handle.
/// This prevents copies from following a concurrently growing file forever,
/// and makes shrink/growth races fail before the destination is published.
fn copy_open_file_exact(
    mut input: File,
    output: &mut File,
    expected_len: u64,
) -> io::Result<String> {
    let mut hasher = Sha256::new();
    let mut copied = 0u64;
    let mut buf = [0u8; 64 * 1024];
    while copied < expected_len {
        let remaining = expected_len - copied;
        let limit = usize::try_from(remaining.min(buf.len() as u64)).unwrap_or(buf.len());
        let n = input.read(&mut buf[..limit])?;
        if n == 0 {
            return Err(io::Error::new(
                io::ErrorKind::UnexpectedEof,
                "source became shorter than its validated length",
            ));
        }
        hasher.update(&buf[..n]);
        output.write_all(&buf[..n])?;
        copied += n as u64;
    }
    let mut extra = [0u8; 1];
    if input.read(&mut extra)? != 0 {
        return Err(io::Error::new(
            io::ErrorKind::InvalidData,
            "source grew beyond its validated length",
        ));
    }
    Ok(format!("{:x}", hasher.finalize()))
}

/// Remove a regular file without ever following a linked final component or a
/// linked/junction parent.
pub fn remove_file_force_within(root: &Path, path: &Path) -> io::Result<()> {
    validate_existing_parent_within(root, path)?;
    let meta = fs::symlink_metadata(path)?;
    if metadata_is_link(&meta) || !meta.is_file() {
        return Err(invalid_path(format!(
            "refusing to remove a link or non-file: {}",
            path.display()
        )));
    }
    remove_file_force(path)?;
    sync_parent(path)
}

/// Remove an empty directory after proving the entire path is contained and
/// contains no symlink/junction component.
pub fn remove_dir_within(root: &Path, dir: &Path) -> io::Result<()> {
    validate_dir_within(root, dir)?;
    fs::remove_dir(dir)?;
    sync_parent(dir)
}

/// Create a directory tree beneath `root` one component at a time, refusing
/// every symlink or Windows reparse point already present in the chain.
pub fn create_dir_all_within(root: &Path, dir: &Path) -> io::Result<()> {
    let marker = dir.join(".execs-containment-check");
    prepare_parent_within(root, &marker)?;
    validate_dir_within(root, dir)
}

/// Create a brand-new regular file beneath a validated root. `create_new`
/// refuses an attacker-supplied final symlink instead of following it.
pub fn create_new_file_within(root: &Path, path: &Path) -> io::Result<File> {
    prepare_parent_within(root, path)?;
    OpenOptions::new().write(true).create_new(true).open(path)
}

/// Recursively remove one contained scratch tree without following links or
/// reparse points. The allowed root itself can never be the target.
pub fn remove_tree_within(root: &Path, target: &Path) -> io::Result<()> {
    let rel = target
        .strip_prefix(root)
        .map_err(|_| invalid_path("tree removal target escapes its allowed root"))?;
    if rel.as_os_str().is_empty() {
        return Err(invalid_path("refusing to remove the allowed root"));
    }
    match fs::symlink_metadata(target) {
        Err(err) if err.kind() == io::ErrorKind::NotFound => return Ok(()),
        Err(err) => return Err(err),
        Ok(_) => {}
    }
    let mut visited = 0usize;
    remove_tree_entry_within(root, target, &mut visited)
}

fn remove_tree_entry_within(root: &Path, path: &Path, visited: &mut usize) -> io::Result<()> {
    const MAX_TREE_ENTRIES: usize = 200_000;
    *visited = visited.saturating_add(1);
    if *visited > MAX_TREE_ENTRIES {
        return Err(invalid_path(
            "contained tree exceeds the cleanup entry limit",
        ));
    }
    let metadata = fs::symlink_metadata(path)?;
    if metadata_is_link(&metadata) {
        return Err(invalid_path(format!(
            "refusing to traverse a linked tree entry: {}",
            path.display()
        )));
    }
    if metadata.is_file() {
        return remove_file_force_within(root, path);
    }
    if !metadata.is_dir() {
        return Err(invalid_path(format!(
            "refusing to remove a non-file tree entry: {}",
            path.display()
        )));
    }
    validate_dir_within(root, path)?;
    for entry in fs::read_dir(path)? {
        let child = entry?.path();
        remove_tree_entry_within(root, &child, visited)?;
    }
    remove_dir_within(root, path)
}

/// Validate a regular file and all of its parents without following a link or
/// junction. Callers may safely open/hash the path immediately afterward.
pub fn validate_file_within(root: &Path, path: &Path) -> io::Result<()> {
    validate_existing_parent_within(root, path)?;
    let meta = fs::symlink_metadata(path)?;
    if metadata_is_link(&meta) || !meta.is_file() {
        return Err(invalid_path(format!(
            "refusing to read a linked or non-file path: {}",
            path.display()
        )));
    }
    Ok(())
}

/// Validate an existing directory immediately before a contained directory
/// operation. This is intentionally narrow; callers still decide whether the
/// directory is empty/safe to remove.
pub fn validate_dir_within(root: &Path, dir: &Path) -> io::Result<()> {
    let marker = dir.join(".execs-containment-check");
    validate_existing_parent_within(root, &marker)?;
    let meta = fs::symlink_metadata(dir)?;
    if metadata_is_link(&meta) || !meta.is_dir() {
        return Err(invalid_path(format!(
            "refusing to traverse a linked or non-directory path: {}",
            dir.display()
        )));
    }
    Ok(())
}

#[cfg(test)]
mod tests {

    #[test]
    fn md5_matches_the_rfc_1321_vectors() {
        let hex = |bytes: &[u8]| {
            super::md5(bytes)
                .iter()
                .map(|byte| format!("{byte:02x}"))
                .collect::<String>()
        };
        assert_eq!(hex(b""), "d41d8cd98f00b204e9800998ecf8427e");
        assert_eq!(hex(b"abc"), "900150983cd24fb0d6963f7d28e17f72");
        assert_eq!(
            hex(b"The quick brown fox jumps over the lazy dog"),
            "9e107d9d372bb6826bd81d3542a419d6"
        );
        // Spans several blocks, so the length padding is exercised too.
        assert_eq!(
            hex(
                b"12345678901234567890123456789012345678901234567890123456789012345678901234567890"
            ),
            "57edf4a22be3c955ac49da2e2107b67a"
        );
    }
    use super::*;

    #[test]
    fn hashes_known_vector() {
        assert_eq!(
            sha256_hex(b"hello"),
            "2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824"
        );
        assert_eq!(
            sha512_hex(b""),
            "cf83e1357eefb8bdf1542850d66d8007d620e4050b5715dc83f4a921d36ce9ce47d0d13c5d85f2b0ff8318d2877eec2f63b931bd47417a81a538327af927da3e"
        );
    }

    #[test]
    fn bounded_read_rejects_an_oversized_sparse_file() {
        let dir = crate::test_temp_dir();
        let path = dir.join("oversized.json");
        let file = std::fs::File::create(&path).unwrap();
        file.set_len(1024 * 1024 * 1024).unwrap();

        let err = read_small_file_bounded(&path, 1024).unwrap_err();
        assert_eq!(err.kind(), std::io::ErrorKind::InvalidData);
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn exact_copy_never_publishes_short_or_over_limit_sources() {
        let dir = crate::test_temp_dir();
        let root = dir.join("root");
        let source = dir.join("source.bin");
        std::fs::create_dir_all(&root).unwrap();
        std::fs::write(&source, b"four").unwrap();

        let exact = root.join("exact.bin");
        let hash = copy_and_sha256_exact_within(&root, &source, &exact, 4).unwrap();
        assert_eq!(hash, sha256_hex(b"four"));
        assert_eq!(std::fs::read(&exact).unwrap(), b"four");

        let too_long = root.join("too-long.bin");
        let err = copy_and_sha256_exact_within(&root, &source, &too_long, 3).unwrap_err();
        assert_eq!(err.kind(), io::ErrorKind::InvalidData);
        assert!(!too_long.exists());
        assert!(!part_path(&too_long).exists());

        let too_short = root.join("too-short.bin");
        let err = copy_and_sha256_exact_within(&root, &source, &too_short, 5).unwrap_err();
        assert_eq!(err.kind(), io::ErrorKind::UnexpectedEof);
        assert!(!too_short.exists());
        assert!(!part_path(&too_short).exists());
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn read_only_containment_validation_never_creates_missing_paths() {
        let dir = crate::test_temp_dir();
        let root = dir.join("root");
        std::fs::create_dir_all(&root).unwrap();
        let missing_dir = root.join("missing/dir");
        let missing_file = root.join("other/missing.bin");

        assert!(validate_dir_within(&root, &missing_dir).is_err());
        assert!(validate_file_within(&root, &missing_file).is_err());
        assert!(!root.join("missing").exists());
        assert!(!root.join("other").exists());
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn write_target_validation_allows_missing_parents_without_creating_them() {
        let dir = crate::test_temp_dir();
        let root = dir.join("root");
        std::fs::create_dir_all(&root).unwrap();
        let destination = root.join("missing/tree/file.bin");

        validate_write_target_within(&root, &destination).unwrap();

        assert!(!root.join("missing").exists());
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn verified_copy_never_publishes_a_hash_mismatch() {
        let dir = crate::test_temp_dir();
        let src = dir.join("source.bin");
        let dest = dir.join("live/dest.bin");
        std::fs::create_dir_all(dest.parent().unwrap()).unwrap();
        std::fs::write(&src, b"tampered").unwrap();
        std::fs::write(&dest, b"known-good").unwrap();

        let err =
            copy_verified_atomic_within(&dir, &src, &dest, &sha256_hex(b"expected")).unwrap_err();
        assert_eq!(err.kind(), std::io::ErrorKind::InvalidData);
        assert_eq!(std::fs::read(&dest).unwrap(), b"known-good");
        assert!(!part_path(&dest).exists());
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[cfg(unix)]
    #[test]
    fn contained_write_refuses_a_linked_parent() {
        use std::os::unix::fs::symlink;

        let dir = crate::test_temp_dir();
        let root = dir.join("root");
        let outside = dir.join("outside");
        std::fs::create_dir_all(root.join("tf/custom")).unwrap();
        std::fs::create_dir_all(&outside).unwrap();
        std::fs::write(outside.join("victim.txt"), b"outside").unwrap();
        symlink(&outside, root.join("tf/custom/pack")).unwrap();

        assert!(write_atomic_within(
            &root,
            &root.join("tf/custom/pack/victim.txt"),
            b"overwritten"
        )
        .is_err());
        assert_eq!(
            std::fs::read(outside.join("victim.txt")).unwrap(),
            b"outside"
        );
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[cfg(unix)]
    #[test]
    fn write_target_validation_refuses_a_linked_parent() {
        use std::os::unix::fs::symlink;

        let dir = crate::test_temp_dir();
        let root = dir.join("root");
        let outside = dir.join("outside");
        std::fs::create_dir_all(root.join("tf/custom")).unwrap();
        std::fs::create_dir_all(&outside).unwrap();
        symlink(&outside, root.join("tf/custom/pack")).unwrap();

        assert!(
            validate_write_target_within(&root, &root.join("tf/custom/pack/file.bin")).is_err()
        );
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[cfg(unix)]
    #[test]
    fn atomic_write_refuses_a_precreated_part_symlink() {
        use std::os::unix::fs::symlink;

        let dir = crate::test_temp_dir();
        let root = dir.join("root");
        let dest = root.join("tf/cfg/config.cfg");
        let outside = dir.join("outside.txt");
        std::fs::create_dir_all(dest.parent().unwrap()).unwrap();
        std::fs::write(&dest, b"old").unwrap();
        std::fs::write(&outside, b"outside").unwrap();
        symlink(&outside, part_path(&dest)).unwrap();

        assert!(write_atomic_within(&root, &dest, b"new").is_err());
        assert_eq!(std::fs::read(&dest).unwrap(), b"old");
        assert_eq!(std::fs::read(&outside).unwrap(), b"outside");
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn copy_and_hash_matches_bytes() {
        let dir = crate::test_temp_dir();
        let src = dir.join("src.bin");
        let dest = dir.join("out").join("dest.bin");
        std::fs::write(&src, b"hello").unwrap();
        let hash = copy_and_sha256(&src, &dest).unwrap();
        assert_eq!(hash, sha256_hex(b"hello"));
        assert_eq!(std::fs::read(&dest).unwrap(), b"hello");
        assert_eq!(sha256_file(&src).unwrap(), hash);
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn copy_leaves_no_part_file_and_replaces_an_existing_dest() {
        let dir = crate::test_temp_dir();
        let src = dir.join("src.bin");
        let dest = dir.join("dest.bin");
        std::fs::write(&src, b"new").unwrap();
        std::fs::write(&dest, b"stale-and-longer").unwrap();

        copy_and_sha256(&src, &dest).unwrap();

        assert_eq!(std::fs::read(&dest).unwrap(), b"new");
        assert!(
            !part_path(&dest).exists(),
            "the .execs-part side file must not survive a successful copy"
        );
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn write_atomic_replaces_and_cleans_up() {
        let dir = crate::test_temp_dir();
        let dest = dir.join("nested").join("out.json");
        write_atomic(&dest, b"{\"a\":1}").unwrap();
        write_atomic(&dest, b"{}").unwrap();
        assert_eq!(std::fs::read(&dest).unwrap(), b"{}");
        assert!(!part_path(&dest).exists());
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn write_atomic_replaces_a_read_only_destination() {
        let dir = crate::test_temp_dir();
        let dest = dir.join("locked.cfg");
        std::fs::write(&dest, b"old").unwrap();
        let mut perms = std::fs::metadata(&dest).unwrap().permissions();
        #[allow(clippy::permissions_set_readonly_false)]
        perms.set_readonly(true);
        std::fs::set_permissions(&dest, perms).unwrap();

        write_atomic(&dest, b"new").unwrap();

        assert_eq!(std::fs::read(&dest).unwrap(), b"new");
        assert!(!part_path(&dest).exists());
        let _ = clear_readonly(&dest);
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn a_failed_replace_keeps_the_old_destination() {
        // The part file is missing, so the rename can never succeed. The
        // destination must survive untouched — an earlier fallback deleted it.
        let dir = crate::test_temp_dir();
        let dest = dir.join("index.json");
        std::fs::write(&dest, b"{\"profiles\":[]}").unwrap();
        let missing = part_path(&dest);

        assert!(replace_file(&missing, &dest).is_err());

        assert_eq!(std::fs::read(&dest).unwrap(), b"{\"profiles\":[]}");
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn remove_file_force_handles_the_read_only_bit() {
        let dir = crate::test_temp_dir();
        let file = dir.join("ro.vpk");
        std::fs::write(&file, b"x").unwrap();
        let mut perms = std::fs::metadata(&file).unwrap().permissions();
        #[allow(clippy::permissions_set_readonly_false)]
        perms.set_readonly(true);
        std::fs::set_permissions(&file, perms).unwrap();

        remove_file_force(&file).unwrap();

        assert!(!file.exists());
        let _ = std::fs::remove_dir_all(&dir);
    }
}
