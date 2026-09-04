//! Scan Steam libraries and confirm a TF2 root via `tf/steam.inf` app 440.

use std::collections::HashSet;
use std::fs;
use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};

use crate::hash::{metadata_is_link, read_small_text_bounded};
use crate::steam_inf::steam_inf_app_id;
use crate::vdf::{installdir_from_acf, parse_vdf, steam_libraries, SteamLibrary};

const DEFAULT_INSTALLDIR: &str = "Team Fortress 2";
const TF2_APP: &str = "440";
const MAX_STEAM_INF_BYTES: usize = 64 * 1024;
const MAX_LIBRARYFOLDERS_BYTES: usize = 16 * 1024 * 1024;
const MAX_APPMANIFEST_BYTES: usize = 1024 * 1024;

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Tf2Install {
    pub path: String,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Tf2RootError {
    MissingSteamInf,
    WrongApp { app_id: String },
    InvalidPath { reason: String },
    Io(String),
}

impl Tf2RootError {
    pub fn code(&self) -> &'static str {
        match self {
            Self::MissingSteamInf => "MissingSteamInf",
            Self::WrongApp { .. } => "WrongApp",
            Self::InvalidPath { .. } => "InvalidPath",
            Self::Io(_) => "Io",
        }
    }

    pub fn message(&self) -> String {
        match self {
            Self::MissingSteamInf => {
                "That folder doesn't look like a TF2 install. Pick the Team Fortress 2 folder (it contains tf) or the tf folder itself.".into()
            }
            Self::WrongApp { app_id } => {
                format!("That install is not Team Fortress 2 (steam.inf app {app_id}, expected 440).")
            }
            Self::InvalidPath { reason } => {
                format!("That TF2 folder cannot be used safely: {reason}")
            }
            Self::Io(err) => format!("Could not write settings: {err}"),
        }
    }
}

pub fn existing_canonical(path: &Path) -> Option<PathBuf> {
    if !path.exists() {
        return None;
    }
    let canonical = path.canonicalize().unwrap_or_else(|_| path.to_path_buf());
    Some(user_path(&canonical))
}

/// Stable path form for persisted metadata and user-facing read models.
/// This is lexical so legacy metadata can be cleaned without touching disk.
pub(crate) fn user_path(path: &Path) -> PathBuf {
    without_windows_verbatim_prefix(path.to_path_buf())
}

pub(crate) fn user_path_string(path: &Path) -> String {
    user_path(path).to_string_lossy().into_owned()
}

