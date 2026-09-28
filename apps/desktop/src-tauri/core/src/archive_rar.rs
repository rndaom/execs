//! Bounded, extraction-only RAR adapter. UnRAR receives a private copy of the
//! archive and runs TEST, never EXTRACT: member paths never reach the filesystem.
//! Raw headers are checked first because native processing can consume service
//! records without returning them through RARReadHeaderEx.
//!
//! UnRAR source code may be used in any software to handle RAR archives without
//! limitations free of charge, but cannot be used to develop RAR (WinRAR)
//! compatible archiver and to re-create RAR compression algorithm, which is
//! proprietary. Distribution of modified UnRAR source code in separate form or
//! as a part of other software is permitted, provided that full text of this
//! paragraph, starting from "UnRAR source code" words, is included in license,
//! or in documentation if license is not available, and in source code comments
//! of resulting package.

use std::io::Write;
use std::sync::Mutex;

use unrar_ng_sys as ffi;

use super::{compression_ratio_exceeded, keep_entry, ArchiveLimits, MIB};
use crate::profile::{portable_path_key, ProfileError};

const MAGIC4: &[u8] = b"Rar!\x1a\x07\x00";
const MAGIC5: &[u8] = b"Rar!\x1a\x07\x01\x00";
const MAX_DICTIONARY: u64 = 128 * MIB;
const MAX_METADATA: usize = 16 * 1024 * 1024;
// UnRAR has process-global error state. Keep calls serialized, including close.
static DECODER: Mutex<()> = Mutex::new(());

fn invalid() -> ProfileError {
    ProfileError::Io("That RAR archive has malformed or truncated headers.".into())
}

fn unsupported(reason: &str) -> ProfileError {
    ProfileError::Io(format!(
        "That RAR archive {reason}. Extract it first, then import the extracted folder."
    ))
}

#[derive(Debug)]
struct Member {
    name: String,
    size: u64,
    packed: u64,
    directory: bool,
}

struct Parser<'a> {
    bytes: &'a [u8],
    at: usize,
}

impl<'a> Parser<'a> {
    fn take(&mut self, len: usize) -> Result<&'a [u8], ProfileError> {
        let end = self.at.checked_add(len).ok_or_else(invalid)?;
        let out = self.bytes.get(self.at..end).ok_or_else(invalid)?;
        self.at = end;
        Ok(out)
    }

    fn byte(&mut self) -> Result<u8, ProfileError> {
        Ok(self.take(1)?[0])
    }

    fn u16(&mut self) -> Result<u16, ProfileError> {
        Ok(u16::from_le_bytes(self.take(2)?.try_into().unwrap()))
    }

    fn u32(&mut self) -> Result<u32, ProfileError> {
        Ok(u32::from_le_bytes(self.take(4)?.try_into().unwrap()))
    }

    fn vint(&mut self) -> Result<u64, ProfileError> {
        let mut value = 0u64;
        for shift in (0..=63).step_by(7) {
            let byte = self.byte()?;
            if shift == 63 && byte > 1 {
                return Err(invalid());
            }
            value |= u64::from(byte & 127) << shift;
            if byte & 128 == 0 {
                return Ok(value);
            }
        }
        Err(invalid())
    }

    fn length(&mut self) -> Result<usize, ProfileError> {
        usize::try_from(self.vint()?).map_err(|_| invalid())
    }
}

fn name(bytes: &[u8]) -> Result<String, ProfileError> {
    // Native fixed-size headers can truncate names; do not accept that alias.
    if bytes.is_empty() || bytes.len() >= 1024 || bytes.contains(&0) {
        return Err(unsupported("has an unsupported file name"));
    }
    let text = std::str::from_utf8(bytes)
        .map_err(|_| unsupported("has a file name in an unsupported encoding"))?;
    // Validate before native normalization can replace a colon or backslash.
    keep_entry(text)?;
    if text.contains(':') {
        return Err(unsupported("contains an unsafe file name"));
    }
    Ok(text.replace('\\', "/"))
}

fn dictionary(bytes: u64) -> Result<(), ProfileError> {
    if bytes > MAX_DICTIONARY {
        return Err(unsupported("requests a dictionary larger than 128 MiB"));
    }
    Ok(())
}

