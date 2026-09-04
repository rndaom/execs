//! The reversible `gameinfo.txt` bypass: comment the `type multiplayer_only`
//! line out and back in, byte-preserving everything else, with a pristine copy
//! kept in app data.

use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};

use crate::archive::read_regular_file_bounded;
use crate::hash::write_atomic_within;
use crate::process_lock::{live_process_names, refuse_if_running_among};

use super::state::{app_dir_within, live_file_exists_within, preloader_dir, read_app_file_bounded};

const MAX_GAMEINFO_BYTES: u64 = 4 * 1024 * 1024;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct GameinfoBypass {
    pub found: bool,
    pub enabled: bool,
}

pub(crate) fn gameinfo_path(tf2_root: &Path) -> PathBuf {
    tf2_root.join("tf").join("gameinfo.txt")
}

fn read_live_gameinfo(tf2_root: &Path) -> std::io::Result<Vec<u8>> {
    let path = gameinfo_path(tf2_root);
    if !live_file_exists_within(tf2_root, &path)? {
        return Err(std::io::Error::new(
            std::io::ErrorKind::NotFound,
            format!("{} was not found", path.display()),
        ));
    }
    // Re-open immediately after the no-link validation. The bounded helper
    // keeps one no-follow handle through the read and verifies its identity.
    match read_regular_file_bounded(&path, MAX_GAMEINFO_BYTES) {
        Ok(Some(bytes)) => Ok(bytes),
        Ok(None) => Err(std::io::Error::new(
            std::io::ErrorKind::InvalidData,
            format!(
                "gameinfo.txt exceeds the {} MiB safety limit",
                MAX_GAMEINFO_BYTES / (1024 * 1024)
            ),
        )),
        Err(err) => Err(std::io::Error::other(err.message())),
    }
}

fn read_gameinfo_backup(data_dir: &Path) -> Result<Option<Vec<u8>>, String> {
    let path = gameinfo_backup_path(data_dir);
    read_app_file_bounded(data_dir, &path, MAX_GAMEINFO_BYTES)
        .map_err(|err| format!("Could not read the gameinfo.txt backup: {err}"))
}

pub(crate) fn split_lines_inclusive(bytes: &[u8]) -> Vec<Vec<u8>> {
    let mut lines = Vec::new();
    let mut start = 0;
    for (index, byte) in bytes.iter().enumerate() {
        if *byte == b'\n' {
            lines.push(bytes[start..=index].to_vec());
            start = index + 1;
        }
    }
    if start < bytes.len() {
        lines.push(bytes[start..].to_vec());
    }
    lines
}

#[cfg(test)]
pub(crate) fn line_has(line: &[u8], needle: &[u8]) -> bool {
    line.windows(needle.len()).any(|window| window == needle)
}

/// Where the `type` key sits on a `type multiplayer_only` line, and whether a
/// `//` opens *before* it (the only comment that actually disables the key).
///
/// A `//` anywhere else on the line is a trailing annotation — it must never
/// be read as "the bypass is on", and revert must never strip it.
pub(crate) fn gameinfo_type_line(line: &[u8]) -> Option<(usize, bool)> {
    let mut at = 0usize;
    if line.starts_with(&[0xef, 0xbb, 0xbf]) {
        at = 3;
    }
    while line.get(at).is_some_and(u8::is_ascii_whitespace) {
        at += 1;
    }
    let commented = line.get(at..at + 2) == Some(b"//");
    if commented {
        at += 2;
        while line.get(at).is_some_and(u8::is_ascii_whitespace) {
            at += 1;
        }
    }
    let pos_type = at;
    if line.get(at..at + 4) != Some(b"type") {
        return None;
    }
    at += 4;
    if !line.get(at).is_some_and(u8::is_ascii_whitespace) {
        return None;
    }
    while line.get(at).is_some_and(u8::is_ascii_whitespace) {
        at += 1;
    }
    const VALUE: &[u8] = b"multiplayer_only";
    if line.get(at..at + VALUE.len()) != Some(VALUE) {
        return None;
    }
    let mut after = at + VALUE.len();
    while line.get(after).is_some_and(u8::is_ascii_whitespace) {
        after += 1;
    }
    // The only accepted suffix is a real `//` annotation. A single slash or
    // another token must not make an unrelated line eligible for mutation.
    if after < line.len() && line.get(after..after + 2) != Some(b"//") {
        return None;
    }
    Some((pos_type, commented))
}

