//! TF2's saved video resolution, read-only.
//!
//! The engine draws the crosshair in real screen pixels (sprite × scale / 32)
//! with no resolution scaling, so a true-to-size preview needs the resolution
//! the player actually runs. Source keeps it in its "registry": the Windows
//! registry, or Steam's `registry.vdf` on Linux. Nothing here writes.

use std::path::{Path, PathBuf};

use crate::vdf::{parse_vdf, VdfMap, VdfValue};

const MAX_REGISTRY_VDF_BYTES: u64 = 4 * 1024 * 1024;

#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GameResolution {
    pub width: u32,
    pub height: u32,
    /// Missing when TF2 never recorded it.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub windowed: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub borderless: Option<bool>,
}

fn plausible(width: u32, height: u32) -> bool {
    (320..=16_384).contains(&width) && (200..=16_384).contains(&height)
}

fn from_values(
    width: Option<u32>,
    height: Option<u32>,
    windowed: Option<u32>,
    borderless: Option<u32>,
) -> Option<GameResolution> {
    let (width, height) = (width?, height?);
    plausible(width, height).then_some(GameResolution {
        width,
        height,
        windowed: windowed.map(|value| value != 0),
        borderless: borderless.map(|value| value != 0),
    })
}

pub fn read_game_resolution() -> Option<GameResolution> {
    #[cfg(windows)]
    {
        read_windows_registry()
    }
    #[cfg(not(windows))]
    {
        steam_registry_candidates()
            .iter()
            .find_map(|path| read_steam_registry_vdf(path))
    }
}

#[cfg(windows)]
fn read_windows_registry() -> Option<GameResolution> {
    use winreg::enums::HKEY_CURRENT_USER;
    use winreg::RegKey;
    let key = RegKey::predef(HKEY_CURRENT_USER)
        .open_subkey(r"Software\Valve\Source\tf\Settings")
        .ok()?;
    let value = |name: &str| key.get_value::<u32, _>(name).ok();
    from_values(
        value("ScreenWidth"),
        value("ScreenHeight"),
        value("ScreenWindowed"),
        value("ScreenNoBorder"),
    )
}

#[cfg_attr(windows, allow(dead_code))]
fn steam_registry_candidates() -> Vec<PathBuf> {
    let Some(home) = std::env::var_os("HOME").map(PathBuf::from) else {
        return Vec::new();
    };
    vec![
        home.join(".steam").join("registry.vdf"),
        home.join(".var/app/com.valvesoftware.Steam/.steam/registry.vdf"),
    ]
}

#[cfg_attr(windows, allow(dead_code))]
fn read_steam_registry_vdf(path: &Path) -> Option<GameResolution> {
    let bytes = crate::archive::read_regular_file_bounded(path, MAX_REGISTRY_VDF_BYTES)
        .ok()
        .flatten()?;
    resolution_from_registry_vdf(&String::from_utf8_lossy(&bytes))
}

/// `Registry/HKCU/Software/Valve/Source/tf/Settings` in Steam's registry.vdf.
pub fn resolution_from_registry_vdf(text: &str) -> Option<GameResolution> {
    let map = parse_vdf(text).ok()?;
    let mut current: &VdfMap = &map;
    for key in [
        "Registry", "HKCU", "Software", "Valve", "Source", "tf", "Settings",
    ] {
        current = current.get(key)?.as_obj()?;
    }
    let value = |name: &str| {
        current
            .get(name)
            .and_then(VdfValue::as_str)
            .and_then(|text| text.trim().parse::<u32>().ok())
    };
    from_values(
        value("ScreenWidth"),
        value("ScreenHeight"),
        value("ScreenWindowed"),
        value("ScreenNoBorder"),
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reads_tf2_settings_from_steams_registry_vdf() {
        let text = r#""Registry"
{
	"HKCU"
	{
		"Software"
		{
			"Valve"
			{
				"Steam" { "Language" "english" }
				"Source"
				{
					"tf"
					{
						"Settings"
						{
							"ScreenWidth"		"2560"
							"ScreenHeight"		"1440"
							"ScreenWindowed"		"1"
							"ScreenNoBorder"		"1"
						}
					}
				}
			}
		}
	}
}"#;
        assert_eq!(
            resolution_from_registry_vdf(text),
            Some(GameResolution {
                width: 2560,
                height: 1440,
                windowed: Some(true),
                borderless: Some(true),
            })
        );
    }

    #[test]
    fn missing_or_nonsense_values_are_unknown() {
        assert_eq!(resolution_from_registry_vdf("\"Registry\" { }"), None);
        let tiny = r#""Registry" { "HKCU" { "Software" { "Valve" { "Source" { "tf" { "Settings" {
            "ScreenWidth" "0" "ScreenHeight" "1080" } } } } } } }"#;
        assert_eq!(resolution_from_registry_vdf(tiny), None);
        assert_eq!(resolution_from_registry_vdf("not vdf {"), None);
    }

    #[test]
    fn a_resolution_without_window_flags_still_counts() {
        assert_eq!(
            from_values(Some(1920), Some(1080), None, None),
            Some(GameResolution {
                width: 1920,
                height: 1080,
                windowed: None,
                borderless: None,
            })
        );
    }
}
