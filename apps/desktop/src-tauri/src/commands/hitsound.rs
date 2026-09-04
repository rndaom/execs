//! The Sounds pane: hit and kill sounds.

use execs_core::hitsound::HITSOUND_MAX_BYTES;
use execs_core::{
    HitsoundChange, HitsoundEntry, HitsoundKind, HitsoundSource, ProfileDetail, WavInfo,
};
use serde::{Deserialize, Serialize};
use tauri::AppHandle;
use tauri_plugin_dialog::DialogExt;

use super::shared::{blocking, read_bounded_file, with_profile, with_root, ActiveContext};
use crate::error::CommandError;
use crate::{HitsoundCacheGate, WriteGate};

/// What a picked WAV past the engine cap is told, before and after reading.
const HITSOUND_TOO_LARGE: &str = "That file is too large for a hit sound (8 MB limit).";
const ABANDONED_PICK_MAX_AGE: std::time::Duration =
    std::time::Duration::from_secs(7 * 24 * 60 * 60);

fn gc_picked_for_library(root: &std::path::Path) -> Result<(), CommandError> {
    let library = execs_core::load_library(Some(root))?;
    let mut referenced = Vec::new();
    for profile in library.profiles {
        let manifest = execs_core::load_manifest(&execs_core::profiles_dir(), &profile.id)?;
        let Some(record) = manifest.hitsound else {
            continue;
        };
        referenced.extend(
            [record.hit, record.kill]
                .into_iter()
                .flatten()
                .filter_map(|entry| entry.token),
        );
    }
    crate::hitsound_fetch::gc_picked(&referenced, ABANDONED_PICK_MAX_AGE)?;
    Ok(())
}

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
    /// A comfig.app hits-library entry by its opaque 128-hex object id.
    Comfig { hash: String, name: String },
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
        HitsoundPick::Comfig { hash, .. } => Ok(crate::hitsound_fetch::fetch_comfig_wav(hash)?),
        HitsoundPick::Stock { stem } => {
            let stock = execs_core::extract_stock_hitsounds(root)?;
            stock
                .get(&stem.to_ascii_lowercase())
                .cloned()
                .ok_or_else(|| CommandError::unknown("That stock sound was not found in the VPK."))
        }
    }
}

/// WAV bytes for the audio element as a `Response`. ADPCM sources (every
/// comfig.app sound) are decoded to PCM for the preview only; what gets
/// installed is still the original file.
#[tauri::command]
pub async fn hitsound_bytes(pick: HitsoundPick) -> Result<tauri::ipc::Response, CommandError> {
    let bytes = with_profile(move |root, profile_id| {
        Ok(execs_core::preview_wav(&pick_bytes(
            &root,
            &profile_id,
            &pick,
        )?))
    })
    .await?;
    Ok(tauri::ipc::Response::new(bytes))
}