/// Whether the `type multiplayer_only` line is currently commented out.
pub fn gameinfo_bypass_state(tf2_root: &Path) -> Result<GameinfoBypass, String> {
    let bytes = match read_live_gameinfo(tf2_root) {
        Ok(bytes) => bytes,
        Err(err) if err.kind() == std::io::ErrorKind::NotFound => {
            return Ok(GameinfoBypass {
                found: false,
                enabled: false,
            });
        }
        Err(err) => return Err(format!("Could not read gameinfo.txt: {err}")),
    };
    if !valid_gameinfo(&bytes) {
        return Err(
            "gameinfo.txt does not contain the expected GameInfo/type multiplayer_only structure; verify game files in Steam."
                .into(),
        );
    }
    // Only the FIRST matching line decides: that is the one the toggle edits.
    let enabled = split_lines_inclusive(&bytes)
        .iter()
        .find_map(|line| gameinfo_type_line(line))
        .is_some_and(|(_, commented)| commented);
    Ok(GameinfoBypass {
        found: true,
        enabled,
    })
}

/// Comment/uncomment one `type multiplayer_only` line in place. Returns true
/// when the line changed.
pub(crate) fn toggle_type_line(line: &mut Vec<u8>, enabled: bool) -> bool {
    let Some((pos_type, commented)) = gameinfo_type_line(line) else {
        return false;
    };
    if enabled == commented {
        return false;
    }
    if enabled {
        line.splice(pos_type..pos_type, b"//".iter().copied());
        return true;
    }
    // Disable: strip exactly the `//` that opens this key, plus whatever
    // whitespace sits between it and `type` (our own enable inserts none, so
    // the round trip is byte-identical). A trailing comment is never touched.
    let mut start = pos_type;
    while start > 0 && (line[start - 1] == b' ' || line[start - 1] == b'\t') {
        start -= 1;
    }
    if start < 2 || &line[start - 2..start] != b"//" {
        return false;
    }
    line.drain(start - 2..pos_type);
    true
}

pub(crate) fn gameinfo_backup_path(data_dir: &Path) -> PathBuf {
    preloader_dir(data_dir).join("gameinfo.original.txt")
}

/// Keep the pristine backup usable. It is written on first sight, and
/// refreshed whenever the game's file differs from it while the bypass is
/// *off* — that is a TF2 update replacing gameinfo.txt, and a stale backup
/// would otherwise restore last patch's file forever.
pub(crate) fn refresh_gameinfo_backup(
    data_dir: &Path,
    bytes: &[u8],
    currently_enabled: bool,
) -> Result<(), String> {
    if !valid_gameinfo(bytes) {
        return Err(
            "gameinfo.txt does not contain the expected GameInfo/type multiplayer_only structure; refusing to back it up or edit it. Verify game files in Steam."
                .into(),
        );
    }
    let backup = gameinfo_backup_path(data_dir);
    match read_gameinfo_backup(data_dir) {
        Ok(Some(existing)) if currently_enabled => {
            if !valid_pristine_gameinfo(&existing)
                || toggled_gameinfo(&existing, true).as_deref() != Some(bytes)
            {
                return Err(
                    "The pristine gameinfo.txt backup is missing or does not match the active bypass; refusing to overwrite it. Disable the bypass or verify game files in Steam before retrying."
                        .into(),
                );
            }
            return Ok(());
        }
        Ok(None) if currently_enabled => {
            return Err(
                "gameinfo.txt is already bypassed but no pristine backup exists; verify game files in Steam before applying or restoring the bypass."
                    .into(),
            );
        }
        Ok(Some(existing)) if existing == bytes && valid_pristine_gameinfo(&existing) => {
            return Ok(())
        }
        Ok(Some(_)) | Ok(None) => {}
        Err(err) => return Err(err),
    }
    app_dir_within(data_dir, &preloader_dir(data_dir), true)?;
    write_atomic_within(data_dir, &backup, bytes)
        .map_err(|err| format!("Could not back up gameinfo.txt: {err}"))
}

