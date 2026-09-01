//! Read and write TF2 launch options (profile + Steam `localconfig.vdf`).

use std::fs;
use std::path::{Path, PathBuf};
use std::time::SystemTime;

use serde::{Deserialize, Serialize};

use crate::finder::discover_steam_roots;
use crate::hash::write_atomic;
use crate::process_lock::{
    current_process_os, live_process_names, refuse_if_running_among, steam_running_among, ProcessOs,
};
use crate::profile::{load_library_from, load_manifest, manifest_file, profiles_dir, ProfileError};
use crate::vdf::{parse_vdf, serialize_vdf, VdfMap, VdfValue};

const TF2_APP: &str = "440";
const STEAM_ID64_BASE: u64 = 76561197960265728;
const RECOMMENDED_LAUNCH_OPTIONS: &str = "-novid -nojoy -nosteamcontroller -nohltv -particles 1";

const LAUNCH_OPTIONS_PATH: &[&str] = &[
    "UserLocalConfigStore",
    "Software",
    "Valve",
    "Steam",
    "apps",
    "440",
    "LaunchOptions",
];

const LAUNCH_OPTIONS_PATH_FROM_STORE: &[&str] =
    &["Software", "Valve", "Steam", "apps", "440", "LaunchOptions"];

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SteamAccount {
    pub steam_root: PathBuf,
    pub account_id: String,
}

impl SteamAccount {
    pub fn localconfig(&self) -> PathBuf {
        self.steam_root
            .join("userdata")
            .join(&self.account_id)
            .join("config")
            .join("localconfig.vdf")
    }

    pub fn cloud_config(&self) -> PathBuf {
        self.steam_root
            .join("userdata")
            .join(&self.account_id)
            .join(TF2_APP)
            .join("remote")
            .join("cfg")
            .join("config.cfg")
    }
}

pub fn read_launch_options() -> String {
    read_launch_options_from(&discover_steam_roots())
}

pub fn read_launch_options_from(steam_roots: &[PathBuf]) -> String {
    let Some(account) = pick_steam_account_from(steam_roots) else {
        return String::new();
    };
    let Ok(text) = fs::read_to_string(account.localconfig()) else {
        return String::new();
    };
    let Ok(vdf) = parse_vdf(&text) else {
        return String::new();
    };
    sanitize_launch_options(&launch_options_from_localconfig(&vdf).unwrap_or_default())
}

/// Official mastercomfig recommended set. Same on Windows and Linux (no `gamemoderun`).
pub fn recommended_launch_options() -> String {
    recommended_launch_options_for(current_process_os())
}