/// comfig.app's hits library (pinned index), for the browsable list.
#[tauri::command]
pub async fn comfig_hitsound_index(
) -> Result<Vec<crate::hitsound_fetch::ComfigHitsound>, CommandError> {
    blocking(|| Ok(crate::hitsound_fetch::fetch_comfig_index()?)).await
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
pub async fn pick_hitsound_file(
    app: AppHandle,
    cache_gate: tauri::State<'_, HitsoundCacheGate>,
) -> Result<Option<PickedHitsound>, CommandError> {
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
    let (name, wav, info, converted) = blocking(move || {
        let name = path
            .file_name()
            .map(|name| name.to_string_lossy().into_owned())
            .unwrap_or_else(|| "sound.wav".into());
        // Refused by its size on disk before it is read whole; the same
        // sentence guards the bytes below for a file that grew in between.
        let raw = read_bounded_file(&path, HITSOUND_MAX_BYTES as u64, HITSOUND_TOO_LARGE)?;
        let (wav, info) = execs_core::prepare_hitsound_wav(&raw)?;
        let converted = wav != raw;
        Ok((name, wav, info, converted))
    })
    .await?;
    // A concurrent Apply may hold an old picked token while it resolves and
    // commits its manifest reference. Stash and sweep under that same cache
    // lock so neither side can delete the other's in-flight source.
    let _cache_guard = cache_gate.0.lock().await;
    blocking(move || {
        let token = crate::hitsound_fetch::stash_picked(&wav)?;
        if let Some(root) = execs_core::remembered_tf2_root() {
            let _ = gc_picked_for_library(&root);
        }
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
    Install {
        pick: HitsoundPick,
        /// 0, 6 or 12 dB applied to the file itself.
        #[serde(default)]
        boost: u8,
    },
}

fn resolve_change(
    root: &std::path::Path,
    profile_id: &str,
    change: HitsoundSlotChange,
) -> Result<HitsoundChange, CommandError> {
    Ok(match change {
        HitsoundSlotChange::Keep => HitsoundChange::Keep,
        HitsoundSlotChange::Clear => HitsoundChange::Clear,
        HitsoundSlotChange::Install { pick, boost } => {
            let boost = execs_core::clamp_boost_db(boost);
            let (entry, raw) =
                match &pick {
                    HitsoundPick::Community { name } => (
                        HitsoundEntry::new(name.clone(), HitsoundSource::Community),
                        pick_bytes(root, profile_id, &pick)?,
                    ),
                    HitsoundPick::File { name, token } => {
                        let mut entry = HitsoundEntry::new(name.clone(), HitsoundSource::File);
                        entry.token = Some(token.clone());
                        (entry, pick_bytes(root, profile_id, &pick)?)
                    }
                    HitsoundPick::Comfig { name, hash } => {
                        let mut entry = HitsoundEntry::new(name.clone(), HitsoundSource::Comfig);
                        entry.hash = Some(hash.clone());
                        (entry, pick_bytes(root, profile_id, &pick)?)
                    }
                    // Re-install what is already there at a different boost: the
                    // installed bytes are already boosted, so go back to the source.
                    HitsoundPick::Installed { slot } => installed_source(profile_id, *slot)?,
                    HitsoundPick::Stock { .. } => return Err(CommandError::unknown(
                        "Stock sounds are chosen with the effect setting, not installed as files.",
                    )),
                };
            let mut entry = entry;
            entry.boost = boost;
            let (wav, _) = execs_core::prepare_hitsound_wav_boosted(&raw, boost)?;
            HitsoundChange::Install { entry, wav }
        }
    })
}

/// The installed entry of a slot plus its original (unboosted) bytes.
fn installed_source(
    profile_id: &str,
    slot: HitsoundKind,
) -> Result<(HitsoundEntry, Vec<u8>), CommandError> {
    let record = execs_core::load_manifest(&execs_core::profiles_dir(), profile_id)?
        .hitsound
        .unwrap_or_default();
    let entry = match slot {
        HitsoundKind::Hit => record.hit,
        HitsoundKind::Kill => record.kill,
    }
    .ok_or_else(|| CommandError::unknown("Nothing is installed in that slot."))?;
    // The installed bytes are the source whenever nothing was baked into them
    // yet; only an already-boosted entry has to go back to where it came from.
    let installed = || {
        if entry.boost == 0 {
            execs_core::stored_hitsound(&execs_core::profiles_dir(), profile_id, slot)
        } else {
            None
        }
    };
    let raw = match entry.source {
        HitsoundSource::Community => crate::hitsound_fetch::fetch_community_wav(&entry.name)
            .or_else(|err| installed().ok_or(CommandError::unknown(err)))?,
        HitsoundSource::Comfig => match entry.hash.as_deref() {
            Some(hash) => crate::hitsound_fetch::fetch_comfig_wav(hash)
                .or_else(|err| installed().ok_or(CommandError::unknown(err)))?,
            None => installed().ok_or_else(|| {
                CommandError::unknown("Pick this sound from the library again to change its boost.")
            })?,
        },
        HitsoundSource::File => entry
            .token
            .as_deref()
            .and_then(|token| crate::hitsound_fetch::read_picked(token).ok())
            .or_else(installed)
            .ok_or_else(|| CommandError::unknown("Pick the file again to change its boost."))?,
    };
    Ok((entry, raw))
}

#[tauri::command]
pub async fn apply_hitsounds(
    gate: tauri::State<'_, WriteGate>,
    cache_gate: tauri::State<'_, HitsoundCacheGate>,
    hit: HitsoundSlotChange,
    kill: HitsoundSlotChange,
) -> Result<ProfileDetail, CommandError> {
    // Keep every picked source alive until the profile manifest names it.
    // This cache-only lock may span a remote fetch, but never blocks unrelated
    // profile writes; all commands that take both locks use cache -> write.
    let _cache_guard = cache_gate.0.lock().await;
    let (context, hit, kill) = with_profile(move |root, profile_id| {
        execs_core::refuse_if_running()?;
        let context = ActiveContext::capture(&root, &profile_id);
        let hit = resolve_change(&root, &profile_id, hit)?;
        let kill = resolve_change(&root, &profile_id, kill)?;
        Ok((context, hit, kill))
    })
    .await?;
    let _guard = gate.lock_for_write().await?;
    with_profile(move |root, profile_id| {
        context.ensure_current(&root, &profile_id)?;
        let detail = execs_core::apply_hitsounds(&root, &profile_id, hit, kill)?;
        // Cache cleanup is post-commit and retryable; it must never make a
        // successful sound install look rolled back to the renderer.
        let _ = gc_picked_for_library(&root);
        Ok(detail)
    })
    .await
}

#[tauri::command]
pub async fn remove_hitsounds(
    gate: tauri::State<'_, WriteGate>,
    cache_gate: tauri::State<'_, HitsoundCacheGate>,
) -> Result<ProfileDetail, CommandError> {
    let _cache_guard = cache_gate.0.lock().await;
    let _guard = gate.lock_for_write().await?;
    with_profile(|root, profile_id| {
        let detail = execs_core::remove_hitsounds(&root, &profile_id)?;
        let _ = gc_picked_for_library(&root);
        Ok(detail)
    })
    .await
}