fn preflight(bytes: &[u8], limits: ArchiveLimits) -> Result<Vec<Member>, ProfileError> {
    let members = if bytes.starts_with(MAGIC5) {
        headers5(bytes, limits)?
    } else if bytes.starts_with(MAGIC4) {
        headers4(bytes, limits)?
    } else {
        return Err(invalid());
    };
    let mut total = 0u64;
    let mut seen = std::collections::HashSet::new();
    for member in &members {
        // Include discarded junk: solid decoding still needs its bytes.
        if member.size > limits.max_entry_bytes {
            return Err(limits.entry_too_big(&member.name));
        }
        total = total
            .checked_add(member.size)
            .ok_or_else(|| limits.total_too_big())?;
        if total > limits.max_total_bytes {
            return Err(limits.total_too_big());
        }
        if !member.directory {
            if let Some(rel) = keep_entry(&member.name)? {
                if !seen.insert(portable_path_key(&rel)?) {
                    return Err(unsupported("contains colliding file paths"));
                }
            }
        }
        // A solid member may use preceding members' dictionary; apply ratio
        // to the complete archive, not a member's compressed byte count.
    }
    if compression_ratio_exceeded(total, bytes.len() as u64) {
        return Err(unsupported("decompresses more than 200x"));
    }
    Ok(members)
}

fn headers4(bytes: &[u8], limits: ArchiveLimits) -> Result<Vec<Member>, ProfileError> {
    let mut at = MAGIC4.len();
    let mut metadata = 0usize;
    let mut members = Vec::new();
    let mut main = false;
    while at < bytes.len() {
        let mut prefix = Parser {
            bytes: &bytes[at..],
            at: 0,
        };
        let crc = prefix.u16()?;
        let kind = prefix.byte()?;
        let flags = prefix.u16()?;
        let size = usize::from(prefix.u16()?);
        if size < 7 {
            return Err(invalid());
        }
        let end = at.checked_add(size).ok_or_else(invalid)?;
        let header = bytes.get(at..end).ok_or_else(invalid)?;
        if crc32fast::hash(&header[2..]) as u16 != crc {
            return Err(invalid());
        }
        metadata = metadata.checked_add(size).ok_or_else(invalid)?;
        if metadata > MAX_METADATA {
            return Err(unsupported("has too much header metadata"));
        }
        let mut p = Parser {
            bytes: header,
            at: 7,
        };
        let mut packed = if flags & 0x8000 != 0 {
            u64::from(p.u32()?)
        } else {
            0
        };
        match kind {
            0x73 if !main && members.is_empty() => {
                main = true;
                if flags & 1 != 0 {
                    return Err(unsupported("is split across multiple volumes"));
                }
                if flags & 0x80 != 0 {
                    return Err(unsupported("is password protected"));
                }
                if flags & 2 != 0 {
                    return Err(unsupported("contains a legacy embedded comment"));
                }
            }
            0x74 if main => {
                if flags & 0x8000 == 0 {
                    return Err(invalid());
                }
                if flags & 3 != 0 {
                    return Err(unsupported("is split across multiple volumes"));
                }
                if flags & 4 != 0 {
                    return Err(unsupported("is password protected"));
                }
                if flags & 8 != 0 {
                    return Err(unsupported("contains a legacy embedded comment"));
                }
                let mut unpacked = u64::from(p.u32()?);
                let os = p.byte()?;
                p.take(8)?; // CRC32 and DOS time.
                let version = p.byte()?;
                let method = p.byte()?;
                let name_len = usize::from(p.u16()?);
                let attr = p.u32()?;
                if flags & 0x100 != 0 {
                    packed |= u64::from(p.u32()?) << 32;
                    unpacked |= u64::from(p.u32()?) << 32;
                }
                if unpacked == u64::MAX
                    || !(15..=29).contains(&version)
                    || !(0x30..=0x35).contains(&method)
                {
                    return Err(unsupported("uses unsupported compression settings"));
                }
                let raw_name = p.take(name_len)?;
                if flags & 0x200 != 0 && raw_name.contains(&0) {
                    return Err(unsupported("uses legacy encoded Unicode names"));
                }
                let directory = flags & 0xe0 == 0xe0;
                if os == 3
                    && attr & 0xf000 != 0
                    && attr & 0xf000 != 0x8000
                    && attr & 0xf000 != 0x4000
                {
                    return Err(unsupported("contains links or special files"));
                }
                members.push(Member {
                    name: name(raw_name)?,
                    size: unpacked,
                    packed,
                    directory,
                });
            }
            0x7b if main => {
                if flags & 1 != 0 {
                    return Err(unsupported("is split across multiple volumes"));
                }
                if end != bytes.len() {
                    return Err(invalid());
                }
                break;
            }
            _ => return Err(unsupported("contains unsupported service records")),
        }
        if members.len() > limits.max_entries {
            return Err(limits.too_many());
        }
        at = end
            .checked_add(usize::try_from(packed).map_err(|_| invalid())?)
            .ok_or_else(invalid)?;
        if at > bytes.len() {
            return Err(invalid());
        }
    }
    if !main {
        return Err(invalid());
    }
    Ok(members)
}

