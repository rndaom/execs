//! App-data settings. Not Tauri's reverse-domain directory.

use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};

use crate::archive::read_regular_file_bounded_within;
use crate::finder::{normalize_tf2_root, user_path_string, Tf2RootError};
use crate::hash::{validate_dir_within, write_atomic_within};

pub const SETTINGS_SCHEMA: u32 = 1;
const MAX_SETTINGS_BYTES: usize = 64 * 1024;

/// Settings files written by earlier versions may carry keys this struct does
/// not have, such as `inheritBinds`. Unknown keys are ignored, so they load.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Settings {
    pub schema: u32,
    #[serde(rename = "tf2Root")]
    pub tf2_root: String,
}

/// Windows `%AppData%\execs`, Linux `~/.local/share/execs` (or `$XDG_DATA_HOME/execs`).
///
/// On Windows an unset or relative `%APPDATA%` is an error, not a fallback:
/// the old relative `AppData\execs` silently created a second, invisible
/// profile library next to whatever the process CWD happened to be.
pub fn execs_data_dir() -> PathBuf {
    #[cfg(windows)]
    {
        try_execs_data_dir().expect("APPDATA is not set, so there is no execs data directory")
    }
    #[cfg(not(windows))]
    {
        try_execs_data_dir()
            .expect("XDG_DATA_HOME and HOME do not provide an absolute execs data directory")
    }
}

/// Fallible form of [`execs_data_dir`]. Refuses a missing/relative platform
/// base instead of silently creating a library beneath the process CWD.
pub fn try_execs_data_dir() -> Result<PathBuf, String> {
    #[cfg(windows)]
    {
        data_dir_from_appdata(std::env::var_os("APPDATA"))
    }
    #[cfg(not(windows))]
    {
        linux_data_dir_from_env(std::env::var_os("XDG_DATA_HOME"), std::env::var_os("HOME"))
    }
}

#[cfg(not(windows))]
fn linux_data_dir_from_env(
    xdg_data_home: Option<std::ffi::OsString>,
    home: Option<std::ffi::OsString>,
) -> Result<PathBuf, String> {
    if let Some(xdg) = xdg_data_home {
        let path = PathBuf::from(xdg);
        // The XDG Base Directory specification requires an absolute path;
        // empty and relative values are invalid and must be ignored.
        if path.is_absolute() {
            return Ok(path.join("execs"));
        }
    }
    if let Some(home) = home {
        let path = PathBuf::from(home);
        if path.is_absolute() {
            return Ok(path.join(".local/share/execs"));
        }
    }
    Err(
        "XDG_DATA_HOME and HOME are unset or relative, so execs cannot find its settings and profile library."
            .into(),
    )
}

#[cfg(windows)]
fn data_dir_from_appdata(appdata: Option<std::ffi::OsString>) -> Result<PathBuf, String> {
    if let Some(value) = appdata {
        let path = PathBuf::from(value);
        if path.is_absolute() {
            return Ok(path.join("execs"));
        }
    }
    Err(
        "%APPDATA% is unset or relative, so execs cannot find its settings and profile library."
            .to_string(),
    )
}

pub fn settings_file() -> PathBuf {
    execs_data_dir().join("settings.json")
}

pub fn load_settings_from(file: &Path) -> Option<Settings> {
    let parent = file.parent()?;
    let bytes =
        read_regular_file_bounded_within(parent, file, MAX_SETTINGS_BYTES as u64).ok()??;
    let text = String::from_utf8(bytes).ok()?;
    let settings: Settings = serde_json::from_str(&text).ok()?;
    if settings.schema != SETTINGS_SCHEMA || settings.tf2_root.is_empty() {
        return None;
    }
    Some(settings)
}

pub fn save_settings_to(file: &Path, settings: &Settings) -> Result<(), String> {
    let json = serde_json::to_string_pretty(settings).map_err(|e| e.to_string())?;
    // Atomic: a truncated settings.json reads as "no TF2 folder confirmed"
    // and sends the user back through first run.
    let parent = file
        .parent()
        .ok_or_else(|| "The settings path has no parent directory.".to_string())?;
    match std::fs::symlink_metadata(parent) {
        Err(err) if err.kind() == std::io::ErrorKind::NotFound => {
            // Create only the final app directory. A concurrent link at that
            // name makes create_dir fail or the validation below reject it;
            // linked platform bases (relocated AppData/XDG) remain supported.
            std::fs::create_dir(parent).map_err(|err| err.to_string())?;
        }
        Err(err) => return Err(err.to_string()),
        Ok(_) => {}
    }
    validate_dir_within(parent, parent).map_err(|e| e.to_string())?;
    write_atomic_within(parent, file, format!("{json}\n").as_bytes()).map_err(|e| e.to_string())
}

/// Re-validates `steam.inf`. A moved or non-440 root is treated as unconfirmed.
pub fn remembered_tf2_root_from(file: &Path) -> Option<PathBuf> {
    let mut settings = load_settings_from(file)?;
    let valid = normalize_tf2_root(Path::new(&settings.tf2_root)).ok()?;
    let cleaned = user_path_string(&valid);
    if settings.tf2_root != cleaned {
        settings.tf2_root = cleaned;
        // Settings writes are allowed while TF2 is open. A read-only settings
        // file must not make an otherwise valid remembered install disappear.
        let _ = save_settings_to(file, &settings);
    }
    Some(valid)
}

