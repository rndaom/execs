//! The reversible `gameinfo.txt` bypass: comment the `type multiplayer_only`
//! line out and back in, byte-preserving everything else, with a pristine copy
//! kept in app data.

use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};

use crate::process_lock::refuse_if_running_among;

use super::state::preloader_dir;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct GameinfoBypass {
    pub found: bool,
    pub enabled: bool,
}

pub(crate) fn gameinfo_path(tf2_root: &Path) -> PathBuf {
    tf2_root.join("tf").join("gameinfo.txt")
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

pub(crate) fn line_has(line: &[u8], needle: &[u8]) -> bool {
    line.windows(needle.len()).any(|window| window == needle)
}

pub(crate) fn find_bytes(haystack: &[u8], needle: &[u8]) -> Option<usize> {
    if needle.is_empty() || haystack.len() < needle.len() {
        return None;
    }
    haystack
        .windows(needle.len())
        .position(|window| window == needle)
}

/// Where the `type` key sits on a `type multiplayer_only` line, and whether a
/// `//` opens *before* it (the only comment that actually disables the key).
///
/// A `//` anywhere else on the line is a trailing annotation — it must never
/// be read as "the bypass is on", and revert must never strip it.
pub(crate) fn gameinfo_type_line(line: &[u8]) -> Option<(usize, bool)> {
    if !line_has(line, b"multiplayer_only") {
        return None;
    }
    let pos_type = find_bytes(line, b"type")?;
    let commented = find_bytes(line, b"//").is_some_and(|pos| pos < pos_type);
    Some((pos_type, commented))
}

/// Whether the `type multiplayer_only` line is currently commented out.
pub fn gameinfo_bypass_state(tf2_root: &Path) -> Result<GameinfoBypass, String> {
    let path = gameinfo_path(tf2_root);
    let Ok(bytes) = std::fs::read(&path) else {
        return Ok(GameinfoBypass {
            found: false,
            enabled: false,
        });
    };
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
    let backup = gameinfo_backup_path(data_dir);
    let stale = match std::fs::read(&backup) {
        Ok(existing) => existing != bytes && !currently_enabled,
        Err(_) => true,
    };
    if !stale {
        return Ok(());
    }
    std::fs::create_dir_all(preloader_dir(data_dir))
        .map_err(|err| format!("Could not prepare the preloader folder: {err}"))?;
    std::fs::write(&backup, bytes).map_err(|err| format!("Could not back up gameinfo.txt: {err}"))
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
    refuse_if_running_among(running_names).map_err(|err| err.message().to_string())?;
    let backup = gameinfo_backup_path(data_dir);
    let Ok(pristine) = std::fs::read(&backup) else {
        return Ok(false);
    };
    if find_bytes(&pristine, b"\"GameInfo\"").is_none() {
        return Err(
            "The gameinfo.txt backup is not a GameInfo file; refusing to restore from it. \
             Verify game files in Steam to get the stock file back."
                .into(),
        );
    }
    let path = gameinfo_path(tf2_root);
    if std::fs::read(&path).is_ok_and(|current| current == pristine) {
        return Ok(false);
    }
    // Re-check right before the write into the official file.
    refuse_if_running_among(running_names).map_err(|err| err.message().to_string())?;
    // Atomic: a truncated gameinfo.txt means TF2 does not start at all.
    crate::hash::write_atomic(&path, &pristine)
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
    refuse_if_running_among(running_names).map_err(|err| err.message().to_string())?;
    let path = gameinfo_path(tf2_root);
    let bytes =
        std::fs::read(&path).map_err(|err| format!("Could not read gameinfo.txt: {err}"))?;

    let currently_enabled = split_lines_inclusive(&bytes)
        .iter()
        .find_map(|line| gameinfo_type_line(line))
        .is_some_and(|(_, commented)| commented);
    refresh_gameinfo_backup(data_dir, &bytes, currently_enabled)?;

    let mut lines = split_lines_inclusive(&bytes);
    let mut changed = false;
    for line in &mut lines {
        if gameinfo_type_line(line).is_none() {
            continue;
        }
        // Only the first matching line is ours; a commented example line
        // further down must stay exactly as the game shipped it.
        changed = toggle_type_line(line, enabled);
        break;
    }
    if !changed {
        return Ok(false);
    }

    // Re-check immediately before the first write into the official file:
    // the caller's entry check can be minutes old (downloads happen between).
    refuse_if_running_among(running_names).map_err(|err| err.message().to_string())?;
    let updated: Vec<u8> = lines.concat();
    // Atomic: a truncated gameinfo.txt means TF2 does not start at all.
    crate::hash::write_atomic(&path, &updated)
        .map_err(|err| format!("Could not write gameinfo.txt: {err}"))?;
    Ok(true)
}

// ---------------------------------------------------------------------------
// State: snapshots of patched entries