fn headers5(bytes: &[u8], limits: ArchiveLimits) -> Result<Vec<Member>, ProfileError> {
    let mut at = MAGIC5.len();
    let mut metadata = 0usize;
    let mut members = Vec::new();
    let mut main = false;
    let mut ended = false;
    while at < bytes.len() {
        let mut prefix = Parser {
            bytes: &bytes[at..],
            at: 0,
        };
        let crc = prefix.u32()?;
        let size = prefix.length()?;
        if size > 2 * 1024 * 1024 || prefix.at > 7 {
            return Err(invalid());
        }
        let end = at
            .checked_add(prefix.at)
            .and_then(|v| v.checked_add(size))
            .ok_or_else(invalid)?;
        let header = bytes.get(at..end).ok_or_else(invalid)?;
        if crc32fast::hash(&header[4..]) != crc {
            return Err(invalid());
        }
        metadata = metadata.checked_add(header.len()).ok_or_else(invalid)?;
        if metadata > MAX_METADATA {
            return Err(unsupported("has too much header metadata"));
        }
        let mut p = Parser {
            bytes: header,
            at: prefix.at,
        };
        let kind = p.vint()?;
        let flags = p.vint()?;
        if flags & 0x18 != 0 {
            return Err(unsupported("is split across multiple volumes"));
        }
        let extra = if flags & 1 != 0 { p.length()? } else { 0 };
        let packed = if flags & 2 != 0 { p.vint()? } else { 0 };
        let extra_start = header.len().checked_sub(extra).ok_or_else(invalid)?;
        if extra_start < p.at {
            return Err(invalid());
        }
        p.bytes = &header[..extra_start];
        match kind {
            1 if !main && members.is_empty() => {
                main = true;
                let main_flags = p.vint()?;
                if main_flags & 3 != 0 {
                    return Err(unsupported("is split across multiple volumes"));
                }
                if packed != 0 {
                    return Err(invalid());
                }
            }
            2 if main => {
                let file_flags = p.vint()?;
                let size = p.vint()?;
                let attr = p.vint()?;
                if file_flags & 8 != 0 {
                    return Err(unsupported("does not declare its expanded size"));
                }
                if file_flags & 2 != 0 {
                    p.take(4)?;
                }
                if file_flags & 4 != 0 {
                    p.take(4)?;
                }
                let comp = p.vint()?;
                if comp & 63 != 0 || (comp >> 7) & 7 > 5 {
                    return Err(unsupported("uses unsupported compression settings"));
                }
                dictionary(
                    0x20000u64
                        .checked_shl(((comp >> 10) & 15) as u32)
                        .ok_or_else(invalid)?,
                )?;
                let os = p.vint()?;
                if os > 1
                    || (os == 1
                        && attr & 0xf000 != 0
                        && attr & 0xf000 != 0x8000
                        && attr & 0xf000 != 0x4000)
                {
                    return Err(unsupported("contains links or special files"));
                }
                let len = p.length()?;
                let name = name(p.take(len)?)?;
                members.push(Member {
                    name,
                    size,
                    packed,
                    directory: file_flags & 1 != 0,
                });
            }
            4 => return Err(unsupported("is password protected")),
            5 if main => {
                if p.vint()? & 1 != 0 {
                    return Err(unsupported("is split across multiple volumes"));
                }
                if end != bytes.len() || packed != 0 {
                    return Err(invalid());
                }
                ended = true;
            }
            _ => return Err(unsupported("contains unsupported service records")),
        }
        let mut extras = Parser {
            bytes: &header[extra_start..],
            at: 0,
        };
        while extras.at < extras.bytes.len() {
            let len = extras.length()?;
            let mut field = Parser {
                bytes: extras.take(len)?,
                at: 0,
            };
            let kind_extra = field.vint()?;
            if kind == 1 && kind_extra == 1 {
                // Native Quick Open substitutes cached file headers. Until the
                // DLL can disable it, refuse rather than validate different bytes.
                if field.vint()? & 1 != 0 && field.vint()? != 0 {
                    return Err(unsupported("uses Quick Open header caching"));
                }
            }
            if kind == 2 && kind_extra == 1 {
                return Err(unsupported("is password protected"));
            }
            if kind == 2 && matches!(kind_extra, 4 | 5 | 7) {
                return Err(unsupported(
                    "contains file versions, links or alternate streams",
                ));
            }
        }
        if members.len() > limits.max_entries {
            return Err(limits.too_many());
        }
        at = end
            .checked_add(usize::try_from(packed).map_err(|_| invalid())?)
            .ok_or_else(invalid)?;
        if at > bytes.len() {
            return Err(invalid());
        }
    }
    if !main || !ended {
        return Err(invalid());
    }
    Ok(members)
}

