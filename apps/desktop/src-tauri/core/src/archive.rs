//! Reading a user's archive or folder into `(relative path, bytes)` pairs.
//!
//! HUDs and mods both arrive as a zip, a 7z or a folder the user points at, and
//! both need the same three things: a ceiling on how much the app will unpack,
//! a path sanitizer that refuses anything escaping the destination, and the
//! junk filter that leaves `.git`, `sound.cache` and OS droppings behind. Those
//! live here once so a second import surface cannot drift from the first.

use std::fs;
use std::io::{Cursor, Read};
use std::path::Path;

use zip::ZipArchive;

use crate::profile::ProfileError;

const SEVEN_ZIP_MAGIC: [u8; 6] = [0x37, 0x7A, 0xBC, 0xAF, 0x27, 0x1C];

const MIB: u64 = 1024 * 1024;

/// How deep a folder import descends. A real HUD or mod is a handful of
/// levels; anything deeper is a loop through a junction or a runaway tree.
const MAX_DIR_DEPTH: usize = 32;

/// What an import will unpack before it gives up. The bytes come off the
/// network or a path the user picked, and the whole archive is held in memory
/// while it is read, so without a ceiling a zip bomb (or a merely enormous
/// repo) takes the app down.
#[derive(Debug, Clone, Copy)]
pub struct ArchiveLimits {
    pub max_entries: usize,
    pub max_entry_bytes: u64,
    pub max_total_bytes: u64,
}

impl ArchiveLimits {
    pub const fn new(max_entries: usize, max_entry_bytes: u64, max_total_bytes: u64) -> Self {
        Self {
            max_entries,
            max_entry_bytes,
            max_total_bytes,
        }
    }

    fn too_many(&self) -> ProfileError {
        ProfileError::Io(format!(
            "That archive has more than {} files; refusing to unpack it.",
            self.max_entries
        ))
    }

    fn entry_too_big(&self, rel: &str) -> ProfileError {
        ProfileError::Io(format!(
            "{rel} is larger than {} MiB; refusing to unpack it.",
            self.max_entry_bytes / MIB
        ))
    }

    fn total_too_big(&self) -> ProfileError {
        ProfileError::Io(format!(
            "That archive unpacks to more than {} MiB; refusing to unpack it.",
            self.max_total_bytes / MIB
        ))
    }
}

/// One archive of whatever kind the host handed back, sniffed by magic rather
/// than by the URL's extension. RAR is named in the error so the user knows why
/// it stopped.
pub fn extract_archive(
    bytes: &[u8],
    limits: ArchiveLimits,
) -> Result<Vec<(String, Vec<u8>)>, ProfileError> {
    if bytes.starts_with(b"PK") {
        return extract_zip(bytes, limits);
    }
    if bytes.starts_with(&SEVEN_ZIP_MAGIC) {
        return extract_7z(bytes, limits);
    }
    if bytes.starts_with(b"Rar!") {
        return Err(ProfileError::Io(
            "That is a RAR archive, which this app cannot unpack. Open the author's page to install it by hand.".into(),
        ));
    }
    if bytes.starts_with(b"<") || bytes.starts_with(b"{") {
        return Err(ProfileError::Io(
            "The download returned a web page instead of the archive. Try again later or open the author's page.".into(),
        ));
    }
    Err(ProfileError::Io(
        "The download is not a zip or 7z archive.".into(),
    ))
}

