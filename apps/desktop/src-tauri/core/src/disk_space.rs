//! Free space checks before large writes, and one plain message for a full disk.
//!
//! Only the volume holding the path is asked (`GetDiskFreeSpaceExW` or
//! `statvfs`), never every mount, so an unreachable network mount elsewhere
//! cannot stall a switch.
//!
//! A switch, import or install that runs out of space partway leaves work to
//! recover, and retrying on the same full drive fails the same way. Checking
//! first refuses early with the drive, what is needed and what is free. The
//! estimate includes headroom for the temporary part files every atomic write
//! makes; an operation that still hits a full disk gets the same wording.

use std::path::{Path, PathBuf};

use crate::profile::ProfileError;

/// Room left beyond the estimate, for part files, journals and the OS.
pub const HEADROOM_BYTES: u64 = 64 * 1024 * 1024;

/// What a player reads when the operating system reports a full disk. It
/// makes no claim about what else changed: a write can fail after earlier
/// steps, and [`disk_full_message`] keeps any recovery step the error named.
pub const DISK_FULL_MESSAGE: &str = "The drive is full. Free some space on it, then try again.";

/// The plain full-disk sentence for an out-of-space `original` error, followed
/// by the recovery step it carried (a switch stopped after its Remove step
/// must still say to re-apply a profile).
pub fn disk_full_message(original: &str) -> String {
    if original.contains(crate::switch::MID_SWITCH_GUIDANCE) {
        format!("{DISK_FULL_MESSAGE} {}", crate::switch::MID_SWITCH_GUIDANCE)
    } else {
        DISK_FULL_MESSAGE.to_string()
    }
}

#[cfg(test)]
thread_local! {
    static AVAILABLE_OVERRIDE: std::cell::Cell<Option<u64>> = const { std::cell::Cell::new(None) };
}

/// Pretend every drive has `bytes` free on this thread (tests only).
#[cfg(test)]
pub fn set_available_override(bytes: Option<u64>) {
    AVAILABLE_OVERRIDE.with(|cell| cell.set(bytes));
}

/// The drive holding `path` and its free bytes, or `None` when unknown.
pub fn available_bytes(path: &Path) -> Option<(String, u64)> {
    #[cfg(test)]
    if let Some(bytes) = AVAILABLE_OVERRIDE.with(std::cell::Cell::get) {
        return Some((drive_label(path, Path::new("/")), bytes));
    }
    let target = existing_ancestor(path)?;
    let free = free_bytes(&target)?;
    Some((drive_label(&target, &target), free))
}

#[cfg(windows)]
fn free_bytes(path: &Path) -> Option<u64> {
    let mut available = 0u64;
    let wide = windows::core::HSTRING::from(path.as_os_str());
    // SAFETY: a valid wide path and one out-pointer; the other totals are not requested.
    unsafe {
        windows::Win32::Storage::FileSystem::GetDiskFreeSpaceExW(
            &wide,
            Some(&mut available),
            None,
            None,
        )
    }
    .ok()?;
    Some(available)
}

#[cfg(unix)]
#[allow(clippy::unnecessary_cast)] // statvfs field widths differ between platforms.
fn free_bytes(path: &Path) -> Option<u64> {
    use std::os::unix::ffi::OsStrExt;
    let c_path = std::ffi::CString::new(path.as_os_str().as_bytes()).ok()?;
    let mut stat = std::mem::MaybeUninit::<libc::statvfs>::uninit();
    // SAFETY: a NUL-terminated path and a buffer statvfs fills on success.
    if unsafe { libc::statvfs(c_path.as_ptr(), stat.as_mut_ptr()) } != 0 {
        return None;
    }
    // SAFETY: statvfs returned 0, so the buffer is initialized.
    let stat = unsafe { stat.assume_init() };
    Some((stat.f_bavail as u64).saturating_mul(stat.f_frsize as u64))
}

/// The nearest existing folder, canonicalized so links resolve to their volume.
fn existing_ancestor(path: &Path) -> Option<PathBuf> {
    let mut current = Some(path);
    while let Some(candidate) = current {
        if let Ok(resolved) = std::fs::canonicalize(candidate) {
            return Some(strip_verbatim(resolved));
        }
        current = candidate.parent();
    }
    None
}

/// `\\?\H:\…` → `H:\…`, so the drive letter reads plainly in messages.
fn strip_verbatim(path: PathBuf) -> PathBuf {
    let text = path.to_string_lossy();
    match text.strip_prefix(r"\\?\") {
        Some(rest) if !rest.starts_with("UNC\\") => PathBuf::from(rest),
        _ => path,
    }
}

/// `H:` on Windows, otherwise the drive holding the folder.
fn drive_label(path: &Path, folder: &Path) -> String {
    let text = path.to_string_lossy();
    let bytes = text.as_bytes();
    if bytes.len() >= 2 && bytes[1] == b':' && bytes[0].is_ascii_alphabetic() {
        return text[..2].to_ascii_uppercase();
    }
    format!("the drive holding {}", folder.display())
}

/// Sizes the way players read them: "1.2 GB", "300 MB".
pub fn readable_size(bytes: u64) -> String {
    const MIB: f64 = 1024.0 * 1024.0;
    let mib = bytes as f64 / MIB;
    if mib >= 1024.0 {
        format!("{:.1} GB", mib / 1024.0)
    } else {
        format!("{} MB", mib.ceil() as u64)
    }
}

