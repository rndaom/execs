//! Scan Steam libraries and confirm a TF2 root via `tf/steam.inf` app 440.

use std::collections::HashSet;
use std::fs;
use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};

use crate::steam_inf::steam_inf_app_id;
use crate::vdf::{installdir_from_acf, parse_vdf, steam_libraries, SteamLibrary};

const DEFAULT_INSTALLDIR: &str = "Team Fortress 2";
const TF2_APP: &str = "440";

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Tf2Install {
    pub path: String,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Tf2RootError {
    MissingSteamInf,
    WrongApp { app_id: String },
    Io(String),
}

impl Tf2RootError {
    pub fn code(&self) -> &'static str {
        match self {
            Self::MissingSteamInf => "MissingSteamInf",
            Self::WrongApp { .. } => "WrongApp",
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

    let text = fs::read_to_string(&inf_path).map_err(|_| Tf2RootError::MissingSteamInf)?;
    match steam_inf_app_id(&text) {
        Some(id) if id == TF2_APP => Ok(existing_canonical(&root).unwrap_or(root)),
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
                let key = valid.to_string_lossy().into_owned();
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
    let text = fs::read_to_string(&primary).or_else(|_| fs::read_to_string(&fallback));
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
    installdir_from_acf(&fs::read_to_string(acf).ok()?)
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
}