pub fn recommended_launch_options_for(_os: ProcessOs) -> String {
    sanitize_launch_options(RECOMMENDED_LAUNCH_OPTIONS)
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum LaunchWriteReason {
    Written,
    SteamOpen,
    NoAccount,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LaunchWriteResult {
    pub written: bool,
    pub reason: LaunchWriteReason,
}

impl LaunchWriteResult {
    fn steam_open() -> Self {
        Self {
            written: false,
            reason: LaunchWriteReason::SteamOpen,
        }
    }

    fn no_account() -> Self {
        Self {
            written: false,
            reason: LaunchWriteReason::NoAccount,
        }
    }

    fn ok() -> Self {
        Self {
            written: true,
            reason: LaunchWriteReason::Written,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SetLaunchResult {
    pub launch_options: String,
    pub steam_write: LaunchWriteReason,
}

pub fn write_launch_options_to_localconfig(
    options: &str,
) -> Result<LaunchWriteResult, ProfileError> {
    write_launch_options_to_localconfig_from(&discover_steam_roots(), options, live_process_names())
}

pub fn write_launch_options_to_localconfig_from<I, S>(
    steam_roots: &[PathBuf],
    options: &str,
    steam_running_names: I,
) -> Result<LaunchWriteResult, ProfileError>
where
    I: IntoIterator<Item = S>,
    S: AsRef<str>,
{
    if steam_running_among(steam_running_names) {
        return Ok(LaunchWriteResult::steam_open());
    }
    let Some(account) = pick_steam_account_from(steam_roots) else {
        return Ok(LaunchWriteResult::no_account());
    };
    let path = account.localconfig();
    let text = fs::read_to_string(&path).map_err(|err| ProfileError::Io(err.to_string()))?;
    let mut vdf = parse_vdf(&text).map_err(ProfileError::Io)?;
    set_launch_options_in_vdf(&mut vdf, &sanitize_launch_options(options));
    let serialized = serialize_vdf(&vdf);
    // We re-emit the whole file through our own writer, so anything our parser
    // does not model would be silently corrupted. Read our own output back and
    // refuse to write unless it is the tree we meant to write. This is a
    // Steam-owned file holding every app's launch options.
    let reparsed = parse_vdf(&serialized).map_err(ProfileError::Io)?;
    if reparsed != vdf {
        return Err(ProfileError::Io(
            "Refusing to rewrite localconfig.vdf: this file uses KeyValues syntax we would not \
             round-trip intact. Set the launch options in Steam instead."
                .into(),
        ));
    }
    backup_localconfig_once(&path)?;
    write_atomic(&path, serialized.as_bytes()).map_err(|err| ProfileError::Io(err.to_string()))?;
    Ok(LaunchWriteResult::ok())
}

/// Keep one pristine copy of the user's Steam config, made the first time we
/// ever touch it.
fn backup_localconfig_once(path: &Path) -> Result<(), ProfileError> {
    let mut name = path.file_name().unwrap_or_default().to_os_string();
    name.push(".execs-backup");
    let backup = path.with_file_name(name);
    if backup.exists() {
        return Ok(());
    }
    fs::copy(path, &backup).map_err(|err| ProfileError::Io(err.to_string()))?;
    Ok(())
}

pub fn get_profile_launch_options(
    tf2_root: &Path,
    profile_id: &str,
) -> Result<String, ProfileError> {
    get_profile_launch_options_from(&profiles_dir(), tf2_root, profile_id)
}

pub fn get_profile_launch_options_from(
    profiles_dir: &Path,
    tf2_root: &Path,
    profile_id: &str,
) -> Result<String, ProfileError> {
    ensure_library_usable(profiles_dir, tf2_root)?;
    Ok(load_manifest(profiles_dir, profile_id)?.launch_options)
}

pub fn set_profile_launch_options(
    tf2_root: &Path,
    profile_id: &str,
    raw: &str,
) -> Result<SetLaunchResult, ProfileError> {
    let names = live_process_names();
    set_profile_launch_options_to(
        &profiles_dir(),
        tf2_root,
        profile_id,
        raw,
        names.clone(),
        names,
        &discover_steam_roots(),
    )
}

pub fn set_profile_launch_options_to<I, J, S, T>(
    profiles_dir: &Path,
    tf2_root: &Path,
    profile_id: &str,
    raw: &str,
    running_tf2_names: I,
    steam_names: J,
    steam_roots: &[PathBuf],
) -> Result<SetLaunchResult, ProfileError>
where
    I: IntoIterator<Item = S>,
    S: AsRef<str>,
    J: IntoIterator<Item = T>,
    T: AsRef<str>,
{
    refuse_if_running_among(running_tf2_names)?;
    ensure_library_usable(profiles_dir, tf2_root)?;
    let sanitized = sanitize_launch_options(raw);
    write_manifest_launch_options(profiles_dir, profile_id, &sanitized)?;
    let steam = write_launch_options_to_localconfig_from(steam_roots, &sanitized, steam_names)?;
    Ok(SetLaunchResult {
        launch_options: sanitized,
        steam_write: steam.reason,
    })
}

fn ensure_library_usable(profiles_dir: &Path, tf2_root: &Path) -> Result<(), ProfileError> {
    let library = load_library_from(profiles_dir, Some(tf2_root))?;
    if library.root_mismatch {
        return Err(ProfileError::RootMismatch {
            library_root: library.tf2_root.unwrap_or_default(),
            confirmed_root: tf2_root.to_string_lossy().into_owned(),
        });
    }
    if !library.usable {
        return Err(ProfileError::NotInitialized);
    }
    Ok(())
}

fn write_manifest_launch_options(
    profiles_dir: &Path,
    profile_id: &str,
    launch_options: &str,
) -> Result<(), ProfileError> {
    let mut manifest = load_manifest(profiles_dir, profile_id)?;
    manifest.launch_options = launch_options.to_string();
    let path = manifest_file(profiles_dir, profile_id);
    let json =
        serde_json::to_string_pretty(&manifest).map_err(|err| ProfileError::Io(err.to_string()))?;
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|err| ProfileError::Io(err.to_string()))?;
    }
    fs::write(&path, format!("{json}\n")).map_err(|err| ProfileError::Io(err.to_string()))
}

fn set_launch_options_in_vdf(vdf: &mut VdfMap, options: &str) {
    if vdf
        .get("UserLocalConfigStore")
        .and_then(VdfValue::as_obj)
        .is_some()
    {
        vdf.set_path(LAUNCH_OPTIONS_PATH, options);
        return;
    }
    if vdf.get("Software").and_then(VdfValue::as_obj).is_some() {
        vdf.set_path(LAUNCH_OPTIONS_PATH_FROM_STORE, options);
        return;
    }
    vdf.set_path(LAUNCH_OPTIONS_PATH, options);
}

pub fn find_cloud_config() -> Option<PathBuf> {
    find_cloud_config_from(&discover_steam_roots())
}

pub fn find_cloud_config_from(steam_roots: &[PathBuf]) -> Option<PathBuf> {
    let path = cloud_config_path_from(steam_roots)?;
    path.is_file().then_some(path)
}

/// Cloud `config.cfg` path for the picked account, even if the file does not exist yet.
pub fn cloud_config_path_from(steam_roots: &[PathBuf]) -> Option<PathBuf> {
    pick_steam_account_from(steam_roots).map(|account| account.cloud_config())
}

pub fn pick_steam_account_from(steam_roots: &[PathBuf]) -> Option<SteamAccount> {
    let mut candidates = Vec::new();
    for steam_root in steam_roots {
        let userdata = steam_root.join("userdata");
        let Ok(entries) = fs::read_dir(&userdata) else {
            continue;
        };
        for entry in entries.flatten() {
            if !entry.path().is_dir() {
                continue;
            }
            let account_id = entry.file_name().to_string_lossy().into_owned();
            if account_id == "0" || account_id.is_empty() {
                continue;
            }
            let account = SteamAccount {
                steam_root: steam_root.clone(),
                account_id,
            };
            if !account.localconfig().is_file() {
                continue;
            }
            candidates.push(account);
        }
    }
    if candidates.is_empty() {
        return None;
    }

    let with_440: Vec<SteamAccount> = candidates
        .iter()
        .filter(|account| {
            account
                .steam_root
                .join("userdata")
                .join(&account.account_id)
                .join(TF2_APP)
                .exists()
        })
        .cloned()
        .collect();

    let pool = if with_440.is_empty() {
        &candidates
    } else {
        &with_440
    };

    if let Some(preferred) = prefer_most_recent(steam_roots, pool) {
        return Some(preferred);
    }

    pool.iter()
        .filter(|account| localconfig_mentions_440(&account.localconfig()))
        .max_by_key(|account| localconfig_mtime(&account.localconfig()))
        .cloned()
        .or_else(|| {
            pool.iter()
                .max_by_key(|account| localconfig_mtime(&account.localconfig()))
                .cloned()
        })
}

pub fn sanitize_launch_options(raw: &str) -> String {
    let tokens: Vec<&str> = raw.split_whitespace().collect();
    let mut out = Vec::new();
    let mut i = 0;
    while i < tokens.len() {
        let token = tokens[i];
        let lower = token.to_ascii_lowercase();
        if matches!(
            lower.as_str(),
            "-autoconfig" | "-default" | "+quit" | "gamemoderun"
        ) {
            i += 1;
            continue;
        }
        // A `%command%` wrapper carried across profiles is exactly the launch
        // damage the rule exists to prevent (AGENTS.md RND-158).
        if lower.contains("%command%") {
            i += 1;
            continue;
        }
        if lower == "-dxlevel" || lower.starts_with("-dxlevel") {
            if lower == "-dxlevel"
                && i + 1 < tokens.len()
                && !tokens[i + 1].starts_with('-')
                && !tokens[i + 1].starts_with('+')
            {
                i += 2;
                continue;
            }
            i += 1;
            continue;
        }
        out.push(token);
        i += 1;
    }
    out.join(" ")
}

fn prefer_most_recent(steam_roots: &[PathBuf], pool: &[SteamAccount]) -> Option<SteamAccount> {
    for steam_root in steam_roots {
        let loginusers = steam_root.join("config").join("loginusers.vdf");
        let Ok(text) = fs::read_to_string(&loginusers) else {
            continue;
        };
        let Ok(vdf) = parse_vdf(&text) else {
            continue;
        };
        let Some(account_id) = most_recent_account_id(&vdf) else {
            continue;
        };
        if let Some(match_account) = pool
            .iter()
            .find(|account| account.steam_root == *steam_root && account.account_id == account_id)
        {
            return Some(match_account.clone());
        }
    }
    None
}

fn most_recent_account_id(vdf: &VdfMap) -> Option<String> {
    let users = vdf
        .get("users")
        .or_else(|| vdf.get("Users"))
        .and_then(VdfValue::as_obj)?;
    for (steam_id64, value) in &users.entries {
        let Some(obj) = value.as_obj() else {
            continue;
        };
        let most_recent = obj
            .get("MostRecent")
            .or_else(|| obj.get("mostrecent"))
            .and_then(VdfValue::as_str)
            .unwrap_or("");
        if most_recent == "1" {
            return steamid64_to_account(steam_id64);
        }
    }
    None
}

fn steamid64_to_account(id: &str) -> Option<String> {
    let n: u64 = id.parse().ok()?;
    n.checked_sub(STEAM_ID64_BASE).map(|id| id.to_string())
}

fn launch_options_from_localconfig(vdf: &VdfMap) -> Option<String> {
    let store = vdf
        .get("UserLocalConfigStore")
        .and_then(VdfValue::as_obj)
        .unwrap_or(vdf);
    let apps = vdf_get_obj(store, &["Software", "Valve", "Steam", "apps"])?;
    let app = apps.get(TF2_APP)?.as_obj()?;
    app.get("LaunchOptions")
        .and_then(VdfValue::as_str)
        .map(str::to_string)
}

fn localconfig_mentions_440(path: &Path) -> bool {
    let Ok(text) = fs::read_to_string(path) else {
        return false;
    };
    let Ok(vdf) = parse_vdf(&text) else {
        return false;
    };
    launch_options_from_localconfig(&vdf).is_some() || vdf_has_app_440(&vdf)
}

fn vdf_has_app_440(vdf: &VdfMap) -> bool {
    let store = vdf
        .get("UserLocalConfigStore")
        .and_then(VdfValue::as_obj)
        .unwrap_or(vdf);
    vdf_get_obj(store, &["Software", "Valve", "Steam", "apps"])
        .and_then(|apps| apps.get(TF2_APP))
        .is_some()
}

fn vdf_get_obj<'a>(map: &'a VdfMap, keys: &[&str]) -> Option<&'a VdfMap> {
    let mut current = map;
    for key in keys {
        current = current.get(key)?.as_obj()?;
    }
    Some(current)
}

fn localconfig_mtime(path: &Path) -> SystemTime {
    fs::metadata(path)
        .and_then(|meta| meta.modified())
        .unwrap_or(SystemTime::UNIX_EPOCH)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;

    fn write_file(path: &Path, contents: &str) {
        if let Some(parent) = path.parent() {
            fs::create_dir_all(parent).unwrap();
        }
        let mut file = fs::File::create(path).unwrap();
        file.write_all(contents.as_bytes()).unwrap();
    }

    fn localconfig(options: &str) -> String {
        format!(
            r#""UserLocalConfigStore"
{{
	"Software"
	{{
		"Valve"
		{{
			"Steam"
			{{
				"apps"
				{{
					"440"
					{{
						"LaunchOptions"		"{options}"
					}}
				}}
			}}
		}}
	}}
}}
"#
        )
    }

    fn cleanup(dir: &Path) {
        let _ = fs::remove_dir_all(dir);
    }

    #[test]
    fn strips_banned_launch_tokens() {
        assert_eq!(
            sanitize_launch_options("-novid -autoconfig -default -dxlevel 90 +quit -console"),
            "-novid -console"
        );
        assert_eq!(sanitize_launch_options("-dxlevel90 -novid"), "-novid");
        assert_eq!(sanitize_launch_options(""), "");
        // AGENTS.md RND-158 names `gamemoderun %command%` alongside the rest.
        assert_eq!(
            sanitize_launch_options("gamemoderun %command% -novid"),
            "-novid"
        );
        assert_eq!(
            sanitize_launch_options("mangohud %command% -nojoy"),
            "mangohud -nojoy"
        );
        assert_eq!(sanitize_launch_options("GAMEMODERUN -novid"), "-novid");
    }

    #[test]
    fn localconfig_write_backs_up_once_and_leaves_no_part_file() {
        let dir = crate::test_temp_dir();
        let steam = dir.join("Steam");
        write_account(&steam, "111", "-novid");
        let path = steam
            .join("userdata")
            .join("111")
            .join("config")
            .join("localconfig.vdf");
        let original = fs::read(&path).unwrap();

        write_launch_options_to_localconfig_from(&[steam.clone()], "-nojoy", None::<&str>).unwrap();
        let backup = path.with_file_name("localconfig.vdf.execs-backup");
        assert_eq!(fs::read(&backup).unwrap(), original);
        assert!(!path.with_file_name("localconfig.vdf.execs-part").exists());

        // A second write must not overwrite the pristine copy.
        write_launch_options_to_localconfig_from(&[steam.clone()], "-console", None::<&str>)
            .unwrap();
        assert_eq!(fs::read(&backup).unwrap(), original);
        assert_eq!(read_launch_options_from(&[steam.clone()]), "-console");
        cleanup(&dir);
    }

    #[test]
    fn localconfig_conditionals_survive_the_rewrite() {
        let dir = crate::test_temp_dir();
        let steam = dir.join("Steam");
        let path = steam
            .join("userdata")
            .join("111")
            .join("config")
            .join("localconfig.vdf");
        // `"key" "value" [$WIN32]` used to be read as the key `[$WIN32]` whose
        // value was the next key, shifting everything after it by one.
        let text = localconfig("-novid").replace(
            "\"LaunchOptions\"\t\t\"-novid\"",
            "\"LaunchOptions\"\t\t\"-novid\"\n\t\t\t\t\t\t\t\"Cloud\"\t\t\"1\" [$WIN32]\n\t\t\t\t\t\t\t\"LastPlayed\"\t\t\"99\"",
        );
        write_file(&path, &text);
        fs::create_dir_all(steam.join("userdata").join("111").join("440")).unwrap();

        write_launch_options_to_localconfig_from(&[steam.clone()], "-nojoy", None::<&str>).unwrap();

        let after = parse_vdf(&fs::read_to_string(&path).unwrap()).unwrap();
        let app = vdf_get_obj(
            &after,
            &[
                "UserLocalConfigStore",
                "Software",
                "Valve",
                "Steam",
                "apps",
                "440",
            ],
        )
        .unwrap();
        assert_eq!(app.get("Cloud").and_then(VdfValue::as_str), Some("1"));
        assert_eq!(app.get("LastPlayed").and_then(VdfValue::as_str), Some("99"));
        assert_eq!(
            app.get("LaunchOptions").and_then(VdfValue::as_str),
            Some("-nojoy")
        );
        assert!(fs::read_to_string(&path).unwrap().contains("[$WIN32]"));
        cleanup(&dir);
    }

    #[test]
    fn reads_launch_options_from_account_with_440() {
        let dir = crate::test_temp_dir();
        let steam = dir.join("Steam");
        write_file(
            &steam
                .join("userdata")
                .join("111")
                .join("config")
                .join("localconfig.vdf"),
            &localconfig("-novid -windowed"),
        );
        write_file(
            &steam
                .join("userdata")
                .join("111")
                .join("440")
                .join("remote")
                .join("cfg")
                .join("config.cfg"),
            "unbindall\n",
        );
        write_file(
            &steam
                .join("userdata")
                .join("222")
                .join("config")
                .join("localconfig.vdf"),
            &localconfig("-autoconfig"),
        );

        let options = read_launch_options_from(&[steam.clone()]);
        assert_eq!(options, "-novid -windowed");
        let cloud = find_cloud_config_from(&[steam]).unwrap();
        assert!(cloud.ends_with(Path::new("440/remote/cfg/config.cfg")));
        cleanup(&dir);
    }

    #[test]
    fn prefers_most_recent_loginusers_account() {
        let dir = crate::test_temp_dir();
        let steam = dir.join("Steam");
        let recent_id64 = STEAM_ID64_BASE + 999;
        write_file(
            &steam.join("config").join("loginusers.vdf"),
            &format!(
                r#""users"
{{
	"{recent_id64}"
	{{
		"MostRecent"		"1"
	}}
	"{}"
	{{
		"MostRecent"		"0"
	}}
}}
"#,
                STEAM_ID64_BASE + 111
            ),
        );
        write_file(
            &steam
                .join("userdata")
                .join("999")
                .join("config")
                .join("localconfig.vdf"),
            &localconfig("-console"),
        );
        fs::create_dir_all(steam.join("userdata").join("999").join("440")).unwrap();
        write_file(
            &steam
                .join("userdata")
                .join("111")
                .join("config")
                .join("localconfig.vdf"),
            &localconfig("-novid"),
        );
        fs::create_dir_all(steam.join("userdata").join("111").join("440")).unwrap();

        assert_eq!(read_launch_options_from(&[steam]), "-console");
        cleanup(&dir);
    }

    #[test]
    fn missing_steam_data_is_empty() {
        let dir = crate::test_temp_dir();
        assert_eq!(read_launch_options_from(&[dir.join("none")]), "");
        assert_eq!(find_cloud_config_from(&[dir.join("none")]), None);
        cleanup(&dir);
    }

    #[test]
    fn recommended_is_the_official_comfig_set() {
        let expected = "-novid -nojoy -nosteamcontroller -nohltv -particles 1";
        assert_eq!(recommended_launch_options(), expected);
        assert_eq!(recommended_launch_options_for(ProcessOs::Windows), expected);
        assert_eq!(recommended_launch_options_for(ProcessOs::Linux), expected);
        assert_eq!(
            sanitize_launch_options(&format!(
                "{expected} -autoconfig -default -dxlevel 90 +quit"
            )),
            expected
        );
    }

    fn write_account(steam: &Path, account: &str, options: &str) {
        write_file(
            &steam
                .join("userdata")
                .join(account)
                .join("config")
                .join("localconfig.vdf"),
            &localconfig(options),
        );
        fs::create_dir_all(steam.join("userdata").join(account).join("440")).unwrap();
    }

    #[test]
    fn writes_localconfig_when_steam_names_empty() {
        let dir = crate::test_temp_dir();
        let steam = dir.join("Steam");
        write_account(&steam, "111", "-novid");

        let result = write_launch_options_to_localconfig_from(
            &[steam.clone()],
            "-novid -nojoy -autoconfig +quit",
            None::<&str>,
        )
        .unwrap();
        assert_eq!(
            result,
            LaunchWriteResult {
                written: true,
                reason: LaunchWriteReason::Written,
            }
        );
        assert_eq!(read_launch_options_from(&[steam.clone()]), "-novid -nojoy");
        let text = fs::read_to_string(
            steam
                .join("userdata")
                .join("111")
                .join("config")
                .join("localconfig.vdf"),
        )
        .unwrap();
        let vdf = parse_vdf(&text).unwrap();
        assert_eq!(
            launch_options_from_localconfig(&vdf).as_deref(),
            Some("-novid -nojoy")
        );
        cleanup(&dir);
    }

    #[test]
    fn skips_localconfig_when_steam_is_open() {
        let dir = crate::test_temp_dir();
        let steam = dir.join("Steam");
        write_account(&steam, "111", "-novid");

        let result =
            write_launch_options_to_localconfig_from(&[steam.clone()], "-console", ["steam"])
                .unwrap();
        assert_eq!(
            result,
            LaunchWriteResult {
                written: false,
                reason: LaunchWriteReason::SteamOpen,
            }
        );
        assert_eq!(read_launch_options_from(&[steam]), "-novid");
        cleanup(&dir);
    }

    #[test]
    fn write_without_account_is_no_account() {
        let dir = crate::test_temp_dir();
        let result =
            write_launch_options_to_localconfig_from(&[dir.join("none")], "-novid", None::<&str>)
                .unwrap();
        assert_eq!(
            result,
            LaunchWriteResult {
                written: false,
                reason: LaunchWriteReason::NoAccount,
            }
        );
        cleanup(&dir);
    }

    fn tf2_name() -> &'static str {
        if cfg!(windows) {
            "tf_win64.exe"
        } else {
            "tf_linux64"
        }
    }

    #[test]
    fn set_profile_sanitizes_and_writes_steam_when_closed() {
        let dir = crate::test_temp_dir();
        let root = dir.join("Team Fortress 2");
        let profiles = dir.join("profiles");
        let steam = dir.join("Steam");
        write_file(&root.join("tf/steam.inf"), "appID=440\n");
        write_account(&steam, "111", "-old");
        let library =
            crate::profile::create_profile_record_to(&profiles, &root, "Main", None::<&str>)
                .unwrap();
        let id = library.profiles[0].id.clone();

        let result = set_profile_launch_options_to(
            &profiles,
            &root,
            &id,
            "-novid -autoconfig -dxlevel 90 +quit -console",
            None::<&str>,
            None::<&str>,
            &[steam.clone()],
        )
        .unwrap();
        assert_eq!(result.launch_options, "-novid -console");
        assert_eq!(result.steam_write, LaunchWriteReason::Written);
        assert_eq!(
            get_profile_launch_options_from(&profiles, &root, &id).unwrap(),
            "-novid -console"
        );
        assert_eq!(read_launch_options_from(&[steam]), "-novid -console");
        cleanup(&dir);
    }

    #[test]
    fn set_profile_saves_library_when_steam_is_open() {
        let dir = crate::test_temp_dir();
        let root = dir.join("Team Fortress 2");
        let profiles = dir.join("profiles");
        let steam = dir.join("Steam");
        write_file(&root.join("tf/steam.inf"), "appID=440\n");
        write_account(&steam, "111", "-old");
        let library =
            crate::profile::create_profile_record_to(&profiles, &root, "Main", None::<&str>)
                .unwrap();
        let id = library.profiles[0].id.clone();

        let result = set_profile_launch_options_to(
            &profiles,
            &root,
            &id,
            "-console",
            None::<&str>,
            ["steam"],
            &[steam.clone()],
        )
        .unwrap();
        assert_eq!(result.launch_options, "-console");
        assert_eq!(result.steam_write, LaunchWriteReason::SteamOpen);
        assert_eq!(
            load_manifest(&profiles, &id).unwrap().launch_options,
            "-console"
        );
        assert_eq!(read_launch_options_from(&[steam]), "-old");
        cleanup(&dir);
    }

    #[test]
    fn set_profile_refuses_while_tf2_running() {
        let dir = crate::test_temp_dir();
        let root = dir.join("Team Fortress 2");
        let profiles = dir.join("profiles");
        write_file(&root.join("tf/steam.inf"), "appID=440\n");
        let library =
            crate::profile::create_profile_record_to(&profiles, &root, "Main", None::<&str>)
                .unwrap();
        let id = library.profiles[0].id.clone();
        let err = set_profile_launch_options_to(
            &profiles,
            &root,
            &id,
            "-novid",
            [tf2_name()],
            None::<&str>,
            &[],
        )
        .unwrap_err();
        assert_eq!(err, ProfileError::GameRunning);
        assert_eq!(load_manifest(&profiles, &id).unwrap().launch_options, "");
        cleanup(&dir);
    }
}
