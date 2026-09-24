//! The Crosshair pane: the custom pack builder and its previews.

use std::collections::BTreeMap;

use execs_core::{CrosshairAsset, ProfileDetail, StockCrosshairSprite};

use super::shared::{active_manifest, with_profile, with_root};
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
    settings: Option<execs_core::crosshair::CrosshairBuildSettings>,
) -> Result<ProfileDetail, CommandError> {
    let _guard = gate.lock_for_write().await?;
    with_profile(move |root, profile_id| {
        if let Some(settings) = settings {
            return Ok(execs_core::crosshair::apply_crosshairs_configured(
                &root,
                &profile_id,
                &shape,
                &assignments,
                custom_rgba.as_deref(),
                color,
                &library.unwrap_or_default(),
                design.as_deref(),
                &settings,
            )?);
        }
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

/// Decode the active profile's installed library crosshairs for previews.
#[tauri::command]
pub async fn get_pack_crosshair_previews(
) -> Result<BTreeMap<String, StockCrosshairSprite>, CommandError> {
    with_profile(|_root, profile_id| {
        let manifest = active_manifest(&profile_id)?;
        let mut out = BTreeMap::new();
        if let Some(record) = manifest.crosshair {
            for name in record
                .library
                .keys()
                .map(String::as_str)
                .chain(std::iter::once("custom"))
            {
                let Some(bytes) = execs_core::stored_pack_crosshair(
                    &execs_core::profiles_dir(),
                    &profile_id,
                    name,
                ) else {
                    continue;
                };
                if let Ok(decoded) = execs_core::vtf_read::decode_vtf_frame0(&bytes) {
                    out.insert(
                        name.to_owned(),
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

/// Candidate custom-pack members that could replace Valve's stock preview art.
/// The index deliberately does not claim a runtime winner.
#[tauri::command]
pub async fn get_crosshair_content_sources(
) -> Result<execs_core::content_index::ContentIndex, CommandError> {
    with_root(|root| {
        let paths: Vec<String> = (1..=7)
            .flat_map(|number| {
                ["vtf", "vmt"].map(move |extension| {
                    format!("materials/vgui/crosshairs/crosshair{number}.{extension}")
                })
            })
            .collect();
        let path_refs: Vec<&str> = paths.iter().map(String::as_str).collect();
        Ok(execs_core::content_index::scan_custom_paths(
            &root,
            &path_refs,
            Some(execs_core::crosshair::EXECS_CROSSHAIRS_PACK),
        ))
    })
    .await
}

#[tauri::command]
pub async fn get_crosshair_source_status(
) -> Result<execs_core::crosshair::CrosshairSourceStatus, CommandError> {
    with_profile(|root, profile_id| {
        Ok(execs_core::crosshair::crosshair_source_status_to(
            &execs_core::profiles_dir(),
            &root,
            &profile_id,
        )?)
    })
    .await
}

#[tauri::command]
pub async fn remove_crosshairs(
    gate: tauri::State<'_, WriteGate>,
) -> Result<ProfileDetail, CommandError> {
    let _guard = gate.lock_for_write().await?;
    with_profile(|root, profile_id| Ok(execs_core::remove_crosshairs(&root, &profile_id)?)).await
}

#[tauri::command]
pub async fn deactivate_crosshairs(
    gate: tauri::State<'_, WriteGate>,
) -> Result<ProfileDetail, CommandError> {
    let _guard = gate.lock_for_write().await?;
    with_profile(|root, id| {
        Ok(execs_core::crosshair::deactivate_crosshairs_to(
            &execs_core::profiles_dir(),
            &root,
            &id,
            execs_core::process_lock::live_process_names(),
        )?)
    })
    .await
}
