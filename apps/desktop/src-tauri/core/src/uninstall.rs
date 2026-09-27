//! How this copy of execs was installed, and the opt-in app-data removal that
//! can precede uninstalling it. Nothing here touches TF2 or Steam folders.

use std::fs;
use std::io;
use std::path::{Path, PathBuf};

use serde::Serialize;

use crate::hash::{metadata_is_link, remove_file_force_within, remove_tree_within};

/// The deb package name Tauri derives from `productName`.
pub const DEB_PACKAGE: &str = "execs";

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum InstallKind {
    /// The NSIS uninstaller registered for this user sits beside this exe.
    #[serde(rename_all = "camelCase")]
    WindowsInstaller { uninstaller: String },
    /// Running from an AppImage; only that one file is the app.
    #[serde(rename_all = "camelCase")]
    AppImage { path: String },
    /// Installed by dpkg; removal needs the system package manager.
    #[serde(rename_all = "camelCase")]
    Deb { package: String },
    /// A development build or a copy execs cannot identify.
    Unmanaged,
}

/// `"C:\...\uninstall.exe"` with or without quotes; anything else is refused.
pub fn parse_uninstall_string(value: &str) -> Option<PathBuf> {
    let trimmed = value.trim();
    let unquoted = trimmed
        .strip_prefix('"')
        .and_then(|rest| rest.strip_suffix('"'))
        .unwrap_or(trimmed);
    if unquoted.contains('"') {
        return None;
    }
    let path = PathBuf::from(unquoted);
    let name = path.file_name()?.to_string_lossy().to_ascii_lowercase();
    (path.is_absolute() && name == "uninstall.exe").then_some(path)
}

fn same_directory(a: &Path, b: &Path) -> bool {
    match (
        a.parent().map(fs::canonicalize),
        b.parent().map(fs::canonicalize),
    ) {
        (Some(Ok(a)), Some(Ok(b))) => {
            if cfg!(windows) {
                a.to_string_lossy().to_lowercase() == b.to_string_lossy().to_lowercase()
            } else {
                a == b
            }
        }
        _ => false,
    }
}

fn is_regular_file(path: &Path) -> bool {
    fs::symlink_metadata(path).is_ok_and(|meta| meta.is_file() && !metadata_is_link(&meta))
}

/// Accept the registered uninstaller only when it belongs to this exe's folder.
pub fn verified_uninstaller(uninstall_string: &str, current_exe: &Path) -> Option<PathBuf> {
    let uninstaller = parse_uninstall_string(uninstall_string)?;
    (is_regular_file(&uninstaller) && same_directory(&uninstaller, current_exe))
        .then_some(uninstaller)
}

#[cfg(windows)]
fn registered_uninstall_string() -> Option<String> {
    use winreg::enums::HKEY_CURRENT_USER;
    use winreg::RegKey;
    RegKey::predef(HKEY_CURRENT_USER)
        .open_subkey(r"Software\Microsoft\Windows\CurrentVersion\Uninstall\execs")
        .ok()?
        .get_value::<String, _>("UninstallString")
        .ok()
}

/// An AppImage sets `$APPIMAGE` to its own absolute path.
pub fn verified_appimage(appimage: Option<&std::ffi::OsStr>) -> Option<PathBuf> {
    let path = PathBuf::from(appimage?);
    (path.is_absolute() && is_regular_file(&path)).then_some(path)
}

/// dpkg lists every file a package installed, one absolute path per line.
pub fn deb_owns(list_text: &str, current_exe: &Path) -> bool {
    let exe = current_exe.to_string_lossy();
    list_text.lines().any(|line| line.trim() == exe)
}

pub fn detect_install(current_exe: &Path) -> InstallKind {
    #[cfg(windows)]
    {
        if let Some(uninstaller) = registered_uninstall_string()
            .and_then(|value| verified_uninstaller(&value, current_exe))
        {
            return InstallKind::WindowsInstaller {
                uninstaller: uninstaller.to_string_lossy().to_string(),
            };
        }
        InstallKind::Unmanaged
    }
    #[cfg(not(windows))]
    {
        if let Some(path) = verified_appimage(std::env::var_os("APPIMAGE").as_deref()) {
            return InstallKind::AppImage {
                path: path.to_string_lossy().to_string(),
            };
        }
        let list = format!("/var/lib/dpkg/info/{DEB_PACKAGE}.list");
        if crate::hash::read_small_text_bounded(Path::new(&list), 1024 * 1024)
            .is_ok_and(|text| deb_owns(&text, current_exe))
        {
            return InstallKind::Deb {
                package: DEB_PACKAGE.into(),
            };
        }
        InstallKind::Unmanaged
    }
}