struct Output {
    bytes: Vec<u8>,
    remaining: u64,
    total: u64,
    failed: bool,
    keep: bool,
}

extern "C" fn callback(
    msg: ffi::UINT,
    user: ffi::LPARAM,
    data: ffi::LPARAM,
    len: ffi::LPARAM,
) -> i32 {
    // Every callback runs synchronously inside one native call while Output is
    // exclusively borrowed and stationary. No pointer survives that call.
    let output = unsafe { &mut *(user as *mut Output) };
    if msg != ffi::UCM_PROCESSDATA || len < 0 || (len > 0 && data == 0) {
        output.failed = true;
        return -1; // Never supply passwords, volumes or dictionary overrides.
    }
    let count = len as u64;
    if count > output.remaining || count > output.total {
        output.failed = true;
        return -1;
    }
    if output.keep && count != 0 {
        let Ok(count) = usize::try_from(count) else {
            output.failed = true;
            return -1;
        };
        if output.bytes.try_reserve(count).is_err() {
            output.failed = true;
            return -1;
        }
        let bytes = unsafe { std::slice::from_raw_parts(data as *const u8, count) };
        output.bytes.extend_from_slice(bytes);
    }
    output.remaining -= count;
    output.total -= count;
    1
}

struct Handle(*const ffi::Handle);
impl Drop for Handle {
    fn drop(&mut self) {
        // Created by RAROpenArchiveEx and closed exactly once before temp cleanup.
        unsafe {
            ffi::RARCloseArchive(self.0);
        }
    }
}

fn native_name(header: &ffi::HeaderDataEx) -> Result<String, ProfileError> {
    let wide = header.filename_w; // Packed fields must be copied before borrowing.
    let end = wide.iter().position(|c| *c == 0).ok_or_else(invalid)?;
    #[cfg(windows)]
    let text = String::from_utf16(&wide[..end]).map_err(|_| invalid())?;
    #[cfg(not(windows))]
    let text = wide[..end]
        .iter()
        .map(|c| char::from_u32(*c as u32).ok_or_else(invalid))
        .collect::<Result<String, _>>()?;
    Ok(text.replace('\\', "/"))
}

