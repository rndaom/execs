//! The Sounds pane: hit and kill sounds.

use execs_core::{
    HitsoundChange, HitsoundEntry, HitsoundKind, HitsoundSource, ProfileDetail, WavInfo,
};
use serde::{Deserialize, Serialize};
use tauri::AppHandle;
use tauri_plugin_dialog::DialogExt;

use super::shared::{blocking, with_profile, with_root};
use crate::error::CommandError;
use crate::WriteGate;

/// One sound the pane can audition or install.
#[derive(Debug, Clone, Deserialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum HitsoundPick {
    /// A pinned community-pack entry by upstream stem.
    Community { name: String },
    /// A user file the dialog already prepared, by its stash token.
    File { token: String, name: String },
    /// What the active profile already has installed in this slot.
    Installed { slot: HitsoundKind },
    /// One of the engine's own sounds, by file stem, from the user's VPK.
    Stock { stem: String },
}

fn pick_bytes(
    root: &std::path::Path,
    profile_id: &str,
    pick: &HitsoundPick,
) -> Result<Vec<u8>, CommandError> {
    match pick {
        HitsoundPick::Community { name } => Ok(crate::hitsound_fetch::fetch_community_wav(name)?),
        HitsoundPick::File { token, .. } => Ok(crate::hitsound_fetch::read_picked(token)?),
        HitsoundPick::Installed { slot } => {
            execs_core::stored_hitsound(&execs_core::profiles_dir(), profile_id, *slot)
                .ok_or_else(|| CommandError::unknown("Nothing is installed in that slot."))
        }
        HitsoundPick::Stock { stem } => {
            let stock = execs_core::extract_stock_hitsounds(root)?;
            stock
                .get(&stem.to_ascii_lowercase())
                .cloned()
                .ok_or_else(|| CommandError::unknown("That stock sound was not found in the VPK."))
        }
    }
}

/// Raw WAV bytes for the audio element, straight through as a `Response`.
#[tauri::command]
pub async fn hitsound_bytes(pick: HitsoundPick) -> Result<tauri::ipc::Response, CommandError> {
    let bytes = with_profile(move |root, profile_id| pick_bytes(&root, &profile_id, &pick)).await?;
    Ok(tauri::ipc::Response::new(bytes))
}

/// The stock hit/kill sound stems present in the user's sound VPK.
#[tauri::command]
pub async fn list_stock_hitsounds() -> Result<Vec<String>, CommandError> {
    with_root(|root| {
        Ok(execs_core::extract_stock_hitsounds(&root)?
            .into_keys()
            .collect())
    })
    .await
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PickedHitsound {
    pub token: String,
    pub name: String,
    pub info: WavInfo,
    /// True when the file was re-encoded to something the engine plays.
    pub converted: bool,
}

/// Let the user choose a WAV, prepare it for the engine, and stash it for
/// auditioning and a later Apply. Cancelling the dialog returns `None`.
#[tauri::command]
pub async fn pick_hitsound_file(app: AppHandle) -> Result<Option<PickedHitsound>, CommandError> {
    let picked = tauri::async_runtime::spawn_blocking(move || {
        app.dialog()
            .file()
            .set_title("Choose a WAV sound")
            .add_filter("WAV audio", &["wav"])
            .blocking_pick_file()
    })
    .await
    .map_err(|err| CommandError::unknown(err.to_string()))?;
    let Some(picked) = picked else {
        return Ok(None);
    };
    let path = picked
        .into_path()
        .map_err(|err| CommandError::unknown(err.to_string()))?;
    blocking(move || {
        let name = path
            .file_name()
            .map(|name| name.to_string_lossy().into_owned())
            .unwrap_or_else(|| "sound.wav".into());
        let raw = std::fs::read(&path).map_err(|err| CommandError::unknown(err.to_string()))?;
        if raw.len() > execs_core::hitsound::HITSOUND_MAX_BYTES {
            return Err(CommandError::unknown(
                "That file is too large for a hit sound (8 MB limit).",
            ));
        }
        let (wav, info) = execs_core::prepare_hitsound_wav(&raw)?;
        let converted = wav != raw;
        let token = crate::hitsound_fetch::stash_picked(&wav)?;
        Ok(Some(PickedHitsound {
            token,
            name,
            info,
            converted,
        }))
    })
    .await
}

/// What Apply should do with one slot.
#[derive(Debug, Clone, Deserialize)]
#[serde(tag = "change", rename_all = "camelCase")]
pub enum HitsoundSlotChange {
    Keep,
    Clear,
    Install { pick: HitsoundPick },
}

fn resolve_change(
    root: &std::path::Path,
    profile_id: &str,
    change: HitsoundSlotChange,
) -> Result<HitsoundChange, CommandError> {
    Ok(match change {
        HitsoundSlotChange::Keep => HitsoundChange::Keep,
        HitsoundSlotChange::Clear => HitsoundChange::Clear,
        HitsoundSlotChange::Install { pick } => {
            let entry =
                match &pick {
                    HitsoundPick::Community { name } => HitsoundEntry {
                        name: name.clone(),
                        source: HitsoundSource::Community,
                    },
                    HitsoundPick::File { name, .. } => HitsoundEntry {
                        name: name.clone(),
                        source: HitsoundSource::File,
                    },
                    HitsoundPick::Installed { .. } => {
                        return Err(CommandError::unknown(
                            "Choose a sound to install, or keep the current one.",
                        ))
                    }
                    HitsoundPick::Stock { .. } => return Err(CommandError::unknown(
                        "Stock sounds are chosen with the effect setting, not installed as files.",
                    )),
                };
            let raw = pick_bytes(root, profile_id, &pick)?;
            let (wav, _) = execs_core::prepare_hitsound_wav(&raw)?;
            HitsoundChange::Install { entry, wav }
        }
    })
}

#[tauri::command]
pub async fn apply_hitsounds(
    gate: tauri::State<'_, WriteGate>,
    hit: HitsoundSlotChange,
    kill: HitsoundSlotChange,
) -> Result<ProfileDetail, CommandError> {
    let _guard = gate.0.lock().await;
    with_profile(move |root, profile_id| {
        let hit = resolve_change(&root, &profile_id, hit)?;
        let kill = resolve_change(&root, &profile_id, kill)?;
        Ok(execs_core::apply_hitsounds(&root, &profile_id, hit, kill)?)
    })
    .await
}

#[tauri::command]
pub async fn remove_hitsounds(
    gate: tauri::State<'_, WriteGate>,
) -> Result<ProfileDetail, CommandError> {
    let _guard = gate.0.lock().await;
    with_profile(|root, profile_id| Ok(execs_core::remove_hitsounds(&root, &profile_id)?)).await
}