/// Remove everything in the data directory, entry by entry, without following
/// links. Callers must first make sure no preloader snapshot is still needed.
/// Returns the data-dir-relative entries that could not be removed.
pub fn delete_app_data(data_dir: &Path) -> io::Result<Vec<String>> {
    let mut failed = Vec::new();
    let entries = match fs::read_dir(data_dir) {
        Ok(entries) => entries,
        Err(err) if err.kind() == io::ErrorKind::NotFound => return Ok(failed),
        Err(err) => return Err(err),
    };
    for entry in entries {
        let path = entry?.path();
        let removed = match fs::symlink_metadata(&path) {
            Ok(meta) if metadata_is_link(&meta) => {
                fs::remove_file(&path).or_else(|_| fs::remove_dir(&path))
            }
            Ok(meta) if meta.is_dir() => remove_tree_within(data_dir, &path),
            Ok(_) => remove_file_force_within(data_dir, &path),
            Err(err) => Err(err),
        };
        if removed.is_err() {
            failed.push(
                path.file_name()
                    .map(|name| name.to_string_lossy().to_string())
                    .unwrap_or_default(),
            );
        }
    }
    failed.sort();
    Ok(failed)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_only_an_absolute_uninstaller_path() {
        let path = if cfg!(windows) {
            r"C:\Users\Me\AppData\Local\execs\uninstall.exe"
        } else {
            "/opt/execs/uninstall.exe"
        };
        assert_eq!(
            parse_uninstall_string(&format!("\"{path}\"")),
            Some(PathBuf::from(path))
        );
        assert_eq!(parse_uninstall_string(path), Some(PathBuf::from(path)));
        assert_eq!(parse_uninstall_string("uninstall.exe"), None);
        assert_eq!(parse_uninstall_string(&format!("\"{path}\" /S")), None);
        assert_eq!(
            parse_uninstall_string(&path.replace("uninstall", "other")),
            None
        );
    }

    #[test]
    fn the_uninstaller_must_sit_beside_this_exe() {
        let dir = crate::test_temp_dir();
        let install = dir.join("execs");
        fs::create_dir_all(&install).unwrap();
        fs::write(install.join("uninstall.exe"), b"MZ").unwrap();
        fs::write(install.join("execs.exe"), b"MZ").unwrap();
        let registered = format!("\"{}\"", install.join("uninstall.exe").display());
        assert!(verified_uninstaller(&registered, &install.join("execs.exe")).is_some());
        let dev = dir.join("target").join("execs.exe");
        fs::create_dir_all(dev.parent().unwrap()).unwrap();
        fs::write(&dev, b"MZ").unwrap();
        assert!(verified_uninstaller(&registered, &dev).is_none());
        fs::remove_file(install.join("uninstall.exe")).unwrap();
        assert!(verified_uninstaller(&registered, &install.join("execs.exe")).is_none());
        fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn appimage_and_deb_evidence_must_match_real_files() {
        let dir = crate::test_temp_dir();
        let image = dir.join("execs.AppImage");
        fs::write(&image, b"\x7fELF").unwrap();
        assert_eq!(
            verified_appimage(Some(image.as_os_str())),
            Some(image.clone())
        );
        assert_eq!(
            verified_appimage(Some(std::ffi::OsStr::new("relative"))),
            None
        );
        assert_eq!(verified_appimage(None), None);
        assert!(deb_owns(
            "/usr/share/doc/execs\n/usr/bin/execs\n",
            Path::new("/usr/bin/execs")
        ));
        assert!(!deb_owns(
            "/usr/bin/execs-other\n",
            Path::new("/usr/bin/execs")
        ));
        fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn deleting_app_data_empties_only_the_data_directory() {
        let dir = crate::test_temp_dir();
        let data = dir.join("execs");
        let outside = dir.join("outside.txt");
        fs::write(&outside, b"keep").unwrap();
        fs::create_dir_all(data.join("profiles/a")).unwrap();
        fs::write(data.join("profiles/a/manifest.json"), b"{}").unwrap();
        fs::write(data.join("settings.json"), b"{}").unwrap();
        assert!(delete_app_data(&data).unwrap().is_empty());
        assert_eq!(fs::read_dir(&data).unwrap().count(), 0);
        assert!(outside.is_file());
        assert!(delete_app_data(&dir.join("absent")).unwrap().is_empty());
        fs::remove_dir_all(dir).unwrap();
    }
}
