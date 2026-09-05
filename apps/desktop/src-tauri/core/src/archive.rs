//! Reading a user's archive or folder into `(relative path, bytes)` pairs.
//!
//! HUDs and mods both arrive as a zip, a 7z or a folder the user points at, and
//! both need the same three things: a ceiling on how much the app will unpack,
//! a path sanitizer that refuses anything escaping the destination, and the
//! junk filter that leaves `.git`, `sound.cache` and OS droppings behind. Those
//! live here once so a second import surface cannot drift from the first.

use std::collections::HashSet;
use std::fs::{self, File, OpenOptions};
use std::io::{Cursor, Read};
use std::path::Path;

use same_file::Handle as SameFileHandle;
use sevenz_rust2::{ArchiveReader, EncoderMethod, Password};
use zip::ZipArchive;

use crate::hash::metadata_is_link;
use crate::profile::{portable_path_key, ProfileError};

const SEVEN_ZIP_MAGIC: [u8; 6] = [0x37, 0x7A, 0xBC, 0xAF, 0x27, 0x1C];

const MIB: u64 = 1024 * 1024;

/// Header metadata is never a meaningful fraction of a HUD/mod payload. This
/// cap is checked from the fixed 7z start header before the parser allocates.
const MAX_7Z_NEXT_HEADER_BYTES: u64 = 16 * 1024 * 1024;
/// A normal 7z produced by 7-Zip uses 16–64 MiB. The decoder otherwise accepts
/// an attacker-declared 4 GiB LZMA dictionary before our output limits run.
const MAX_7Z_DICTIONARY_BYTES: u64 = 128 * 1024 * 1024;
const MAX_ARCHIVE_COMPRESSION_RATIO: u64 = 200;
// Small neutral textures routinely compress beyond 200x (budhud ships two
// 256 KiB textures at 756x). Apply the expansion heuristic above this floor;
// declared and actual per-entry/total byte ceilings still apply at every size.
const ARCHIVE_COMPRESSION_RATIO_FLOOR: u64 = 8 * MIB;
/// Imported cfgs are executable text, not game assets. Bounding the parser
/// keeps a renamed binary or intentionally huge token stream out of memory.
pub const MAX_IMPORTED_CFG_BYTES: usize = 8 * 1024 * 1024;
const MAX_IMPORTED_LAUNCH_BYTES: usize = 64 * 1024;
/// Parser-work ceilings are deliberately far above real cfgs while keeping a
/// separator/token storm from turning an 8 MiB text file into millions of
/// heap allocations or an unbounded validation loop.
const MAX_CFG_SEGMENTS: usize = 100_000;
const MAX_CFG_TOKENS: usize = 500_000;
const MAX_CFG_TOKENS_PER_COMMAND: usize = 4_096;
const MAX_CFG_TOKEN_BYTES: usize = 1024 * 1024;
const MAX_LAUNCH_TOKENS: usize = 4_096;

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
    let mut seen = HashSet::new();
    let mut total: u64 = 0;
    let mut declared_total: u64 = 0;
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
        let key = portable_path_key(&rel)?;
        if !seen.insert(key) {
            return Err(ProfileError::Io(format!(
                "That archive contains colliding file paths: {rel}"
            )));
        }
        if entry.size() > limits.max_entry_bytes {
            return Err(limits.entry_too_big(&rel));
        }
        let declared = entry.size();
        let compressed = entry.compressed_size();
        declared_total = declared_total
            .checked_add(declared)
            .ok_or_else(|| limits.total_too_big())?;
        if declared_total > limits.max_total_bytes {
            return Err(limits.total_too_big());
        }
        validate_zip_total_expansion(declared_total, bytes.len() as u64)?;
        if compression_ratio_exceeded(declared, compressed) {
            return Err(ProfileError::Io(format!(
                "{rel} decompresses more than {MAX_ARCHIVE_COMPRESSION_RATIO}x; refusing to unpack it."
            )));
        }
        let budget = limits.max_total_bytes.saturating_sub(total);
        let mut data = Vec::new();
        // `take` also catches an entry whose header understates its real size.
        entry
            .by_ref()
            .take(budget.min(limits.max_entry_bytes).saturating_add(1))
            .read_to_end(&mut data)
            .map_err(|err| ProfileError::Io(err.to_string()))?;
        if data.len() as u64 > limits.max_entry_bytes {
            return Err(limits.entry_too_big(&rel));
        }
        total = total
            .checked_add(data.len() as u64)
            .ok_or_else(|| limits.total_too_big())?;
        if total > limits.max_total_bytes {
            return Err(limits.total_too_big());
        }
        validate_zip_total_expansion(total, bytes.len() as u64)?;
        validate_actual_archive_entry(&rel, data.len() as u64, declared, compressed)?;
        raw.push((rel, data));
    }
    Ok(raw)
}

fn validate_zip_total_expansion(expanded: u64, archive_bytes: u64) -> Result<(), ProfileError> {
    if compression_ratio_exceeded(expanded, archive_bytes) {
        return Err(ProfileError::Io(format!(
            "That ZIP archive decompresses more than {MAX_ARCHIVE_COMPRESSION_RATIO}x; refusing to unpack it."
        )));
    }
    Ok(())
}