/// Refuse when the drive holding `path` has less than `needed` plus headroom
/// free. Unknown free space never blocks the write.
pub fn ensure_space(path: &Path, needed: u64) -> Result<(), ProfileError> {
    let Some((drive, available)) = available_bytes(path) else {
        return Ok(());
    };
    let wanted = needed.saturating_add(HEADROOM_BYTES);
    if available >= wanted {
        return Ok(());
    }
    Err(ProfileError::NotEnoughSpace(format!(
        "Not enough space on {drive} (needs {}, {} free). Free some space, then try again.",
        readable_size(wanted),
        readable_size(available)
    )))
}

/// True for the operating system's out-of-space errors on Windows and Linux.
pub fn is_disk_full_error(message: &str) -> bool {
    let lower = message.to_ascii_lowercase();
    // Windows ERROR_DISK_FULL and ERROR_HANDLE_DISK_FULL, Linux ENOSPC.
    lower.contains("os error 112)")
        || lower.contains("os error 39)")
        || lower.contains("os error 28)")
        || lower.contains("no space left on device")
        || lower.contains("not enough space on the disk")
        || lower.contains("storagefull")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn refuses_with_the_drive_what_is_needed_and_what_is_free() {
        set_available_override(Some(300 * 1024 * 1024));
        let error = ensure_space(Path::new("H:/SteamLibrary"), 1_200 * 1024 * 1024).unwrap_err();
        assert_eq!(
            error.message(),
            "Not enough space on H: (needs 1.2 GB, 300 MB free). Free some space, then try again."
        );
        assert!(ensure_space(Path::new("H:/SteamLibrary"), 100 * 1024 * 1024).is_ok());
        set_available_override(None);
    }

    #[test]
    fn a_switch_on_a_nearly_full_drive_refuses_before_removing_anything() {
        let dir = crate::test_temp_dir();
        let profiles = dir.join("execs").join("profiles");
        let root = dir.join("Team Fortress 2");
        std::fs::create_dir_all(root.join("tf/cfg")).unwrap();
        std::fs::create_dir_all(root.join("tf/custom/pack")).unwrap();
        std::fs::write(root.join("tf/steam.inf"), "appID=440\n").unwrap();
        std::fs::write(root.join("tf/cfg/config.cfg"), "bind w +forward\n").unwrap();
        std::fs::write(root.join("tf/custom/pack/a.txt"), "installed").unwrap();
        let unlocked = ["explorer.exe"];
        let low = crate::profile::save_current_as_to(
            &profiles,
            &root,
            "Low",
            unlocked,
            crate::profile::SaveCurrentOptions::default(),
        )
        .unwrap()
        .profiles[0]
            .id
            .clone();
        let other = crate::profile::create_profile_record_to(&profiles, &root, "Other", unlocked)
            .unwrap()
            .profiles
            .into_iter()
            .find(|profile| profile.id != low)
            .unwrap()
            .id;
        let switch = || {
            crate::switch::switch_profile_to(
                &profiles,
                &root,
                &other,
                unlocked,
                crate::absorb::AbsorbOptions::default(),
                |_| {},
            )
        };
        set_available_override(Some(1024 * 1024));
        let refused = switch().unwrap_err();
        set_available_override(None);
        assert!(
            matches!(refused, ProfileError::NotEnoughSpace(_)),
            "{refused:?}"
        );
        assert!(refused.message().starts_with("Not enough space on "));
        // Nothing was removed and the installed profile is still active.
        assert!(root.join("tf/custom/pack/a.txt").is_file());
        let library = crate::profile::load_library_from(&profiles, Some(&root)).unwrap();
        assert_eq!(library.active_profile_id.as_deref(), Some(low.as_str()));
        assert!(library.pending_switch_profile_id.is_none());
        assert!(switch().is_ok());
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn reads_the_real_free_space_of_an_existing_folder() {
        let dir = crate::test_temp_dir();
        std::fs::create_dir_all(&dir).unwrap();
        let (_, free) = available_bytes(&dir.join("not-created-yet")).unwrap();
        assert!(free > 0);
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn recognises_full_disk_errors() {
        assert!(is_disk_full_error(
            "There is not enough space on the disk. (os error 112)"
        ));
        assert!(is_disk_full_error("No space left on device (os error 28)"));
        assert!(!is_disk_full_error("Access is denied. (os error 5)"));
        assert!(!is_disk_full_error("os error 2800"));
        assert!(!is_disk_full_error("Unexpected failure (os error 1120)"));
        assert!(is_disk_full_error("The disk is full. (os error 39)"));
    }

    #[test]
    fn a_full_disk_mid_switch_keeps_the_re_apply_step() {
        let mid_switch = format!(
            "Could not write tf/custom/pack.vpk: There is not enough space on the disk. (os error 112) {}",
            crate::switch::MID_SWITCH_GUIDANCE
        );
        let message = disk_full_message(&mid_switch);
        assert!(message.starts_with(DISK_FULL_MESSAGE));
        assert!(message.ends_with(crate::switch::MID_SWITCH_GUIDANCE));
        assert!(!message.contains("Nothing else was changed"));
        assert_eq!(
            disk_full_message("No space left on device (os error 28)"),
            DISK_FULL_MESSAGE
        );
    }
}
