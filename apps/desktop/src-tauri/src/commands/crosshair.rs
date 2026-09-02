//! The Crosshair pane: the custom pack builder and its previews.

use std::collections::BTreeMap;

use execs_core::{CrosshairAsset, ProfileDetail, StockCrosshairSprite};
use serde::Serialize;

use super::shared::{active_manifest, blocking, with_profile, with_root};
use crate::error::CommandError;
use crate::WriteGate;

#[tauri::command]
#[allow(clippy::too_many_arguments)]
pub async fn apply_crosshairs(
    gate: tauri::State<'_, WriteGate>,
    shape: String,
    assignments: BTreeMap<String, String>,
    custom_rgba: Option<Vec<u8>>,
    color: Option<[u8; 3]>,
    library: Option<BTreeMap<String, CrosshairAsset>>,
    design: Option<String>,
) -> Result<ProfileDetail, CommandError> {
    let _guard = gate.0.lock().await;
    with_profile(move |root, profile_id| {
        Ok(execs_core::apply_crosshairs(
            &root,
            &profile_id,
            &shape,
            &assignments,
            custom_rgba.as_deref(),
            color,
            &library.unwrap_or_default(),
            design.as_deref(),
        )?)
    })
    .await
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CommunityCrosshair {
    pub file: String,
    pub width: u32,
    pub height: u32,
    /// Frame 0 as unpremultiplied RGBA, for the picker preview.
    pub rgba: Vec<u8>,
    /// The raw VTF bytes to pass back through apply_crosshairs' library.
    pub bytes: Vec<u8>,
}

/// Download (with local cache) one Venom-pack crosshair and decode a preview.
#[tauri::command]
pub async fn fetch_community_crosshair(file: String) -> Result<CommunityCrosshair, CommandError> {
    blocking(move || {
        let bytes = crate::crosshair_fetch::fetch_crosshair_vtf(&file)?;
        let decoded = execs_core::vtf_read::decode_vtf_frame0(&bytes)?;
        if decoded.frames > 1 {
            return Err(CommandError::unknown(
                "Animated crosshairs are not supported yet.",
            ));
        }
        Ok(CommunityCrosshair {
            file,
            width: decoded.width,
            height: decoded.height,
            rgba: decoded.rgba,
            bytes,
        })
    })
    .await
}

/// Thumbnails for the community picker: every requested Venom entry fetched
/// (with cache) and decoded to frame 0. Entries that fail to download or
/// decode are simply absent from the map.
#[tauri::command]
pub async fn fetch_community_crosshair_previews(
    files: Vec<String>,
) -> Result<BTreeMap<String, StockCrosshairSprite>, CommandError> {
    blocking(move || {
        let fetched = crate::crosshair_fetch::fetch_crosshair_vtfs(&files);
        let mut out = BTreeMap::new();
        for (file, bytes) in fetched {
            let Ok(decoded) = execs_core::vtf_read::decode_vtf_frame0(&bytes) else {
                continue;
            };
            if decoded.frames > 1 {
                continue;
            }
            out.insert(
                file,
                StockCrosshairSprite {
                    width: decoded.width,
                    height: decoded.height,
                    rgba: decoded.rgba,
                },
            );
        }
        Ok(out)
    })
    .await
}

/// Decode the active profile's installed library crosshairs for previews.
#[tauri::command]
pub async fn get_pack_crosshair_previews(
) -> Result<BTreeMap<String, StockCrosshairSprite>, CommandError> {
    with_profile(|_root, profile_id| {
        let manifest = active_manifest(&profile_id)?;
        let mut out = BTreeMap::new();
        if let Some(record) = manifest.crosshair {
            for name in record.library.keys() {
                let Some(bytes) = execs_core::stored_pack_crosshair(
                    &execs_core::profiles_dir(),
                    &profile_id,
                    name,
                ) else {
                    continue;
                };
                if let Ok(decoded) = execs_core::vtf_read::decode_vtf_frame0(&bytes) {
                    out.insert(
                        name.clone(),
                        StockCrosshairSprite {
                            width: decoded.width,
                            height: decoded.height,
                            rgba: decoded.rgba,
                        },
                    );
                }
            }
        }
        Ok(out)
    })
    .await
}

#[tauri::command]
pub async fn get_stock_crosshair_sprites(
) -> Result<BTreeMap<String, StockCrosshairSprite>, CommandError> {
    with_root(|root| Ok(execs_core::extract_stock_crosshair_sprites(&root)?)).await
}

#[tauri::command]
pub async fn remove_crosshairs(
    gate: tauri::State<'_, WriteGate>,
) -> Result<ProfileDetail, CommandError> {
    let _guard = gate.0.lock().await;
    with_profile(|root, profile_id| Ok(execs_core::remove_crosshairs(&root, &profile_id)?)).await
}