fn extract_7z(bytes: &[u8], limits: ArchiveLimits) -> Result<Vec<(String, Vec<u8>)>, ProfileError> {
    validate_7z_start_header(bytes)?;
    let mut reader = ArchiveReader::new(Cursor::new(bytes), Password::empty())
        .map_err(|err| ProfileError::Io(format!("Could not read the 7z archive ({err})")))?;
    // One decoder thread avoids multiplying the declared dictionary by the
    // machine's CPU count for an untrusted archive.
    reader.set_thread_count(1);
    let archive = reader.archive();
    if archive.files.len() > limits.max_entries {
        return Err(limits.too_many());
    }
    validate_7z_dictionaries(archive)?;
    let mut declared_total = 0u64;
    let mut seen = HashSet::new();
    for entry in &archive.files {
        if entry.is_directory() {
            continue;
        }
        declared_total = declared_total
            .checked_add(entry.size())
            .ok_or_else(|| limits.total_too_big())?;
        if declared_total > limits.max_total_bytes {
            return Err(limits.total_too_big());
        }
        let Some(rel) = keep_entry(entry.name())? else {
            continue;
        };
        let key = portable_path_key(&rel)?;
        if !seen.insert(key) {
            return Err(ProfileError::Io(format!(
                "That archive contains colliding file paths: {rel}"
            )));
        }
        if entry.size() > limits.max_entry_bytes {
            return Err(limits.entry_too_big(&rel));
        }
    }
    if compression_ratio_exceeded(declared_total, bytes.len() as u64) {
        return Err(ProfileError::Io(format!(
            "That 7z archive decompresses more than {MAX_ARCHIVE_COMPRESSION_RATIO}x; refusing to unpack it."
        )));
    }

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
                return Err(sevenz_rust2::Error::Other(
                    limits.too_many().message().into(),
                ));
            }
            let kept = keep_entry(entry.name())
                .map_err(|err| sevenz_rust2::Error::Other(err.message().into()))?;
            let Some(rel) = kept else {
                return Ok(true);
            };
            if entry.size() > limits.max_entry_bytes {
                return Err(sevenz_rust2::Error::Other(
                    limits.entry_too_big(&rel).message().into(),
                ));
            }
            let budget = limits.max_total_bytes.saturating_sub(total);
            let mut data = Vec::new();
            stream
                .take(budget.min(limits.max_entry_bytes).saturating_add(1))
                .read_to_end(&mut data)
                .map_err(|err| sevenz_rust2::Error::Other(err.to_string().into()))?;
            if data.len() as u64 > limits.max_entry_bytes {
                return Err(sevenz_rust2::Error::Other(
                    limits.entry_too_big(&rel).message().into(),
                ));
            }
            total = total.checked_add(data.len() as u64).ok_or_else(|| {
                sevenz_rust2::Error::Other(limits.total_too_big().message().into())
            })?;
            if total > limits.max_total_bytes {
                return Err(sevenz_rust2::Error::Other(
                    limits.total_too_big().message().into(),
                ));
            }
            validate_actual_archive_entry(
                &rel,
                data.len() as u64,
                entry.size(),
                entry.compressed_size,
            )
            .map_err(|err| sevenz_rust2::Error::Other(err.message().into()))?;
            raw.push((rel, data));
            Ok(true)
        })
        .map_err(|err| ProfileError::Io(err.to_string()))?;
    Ok(raw)
}

fn compression_ratio_exceeded(uncompressed: u64, compressed: u64) -> bool {
    (compressed == 0 && uncompressed > 0)
        || (compressed > 0
            && uncompressed > ARCHIVE_COMPRESSION_RATIO_FLOOR
            && uncompressed > compressed.saturating_mul(MAX_ARCHIVE_COMPRESSION_RATIO))
}

fn validate_actual_archive_entry(
    rel: &str,
    actual: u64,
    declared: u64,
    compressed: u64,
) -> Result<(), ProfileError> {
    if actual != declared {
        return Err(ProfileError::Io(format!(
            "{rel} does not match the size declared by the archive."
        )));
    }
    if compressed > 0 && compression_ratio_exceeded(actual, compressed) {
        return Err(ProfileError::Io(format!(
            "{rel} decompresses more than {MAX_ARCHIVE_COMPRESSION_RATIO}x; refusing to unpack it."
        )));
    }
    Ok(())
}

/// Validate the fixed 32-byte prefix before handing anything to the 7z parser.
/// The maintained decoder also bounds internal header counts by available
/// bytes; this lower application cap prevents even a genuinely huge metadata
/// region from becoming a large allocation before we can inspect file count.
fn validate_7z_start_header(bytes: &[u8]) -> Result<(), ProfileError> {
    if bytes.len() < 32 || !bytes.starts_with(&SEVEN_ZIP_MAGIC) {
        return Err(ProfileError::Io(
            "That 7z archive has a truncated header.".into(),
        ));
    }
    let next_offset = u64::from_le_bytes(bytes[12..20].try_into().unwrap());
    let next_size = u64::from_le_bytes(bytes[20..28].try_into().unwrap());
    if next_size == 0 || next_size > MAX_7Z_NEXT_HEADER_BYTES {
        return Err(ProfileError::Io(format!(
            "That 7z archive has more than {} MiB of header metadata; refusing to unpack it.",
            MAX_7Z_NEXT_HEADER_BYTES / MIB
        )));
    }
    let header_end = 32u64
        .checked_add(next_offset)
        .and_then(|start| start.checked_add(next_size))
        .ok_or_else(|| ProfileError::Io("That 7z archive has an invalid header offset.".into()))?;
    if header_end > bytes.len() as u64 {
        return Err(ProfileError::Io(
            "That 7z archive points past the end of the file.".into(),
        ));
    }
    let header_start = 32usize
        .checked_add(next_offset as usize)
        .ok_or_else(|| ProfileError::Io("That 7z archive has an invalid header offset.".into()))?;
    let header_end = header_start
        .checked_add(next_size as usize)
        .ok_or_else(|| ProfileError::Io("That 7z archive has an invalid header size.".into()))?;
    preflight_encoded_7z_header(&bytes[header_start..header_end])?;
    Ok(())
}

