//! TF2's scoreboard class emblems, decoded from the player's own
//! `tf2_textures_dir.vpk` so the interface can show them without shipping any
//! Valve artwork. Read-only; a missing or unreadable emblem is simply absent.

use std::collections::BTreeMap;
use std::path::Path;

use crate::crosshair::StockCrosshairSprite;
use crate::profile::ProfileError;
use crate::vpk::read_vpk_dir_file_filtered;

/// execs class ids and the texture stem TF2 uses for each emblem.
pub const CLASS_ICON_TEXTURES: [(&str, &str); 9] = [
    ("scout", "scout"),
    ("soldier", "soldier"),
    ("pyro", "pyro"),
    ("demoman", "demo"),
    ("heavy", "heavy"),
    ("engineer", "engineer"),
    ("medic", "medic"),
    ("sniper", "sniper"),
    ("spy", "spy"),
];

fn texture_path(stem: &str) -> String {
    format!("materials/hud/leaderboard_class_{stem}.vtf")
}

/// Decode the nine class emblems. Emblems that fail to decode are left out so
/// the interface falls back to text for that class.
pub fn extract_class_icons(
    tf2_root: &Path,
) -> Result<BTreeMap<String, StockCrosshairSprite>, ProfileError> {
    let vpk = tf2_root.join("tf").join("tf2_textures_dir.vpk");
    if !vpk.is_file() {
        return Err(ProfileError::Io(
            "Could not find tf/tf2_textures_dir.vpk. Confirm the TF2 install.".into(),
        ));
    }
    let wanted: Vec<String> = CLASS_ICON_TEXTURES
        .iter()
        .map(|(_, stem)| texture_path(stem))
        .collect();
    let keep = |rel: &str| {
        let lower = rel.to_ascii_lowercase();
        wanted.contains(&lower)
    };
    let archive =
        read_vpk_dir_file_filtered(&vpk, &keep).map_err(|err| ProfileError::Io(err.message()))?;
    let mut out = BTreeMap::new();
    for (class, stem) in CLASS_ICON_TEXTURES {
        let target = texture_path(stem);
        let Some(bytes) = archive
            .files
            .iter()
            .find(|(path, _)| path.to_ascii_lowercase() == target)
            .map(|(_, bytes)| bytes)
        else {
            continue;
        };
        // The emblems are 64px; a larger replacement is scaled to a small mip.
        if let Ok(decoded) = crate::vtf_read::decode_vtf_frame0_with_max_dimension(bytes, 128) {
            out.insert(
                class.to_owned(),
                StockCrosshairSprite {
                    width: decoded.width,
                    height: decoded.height,
                    rgba: decoded.rgba,
                },
            );
        }
    }
    Ok(out)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn every_class_maps_to_one_scoreboard_texture() {
        let paths: Vec<String> = CLASS_ICON_TEXTURES
            .iter()
            .map(|(_, stem)| texture_path(stem))
            .collect();
        assert_eq!(paths.len(), 9);
        assert!(paths.contains(&"materials/hud/leaderboard_class_demo.vtf".to_owned()));
        let mut unique = paths.clone();
        unique.sort();
        unique.dedup();
        assert_eq!(unique.len(), 9);
    }

    #[test]
    fn a_missing_texture_archive_is_an_error() {
        let dir = std::env::temp_dir().join(format!("execs-class-icons-{}", std::process::id()));
        std::fs::create_dir_all(dir.join("tf")).unwrap();
        assert!(extract_class_icons(&dir).is_err());
        let _ = std::fs::remove_dir_all(&dir);
    }
}