pub(super) fn extract(
    bytes: &[u8],
    limits: ArchiveLimits,
) -> Result<Vec<(String, Vec<u8>)>, ProfileError> {
    let members = preflight(bytes, limits)?;
    let _guard = DECODER
        .lock()
        .map_err(|_| unsupported("could not acquire the decoder"))?;
    let scratch = tempfile::tempdir().map_err(|e| ProfileError::Io(e.to_string()))?;
    let path = scratch.path().join("input.rar");
    let mut input = std::fs::OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(&path)
        .map_err(|e| ProfileError::Io(e.to_string()))?;
    input
        .write_all(bytes)
        .map_err(|e| ProfileError::Io(e.to_string()))?;
    drop(input);
    #[cfg(windows)]
    let path_native: Vec<u16> = {
        use std::os::windows::ffi::OsStrExt;
        path.as_os_str().encode_wide().chain(Some(0)).collect()
    };
    #[cfg(not(windows))]
    let path_native = {
        use std::os::unix::ffi::OsStrExt;
        std::ffi::CString::new(path.as_os_str().as_bytes()).map_err(|_| invalid())?
    };
    let mut output = Output {
        bytes: Vec::new(),
        remaining: 0,
        total: limits.max_total_bytes,
        failed: false,
        keep: false,
    };
    let mut open = ffi::OpenArchiveDataEx::new(path_native.as_ptr(), ffi::RAR_OM_EXTRACT);
    open.callback = Some(callback);
    open.user_data = (&mut output as *mut Output) as ffi::LPARAM;
    // Native writes only to the explicitly writable packed structs; its API
    // uses const pointers in Rust despite the C signature being mutable.
    let ptr = unsafe { ffi::RAROpenArchiveEx(&raw mut open) };
    if ptr.is_null() {
        return Err(unsupported("could not be opened"));
    }
    let handle = Handle(ptr);
    if open.open_result != 0
        || output.failed
        || open.flags & (ffi::ROADF_VOLUME | ffi::ROADF_ENCHEADERS) != 0
    {
        return Err(unsupported("is damaged, encrypted or split across volumes"));
    }
    let mut result = Vec::new();
    for member in &members {
        let mut header = ffi::HeaderDataEx::default();
        if unsafe { ffi::RARReadHeaderEx(handle.0, &raw mut header) } != 0 {
            return Err(invalid());
        }
        let size = u64::from(header.unp_size) | u64::from(header.unp_size_high) << 32;
        let packed = u64::from(header.pack_size) | u64::from(header.pack_size_high) << 32;
        dictionary(u64::from(header.dict_size) * 1024)?;
        if size != member.size
            || packed != member.packed
            || native_name(&header)? != member.name
            || header.flags & (ffi::RHDF_SPLITBEFORE | ffi::RHDF_SPLITAFTER | ffi::RHDF_ENCRYPTED)
                != 0
            || header.redir_type != 0
            || (header.flags & ffi::RHDF_DIRECTORY != 0) != member.directory
        {
            return Err(unsupported(
                "has inconsistent or unsupported member headers",
            ));
        }
        let kept = if member.directory {
            None
        } else {
            keep_entry(&member.name)?
        };
        output.bytes.clear();
        output.remaining = member.size;
        output.keep = kept.is_some();
        // TEST sends bytes to our callback and verifies checksums; it never
        // creates member files. TEST junk too, preserving solid history while
        // accounting for every decompressed byte (SKIP suppresses callbacks).
        let code = unsafe {
            ffi::RARProcessFile(handle.0, ffi::RAR_TEST, std::ptr::null(), std::ptr::null())
        };
        if code != 0 || output.failed || output.remaining != 0 {
            return Err(unsupported(
                "is damaged or exceeds its declared output size",
            ));
        }
        if let Some(rel) = kept {
            result.push((rel, std::mem::take(&mut output.bytes)));
        }
    }
    let mut header = ffi::HeaderDataEx::default();
    if unsafe { ffi::RARReadHeaderEx(handle.0, &raw mut header) } != ffi::ERAR_END_ARCHIVE {
        return Err(invalid());
    }
    Ok(result)
}

#[cfg(test)]
mod tests {
    use super::*;
    fn limits() -> ArchiveLimits {
        ArchiveLimits::new(100, 8 * MIB, 32 * MIB)
    }

    #[test]
    fn real_rar4_rar5_normal_and_solid() {
        for (name, bytes, count) in [
            (
                "RAR4",
                include_bytes!("../fixtures/rar/rar4-normal.rar").as_slice(),
                1,
            ),
            (
                "RAR4 solid",
                include_bytes!("../fixtures/rar/rar4-solid.rar").as_slice(),
                2,
            ),
            (
                "RAR5",
                include_bytes!("../fixtures/rar/rar5-normal.rar").as_slice(),
                1,
            ),
            (
                "RAR5 solid",
                include_bytes!("../fixtures/rar/rar5-solid.rar").as_slice(),
                4,
            ),
        ] {
            let result =
                extract(bytes, limits()).unwrap_or_else(|e| panic!("{name}: {}", e.message()));
            assert_eq!(result.len(), count, "{name}");
            assert!(result.iter().all(|(_, data)| !data.is_empty()), "{name}");
        }
        let normal = extract(include_bytes!("../fixtures/rar/rar4-normal.rar"), limits()).unwrap();
        assert_eq!(normal, vec![("VERSION".into(), b"unrar-0.4.0".to_vec())]);
    }