fn valid_gameinfo(bytes: &[u8]) -> bool {
    let mut at = usize::from(bytes.starts_with(&[0xef, 0xbb, 0xbf])) * 3;
    while bytes.get(at).is_some_and(u8::is_ascii_whitespace) {
        at += 1;
    }
    let header_end = at + b"\"GameInfo\"".len();
    bytes.get(at..header_end) == Some(b"\"GameInfo\"")
        && bytes
            .get(header_end)
            .is_none_or(|byte| byte.is_ascii_whitespace() || *byte == b'{')
        && split_lines_inclusive(bytes)
            .iter()
            .any(|line| gameinfo_type_line(line).is_some())
}

fn valid_pristine_gameinfo(bytes: &[u8]) -> bool {
    valid_gameinfo(bytes)
        && split_lines_inclusive(bytes)
            .iter()
            .find_map(|line| gameinfo_type_line(line))
            .is_some_and(|(_, commented)| !commented)
}

pub(crate) fn require_pristine_gameinfo(tf2_root: &Path) -> Result<(), String> {
    let bytes = read_live_gameinfo(tf2_root)
        .map_err(|err| format!("Could not verify repaired gameinfo.txt: {err}"))?;
    if !valid_pristine_gameinfo(&bytes) {
        return Err(
            "Steam has not restored gameinfo.txt to its supported stock form; the preloader recovery remains pending."
                .into(),
        );
    }
    Ok(())
}

fn toggled_gameinfo(bytes: &[u8], enabled: bool) -> Option<Vec<u8>> {
    let mut lines = split_lines_inclusive(bytes);
    for line in &mut lines {
        if gameinfo_type_line(line).is_some() {
            toggle_type_line(line, enabled);
            return Some(lines.concat());
        }
    }
    None
}

/// Put the pristine gameinfo.txt back from the app-data backup. Returns false
/// when there is no backup or the file already matches it; refuses a backup
/// that is not a gameinfo file at all, since writing that over the game's
/// copy is exactly the damage this exists to repair.
pub fn restore_gameinfo_from_backup(
    tf2_root: &Path,
    data_dir: &Path,
    running_names: &[String],
) -> Result<bool, String> {
    restore_gameinfo_from_backup_with_sampler(
        tf2_root,
        data_dir,
        running_names,
        &live_process_names,
    )
}

pub fn restore_gameinfo_from_backup_with_sampler(
    tf2_root: &Path,
    data_dir: &Path,
    running_names: &[String],
    process_sampler: &dyn Fn() -> Vec<String>,
) -> Result<bool, String> {
    refuse_if_running_among(running_names).map_err(|err| err.message().to_string())?;
    let Some(pristine) = read_gameinfo_backup(data_dir)? else {
        return Ok(false);
    };
    if !valid_pristine_gameinfo(&pristine) {
        return Err(
            "The gameinfo.txt backup is not a GameInfo file in pristine form; refusing to restore from it. \
             Verify game files in Steam to get the stock file back."
                .into(),
        );
    }
    let path = gameinfo_path(tf2_root);
    let observed = match read_live_gameinfo(tf2_root) {
        Ok(current) => Some(current),
        Err(err) if err.kind() == std::io::ErrorKind::NotFound => None,
        Err(err) => return Err(format!("Could not read gameinfo.txt: {err}")),
    };
    if observed.as_deref() == Some(pristine.as_slice()) {
        return Ok(false);
    }
    let still_observed = match read_live_gameinfo(tf2_root) {
        Ok(current) => Some(current),
        Err(err) if err.kind() == std::io::ErrorKind::NotFound => None,
        Err(err) => return Err(format!("Could not recheck gameinfo.txt: {err}")),
    };
    if still_observed != observed {
        return Err(
            "gameinfo.txt changed while its restore was being prepared; leaving it alone.".into(),
        );
    }
    // Re-check right before the write into the official file.
    refuse_if_running_among(process_sampler()).map_err(|err| err.message().to_string())?;
    // Atomic: a truncated gameinfo.txt means TF2 does not start at all.
    write_atomic_within(tf2_root, &path, &pristine)
        .map_err(|err| format!("Could not restore gameinfo.txt: {err}"))?;
    Ok(true)
}

