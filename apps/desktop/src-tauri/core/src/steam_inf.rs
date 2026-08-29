//! Valve `steam.inf` reader. Confirm TF2 with app 440 — never write this file.

use std::collections::HashMap;

pub fn parse_steam_inf(text: &str) -> HashMap<String, String> {
    let mut map = HashMap::new();
    for raw in text.lines() {
        let line = raw.trim().trim_end_matches('\r');
        if line.is_empty() || line.starts_with("//") || line.starts_with('#') {
            continue;
        }
        let Some((key, value)) = line.split_once('=') else {
            continue;
        };
        map.insert(key.trim().to_ascii_lowercase(), value.trim().to_string());
    }
    map
}

pub fn steam_inf_app_id(text: &str) -> Option<String> {
    parse_steam_inf(text).get("appid").cloned()
}

pub fn is_tf2_steam_inf(text: &str) -> bool {
    steam_inf_app_id(text).as_deref() == Some("440")
}

#[cfg(test)]
mod tests {
    use super::*;

    const VALVE: &str = "PatchVersion=105.0.0\nProductName=tf\nappID=440\nServerAppID=232250\n";

    #[test]
    fn accepts_tf2_app_id_any_case() {
        assert!(is_tf2_steam_inf(VALVE));
        assert_eq!(steam_inf_app_id(VALVE).as_deref(), Some("440"));
        assert!(is_tf2_steam_inf("AppID=440\n"));
    }

    #[test]
    fn rejects_other_apps_and_missing_id() {
        assert!(!is_tf2_steam_inf("appID=730\n"));
        assert!(!is_tf2_steam_inf("ProductName=tf\n"));
        assert!(!is_tf2_steam_inf(""));
    }
}