    #[test]
    fn refuses_encrypted_headers_data_and_multipart_before_native() {
        for bytes in [
            include_bytes!("../fixtures/rar/rar4-encrypted.rar").as_slice(),
            include_bytes!("../fixtures/rar/rar4-encrypted-names.rar").as_slice(),
            include_bytes!("../fixtures/rar/rar5-encrypted.rar").as_slice(),
            include_bytes!("../fixtures/rar/rar5-encrypted-names.rar").as_slice(),
        ] {
            assert!(preflight(bytes, limits())
                .unwrap_err()
                .message()
                .contains("password"));
        }
        for bytes in [
            include_bytes!("../fixtures/rar/rar4-volume.rar").as_slice(),
            include_bytes!("../fixtures/rar/rar5-volume.rar").as_slice(),
        ] {
            assert!(preflight(bytes, limits())
                .unwrap_err()
                .message()
                .contains("volumes"));
        }
        assert!(preflight(
            include_bytes!("../fixtures/rar/rar5-quickopen.rar"),
            limits()
        )
        .unwrap_err()
        .message()
        .contains("Quick Open"));
    }

    #[test]
    fn rejects_size_count_and_dictionary_limits_before_decode() {
        for bytes in [
            include_bytes!("../fixtures/rar/rar4-solid.rar").as_slice(),
            include_bytes!("../fixtures/rar/rar5-solid.rar").as_slice(),
        ] {
            assert!(preflight(bytes, ArchiveLimits::new(1, 8 * MIB, 32 * MIB)).is_err());
            assert!(preflight(bytes, ArchiveLimits::new(100, 1, 32 * MIB)).is_err());
            assert!(preflight(bytes, ArchiveLimits::new(100, 8 * MIB, 1)).is_err());
        }
        assert!(dictionary(128 * MIB).is_ok());
        assert!(dictionary(128 * MIB + 1).is_err());
    }

    fn vint(mut value: u64, out: &mut Vec<u8>) {
        loop {
            let rest = value >> 7;
            out.push((value as u8 & 127) | if rest != 0 { 128 } else { 0 });
            if rest == 0 {
                break;
            }
            value = rest;
        }
    }

    fn block5(body: &[u8], out: &mut Vec<u8>) {
        let mut header = Vec::new();
        vint(body.len() as u64, &mut header);
        header.extend_from_slice(body);
        out.extend_from_slice(&crc32fast::hash(&header).to_le_bytes());
        out.extend_from_slice(&header);
    }

    // Synthetic headers exercise the preflight before any decoder sees them;
    // real compressed and solid streams are covered by the upstream fixtures.
    fn header_fixture(entries: &[(&str, u64, u64)]) -> Vec<u8> {
        let mut out = MAGIC5.to_vec();
        block5(&[1, 0, 0], &mut out);
        for (name, size, compression) in entries {
            let mut body = vec![2, 2, 1, 0]; // file, data present, one byte packed, flags
            vint(*size, &mut body);
            vint(0, &mut body); // attributes
            vint(*compression, &mut body);
            vint(0, &mut body); // Windows host
            vint(name.len() as u64, &mut body);
            body.extend_from_slice(name.as_bytes());
            block5(&body, &mut out);
            out.push(0);
        }
        block5(&[5, 0, 0], &mut out);
        out
    }