pub fn extract_zip(
    bytes: &[u8],
    limits: ArchiveLimits,
) -> Result<Vec<(String, Vec<u8>)>, ProfileError> {
    let mut archive =
        ZipArchive::new(Cursor::new(bytes)).map_err(|err| ProfileError::Io(err.to_string()))?;
    if archive.len() > limits.max_entries {
        return Err(limits.too_many());
    }
    let mut raw: Vec<(String, Vec<u8>)> = Vec::new();
    let mut total: u64 = 0;
    for index in 0..archive.len() {
        let mut entry = archive
            .by_index(index)
            .map_err(|err| ProfileError::Io(err.to_string()))?;
        if entry.is_dir() {
            continue;
        }
        let Some(rel) = keep_entry(entry.name())? else {
            continue;
        };
        if entry.size() > limits.max_entry_bytes {
            return Err(limits.entry_too_big(&rel));
        }
        let budget = limits.max_total_bytes.saturating_sub(total);
        let mut data = Vec::new();
        // `take` also catches an entry whose header understates its real size.
        entry
            .by_ref()
            .take(budget.min(limits.max_entry_bytes) + 1)
            .read_to_end(&mut data)
            .map_err(|err| ProfileError::Io(err.to_string()))?;
        total += data.len() as u64;
        if total > limits.max_total_bytes {
            return Err(limits.total_too_big());
        }
        raw.push((rel, data));
    }
    Ok(raw)
}

fn extract_7z(bytes: &[u8], limits: ArchiveLimits) -> Result<Vec<(String, Vec<u8>)>, ProfileError> {
    let mut reader = sevenz_rust::SevenZReader::new(
        Cursor::new(bytes),
        bytes.len() as u64,
        sevenz_rust::Password::empty(),
    )
    .map_err(|err| ProfileError::Io(format!("Could not read the 7z archive ({err})")))?;
    let mut raw: Vec<(String, Vec<u8>)> = Vec::new();
    let mut total: u64 = 0;
    let mut count = 0usize;
    reader
        .for_each_entries(|entry, stream| {
            if entry.is_directory() {
                return Ok(true);
            }
            count += 1;
            if count > limits.max_entries {
                return Err(sevenz_rust::Error::other(limits.too_many().message()));
            }
            let kept =
                keep_entry(entry.name()).map_err(|err| sevenz_rust::Error::other(err.message()))?;
            let Some(rel) = kept else {
                return Ok(true);
            };
            if entry.size() > limits.max_entry_bytes {
                return Err(sevenz_rust::Error::other(
                    limits.entry_too_big(&rel).message(),
                ));
            }
            let budget = limits.max_total_bytes.saturating_sub(total);
            let mut data = Vec::new();
            stream
                .take(budget.min(limits.max_entry_bytes) + 1)
                .read_to_end(&mut data)
                .map_err(|err| sevenz_rust::Error::other(err.to_string()))?;
            total += data.len() as u64;
            if total > limits.max_total_bytes {
                return Err(sevenz_rust::Error::other(limits.total_too_big().message()));
            }
            raw.push((rel, data));
            Ok(true)
        })
        .map_err(|err| ProfileError::Io(err.to_string()))?;
    Ok(raw)
}

/// A folder on disk read under the same caps and the same junk filter as an
/// archive, so importing an already-extracted download behaves identically.
pub fn read_dir_entries(
    dir: &Path,
    limits: ArchiveLimits,
) -> Result<Vec<(String, Vec<u8>)>, ProfileError> {
    if !dir.is_dir() {
        return Err(ProfileError::Io("That is not a folder.".into()));
    }
    let mut raw: Vec<(String, Vec<u8>)> = Vec::new();
    let mut total: u64 = 0;
    let mut stack = vec![(dir.to_path_buf(), String::new(), 0usize)];
    while let Some((path, rel, depth)) = stack.pop() {
        if depth >= MAX_DIR_DEPTH {
            return Err(ProfileError::Io(format!(
                "That folder is nested more than {MAX_DIR_DEPTH} folders deep; refusing to import it."
            )));
        }
        let entries = fs::read_dir(&path).map_err(|err| ProfileError::Io(err.to_string()))?;
        for entry in entries.flatten() {
            let name = entry.file_name().to_string_lossy().into_owned();
            if is_junk_name(&name) {
                continue;
            }
            let child_rel = if rel.is_empty() {
                name.clone()
            } else {
                format!("{rel}/{name}")
            };
            let child = entry.path();
            // A symlink or junction is never followed: it can point anywhere
            // (a drive root, a loop) and `is_dir` / `metadata` would follow it.
            if is_symlink(&child) {
                continue;
            }
            if child.is_dir() {
                stack.push((child, child_rel, depth + 1));
                continue;
            }
            if !child.is_file() {
                continue;
            }
            if raw.len() >= limits.max_entries {
                return Err(ProfileError::Io(format!(
                    "That folder has more than {} files; refusing to import it.",
                    limits.max_entries
                )));
            }
            let meta = child
                .metadata()
                .map_err(|err| ProfileError::Io(err.to_string()))?;
            if meta.len() > limits.max_entry_bytes {
                return Err(limits.entry_too_big(&child_rel));
            }
            total += meta.len();
            if total > limits.max_total_bytes {
                return Err(ProfileError::Io(format!(
                    "That folder holds more than {} MiB; refusing to import it.",
                    limits.max_total_bytes / MIB
                )));
            }
            let bytes = fs::read(&child).map_err(|err| ProfileError::Io(err.to_string()))?;
            raw.push((sanitize_entry_path(&child_rel)?, bytes));
        }
    }
    Ok(raw)
}