/// Encoded headers are decompressed by the dependency while it is still
/// constructing `ArchiveReader`, before application-level metadata is
/// available. Parse just their streams declaration first so a tiny archive
/// cannot request a multi-gigabyte dictionary or decoded header in that gap.
fn preflight_encoded_7z_header(header: &[u8]) -> Result<(), ProfileError> {
    const K_ENCODED_HEADER: u8 = 0x17;
    const K_PACK_INFO: u8 = 0x06;
    const K_UNPACK_INFO: u8 = 0x07;
    const K_SIZE: u8 = 0x09;
    const K_CRC: u8 = 0x0A;
    const K_FOLDER: u8 = 0x0B;
    const K_CODERS_UNPACK_SIZE: u8 = 0x0C;
    const K_END: u8 = 0x00;

    let mut cursor = SevenZHeaderCursor::new(header);
    if cursor.read_u8()? != K_ENCODED_HEADER {
        return Ok(());
    }
    if cursor.peek()? == K_PACK_INFO {
        cursor.read_u8()?;
        cursor.read_number()?; // pack position
        let pack_streams = cursor.read_number()?;
        let pack_streams = cursor.bounded_count(pack_streams)?;
        if cursor.read_u8()? != K_SIZE {
            return Err(malformed_7z_header());
        }
        for _ in 0..pack_streams {
            cursor.read_number()?;
        }
        let mut nid = cursor.read_u8()?;
        if nid == K_CRC {
            cursor.skip_digests(pack_streams)?;
            nid = cursor.read_u8()?;
        }
        if nid != K_END {
            return Err(malformed_7z_header());
        }
    }
    if cursor.read_u8()? != K_UNPACK_INFO || cursor.read_u8()? != K_FOLDER {
        return Err(malformed_7z_header());
    }
    let blocks = cursor.read_number()?;
    let blocks = cursor.bounded_count(blocks)?;
    if blocks > 1024 || cursor.read_u8()? != 0 {
        return Err(malformed_7z_header());
    }
    let mut output_streams = Vec::with_capacity(blocks);
    for _ in 0..blocks {
        let coders = cursor.read_number()?;
        let coders = cursor.bounded_count(coders)?;
        if coders == 0 || coders > 64 {
            return Err(malformed_7z_header());
        }
        let mut total_input = 0usize;
        let mut total_output = 0usize;
        for _ in 0..coders {
            let flags = cursor.read_u8()?;
            if flags & 0x80 != 0 {
                return Err(malformed_7z_header());
            }
            let method = cursor.read_exact((flags & 0x0f) as usize)?;
            let (input, output) = if flags & 0x10 == 0 {
                (1usize, 1usize)
            } else {
                let input = cursor.read_number()?;
                let output = cursor.read_number()?;
                (cursor.bounded_count(input)?, cursor.bounded_count(output)?)
            };
            total_input = total_input
                .checked_add(input)
                .ok_or_else(malformed_7z_header)?;
            total_output = total_output
                .checked_add(output)
                .ok_or_else(malformed_7z_header)?;
            if total_input > 256 || total_output > 256 {
                return Err(malformed_7z_header());
            }
            let properties = if flags & 0x20 != 0 {
                let len = cursor.read_number()?;
                let len = cursor.bounded_count(len)?;
                cursor.read_exact(len)?
            } else {
                &[]
            };
            if let Some(dictionary) = seven_z_dictionary_size(method, properties)? {
                if dictionary > MAX_7Z_DICTIONARY_BYTES {
                    return Err(ProfileError::Io(format!(
                        "That 7z archive requests a dictionary larger than {} MiB; refusing to unpack it.",
                        MAX_7Z_DICTIONARY_BYTES / MIB
                    )));
                }
            }
        }
        if total_output == 0 {
            return Err(malformed_7z_header());
        }
        let bind_pairs = total_output - 1;
        for _ in 0..bind_pairs {
            cursor.read_number()?;
            cursor.read_number()?;
        }
        let packed_streams = total_input
            .checked_sub(bind_pairs)
            .ok_or_else(malformed_7z_header)?;
        if packed_streams != 1 {
            for _ in 0..packed_streams {
                cursor.read_number()?;
            }
        }
        output_streams.push(total_output);
    }
    if cursor.read_u8()? != K_CODERS_UNPACK_SIZE {
        return Err(malformed_7z_header());
    }
    for count in output_streams {
        for _ in 0..count {
            let unpacked = cursor.read_number()?;
            if unpacked > MAX_7Z_NEXT_HEADER_BYTES {
                return Err(ProfileError::Io(format!(
                    "That 7z archive expands its encoded header beyond {} MiB; refusing to unpack it.",
                    MAX_7Z_NEXT_HEADER_BYTES / MIB
                )));
            }
        }
    }
    Ok(())
}

struct SevenZHeaderCursor<'a> {
    bytes: &'a [u8],
    position: usize,
}

impl<'a> SevenZHeaderCursor<'a> {
    fn new(bytes: &'a [u8]) -> Self {
        Self { bytes, position: 0 }
    }

    fn peek(&self) -> Result<u8, ProfileError> {
        self.bytes
            .get(self.position)
            .copied()
            .ok_or_else(malformed_7z_header)
    }

    fn read_u8(&mut self) -> Result<u8, ProfileError> {
        let value = self.peek()?;
        self.position += 1;
        Ok(value)
    }

    fn read_exact(&mut self, len: usize) -> Result<&'a [u8], ProfileError> {
        let end = self
            .position
            .checked_add(len)
            .ok_or_else(malformed_7z_header)?;
        let value = self
            .bytes
            .get(self.position..end)
            .ok_or_else(malformed_7z_header)?;
        self.position = end;
        Ok(value)
    }

    fn read_number(&mut self) -> Result<u64, ProfileError> {
        let first = u64::from(self.read_u8()?);
        let mut mask = 0x80u64;
        let mut value = 0u64;
        for index in 0..8 {
            if first & mask == 0 {
                return Ok(value | ((first & (mask - 1)) << (8 * index)));
            }
            value |= u64::from(self.read_u8()?) << (8 * index);
            mask >>= 1;
        }
        Ok(value)
    }

    fn bounded_count(&self, value: u64) -> Result<usize, ProfileError> {
        let value = usize::try_from(value).map_err(|_| malformed_7z_header())?;
        if value > self.bytes.len() {
            return Err(malformed_7z_header());
        }
        Ok(value)
    }

    fn skip_digests(&mut self, count: usize) -> Result<(), ProfileError> {
        let all_defined = self.read_u8()? != 0;
        let defined = if all_defined {
            count
        } else {
            let bits = self.read_exact(count.div_ceil(8))?;
            bits.iter().map(|byte| byte.count_ones() as usize).sum()
        };
        self.read_exact(defined.checked_mul(4).ok_or_else(malformed_7z_header)?)?;
        Ok(())
    }
}

fn malformed_7z_header() -> ProfileError {
    ProfileError::Io("That 7z archive has malformed encoded-header metadata.".into())
}

fn validate_7z_dictionaries(archive: &sevenz_rust2::Archive) -> Result<(), ProfileError> {
    for coder in archive.blocks.iter().flat_map(|block| &block.coders) {
        let Some(size) = seven_z_dictionary_size(coder.encoder_method_id(), coder.properties())?
        else {
            continue;
        };
        if size > MAX_7Z_DICTIONARY_BYTES {
            return Err(ProfileError::Io(format!(
                "That 7z archive requests a dictionary larger than {} MiB; refusing to unpack it.",
                MAX_7Z_DICTIONARY_BYTES / MIB
            )));
        }
    }
    Ok(())
}