pub fn remember_tf2_root_to(file: &Path, root: &Path) -> Result<PathBuf, Tf2RootError> {
    let valid = normalize_tf2_root(root)?;
    let settings = Settings {
        schema: SETTINGS_SCHEMA,
        tf2_root: user_path_string(&valid),
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
    use std::fs;
    use std::io::Write;

    fn write_tf2(root: &Path) {
        let inf = root.join("tf").join("steam.inf");
        fs::create_dir_all(inf.parent().unwrap()).unwrap();
        let mut file = fs::File::create(inf).unwrap();
        file.write_all(b"appID=440\n").unwrap();
    }

    #[cfg(windows)]
    #[test]
    fn data_dir_refuses_an_unset_appdata() {
        // The old fallback silently built `./AppData/execs` next to whatever
        // the process CWD happened to be — a second, invisible profile library.
        assert!(data_dir_from_appdata(None).is_err());
        assert!(data_dir_from_appdata(Some(std::ffi::OsString::new())).is_err());
        assert!(data_dir_from_appdata(Some(std::ffi::OsString::from("relative"))).is_err());
        assert_eq!(
            data_dir_from_appdata(Some(std::ffi::OsString::from(r"D:\Roaming"))).unwrap(),
            PathBuf::from(r"D:\Roaming").join("execs")
        );
    }

    #[test]
    fn round_trip_and_reject_stale_root() {
        let dir = crate::test_temp_dir();
        let root = dir.join("Team Fortress 2");
        write_tf2(&root);
        let file = dir.join("execs").join("settings.json");

        let stored = remember_tf2_root_to(&file, &root).unwrap();
        assert_eq!(
            remembered_tf2_root_from(&file).as_deref(),
            Some(stored.as_path())
        );

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

    #[cfg(not(windows))]
    #[test]
    fn linux_data_dir_requires_an_absolute_base() {
        use std::ffi::OsString;

        assert!(linux_data_dir_from_env(None, None).is_err());
        assert!(linux_data_dir_from_env(Some(OsString::new()), None).is_err());
        assert!(linux_data_dir_from_env(
            Some(OsString::from("relative")),
            Some(OsString::from("also-relative")),
        )
        .is_err());
        assert_eq!(
            linux_data_dir_from_env(
                Some(OsString::from("relative")),
                Some(OsString::from("/home/player")),
            )
            .unwrap(),
            PathBuf::from("/home/player/.local/share/execs")
        );
        assert_eq!(
            linux_data_dir_from_env(
                Some(OsString::from("/var/player-data")),
                Some(OsString::from("/home/player")),
            )
            .unwrap(),
            PathBuf::from("/var/player-data/execs")
        );
    }

    #[test]
    fn legacy_inherit_binds_key_is_ignored_not_fatal() {
        let dir = crate::test_temp_dir();
        fs::create_dir_all(&dir).unwrap();
        let legacy = dir.join("legacy.json");
        fs::write(
            &legacy,
            "{
  \"schema\": 1,
  \"tf2Root\": \"D:/steam\",
  \"inheritBinds\": true
}
",
        )
        .unwrap();
        let parsed = load_settings_from(&legacy).unwrap();
        assert_eq!(parsed.tf2_root, "D:/steam");
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn settings_read_accepts_the_limit_and_rejects_one_byte_more() {
        let dir = crate::test_temp_dir();
        fs::create_dir_all(&dir).unwrap();
        let file = dir.join("settings.json");
        let mut json = br#"{"schema":1,"tf2Root":"D:/steam"}"#.to_vec();
        json.resize(MAX_SETTINGS_BYTES, b' ');
        fs::write(&file, &json).unwrap();
        assert_eq!(load_settings_from(&file).unwrap().tf2_root, "D:/steam");

        json.push(b' ');
        fs::write(&file, &json).unwrap();
        assert!(load_settings_from(&file).is_none());
        let _ = fs::remove_dir_all(&dir);
    }

    #[cfg(windows)]
    #[test]
    fn remembered_root_migrates_legacy_verbatim_settings() {
        let dir = crate::test_temp_dir();
        let root = dir.join("Team Fortress 2");
        write_tf2(&root);
        let file = dir.join("execs").join("settings.json");
        let legacy = format!(r"\\?\{}", root.display());
        save_settings_to(
            &file,
            &Settings {
                schema: SETTINGS_SCHEMA,
                tf2_root: legacy,
            },
        )
        .unwrap();

        assert_eq!(
            remembered_tf2_root_from(&file).as_deref(),
            Some(root.as_path())
        );
        let migrated = load_settings_from(&file).unwrap();
        assert_eq!(migrated.tf2_root, root.to_string_lossy());
        assert!(!fs::read_to_string(&file).unwrap().contains(r"\\?\"));
        let _ = fs::remove_dir_all(&dir);
    }
}
