//! Read TF2 launch options from Steam `localconfig.vdf`. Best-effort; never fails a save.

use std::fs;
use std::path::{Path, PathBuf};
use std::time::SystemTime;

use crate::finder::discover_steam_roots;
use crate::vdf::{parse_vdf, VdfMap, VdfValue};

const TF2_APP: &str = "440";
const STEAM_ID64_BASE: u64 = 76561197960265728;

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
        if matches!(lower.as_str(), "-autoconfig" | "-default" | "+quit") {
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
}