    #[test]
    fn hostile_raw_headers_cannot_bypass_resource_and_path_preflight() {
        let oversized_dict = header_fixture(&[("x", 1, 11 << 10)]);
        assert!(preflight(&oversized_dict, limits())
            .unwrap_err()
            .message()
            .contains("dictionary"));
        let oversized_entry = header_fixture(&[("x", u64::MAX, 0)]);
        assert!(preflight(&oversized_entry, limits())
            .unwrap_err()
            .message()
            .contains("larger"));
        let junk_bomb = header_fixture(&[(".git/x", 9 * MIB, 0)]);
        assert!(preflight(&junk_bomb, limits())
            .unwrap_err()
            .message()
            .contains("larger"));
        let expansion = header_fixture(&[("x", 9 * MIB, 0)]);
        assert!(
            preflight(&expansion, ArchiveLimits::new(10, 16 * MIB, 32 * MIB))
                .unwrap_err()
                .message()
                .contains("200x")
        );
        let collision = header_fixture(&[("pack/Foo", 1, 0), ("pack/foo", 1, 0)]);
        assert!(preflight(&collision, limits())
            .unwrap_err()
            .message()
            .contains("colliding"));
        let traversal = header_fixture(&[("../out", 1, 0)]);
        assert!(preflight(&traversal, limits()).is_err());
        let stream = header_fixture(&[("x:stream", 1, 0)]);
        assert!(preflight(&stream, limits()).is_err());
        let mut service = MAGIC5.to_vec();
        block5(&[1, 0, 0], &mut service);
        block5(&[3, 0], &mut service);
        assert!(preflight(&service, limits())
            .unwrap_err()
            .message()
            .contains("service"));
    }

    #[test]
    fn damaged_compressed_payload_is_not_returned() {
        let mut bytes = include_bytes!("../fixtures/rar/rar5-normal.rar").to_vec();
        // The middle lies inside the compressed payload, outside header CRCs.
        let middle = bytes.len() / 2;
        bytes[middle] ^= 0x40;
        assert!(preflight(&bytes, limits()).is_ok());
        assert!(extract(&bytes, limits()).is_err());
    }

    #[test]
    fn malformed_headers_do_not_panic() {
        for bytes in [
            include_bytes!("../fixtures/rar/rar4-solid.rar").as_slice(),
            include_bytes!("../fixtures/rar/rar5-solid.rar").as_slice(),
        ] {
            for end in 0..bytes.len() {
                // Older RAR4 can omit its end marker; exercise every prefix.
                let _ = preflight(&bytes[..end], limits());
            }
            let mut corrupt = bytes.to_vec();
            corrupt[12] ^= 0x40;
            assert!(preflight(&corrupt, limits()).is_err());
        }
        for bytes in [vec![0xff; 10], vec![0x80; 11]] {
            assert!(Parser {
                bytes: &bytes,
                at: 0
            }
            .vint()
            .is_err());
        }
    }

    #[test]
    fn refuses_unsafe_paths_and_truncated_names_before_native_normalization() {
        for path in [
            "../outside.txt",
            "C:/outside.txt",
            "/outside.txt",
            "pack/file:stream",
            "pack/../outside",
        ] {
            assert!(name(path.as_bytes()).is_err(), "{path}");
        }
        assert!(name(&vec![b'a'; 1024]).is_err());
        assert!(name(b"safe\0hidden").is_err());
        assert_eq!(
            name(b"pack\\materials\\test.vmt").unwrap(),
            "pack/materials/test.vmt"
        );
    }

    #[test]
    fn callback_bounds_actual_output_and_discarded_solid_bytes() {
        let data = [1u8; 4];
        for keep in [true, false] {
            let mut out = Output {
                bytes: Vec::new(),
                remaining: 4,
                total: 4,
                failed: false,
                keep,
            };
            let user = (&mut out as *mut Output) as ffi::LPARAM;
            assert_eq!(
                callback(ffi::UCM_PROCESSDATA, user, data.as_ptr() as ffi::LPARAM, 4),
                1
            );
            assert_eq!(out.remaining, 0);
            assert_eq!(out.total, 0);
            assert_eq!(out.bytes.len(), if keep { 4 } else { 0 });
            assert_eq!(
                callback(ffi::UCM_PROCESSDATA, user, data.as_ptr() as ffi::LPARAM, 1),
                -1
            );
            assert!(out.failed);
        }
        let mut out = Output {
            bytes: Vec::new(),
            remaining: 4,
            total: 3,
            failed: false,
            keep: true,
        };
        let user = (&mut out as *mut Output) as ffi::LPARAM;
        assert_eq!(
            callback(ffi::UCM_PROCESSDATA, user, data.as_ptr() as ffi::LPARAM, 4),
            -1
        );
        assert!(out.bytes.is_empty());
        for msg in [
            ffi::UCM_CHANGEVOLUME,
            ffi::UCM_NEEDPASSWORD,
            ffi::UCM_CHANGEVOLUMEW,
            ffi::UCM_NEEDPASSWORDW,
            5,
        ] {
            assert_eq!(callback(msg, user, 0, 0), -1);
        }
    }
}