/// Toggle the bypass by commenting/uncommenting the *first*
/// `type multiplayer_only` line, byte-preserving everything else (CRLF, BOM,
/// trailing comments, and every other line). A pristine copy is kept in the
/// app data folder. Returns whether the file changed.
pub fn set_gameinfo_bypass(
    tf2_root: &Path,
    data_dir: &Path,
    enabled: bool,
    running_names: &[String],
) -> Result<bool, String> {
    set_gameinfo_bypass_with_sampler(
        tf2_root,
        data_dir,
        enabled,
        running_names,
        &live_process_names,
    )
}

/// Read every byte and validate the backup relationship without changing
/// either file. Selection preparation uses this before it restores the
/// currently installed particle set, so a malformed gameinfo/backup cannot
/// turn a rejected replacement into an uninstall.
pub(crate) fn preflight_gameinfo_bypass(
    tf2_root: &Path,
    data_dir: &Path,
    enabled: bool,
) -> Result<(), String> {
    let bytes = read_live_gameinfo(tf2_root)
        .map_err(|err| format!("Could not read gameinfo.txt: {err}"))?;
    let currently_enabled = split_lines_inclusive(&bytes)
        .iter()
        .find_map(|line| gameinfo_type_line(line))
        .is_some_and(|(_, commented)| commented);
    let updated = toggled_gameinfo(&bytes, enabled)
        .ok_or_else(|| "gameinfo.txt has no supported type line.".to_string())?;
    if currently_enabled {
        let backup = read_gameinfo_backup(data_dir)?.ok_or_else(|| {
            "gameinfo.txt is already bypassed but no pristine backup exists; verify game files in Steam before applying or restoring the bypass."
                .to_string()
        })?;
        if !valid_pristine_gameinfo(&backup)
            || toggled_gameinfo(&backup, true).as_deref() != Some(bytes.as_slice())
        {
            return Err(
                "The pristine gameinfo.txt backup is missing or does not match the active bypass; refusing to overwrite it. Disable the bypass or verify game files in Steam before retrying."
                    .into(),
            );
        }
    }
    // Keep the computation live so the preflight and writer agree about the
    // exact operation, including an idempotent request.
    let _ = updated;
    Ok(())
}

pub fn set_gameinfo_bypass_with_sampler(
    tf2_root: &Path,
    data_dir: &Path,
    enabled: bool,
    running_names: &[String],
    process_sampler: &dyn Fn() -> Vec<String>,
) -> Result<bool, String> {
    refuse_if_running_among(running_names).map_err(|err| err.message().to_string())?;
    let path = gameinfo_path(tf2_root);
    let bytes = read_live_gameinfo(tf2_root)
        .map_err(|err| format!("Could not read gameinfo.txt: {err}"))?;

    let currently_enabled = split_lines_inclusive(&bytes)
        .iter()
        .find_map(|line| gameinfo_type_line(line))
        .is_some_and(|(_, commented)| commented);
    refresh_gameinfo_backup(data_dir, &bytes, currently_enabled)?;

    let updated = toggled_gameinfo(&bytes, enabled)
        .ok_or_else(|| "gameinfo.txt has no supported type line.".to_string())?;
    if updated == bytes {
        return Ok(false);
    }

    let current = read_live_gameinfo(tf2_root)
        .map_err(|err| format!("Could not recheck gameinfo.txt before writing: {err}"))?;
    if current != bytes {
        return Err(
            "gameinfo.txt changed while the bypass was being prepared; leaving it alone.".into(),
        );
    }
    // Re-check immediately before the first write into the official file:
    // the caller's entry check can be minutes old (downloads happen between).
    refuse_if_running_among(process_sampler()).map_err(|err| err.message().to_string())?;
    // Atomic: a truncated gameinfo.txt means TF2 does not start at all.
    write_atomic_within(tf2_root, &path, &updated)
        .map_err(|err| format!("Could not write gameinfo.txt: {err}"))?;
    Ok(true)
}

// ---------------------------------------------------------------------------
// State: snapshots of patched entries