fn seven_z_dictionary_size(method: &[u8], properties: &[u8]) -> Result<Option<u64>, ProfileError> {
    let size = match method {
        id if id == EncoderMethod::ID_LZMA => {
            if properties.len() < 5 {
                return Err(ProfileError::Io(
                    "That 7z archive has malformed LZMA settings.".into(),
                ));
            }
            u32::from_le_bytes(properties[1..5].try_into().unwrap()) as u64
        }
        id if id == EncoderMethod::ID_LZMA2 => {
            let Some(&property) = properties.first() else {
                return Err(ProfileError::Io(
                    "That 7z archive has malformed LZMA2 settings.".into(),
                ));
            };
            if property > 40 {
                return Err(ProfileError::Io(
                    "That 7z archive has invalid LZMA2 settings.".into(),
                ));
            }
            if property == 40 {
                u32::MAX as u64
            } else {
                ((2u64 | u64::from(property & 1)) << (u64::from(property) / 2 + 11))
                    .min(u32::MAX as u64)
            }
        }
        // PPMd is not enabled in our decompression-only build. If a future
        // feature enables it, refuse it until its memory property is also
        // covered by this application policy.
        id if id == EncoderMethod::ID_PPMD => {
            return Err(ProfileError::Io(
                "That 7z archive uses an unsupported PPMd dictionary.".into(),
            ));
        }
        _ => return Ok(None),
    };
    Ok(Some(size))
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum CfgScanMode {
    Imported,
    SecretsOnly,
}

/// Enforce the hostile-config subset of cfglint at the backend trust boundary.
/// UI lint remains richer, but callers cannot bypass these blocking rules by
/// invoking the import commands directly.
pub fn validate_imported_cfg(path: &str, bytes: &[u8]) -> Result<(), ProfileError> {
    scan_cfg(path, bytes, CfgScanMode::Imported)
}

/// Export refuses credentials rather than silently sharing them. Other
/// commands are the player's own data and remain exportable.
pub fn validate_cfg_has_no_secrets(path: &str, bytes: &[u8]) -> Result<(), ProfileError> {
    scan_cfg(path, bytes, CfgScanMode::SecretsOnly)
}

fn scan_cfg(path: &str, bytes: &[u8], mode: CfgScanMode) -> Result<(), ProfileError> {
    if bytes.len() > MAX_IMPORTED_CFG_BYTES {
        return Err(ProfileError::Io(format!(
            "{path} is larger than {} MiB and cannot be safely inspected as a cfg.",
            MAX_IMPORTED_CFG_BYTES / (1024 * 1024)
        )));
    }
    let text = std::str::from_utf8(bytes)
        .map_err(|_| ProfileError::Io(format!("{path} is not valid UTF-8 cfg text.")))?;
    if text.contains('\0') {
        return Err(ProfileError::Io(format!("{path} contains a NUL byte.")));
    }
    let text = text.strip_prefix('\u{feff}').unwrap_or(text);
    let engine_managed = portable_path_key(path)? == "tf/cfg/config.cfg";
    let mut budget = CfgScanBudget::default();
    scan_cfg_commands(text, path, &mut budget, |command, budget| {
        check_cfg_command(path, command, mode, engine_managed, true, 0, budget)
    })
}

/// Imported launch options can execute `+commands` as soon as TF2 starts.
/// Feed each command group through the same policy used for cfg text.
pub fn validate_imported_launch_options(raw: &str) -> Result<(), ProfileError> {
    scan_launch_options(raw, CfgScanMode::Imported)
}

pub fn validate_launch_has_no_secrets(raw: &str) -> Result<(), ProfileError> {
    scan_launch_options(raw, CfgScanMode::SecretsOnly)
}

fn scan_launch_options(raw: &str, mode: CfgScanMode) -> Result<(), ProfileError> {
    if raw.len() > MAX_IMPORTED_LAUNCH_BYTES {
        return Err(ProfileError::Io(
            "Launch options are implausibly large.".into(),
        ));
    }
    let tokens = tokenize_launch_options(raw)?;
    let mut budget = CfgScanBudget::default();
    let mut index = 0usize;
    while index < tokens.len() {
        let Some(name) = tokens[index].value.strip_prefix('+') else {
            index += 1;
            continue;
        };
        if name.is_empty() {
            index += 1;
            continue;
        }
        let mut buffer = name.to_string();
        index += 1;
        while index < tokens.len()
            && !tokens[index].value.starts_with('+')
            && !tokens[index].value.starts_with('-')
        {
            buffer.push(' ');
            buffer.push_str(&tokens[index].fragment);
            index += 1;
        }
        // Source submits each +command group to the same command buffer used
        // by cfg files. Semicolons outside quoted arguments therefore start a
        // second effective command even when embedded in one OS argv token.
        scan_cfg_commands(&buffer, "launch options", &mut budget, |command, budget| {
            let mut command = command.to_vec();
            if let Some(name) = command.first_mut() {
                if let Some(stripped) = name.strip_prefix('+') {
                    *name = stripped.to_string();
                }
            }
            let lower = command
                .first()
                .map(|name| name.to_ascii_lowercase())
                .unwrap_or_default();
            if mode == CfgScanMode::Imported
                && matches!(lower.as_str(), "quit" | "exit" | "disconnect" | "retry")
            {
                return Err(hostile_cfg("launch options", &lower));
            }
            check_cfg_command("launch options", &command, mode, false, true, 0, budget)
        })?;
    }
    Ok(())
}

fn check_cfg_command(
    path: &str,
    command: &[String],
    mode: CfgScanMode,
    engine_managed: bool,
    top_level: bool,
    depth: usize,
    budget: &mut CfgScanBudget,
) -> Result<(), ProfileError> {
    if command.is_empty() || command[0].is_empty() {
        return Ok(());
    }
    if depth > 8 {
        return Err(ProfileError::Io(format!(
            "{path} nests bind or alias commands too deeply to inspect safely."
        )));
    }
    let name = command[0].to_ascii_lowercase();
    let value = command.get(1).map(|value| value.to_ascii_lowercase());
    let engine_top = engine_managed && top_level;

    if name == "password"
        || matches!(
            name.as_str(),
            "rcon" | "rcon_address" | "rcon_password" | "rcon_port"
        )
    {
        let archived_unset = name == "password"
            && engine_top
            && command.len() <= 2
            && value
                .as_deref()
                .is_none_or(|value| value.is_empty() || value == "0");
        if !archived_unset {
            return Err(ProfileError::Io(format!(
                "{path} contains `{name}`, which may expose a server credential and cannot be shared."
            )));
        }
        return Ok(());
    }
    if mode == CfgScanMode::SecretsOnly {
        if matches!(name.as_str(), "bind" | "alias") && command.len() > 2 {
            scan_cfg_payload(
                path,
                &command[2..].join(" "),
                mode,
                engine_managed,
                depth + 1,
                budget,
            )?;
        }
        return Ok(());
    }

    if matches!(name.as_str(), "connect" | "redirect") {
        return Err(hostile_cfg(path, &name));
    }
    if name == "unbindall" && !engine_top {
        return Err(hostile_cfg(path, &name));
    }
    if name == "unbind" && value.as_deref() == Some("escape") {
        return Err(hostile_cfg(path, "unbind escape"));
    }
    if name == "con_enable" && value.as_deref() == Some("0") && !engine_top {
        return Err(hostile_cfg(path, "con_enable 0"));
    }
    if name == "sv_cheats" && value.as_deref().is_some_and(|value| value != "0") {
        return Err(hostile_cfg(path, "sv_cheats"));
    }
    if name == "alias" {
        if let Some(alias) = command.get(1) {
            let bare = alias.trim_start_matches(['+', '-']).to_ascii_lowercase();
            if matches!(
                bare.as_str(),
                "exec"
                    | "alias"
                    | "bind"
                    | "unbind"
                    | "unbindall"
                    | "connect"
                    | "disconnect"
                    | "retry"
                    | "quit"
                    | "exit"
                    | "say"
                    | "say_team"
                    | "rcon"
                    | "kill"
                    | "explode"
                    | "toggleconsole"
            ) {
                return Err(hostile_cfg(path, &format!("alias {alias}")));
            }
        }
        if command.len() > 2 {
            scan_cfg_payload(
                path,
                &command[2..].join(" "),
                mode,
                engine_managed,
                depth + 1,
                budget,
            )?;
        }
        return Ok(());
    }
    if name == "bind" {
        let key = value.as_deref().unwrap_or_default();
        let payload = command.get(2..).unwrap_or_default().join(" ");
        if key == "escape" {
            let preserves_menu = engine_top
                && matches!(
                    payload.trim().to_ascii_lowercase().as_str(),
                    "cancelselect" | "escape"
                );
            if !preserves_menu {
                return Err(hostile_cfg(path, "bind escape"));
            }
        }
        if !payload.is_empty() {
            scan_cfg_payload(path, &payload, mode, engine_managed, depth + 1, budget)?;
        }
    }
    Ok(())
}

fn scan_cfg_payload(
    path: &str,
    payload: &str,
    mode: CfgScanMode,
    engine_managed: bool,
    depth: usize,
    budget: &mut CfgScanBudget,
) -> Result<(), ProfileError> {
    scan_cfg_commands(payload, path, budget, |command, budget| {
        check_cfg_command(path, command, mode, engine_managed, false, depth, budget)
    })
}

fn hostile_cfg(path: &str, command: &str) -> ProfileError {
    ProfileError::Io(format!(
        "{path} contains blocked command `{command}` and cannot be imported."
    ))
}

#[derive(Default)]
struct CfgScanBudget {
    segments: usize,
    tokens: usize,
}

impl CfgScanBudget {
    fn segment(&mut self, path: &str) -> Result<(), ProfileError> {
        self.segments = self.segments.saturating_add(1);
        if self.segments > MAX_CFG_SEGMENTS {
            return Err(ProfileError::Io(format!(
                "{path} contains too many cfg commands to inspect safely."
            )));
        }
        Ok(())
    }

    fn token(&mut self, path: &str, len: usize) -> Result<(), ProfileError> {
        if len > MAX_CFG_TOKEN_BYTES {
            return Err(ProfileError::Io(format!(
                "{path} contains an implausibly large cfg token."
            )));
        }
        self.tokens = self.tokens.saturating_add(1);
        if self.tokens > MAX_CFG_TOKENS {
            return Err(ProfileError::Io(format!(
                "{path} contains too many cfg tokens to inspect safely."
            )));
        }
        Ok(())
    }
}

/// Source tokenizer parity: comments run to newline, quotes form one token,
/// and semicolons/newlines terminate commands only outside quotes. Commands
/// are inspected one at a time instead of materializing a `Vec` for the whole
/// cfg, which keeps separator-heavy hostile input bounded.
fn scan_cfg_commands<F>(
    text: &str,
    path: &str,
    budget: &mut CfgScanBudget,
    mut inspect: F,
) -> Result<(), ProfileError>
where
    F: FnMut(&[String], &mut CfgScanBudget) -> Result<(), ProfileError>,
{
    let bytes = text.as_bytes();
    let mut current = Vec::new();
    let mut index = 0usize;
    while index < bytes.len() {
        match bytes[index] {
            b'\n' | b';' => {
                budget.segment(path)?;
                if !current.is_empty() {
                    inspect(&current, budget)?;
                    current.clear();
                }
                index += 1;
            }
            b'\r' | b' ' | b'\t' => index += 1,
            b'/' if bytes.get(index + 1) == Some(&b'/') => {
                index += 2;
                while index < bytes.len() && bytes[index] != b'\n' {
                    index += 1;
                }
            }
            b'"' => {
                index += 1;
                let start = index;
                while index < bytes.len() && !matches!(bytes[index], b'"' | b'\n') {
                    index += 1;
                }
                budget.token(path, index - start)?;
                if current.len() >= MAX_CFG_TOKENS_PER_COMMAND {
                    return Err(ProfileError::Io(format!(
                        "{path} contains a cfg command with too many tokens."
                    )));
                }
                current.push(text[start..index].to_string());
                if bytes.get(index) == Some(&b'"') {
                    index += 1;
                }
            }
            _ => {
                let start = index;
                while index < bytes.len()
                    && !matches!(bytes[index], b' ' | b'\t' | b'\r' | b'\n' | b'"' | b';')
                    && !(bytes[index] == b'/' && bytes.get(index + 1) == Some(&b'/'))
                {
                    index += 1;
                }
                budget.token(path, index - start)?;
                if current.len() >= MAX_CFG_TOKENS_PER_COMMAND {
                    return Err(ProfileError::Io(format!(
                        "{path} contains a cfg command with too many tokens."
                    )));
                }
                current.push(text[start..index].to_string());
            }
        }
    }
    if !current.is_empty() {
        budget.segment(path)?;
        inspect(&current, budget)?;
    }
    Ok(())
}

struct LaunchToken {
    /// Windows/Steam command-line value after quote grouping.
    value: String,
    /// Same token with quote delimiters retained for Source's command buffer.
    fragment: String,
}

fn tokenize_launch_options(text: &str) -> Result<Vec<LaunchToken>, ProfileError> {
    let mut tokens = Vec::new();
    let mut value = String::new();
    let mut fragment = String::new();
    let mut quoted = false;
    for ch in text.chars() {
        if ch == '"' {
            quoted = !quoted;
            fragment.push(ch);
        } else if ch.is_whitespace() && !quoted {
            if !value.is_empty() || !fragment.is_empty() {
                if tokens.len() >= MAX_LAUNCH_TOKENS {
                    return Err(ProfileError::Io(
                        "Launch options contain too many arguments.".into(),
                    ));
                }
                tokens.push(LaunchToken {
                    value: std::mem::take(&mut value),
                    fragment: std::mem::take(&mut fragment),
                });
            }
        } else {
            value.push(ch);
            fragment.push(ch);
        }
    }
    if !value.is_empty() || !fragment.is_empty() {
        if tokens.len() >= MAX_LAUNCH_TOKENS {
            return Err(ProfileError::Io(
                "Launch options contain too many arguments.".into(),
            ));
        }
        tokens.push(LaunchToken { value, fragment });
    }
    Ok(tokens)
}

/// A folder on disk read under the same caps and the same junk filter as an
/// archive, so importing an already-extracted download behaves identically.
pub fn read_dir_entries(
    dir: &Path,
    limits: ArchiveLimits,
) -> Result<Vec<(String, Vec<u8>)>, ProfileError> {
    let root_meta = fs::symlink_metadata(dir).map_err(|err| ProfileError::Io(err.to_string()))?;
    if metadata_is_link(&root_meta) || !root_meta.is_dir() {
        return Err(ProfileError::Io("That is not a folder.".into()));
    }
    let root_identity =
        SameFileHandle::from_path(dir).map_err(|err| ProfileError::Io(err.to_string()))?;
    let mut raw: Vec<(String, Vec<u8>)> = Vec::new();
    let mut seen = HashSet::new();
    let mut total: u64 = 0;
    let mut entry_count = 0usize;
    let mut stack = vec![(dir.to_path_buf(), String::new(), 0usize, root_identity)];
    while let Some((path, rel, depth, expected_identity)) = stack.pop() {
        if depth >= MAX_DIR_DEPTH {
            return Err(ProfileError::Io(format!(
                "That folder is nested more than {MAX_DIR_DEPTH} folders deep; refusing to import it."
            )));
        }
        let path_meta =
            fs::symlink_metadata(&path).map_err(|err| ProfileError::Io(err.to_string()))?;
        if metadata_is_link(&path_meta) || !path_meta.is_dir() {
            return Err(ProfileError::Io(
                "A folder changed into a link while it was being imported.".into(),
            ));
        }
        let current_identity =
            SameFileHandle::from_path(&path).map_err(|err| ProfileError::Io(err.to_string()))?;
        if current_identity != expected_identity {
            return Err(ProfileError::Io(
                "A folder was replaced while it was being imported; try again.".into(),
            ));
        }
        let entries = fs::read_dir(&path).map_err(|err| ProfileError::Io(err.to_string()))?;
        for entry in entries {
            let entry = entry.map_err(|err| ProfileError::Io(err.to_string()))?;
            let name = entry.file_name().to_string_lossy().into_owned();
            if is_junk_name(&name) {
                continue;
            }
            entry_count = entry_count.saturating_add(1);
            if entry_count > limits.max_entries {
                return Err(ProfileError::Io(format!(
                    "That folder has more than {} entries; refusing to import it.",
                    limits.max_entries
                )));
            }
            let child_rel = if rel.is_empty() {
                name.clone()
            } else {
                format!("{rel}/{name}")
            };
            let child = entry.path();
            // A symlink or junction is never followed: it can point anywhere
            // (a drive root, a loop) and `is_dir` / `metadata` would follow it.
            let meta =
                fs::symlink_metadata(&child).map_err(|err| ProfileError::Io(err.to_string()))?;
            if metadata_is_link(&meta) {
                continue;
            }
            if meta.is_dir() {
                let identity = SameFileHandle::from_path(&child)
                    .map_err(|err| ProfileError::Io(err.to_string()))?;
                stack.push((child, child_rel, depth + 1, identity));
                continue;
            }
            if !meta.is_file() {
                continue;
            }
            let rel = sanitize_entry_path(&child_rel)?;
            let key = portable_path_key(&rel)?;
            if !seen.insert(key) {
                return Err(ProfileError::Io(format!(
                    "That folder contains colliding file paths: {rel}"
                )));
            }
            let remaining = limits.max_total_bytes.saturating_sub(total);
            let read_cap = remaining.min(limits.max_entry_bytes);
            let Some(bytes) = read_regular_file_bounded(&child, read_cap)? else {
                if remaining < limits.max_entry_bytes {
                    return Err(limits.total_too_big());
                }
                return Err(limits.entry_too_big(&rel));
            };
            total = total
                .checked_add(bytes.len() as u64)
                .ok_or_else(|| limits.total_too_big())?;
            if total > limits.max_total_bytes {
                return Err(limits.total_too_big());
            }
            raw.push((rel, bytes));
        }
    }
    Ok(raw)
}

/// Read an untrusted picked file through one no-follow handle and cap actual
/// bytes, not just a racy size observed before opening it. `Ok(None)` means the
/// file exceeded `max_bytes` either before or while it was read.
pub(crate) fn read_regular_file_bounded(
    path: &Path,
    max_bytes: u64,
) -> Result<Option<Vec<u8>>, ProfileError> {
    let (mut file, metadata, identity) = open_untrusted_regular(path)?;
    if metadata.len() > max_bytes {
        return Ok(None);
    }
    let bytes =
        read_bounded(&mut file, max_bytes).map_err(|err| ProfileError::Io(err.to_string()))?;
    verify_open_identity(path, &file, &metadata, &identity)?;
    Ok(bytes)
}

/// Read a regular file only after proving every existing ancestor and the
/// file itself stay within `root`. This is the variant for profile/app-data
/// payloads, where an attacker-controlled junction in an ancestor must not be
/// allowed to redirect a no-follow final-component read outside the store.
pub fn read_regular_file_bounded_within(
    root: &Path,
    path: &Path,
    max_bytes: u64,
) -> Result<Option<Vec<u8>>, ProfileError> {
    crate::hash::validate_file_within(root, path)
        .map_err(|err| ProfileError::Io(err.to_string()))?;
    read_regular_file_bounded(path, max_bytes)
}

fn read_bounded(reader: &mut impl Read, max_bytes: u64) -> std::io::Result<Option<Vec<u8>>> {
    let mut bytes = Vec::new();
    reader
        .take(max_bytes.saturating_add(1))
        .read_to_end(&mut bytes)?;
    Ok((bytes.len() as u64 <= max_bytes).then_some(bytes))
}

fn open_untrusted_regular(
    path: &Path,
) -> Result<(File, fs::Metadata, SameFileHandle), ProfileError> {
    let before = fs::symlink_metadata(path).map_err(|err| ProfileError::Io(err.to_string()))?;
    if metadata_is_link(&before) || !before.is_file() {
        return Err(ProfileError::Io(format!(
            "Refusing to read a linked or non-regular file: {}",
            path.display()
        )));
    }
    let mut options = OpenOptions::new();
    options.read(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        // execs ships on Linux; this is Linux O_NOFOLLOW.
        options.custom_flags(0x0002_0000);
    }
    #[cfg(windows)]
    {
        use std::os::windows::fs::OpenOptionsExt;
        // Open the reparse point itself so the metadata check below rejects it.
        const FILE_FLAG_OPEN_REPARSE_POINT: u32 = 0x0020_0000;
        options.custom_flags(FILE_FLAG_OPEN_REPARSE_POINT);
    }
    let file = options
        .open(path)
        .map_err(|err| ProfileError::Io(err.to_string()))?;
    let metadata = file
        .metadata()
        .map_err(|err| ProfileError::Io(err.to_string()))?;
    if metadata_is_link(&metadata) || !metadata.is_file() {
        return Err(ProfileError::Io(format!(
            "Refusing to read a linked or non-regular file: {}",
            path.display()
        )));
    }
    let identity = SameFileHandle::from_file(
        file.try_clone()
            .map_err(|err| ProfileError::Io(err.to_string()))?,
    )
    .map_err(|err| ProfileError::Io(err.to_string()))?;
    verify_open_identity(path, &file, &metadata, &identity)?;
    Ok((file, metadata, identity))
}

fn verify_open_identity(
    path: &Path,
    file: &File,
    opened_meta: &fs::Metadata,
    opened: &SameFileHandle,
) -> Result<(), ProfileError> {
    let current = fs::symlink_metadata(path).map_err(|err| ProfileError::Io(err.to_string()))?;
    let handle_meta = file
        .metadata()
        .map_err(|err| ProfileError::Io(err.to_string()))?;
    let current_identity =
        SameFileHandle::from_path(path).map_err(|err| ProfileError::Io(err.to_string()))?;
    if metadata_is_link(&current)
        || !current.is_file()
        || &current_identity != opened
        || metadata_changed(opened_meta, &handle_meta)
        || metadata_changed(&handle_meta, &current)
    {
        return Err(ProfileError::Io(format!(
            "{} changed while it was being imported; try again.",
            path.display()
        )));
    }
    Ok(())
}

fn metadata_changed(left: &fs::Metadata, right: &fs::Metadata) -> bool {
    left.len() != right.len()
        || matches!((left.modified(), right.modified()), (Ok(a), Ok(b)) if a != b)
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

    #[test]
    fn generic_archive_checks_ratio_and_declared_size_against_actual_output() {
        let zeros = vec![0u8; ARCHIVE_COMPRESSION_RATIO_FLOOR as usize + 1];
        let bytes = zip_bytes(&[("zeros.bin", &zeros)]);
        let err = extract_zip(&bytes, ArchiveLimits::new(2, 16 * MIB, 16 * MIB)).unwrap_err();
        assert!(err.message().contains("decompresses more"), "{err:?}");

        let err = validate_actual_archive_entry("entry", 5, 4, 4).unwrap_err();
        assert!(err.message().contains("declared"), "{err:?}");
    }

    #[test]
    fn small_repetitive_hud_assets_unpack_without_changing_their_bytes() {
        // Match the reported asset's expanded length without copying its art.
        let mut texture = vec![0u8; 262_352];
        texture[..4].copy_from_slice(b"VTF\0");
        let path = "hud/materials/vgui/replay/thumbnails/overlays/refract.vtf";
        let bytes = zip_bytes(&[
            ("hud/info.vdf", b"\"HUD\" { \"ui_version\" \"3\" }"),
            (path, &texture),
        ]);
        let mut archive = ZipArchive::new(Cursor::new(&bytes)).unwrap();
        let entry = archive.by_name(path).unwrap();
        assert!(entry.size() > entry.compressed_size() * MAX_ARCHIVE_COMPRESSION_RATIO);
        drop(entry);
        let hud = crate::extract_hud_archive(&bytes).unwrap();
        assert_eq!(hud.tree.files.len(), 2);
        assert_eq!(
            hud.tree.get(path.strip_prefix("hud/").unwrap()),
            Some(texture.as_slice())
        );

        let renamed = zip_bytes(&[("repetitive.bin", &texture)]);
        let extracted = extract_zip(&renamed, ArchiveLimits::new(1, MIB, MIB)).unwrap();
        assert_eq!(extracted, vec![("repetitive.bin".into(), texture)]);
    }

    #[test]
    fn ratio_floor_is_bounded_and_does_not_accept_missing_compressed_data() {
        assert!(!compression_ratio_exceeded(
            ARCHIVE_COMPRESSION_RATIO_FLOOR,
            1
        ));
        assert!(compression_ratio_exceeded(
            ARCHIVE_COMPRESSION_RATIO_FLOOR + 1,
            1
        ));
        assert!(compression_ratio_exceeded(1, 0));
        assert!(!compression_ratio_exceeded(0, 0));
        assert!(!compression_ratio_exceeded(u64::MAX, u64::MAX));
        assert!(validate_actual_archive_entry(
            "expanded",
            ARCHIVE_COMPRESSION_RATIO_FLOOR + 1,
            ARCHIVE_COMPRESSION_RATIO_FLOOR + 1,
            1
        )
        .is_err());
        assert!(validate_actual_archive_entry("small", 10, 9, 1).is_err());
    }

    #[test]
    fn small_high_ratio_entries_still_obey_entry_and_total_byte_caps() {
        let payload = vec![0u8; 262_352];
        let single = zip_bytes(&[("asset.bin", &payload)]);
        let err = extract_zip(&single, ArchiveLimits::new(3, 262_351, MIB)).unwrap_err();
        assert!(err.message().contains("larger than"));
        let multiple = zip_bytes(&[
            ("a.bin", &payload),
            ("b.bin", &payload),
            ("c.bin", &payload),
        ]);
        let err = extract_zip(&multiple, ArchiveLimits::new(3, MIB, 524_704)).unwrap_err();
        assert!(err.message().contains("unpacks to more than"));
    }

    #[test]
    fn many_small_entries_cannot_bypass_the_total_expansion_ratio() {
        let payload = vec![0u8; MIB as usize];
        let paths: Vec<_> = (0..10).map(|index| format!("asset-{index}.bin")).collect();
        let entries: Vec<_> = paths
            .iter()
            .map(|path| (path.as_str(), payload.as_slice()))
            .collect();
        let bytes = zip_bytes(&entries);
        let err = extract_zip(&bytes, ArchiveLimits::new(10, 2 * MIB, 16 * MIB)).unwrap_err();
        assert!(
            err.message().contains("ZIP archive decompresses"),
            "{err:?}"
        );
        assert!(validate_zip_total_expansion(ARCHIVE_COMPRESSION_RATIO_FLOOR, 1).is_ok());
        assert!(validate_zip_total_expansion(ARCHIVE_COMPRESSION_RATIO_FLOOR + 1, 1).is_err());
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

    #[test]
    fn actual_file_bytes_are_bounded_even_when_metadata_was_stale() {
        // The bounded handle reader is the second line of defense after an
        // opened file's metadata. It catches a file that grows after that
        // metadata snapshot without allocating the remainder.
        let mut reader = Cursor::new(b"grew after metadata".as_slice());
        assert!(read_bounded(&mut reader, 4).unwrap().is_none());
        assert_eq!(reader.position(), 5);

        let dir = crate::test_temp_dir();
        fs::write(dir.join("large.res"), b"12345").unwrap();
        let err = read_dir_entries(&dir, ArchiveLimits::new(2, 4, 100)).unwrap_err();
        assert!(err.message().contains("larger than"), "{}", err.message());
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn folder_entry_cap_counts_empty_directories() {
        let dir = crate::test_temp_dir();
        let pack = dir.join("pack");
        for name in ["one", "two", "three"] {
            fs::create_dir_all(pack.join(name)).unwrap();
        }
        let err = read_dir_entries(&pack, ArchiveLimits::new(2, 1024, 4096)).unwrap_err();
        assert!(err.message().contains("more than 2 entries"), "{err:?}");
        let _ = fs::remove_dir_all(&dir);
    }

    #[cfg(unix)]
    #[test]
    fn picked_file_identity_change_is_rejected() {
        let dir = crate::test_temp_dir();
        let picked = dir.join("picked.vpk");
        let old = dir.join("old.vpk");
        fs::write(&picked, b"old").unwrap();
        let (file, metadata, identity) = open_untrusted_regular(&picked).unwrap();
        fs::rename(&picked, &old).unwrap();
        fs::write(&picked, b"new").unwrap();
        let err = verify_open_identity(&picked, &file, &metadata, &identity).unwrap_err();
        assert!(err.message().contains("changed"), "{}", err.message());
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

    #[test]
    fn portable_archive_path_collisions_are_refused() {
        let bytes = zip_bytes(&[("pack/Foo.cfg", b"one"), ("pack/foo.cfg", b"two")]);
        let err = extract_zip(&bytes, limits()).unwrap_err();
        assert!(err.message().contains("colliding"), "{}", err.message());

        let bytes = zip_bytes(&[
            ("pack/trailing.cfg", b"one"),
            ("pack/trailing.cfg.", b"two"),
        ]);
        assert!(extract_zip(&bytes, limits()).is_err());
    }

    #[test]
    fn maintained_7z_decoder_reads_the_product_fixture() {
        let bytes = include_bytes!("../fixtures/hud-min.7z");
        let entries =
            extract_archive(bytes, ArchiveLimits::new(100, 1024 * 1024, 4 * 1024 * 1024)).unwrap();
        assert!(entries.iter().any(|(path, _)| path.ends_with("info.vdf")));
    }

    #[test]
    fn seven_z_metadata_and_dictionary_preflight_is_bounded() {
        let mut bytes = vec![0u8; 32];
        bytes[..6].copy_from_slice(&SEVEN_ZIP_MAGIC);
        bytes[20..28].copy_from_slice(&(MAX_7Z_NEXT_HEADER_BYTES + 1).to_le_bytes());
        let err = validate_7z_start_header(&bytes).unwrap_err();
        assert!(
            err.message().contains("header metadata"),
            "{}",
            err.message()
        );

        let mut lzma = vec![0u8; 5];
        lzma[1..5].copy_from_slice(&(256u32 * 1024 * 1024).to_le_bytes());
        assert_eq!(
            seven_z_dictionary_size(EncoderMethod::ID_LZMA, &lzma).unwrap(),
            Some(256 * 1024 * 1024)
        );
        assert_eq!(
            seven_z_dictionary_size(EncoderMethod::ID_LZMA2, &[40]).unwrap(),
            Some(u32::MAX as u64)
        );
        assert!(seven_z_dictionary_size(EncoderMethod::ID_LZMA, &[0]).is_err());

        // This is the encoded-header streams declaration from the product
        // fixture, with only the LZMA2 property raised from 64 MiB to 4 GiB.
        // It must be rejected before `ArchiveReader` gets a chance to allocate
        // the attacker's requested dictionary while decoding that header.
        let encoded_header = [
            0x17, 0x06, 0x57, 0x01, 0x09, 0x80, 0xaf, 0x00, 0x07, 0x0b, 0x01, 0x00, 0x01, 0x21,
            0x21, 0x01, 0x28, 0x0c, 0x81, 0x22, 0x00, 0x00,
        ];
        let err = preflight_encoded_7z_header(&encoded_header).unwrap_err();
        assert!(err.message().contains("dictionary"), "{}", err.message());
    }

    #[test]
    fn backend_cfg_policy_matches_blocking_cfglint_boundaries() {
        let benign = br#"
            // connect bad.example
            echo "connect bad.example; unbindall"
            bind f "+inspect"
        "#;
        validate_imported_cfg("tf/cfg/overrides/autoexec.cfg", benign).unwrap();

        for hostile in [
            "connect bad.example",
            "bind mouse1 \"echo hi; connect bad.example\"",
            "alias harmless \"password hunter2\"",
            "alias connect echo",
            "unbind escape",
            "con_enable 0",
            "sv_cheats 1",
        ] {
            let err = validate_imported_cfg("tf/cfg/overrides/autoexec.cfg", hostile.as_bytes())
                .unwrap_err();
            assert!(
                err.message().contains("cannot"),
                "{hostile}: {}",
                err.message()
            );
        }

        validate_imported_cfg(
            "tf/cfg/config.cfg",
            b"unbindall\nbind ESCAPE cancelselect\ncon_enable 0\npassword 0\n",
        )
        .unwrap();
        assert!(validate_imported_cfg("tf/cfg/config.cfg", b"password real-secret").is_err());
        assert!(validate_cfg_has_no_secrets(
            "tf/cfg/overrides/personal.cfg",
            b"bind f \"rcon_password secret\""
        )
        .is_err());
    }

    #[test]
    fn cfg_scanner_bounds_separator_and_token_storms() {
        let separators = vec![b';'; MAX_CFG_SEGMENTS + 1];
        let err = validate_imported_cfg("tf/cfg/overrides/storm.cfg", &separators).unwrap_err();
        assert!(err.message().contains("too many cfg commands"), "{err:?}");

        let tokens = "x ".repeat(MAX_CFG_TOKENS_PER_COMMAND + 1);
        let err =
            validate_imported_cfg("tf/cfg/overrides/tokens.cfg", tokens.as_bytes()).unwrap_err();
        assert!(err.message().contains("too many tokens"), "{err:?}");
    }

    #[test]
    fn dangerous_launch_console_commands_are_refused() {
        validate_imported_launch_options("-novid +con_enable 1 +exec autoexec").unwrap();
        for options in [
            "+connect bad.example",
            "+retry",
            "+bind f \"connect bad.example\"",
            "+password hunter2",
            "+quit;echo still-runs",
            "+echo before;+quit",
            "+echo before;+connect bad.example",
            "+echo before;+password hunter2",
        ] {
            assert!(
                validate_imported_launch_options(options).is_err(),
                "accepted {options}"
            );
        }
        validate_imported_launch_options(r#"+echo "quoted ; +quit is data" -novid"#).unwrap();
        assert!(validate_launch_has_no_secrets("-novid +password hunter2").is_err());
        assert!(validate_launch_has_no_secrets("+echo before;+rcon_password hunter2").is_err());
    }
}
