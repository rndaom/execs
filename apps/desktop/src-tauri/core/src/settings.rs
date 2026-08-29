//! App-data settings. Not Tauri's reverse-domain directory.

use std::fs;
use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};

use crate::finder::{normalize_tf2_root, Tf2RootError};

pub const SETTINGS_SCHEMA: u32 = 1;

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Settings {
    pub schema: u32,
    #[serde(rename = "tf2Root")]
    pub tf2_root: String,
}

/// Windows `%AppData%\execs`, Linux `~/.local/share/execs` (or `$XDG_DATA_HOME/execs`).
pub fn execs_data_dir() -> PathBuf {
    #[cfg(windows)]
    {
        let appdata = std::env::var_os("APPDATA").unwrap_or_else(|| "AppData".into());
        PathBuf::from(appdata).join("execs")
    }
    #[cfg(not(windows))]
    {
        if let Some(xdg) = std::env::var_os("XDG_DATA_HOME") {
            return PathBuf::from(xdg).join("execs");
        }
        let home = std::env::var_os("HOME").unwrap_or_else(|| ".".into());
        PathBuf::from(home).join(".local/share/execs")
    }
}

pub fn settings_file() -> PathBuf {
    execs_data_dir().join("settings.json")
}

pub fn load_settings_from(file: &Path) -> Option<Settings> {
    let text = fs::read_to_string(file).ok()?;
    let settings: Settings = serde_json::from_str(&text).ok()?;
    if settings.schema != SETTINGS_SCHEMA || settings.tf2_root.is_empty() {
        return None;
    }
    Some(settings)
}

pub fn save_settings_to(file: &Path, settings: &Settings) -> Result<(), String> {
    if let Some(parent) = file.parent() {
        fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    let json = serde_json::to_string_pretty(settings).map_err(|e| e.to_string())?;
    fs::write(file, format!("{json}\n")).map_err(|e| e.to_string())
}

/// Re-validates `steam.inf`. A moved or non-440 root is treated as unconfirmed.
pub fn remembered_tf2_root_from(file: &Path) -> Option<PathBuf> {
    let settings = load_settings_from(file)?;
    normalize_tf2_root(Path::new(&settings.tf2_root)).ok()
}

pub fn remember_tf2_root_to(file: &Path, root: &Path) -> Result<PathBuf, Tf2RootError> {
    let valid = normalize_tf2_root(root)?;
    let settings = Settings {
        schema: SETTINGS_SCHEMA,
        tf2_root: valid.to_string_lossy().into_owned(),
    };
    save_settings_to(file, &settings).map_err(Tf2RootError::Io)?;
    Ok(valid)
}

pub fn remembered_tf2_root() -> Option<PathBuf> {
    remembered_tf2_root_from(&settings_file())
}

pub fn remember_tf2_root(root: &Path) -> Result<PathBuf, Tf2RootError> {
    remember_tf2_root_to(&settings_file(), root)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;

    fn write_tf2(root: &Path) {
        let inf = root.join("tf").join("steam.inf");
        fs::create_dir_all(inf.parent().unwrap()).unwrap();
        let mut file = fs::File::create(inf).unwrap();
        file.write_all(b"appID=440\n").unwrap();
    }

    #[test]
    fn round_trip_and_reject_stale_root() {
        let dir = crate::test_temp_dir();
        let root = dir.join("Team Fortress 2");
        write_tf2(&root);
        let file = dir.join("execs").join("settings.json");

        let stored = remember_tf2_root_to(&file, &root).unwrap();
        assert_eq!(remembered_tf2_root_from(&file).as_deref(), Some(stored.as_path()));

        let parsed = load_settings_from(&file).unwrap();
        assert_eq!(parsed.schema, 1);
        assert!(parsed.tf2_root.contains("Team Fortress 2"));

        fs::remove_file(root.join("tf").join("steam.inf")).unwrap();
        assert_eq!(remembered_tf2_root_from(&file), None);
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn data_dir_uses_spec_paths() {
        let dir = execs_data_dir();
        assert!(dir.ends_with("execs"));
    }
}