fn is_symlink(path: &Path) -> bool {
    fs::symlink_metadata(path)
        .map(|meta| meta.file_type().is_symlink())
        .unwrap_or(false)
}

/// `Ok(None)` for an entry the junk filter drops; an error for one whose name
/// is not safe to write anywhere.
fn keep_entry(raw: &str) -> Result<Option<String>, ProfileError> {
    let rel = sanitize_entry_path(raw)?;
    if rel.split('/').any(is_junk_name) {
        return Ok(None);
    }
    Ok(Some(rel))
}

/// VCS metadata, OS droppings, and the game's own regenerable caches. None of
/// it belongs in a profile, and `__MACOSX` in particular shadows real files.
pub fn is_junk_name(name: &str) -> bool {
    matches!(
        name.to_ascii_lowercase().as_str(),
        ".git"
            | ".svn"
            | ".hg"
            | ".ds_store"
            | "thumbs.db"
            | "desktop.ini"
            | "sound.cache"
            | "__macosx"
    )
}

/// An archive entry name reduced to forward slashes and checked against every
/// way a path can point outside the folder it is being written into.
pub fn sanitize_entry_path(raw: &str) -> Result<String, ProfileError> {
    if raw.contains('\0') {
        return Err(ProfileError::InvalidPath);
    }
    let name = raw.replace('\\', "/");
    let name = name.trim_start_matches("./");
    if name.starts_with('/') {
        return Err(ProfileError::InvalidPath);
    }
    let mut chars = name.chars();
    if let (Some(drive), Some(':')) = (chars.next(), chars.next()) {
        if drive.is_ascii_alphabetic() {
            return Err(ProfileError::InvalidPath);
        }
    }
    let parts: Vec<&str> = name.split('/').filter(|part| !part.is_empty()).collect();
    if parts.iter().any(|part| *part == "." || *part == "..") {
        return Err(ProfileError::InvalidPath);
    }
    if parts.is_empty() {
        return Err(ProfileError::InvalidPath);
    }
    Ok(parts.join("/"))
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;
    use zip::write::SimpleFileOptions;
    use zip::{CompressionMethod, ZipWriter};

    fn limits() -> ArchiveLimits {
        ArchiveLimits::new(100, 1024, 4096)
    }

    fn zip_bytes(entries: &[(&str, &[u8])]) -> Vec<u8> {
        let mut cursor = Cursor::new(Vec::new());
        {
            let mut zip = ZipWriter::new(&mut cursor);
            let options =
                SimpleFileOptions::default().compression_method(CompressionMethod::Deflated);
            for (name, bytes) in entries {
                zip.start_file(*name, options).unwrap();
                zip.write_all(bytes).unwrap();
            }
            zip.finish().unwrap();
        }
        cursor.into_inner()
    }

    #[test]
    fn escaping_and_absolute_entry_names_are_refused() {
        assert!(sanitize_entry_path("../evil.txt").is_err());
        assert!(sanitize_entry_path("/etc/passwd").is_err());
        assert!(sanitize_entry_path("C:/windows/system32").is_err());
        assert!(sanitize_entry_path("a\0b").is_err());
        assert_eq!(
            sanitize_entry_path(".\\pack\\materials\\a.vmt").unwrap(),
            "pack/materials/a.vmt"
        );
    }

    #[test]
    fn junk_is_dropped_from_archives_as_well_as_folders() {
        let bytes = zip_bytes(&[
            ("__MACOSX/._a.vmt", b"junk"),
            ("pack/.git/HEAD", b"ref"),
            ("pack/materials/a.vmt", b"vmt"),
            ("pack/sound.cache", b"stale"),
        ]);
        let entries = extract_zip(&bytes, limits()).unwrap();
        assert_eq!(
            entries
                .iter()
                .map(|(rel, _)| rel.as_str())
                .collect::<Vec<_>>(),
            vec!["pack/materials/a.vmt"]
        );
    }

    #[test]
    fn the_caps_are_enforced_by_entry_and_by_total() {
        let big = vec![b'x'; 2048];
        let err = extract_zip(&zip_bytes(&[("a.bin", &big)]), limits()).unwrap_err();
        assert!(err.message().contains("larger than"), "{}", err.message());

        let chunk = vec![b'y'; 1000];
        let bytes = zip_bytes(&[
            ("a.bin", &chunk),
            ("b.bin", &chunk),
            ("c.bin", &chunk),
            ("d.bin", &chunk),
            ("e.bin", &chunk),
        ]);
        let err = extract_zip(&bytes, limits()).unwrap_err();
        assert!(
            err.message().contains("unpacks to more than"),
            "{}",
            err.message()
        );
    }

    /// A folder nested past the cap is refused rather than walked forever.
    #[test]
    fn folder_import_stops_at_the_depth_cap() {
        let dir = crate::test_temp_dir();
        let mut deep = dir.join("pack");
        for index in 0..(MAX_DIR_DEPTH + 1) {
            deep = deep.join(format!("d{index}"));
        }
        fs::create_dir_all(&deep).unwrap();
        fs::write(deep.join("x.res"), b"x").unwrap();
        let err = read_dir_entries(&dir.join("pack"), limits()).unwrap_err();
        assert!(err.message().contains("folders deep"), "{}", err.message());

        // One level under the cap still imports.
        let mut shallow = dir.join("ok");
        for index in 0..(MAX_DIR_DEPTH - 1) {
            shallow = shallow.join(format!("d{index}"));
        }
        fs::create_dir_all(&shallow).unwrap();
        fs::write(shallow.join("y.res"), b"y").unwrap();
        let entries = read_dir_entries(&dir.join("ok"), limits()).unwrap();
        assert_eq!(entries.len(), 1);
        let _ = fs::remove_dir_all(&dir);
    }

    /// A symlink inside the folder is skipped, whether it points at a file
    /// or at a directory (a loop back to the root would otherwise recurse).
    #[cfg(unix)]
    #[test]
    fn folder_import_does_not_follow_symlinks() {
        let dir = crate::test_temp_dir();
        let pack = dir.join("pack");
        fs::create_dir_all(pack.join("materials")).unwrap();
        fs::write(pack.join("materials/a.vmt"), b"vmt").unwrap();
        fs::write(dir.join("outside.txt"), b"secret").unwrap();
        std::os::unix::fs::symlink(dir.join("outside.txt"), pack.join("link.txt")).unwrap();
        std::os::unix::fs::symlink(&pack, pack.join("loop")).unwrap();
        let entries = read_dir_entries(&pack, limits()).unwrap();
        assert_eq!(
            entries
                .iter()
                .map(|(rel, _)| rel.as_str())
                .collect::<Vec<_>>(),
            vec!["materials/a.vmt"]
        );
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn archives_are_sniffed_by_magic() {
        let err = extract_archive(b"Rar!\x1a\x07\x01\x00rest", limits()).unwrap_err();
        assert!(err.message().contains("RAR"), "{}", err.message());
        let err = extract_archive(b"<!doctype html>", limits()).unwrap_err();
        assert!(err.message().contains("web page"), "{}", err.message());
        let err = extract_archive(b"garbage", limits()).unwrap_err();
        assert!(
            err.message().contains("not a zip or 7z"),
            "{}",
            err.message()
        );
    }
}