/// `std::fs::canonicalize` uses Windows' verbatim namespace (`\\?\`) even for
/// ordinary drive and UNC paths. That form is useful to the OS, but it should
/// never leak into settings, profile metadata, or the install picker.
#[cfg(windows)]
fn without_windows_verbatim_prefix(path: PathBuf) -> PathBuf {
    use std::path::{Component, Prefix};

    let Some(Component::Prefix(prefix)) = path.components().next() else {
        return path;
    };

    let mut simplified = match prefix.kind() {
        Prefix::VerbatimDisk(drive) => PathBuf::from(format!("{}:", char::from(drive))),
        Prefix::VerbatimUNC(server, share) => {
            let mut unc = PathBuf::from(r"\\");
            unc.push(server);
            unc.push(share);
            unc
        }
        _ => return path,
    };

    for component in path.components().skip(1) {
        match component {
            Component::RootDir if simplified.has_root() => {}
            Component::RootDir => simplified.push(Path::new(r"\")),
            Component::CurDir => {}
            Component::ParentDir => simplified.push(".."),
            Component::Normal(part) => simplified.push(part),
            Component::Prefix(_) => return path,
        }
    }
    simplified
}

#[cfg(not(windows))]
fn without_windows_verbatim_prefix(path: PathBuf) -> PathBuf {
    path
}

/// Accept a TF2 root or a `tf/` pick. Folder name alone is never enough.
pub fn normalize_tf2_root(picked: &Path) -> Result<PathBuf, Tf2RootError> {
    let child_inf = picked.join("tf").join("steam.inf");
    let picked_inf = picked.join("steam.inf");

    let (root, inf_path) = if child_inf.is_file() {
        (picked.to_path_buf(), child_inf)
    } else if picked_inf.is_file() {
        let parent = picked.parent().ok_or(Tf2RootError::MissingSteamInf)?;
        (parent.to_path_buf(), picked_inf)
    } else {
        return Err(Tf2RootError::MissingSteamInf);
    };

    // Resolve each boundary separately. Validating only `root` accepts a
    // decoy folder whose `tf` child is a symlink/junction to somewhere else;
    // all later live paths would then cross the confirmed-root boundary.
    let canonical_root = fs::canonicalize(&root).map_err(|_| Tf2RootError::MissingSteamInf)?;
    let tf_path = canonical_root.join("tf");
    if fs::symlink_metadata(&tf_path).is_ok_and(|meta| metadata_is_link(&meta)) {
        return Err(Tf2RootError::InvalidPath {
            reason: "its tf directory is a link or junction".into(),
        });
    }
    let canonical_tf = fs::canonicalize(&tf_path).map_err(|_| Tf2RootError::MissingSteamInf)?;
    if canonical_tf.parent() != Some(canonical_root.as_path()) {
        return Err(Tf2RootError::InvalidPath {
            reason: "its tf directory resolves outside the selected folder".into(),
        });
    }
    let canonical_inf = fs::canonicalize(&inf_path).map_err(|_| Tf2RootError::MissingSteamInf)?;
    if fs::symlink_metadata(&inf_path).is_ok_and(|meta| metadata_is_link(&meta)) {
        return Err(Tf2RootError::InvalidPath {
            reason: "tf/steam.inf is a link".into(),
        });
    }
    if canonical_inf.parent() != Some(canonical_tf.as_path()) {
        return Err(Tf2RootError::InvalidPath {
            reason: "tf/steam.inf resolves outside the tf directory".into(),
        });
    }
    if canonical_root.to_str().is_none() {
        return Err(Tf2RootError::InvalidPath {
            reason: "its path is not valid Unicode".into(),
        });
    }

    let text = read_small_text_bounded(&canonical_inf, MAX_STEAM_INF_BYTES).map_err(|err| {
        if err.kind() == std::io::ErrorKind::NotFound {
            Tf2RootError::MissingSteamInf
        } else {
            Tf2RootError::InvalidPath {
                reason: format!("tf/steam.inf cannot be read safely ({err})"),
            }
        }
    })?;
    match steam_inf_app_id(&text) {
        Some(id) if id == TF2_APP => Ok(user_path(&canonical_root)),
        Some(id) => Err(Tf2RootError::WrongApp { app_id: id }),
        None => Err(Tf2RootError::WrongApp {
            app_id: "missing".into(),
        }),
    }
}

pub fn scan_tf2_installs() -> Vec<Tf2Install> {
    scan_tf2_installs_in(&discover_steam_roots())
}

pub fn scan_tf2_installs_in(steam_roots: &[PathBuf]) -> Vec<Tf2Install> {
    let mut seen = HashSet::new();
    let mut out = Vec::new();

    for steam in steam_roots {
        let Some(steam) = existing_canonical(steam) else {
            continue;
        };
        for lib in libraries_for_steam(&steam) {
            let Some(lib_path) = existing_canonical(Path::new(&lib.path)) else {
                continue;
            };
            if !library_has_tf2(&lib, &lib_path) {
                continue;
            }
            let installdir =
                read_installdir(&lib_path).unwrap_or_else(|| DEFAULT_INSTALLDIR.into());
            let root = lib_path.join("steamapps").join("common").join(installdir);
            if let Ok(valid) = normalize_tf2_root(&root) {
                let Some(key) = valid.to_str().map(str::to_owned) else {
                    continue;
                };
                if seen.insert(key.clone()) {
                    out.push(Tf2Install { path: key });
                }
            }
        }
    }

    out.sort_by(|a, b| a.path.cmp(&b.path));
    out
}

pub fn discover_steam_roots() -> Vec<PathBuf> {
    let mut raw = Vec::new();
    #[cfg(windows)]
    raw.extend(windows_registry_steam());
    #[cfg(not(windows))]
    raw.extend(linux_steam_candidates());

    let mut seen = HashSet::new();
    let mut out = Vec::new();
    for path in raw {
        if let Some(canonical) = existing_canonical(&path) {
            if seen.insert(canonical.clone()) {
                out.push(canonical);
            }
        }
    }
    out
}

fn libraries_for_steam(steam: &Path) -> Vec<SteamLibrary> {
    let mut libs = vec![SteamLibrary {
        path: steam.to_string_lossy().into_owned(),
        apps: HashSet::new(),
    }];
    let primary = steam.join("steamapps").join("libraryfolders.vdf");
    let fallback = steam.join("config").join("libraryfolders.vdf");
    let text = read_small_text_bounded(&primary, MAX_LIBRARYFOLDERS_BYTES)
        .or_else(|_| read_small_text_bounded(&fallback, MAX_LIBRARYFOLDERS_BYTES));
    if let Ok(text) = text {
        if let Ok(map) = parse_vdf(&text) {
            libs.extend(steam_libraries(&map));
        }
    }
    libs
}

fn library_has_tf2(parsed: &SteamLibrary, lib_path: &Path) -> bool {
    parsed.apps.iter().any(|app| app == TF2_APP)
        || lib_path
            .join("steamapps")
            .join("appmanifest_440.acf")
            .is_file()
}

fn read_installdir(lib_path: &Path) -> Option<String> {
    let acf = lib_path.join("steamapps").join("appmanifest_440.acf");
    installdir_from_acf(&read_small_text_bounded(&acf, MAX_APPMANIFEST_BYTES).ok()?)
}

#[cfg(windows)]
fn windows_registry_steam() -> Vec<PathBuf> {
    use winreg::enums::*;
    use winreg::RegKey;

    let mut out = Vec::new();
    if let Ok(key) = RegKey::predef(HKEY_CURRENT_USER).open_subkey(r"Software\Valve\Steam") {
        for name in ["SteamPath", "InstallPath"] {
            if let Ok(val) = key.get_value::<String, _>(name) {
                if !val.is_empty() {
                    out.push(PathBuf::from(val));
                }
            }
        }
    }
    if let Ok(key) =
        RegKey::predef(HKEY_LOCAL_MACHINE).open_subkey(r"SOFTWARE\WOW6432Node\Valve\Steam")
    {
        if let Ok(val) = key.get_value::<String, _>("InstallPath") {
            if !val.is_empty() {
                out.push(PathBuf::from(val));
            }
        }
    }
    out
}

#[cfg(not(windows))]
fn linux_steam_candidates() -> Vec<PathBuf> {
    let mut out = Vec::new();
    if let Some(xdg) = std::env::var_os("XDG_DATA_HOME") {
        let base = PathBuf::from(xdg);
        out.push(base.join("Steam"));
        out.push(base.join("steam"));
    }
    if let Some(home) = std::env::var_os("HOME") {
        let home = PathBuf::from(home);
        out.push(home.join(".local/share/Steam"));
        out.push(home.join(".local/share/steam"));
        out.push(home.join(".steam/steam"));
        out.push(home.join(".steam/root"));
        out.push(home.join(".var/app/com.valvesoftware.Steam/data/Steam"));
        out.push(home.join("snap/steam/common/.local/share/Steam"));
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use std::io::Write;

    fn write_file(path: &Path, contents: &str) {
        if let Some(parent) = path.parent() {
            fs::create_dir_all(parent).unwrap();
        }
        let mut file = fs::File::create(path).unwrap();
        file.write_all(contents.as_bytes()).unwrap();
    }

    fn tf2_tree(root: &Path, app_id: &str) {
        write_file(
            &root.join("tf").join("steam.inf"),
            &format!("ProductName=tf\nappID={app_id}\n"),
        );
    }

    fn steam_library(lib: &Path, installdir: &str, list_in_vdf: bool) {
        let common = lib.join("steamapps").join("common").join(installdir);
        tf2_tree(&common, "440");
        write_file(
            &lib.join("steamapps").join("appmanifest_440.acf"),
            &format!(
                "\"AppState\"\n{{\n\t\"appid\"\t\t\"440\"\n\t\"installdir\"\t\t\"{installdir}\"\n}}\n"
            ),
        );
        if list_in_vdf {
            write_file(
                &lib.join("steamapps").join("libraryfolders.vdf"),
                &format!(
                    "\"libraryfolders\"\n{{\n\t\"0\"\n\t{{\n\t\t\"path\"\t\t\"{}\"\n\t\t\"apps\"\n\t\t{{\n\t\t\t\"440\"\t\t\"1\"\n\t\t}}\n\t}}\n}}\n",
                    vdf_path(lib)
                ),
            );
        }
    }

    fn vdf_path(path: &Path) -> String {
        path.to_string_lossy().replace('\u{5c}', r"\\")
    }

    fn cleanup(dir: &Path) {
        let _ = fs::remove_dir_all(dir);
    }

    #[cfg(unix)]
    fn link_dir(target: &Path, link: &Path) {
        std::os::unix::fs::symlink(target, link).unwrap();
    }

    #[cfg(windows)]
    fn link_dir(target: &Path, link: &Path) {
        let status = std::process::Command::new("cmd")
            .args(["/d", "/c", "mklink", "/j"])
            .arg(link)
            .arg(target)
            .status()
            .unwrap();
        assert!(status.success(), "could not create test junction");
    }

    #[test]
    fn normalizes_root_and_tf_folder() {
        let dir = crate::test_temp_dir();
        let root = dir.join("Team Fortress 2");
        tf2_tree(&root, "440");

        let from_root = normalize_tf2_root(&root).unwrap();
        let from_tf = normalize_tf2_root(&root.join("tf")).unwrap();
        assert_eq!(from_root, from_tf);
        assert!(from_root.ends_with("Team Fortress 2"));
        assert!(!from_root.to_string_lossy().starts_with(r"\\?\"));
        cleanup(&dir);
    }

    #[cfg(windows)]
    #[test]
    fn removes_windows_verbatim_prefixes_from_user_facing_paths() {
        assert_eq!(
            without_windows_verbatim_prefix(PathBuf::from(
                r"\\?\D:\SteamLibrary\steamapps\common\Team Fortress 2"
            )),
            PathBuf::from(r"D:\SteamLibrary\steamapps\common\Team Fortress 2")
        );
        assert_eq!(
            without_windows_verbatim_prefix(PathBuf::from(r"\\?\UNC\server\games\Team Fortress 2")),
            PathBuf::from(r"\\server\games\Team Fortress 2")
        );
    }

    #[test]
    fn rejects_wrong_app_and_missing_inf() {
        let dir = crate::test_temp_dir();
        let root = dir.join("Counter-Strike");
        tf2_tree(&root, "730");
        match normalize_tf2_root(&root) {
            Err(Tf2RootError::WrongApp { app_id }) => assert_eq!(app_id, "730"),
            other => panic!("expected WrongApp, got {other:?}"),
        }
        assert_eq!(normalize_tf2_root(&dir), Err(Tf2RootError::MissingSteamInf));
        cleanup(&dir);
    }

    #[test]
    fn rejects_oversized_steam_inf_without_loading_it() {
        let dir = crate::test_temp_dir();
        let root = dir.join("Team Fortress 2");
        let inf = root.join("tf/steam.inf");
        fs::create_dir_all(inf.parent().unwrap()).unwrap();
        fs::File::create(&inf)
            .unwrap()
            .set_len(MAX_STEAM_INF_BYTES as u64 + 1)
            .unwrap();

        let error = normalize_tf2_root(&root).unwrap_err();
        assert!(matches!(error, Tf2RootError::InvalidPath { .. }));
        assert!(
            error.message().contains("safety limit"),
            "{}",
            error.message()
        );
        cleanup(&dir);
    }

    #[test]
    fn rejects_a_tf_directory_that_resolves_outside_the_selected_root() {
        let dir = crate::test_temp_dir();
        let real = dir.join("real");
        let decoy = dir.join("decoy");
        tf2_tree(&real, "440");
        fs::create_dir_all(&decoy).unwrap();
        link_dir(&real.join("tf"), &decoy.join("tf"));

        assert!(matches!(
            normalize_tf2_root(&decoy),
            Err(Tf2RootError::InvalidPath { .. })
        ));
        cleanup(&dir);
    }

    #[cfg(unix)]
    #[test]
    fn rejects_a_root_that_cannot_round_trip_through_ipc() {
        use std::os::unix::ffi::OsStringExt;

        let dir = crate::test_temp_dir();
        let component = std::ffi::OsString::from_vec(b"tf2-\xff".to_vec());
        let root = dir.join(component);
        tf2_tree(&root, "440");

        assert!(matches!(
            normalize_tf2_root(&root),
            Err(Tf2RootError::InvalidPath { .. })
        ));
        cleanup(&dir);
    }

    #[test]
    fn scan_finds_listed_and_manifest_only_libraries() {
        let dir = crate::test_temp_dir();
        let steam = dir.join("Steam");
        let extra = dir.join("OtherLib");
        steam_library(&steam, "Team Fortress 2", true);
        steam_library(&extra, "Team Fortress 2", false);
        write_file(
            &steam.join("steamapps").join("libraryfolders.vdf"),
            &format!(
                "\"libraryfolders\"\n{{\n\t\"0\"\n\t{{\n\t\t\"path\"\t\t\"{}\"\n\t\t\"apps\"\n\t\t{{\n\t\t\t\"440\"\t\t\"1\"\n\t\t}}\n\t}}\n\t\"1\"\n\t{{\n\t\t\"path\"\t\t\"{}\"\n\t\t\"apps\"\n\t\t{{\n\t\t}}\n\t}}\n}}\n",
                vdf_path(&steam),
                vdf_path(&extra)
            ),
        );

        let found = scan_tf2_installs_in(&[steam]);
        assert_eq!(found.len(), 2);
        assert!(found.iter().all(|c| c.path.contains("Team Fortress 2")));
        cleanup(&dir);
    }

    #[test]
    fn scan_skips_library_without_440() {
        let dir = crate::test_temp_dir();
        let steam = dir.join("Steam");
        write_file(
            &steam.join("steamapps").join("libraryfolders.vdf"),
            &format!(
                "\"libraryfolders\"\n{{\n\t\"0\"\n\t{{\n\t\t\"path\"\t\t\"{}\"\n\t\t\"apps\"\n\t\t{{\n\t\t\t\"730\"\t\t\"1\"\n\t\t}}\n\t}}\n}}\n",
                steam.display()
            ),
        );
        tf2_tree(
            &steam
                .join("steamapps")
                .join("common")
                .join("Team Fortress 2"),
            "440",
        );
        assert!(scan_tf2_installs_in(&[steam]).is_empty());
        cleanup(&dir);
    }

    #[test]
    fn scan_reads_old_libraryfolders_from_config() {
        let dir = crate::test_temp_dir();
        let steam = dir.join("Steam");
        let extra = dir.join("Moved");
        steam_library(&extra, "Team Fortress 2", false);
        write_file(
            &steam.join("config").join("libraryfolders.vdf"),
            &format!(
                "\"LibraryFolders\"\n{{\n\t\"1\"\t\t\"{}\"\n}}\n",
                vdf_path(&extra)
            ),
        );
        let found = scan_tf2_installs_in(&[steam]);
        assert_eq!(found.len(), 1);
        cleanup(&dir);
    }

    #[test]
    fn oversized_steam_vdf_files_are_ignored_without_materializing_them() {
        let dir = crate::test_temp_dir();
        let steam = dir.join("Steam");
        let primary = steam.join("steamapps/libraryfolders.vdf");
        fs::create_dir_all(primary.parent().unwrap()).unwrap();
        fs::File::create(&primary)
            .unwrap()
            .set_len(MAX_LIBRARYFOLDERS_BYTES as u64 + 1)
            .unwrap();
        assert_eq!(libraries_for_steam(&steam).len(), 1);

        let manifest = steam.join("steamapps/appmanifest_440.acf");
        fs::File::create(&manifest)
            .unwrap()
            .set_len(MAX_APPMANIFEST_BYTES as u64 + 1)
            .unwrap();
        assert_eq!(read_installdir(&steam), None);
        cleanup(&dir);
    }
}
