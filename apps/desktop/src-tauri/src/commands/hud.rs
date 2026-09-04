//! The HUD pane: hud-db catalog, pinned zip installs, schema options.

use std::collections::BTreeMap;
use std::path::Path;

use execs_core::{HudCatalogEntry, HudSchemaView, HudUiState, ProfileDetail};
use serde::Serialize;
use tauri::AppHandle;
use tauri_plugin_dialog::DialogExt;

use super::shared::{
    active_manifest, archive_too_large, blocking, refuse_oversize_file, with_profile,
};
use crate::error::CommandError;
use crate::hud_fetch::HUD_ZIP_MAX_BYTES;
use crate::WriteGate;

#[tauri::command]
pub async fn get_hud_catalog(refresh: bool) -> Result<Vec<HudCatalogEntry>, CommandError> {
    blocking(move || Ok(crate::hud_fetch::load_or_fetch_catalog(refresh)?)).await
}

/// `HudUiState` plus one honest bit. When the catalog cannot be read (offline
/// with a cold cache), a state computed against an empty catalog would have
/// the pane say "up to date" while it knows nothing.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HudStatePayload {
    #[serde(flatten)]
    pub state: HudUiState,
    pub catalog_unavailable: bool,
}

/// Popularity and recency per HUD id, from comfig.app (last updated) and
/// tf2huds.dev (downloads, views). Cached for a day; `refresh` forces a read.
#[tauri::command]
pub async fn get_hud_stats(
    refresh: bool,
) -> Result<BTreeMap<String, crate::hud_stats::HudStat>, CommandError> {
    blocking(move || Ok(crate::hud_stats::load_or_fetch_stats(refresh)?)).await
}

/// The pictures behind a HUD's external album (Imgur, or a GitHub showcase
/// page), so the lightbox can show them in-app instead of linking out.
#[tauri::command]
pub async fn get_hud_album(id: String) -> Result<Vec<crate::hud_fetch::AlbumImage>, CommandError> {
    blocking(move || {
        let entry = crate::hud_fetch::catalog_entry(&id)?;
        let Some(album) = entry.album else {
            return Ok(Vec::new());
        };
        Ok(crate::hud_fetch::fetch_hud_album(&album)?)
    })
    .await
}

#[tauri::command]
pub async fn get_hud_state() -> Result<HudStatePayload, CommandError> {
    with_profile(|_root, profile_id| {
        let catalog = crate::hud_fetch::load_or_fetch_catalog(false);
        let catalog_unavailable = catalog.is_err();
        let catalog = catalog.unwrap_or_default();
        let manifest = active_manifest(&profile_id)?;
        Ok(HudStatePayload {
            state: execs_core::hud_ui_state(&manifest, &catalog),
            catalog_unavailable,
        })
    })
    .await
}

/// The HUD zip (up to 512 MiB) is downloaded before the write gate is taken,
/// so an autosave or absorb is not queued behind a slow link; the
/// running-game check comes first so the user hears "close TF2" before the
/// transfer, not after it. Core re-checks under the gate before it writes.
#[tauri::command]
pub async fn install_hud(
    gate: tauri::State<'_, WriteGate>,
    id: String,
) -> Result<ProfileDetail, CommandError> {
    let fetched = with_profile(move |_root, _profile_id| {
        execs_core::refuse_if_running()?;
        fetch_hud_from_catalog(&id)
    })
    .await?;
    let _guard = gate.0.lock().await;
    with_profile(move |root, profile_id| install_fetched_hud(&root, &profile_id, fetched, false))
        .await
}

/// Install a HUD the user has on disk as a zip or 7z. The folder name comes
/// from the archive's; the record is `Local` (no catalog hash, so no update
/// checks) until Match to catalog pairs it with a hud-db entry.
#[tauri::command]
pub async fn import_hud_archive(
    gate: tauri::State<'_, WriteGate>,
    app: AppHandle,
) -> Result<Option<ProfileDetail>, CommandError> {
    let picked = tauri::async_runtime::spawn_blocking(move || {
        app.dialog()
            .file()
            .set_title("Import a HUD archive")
            .add_filter("HUD archive", &["zip", "7z"])
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
    let _guard = gate.0.lock().await;
    with_profile(move |root, profile_id| {
        let name = path
            .file_name()
            .map(|name| name.to_string_lossy().into_owned())
            .unwrap_or_default();
        // Refused by its size on disk before it is read whole: a file past
        // the unpack ceiling cannot unpack to less.
        refuse_oversize_file(
            &path,
            HUD_ZIP_MAX_BYTES,
            archive_too_large(HUD_ZIP_MAX_BYTES),
        )?;
        let bytes = std::fs::read(&path).map_err(|err| CommandError::unknown(err.to_string()))?;
        let extracted = execs_core::extract_hud_archive(&bytes)?;
        Ok(Some(install_local_hud(
            &root,
            &profile_id,
            &name,
            extracted.tree,
        )?))
    })
    .await
}

/// Install a HUD from a folder on disk (an extracted download, or one the
/// user maintains). Same rules as the archive path.
#[tauri::command]
pub async fn import_hud_folder(
    gate: tauri::State<'_, WriteGate>,
    app: AppHandle,
) -> Result<Option<ProfileDetail>, CommandError> {
    let picked = tauri::async_runtime::spawn_blocking(move || {
        app.dialog()
            .file()
            .set_title("Import a HUD folder")
            .blocking_pick_folder()
    })
    .await
    .map_err(|err| CommandError::unknown(err.to_string()))?;
    let Some(picked) = picked else {
        return Ok(None);
    };
    let path = picked
        .into_path()
        .map_err(|err| CommandError::unknown(err.to_string()))?;
    let _guard = gate.0.lock().await;
    with_profile(move |root, profile_id| {
        let name = path
            .file_name()
            .map(|name| name.to_string_lossy().into_owned())
            .unwrap_or_default();
        let extracted = execs_core::hud_tree_from_dir(&path)?;
        Ok(Some(install_local_hud(
            &root,
            &profile_id,
            &name,
            extracted.tree,
        )?))
    })
    .await
}

fn install_local_hud(
    root: &Path,
    profile_id: &str,
    name: &str,
    tree: execs_core::HudTree,
) -> Result<ProfileDetail, CommandError> {
    let id = execs_core::hud_id_from_name(name);
    let detail = execs_core::install_hud_pack(
        root,
        profile_id,
        &tree,
        execs_core::HudRecord {
            id,
            hash: None,
            source: execs_core::HudSource::Local,
            options: BTreeMap::new(),
        },
    )?;
    // A replaced catalog HUD may have left its option cfgs behind.
    execs_core::sync_hud_exec_lines(root, profile_id, &[])?;
    Ok(execs_core::get_active_profile_detail(root)?.unwrap_or(detail))
}

/// Pair a local HUD record with its hud-db entry. The catalog read may hit
/// the network; the manifest write under it takes the gate like every other
/// profile write.
#[tauri::command]
pub async fn match_hud_catalog(
    gate: tauri::State<'_, WriteGate>,
    id: String,
) -> Result<ProfileDetail, CommandError> {
    let entry = blocking(move || Ok(crate::hud_fetch::catalog_entry(&id)?)).await?;
    let _guard = gate.0.lock().await;
    with_profile(move |root, profile_id| {
        Ok(execs_core::match_hud_catalog(
            &root,
            &profile_id,
            &entry.id,
            Some(entry.hash),
        )?)
    })
    .await
}

/// Same shape as `install_hud`: the download runs before the gate, the
/// install under it, and the options the record already carries survive.
#[tauri::command]
pub async fn update_hud(gate: tauri::State<'_, WriteGate>) -> Result<ProfileDetail, CommandError> {
    let fetched = with_profile(|_root, profile_id| {
        execs_core::refuse_if_running()?;
        let manifest = active_manifest(&profile_id)?;
        let status = execs_core::resolve_hud(&manifest)
            .ok_or_else(|| CommandError::unknown("Install a HUD first."))?;
        fetch_hud_from_catalog(&status.record.id)
    })
    .await?;
    let _guard = gate.0.lock().await;
    with_profile(move |root, profile_id| install_fetched_hud(&root, &profile_id, fetched, true))
        .await
}

#[tauri::command]
pub async fn get_hud_schema() -> Result<Option<HudSchemaView>, CommandError> {
    with_profile(|_root, profile_id| {
        let manifest = active_manifest(&profile_id)?;
        let Some(status) = execs_core::resolve_hud(&manifest) else {
            return Ok(None);
        };
        if !execs_core::schema_supported(&status.record.id) {
            return Ok(None);
        }
        let raw = crate::hud_fetch::fetch_hud_schema(&status.record.id)?;
        let schema = execs_core::parse_hud_schema(&raw)?;
        Ok(Some(execs_core::schema_view(&schema)))
    })
    .await
}

#[tauri::command]
pub async fn apply_hud_options(
    gate: tauri::State<'_, WriteGate>,
    options: BTreeMap<String, String>,
) -> Result<ProfileDetail, CommandError> {
    let _guard = gate.0.lock().await;
    with_profile(move |root, profile_id| {
        let manifest = active_manifest(&profile_id)?;
        let status = execs_core::resolve_hud(&manifest)
            .ok_or_else(|| CommandError::unknown("Install a HUD first."))?;
        if !execs_core::schema_supported(&status.record.id) {
            return Err(CommandError::unknown("This HUD has no in-app options."));
        }
        let raw = crate::hud_fetch::fetch_hud_schema(&status.record.id)?;
        let schema = execs_core::parse_hud_schema(&raw)?;
        Ok(execs_core::apply_schema_options(
            &root,
            &profile_id,
            &schema,
            options,
        )?)
    })
    .await
}

/// A catalog HUD with its archive already extracted: the network half of an
/// install, done before the write gate is taken.
struct FetchedHud {
    entry: HudCatalogEntry,
    tree: execs_core::HudTree,
}

fn fetch_hud_from_catalog(id: &str) -> Result<FetchedHud, CommandError> {
    let entry = crate::hud_fetch::catalog_entry(id)?;
    if !entry.install.installable() {
        return Err(CommandError::unknown(
            crate::hud_fetch::no_download_message(),
        ));
    }
    let bytes = crate::hud_fetch::fetch_hud_archive(&entry)?;
    let extracted = execs_core::extract_hud_archive(&bytes)?;
    Ok(FetchedHud {
        entry,
        tree: extracted.tree,
    })
}

/// The disk half: apply the record's options to the tree, install the pack,
/// write the option cfgs and their exec lines.
fn install_fetched_hud(
    root: &Path,
    profile_id: &str,
    fetched: FetchedHud,
    preserve_options: bool,
) -> Result<ProfileDetail, CommandError> {
    let FetchedHud { entry, mut tree } = fetched;
    let manifest = execs_core::load_manifest(&execs_core::profiles_dir(), profile_id)?;
    let layer = execs_core::apply::cfg_layer_from_files(&manifest.files);
    let mut options = BTreeMap::new();
    if preserve_options {
        if let Some(hud) = manifest.hud {
            options = hud.options;
        }
    }
    let mut cfg_writes = Vec::new();
    let mut exec_stems = Vec::new();
    if execs_core::schema_supported(&entry.id) && !options.is_empty() {
        let raw = crate::hud_fetch::fetch_hud_schema(&entry.id)?;
        let schema = execs_core::parse_hud_schema(&raw)?;
        let applied = execs_core::apply_hud_options_for_layer(
            &mut tree, &schema, &entry.id, &options, layer,
        )?;
        cfg_writes = applied.cfg_writes;
        exec_stems = applied.exec_stems;
    }
    let detail = execs_core::install_hud_pack(
        root,
        profile_id,
        &tree,
        execs_core::HudRecord {
            id: entry.id.clone(),
            hash: Some(entry.hash),
            source: execs_core::HudSource::HudDb,
            options,
        },
    )?;
    let cfg_writes_written = cfg_writes.len();
    for (path, bytes) in cfg_writes {
        execs_core::write_owned_file(root, profile_id, &path, &bytes)?;
    }
    // A replaced HUD drops the previous HUD's option cfgs from autoexec; a HUD
    // with options gets its execs_hud_* lines so the WriteCfg files actually run.
    execs_core::sync_hud_exec_lines(root, profile_id, &exec_stems)?;
    if exec_stems.is_empty() && cfg_writes_written == 0 {
        return Ok(detail);
    }
    Ok(execs_core::get_active_profile_detail(root)?.unwrap_or(detail))
}

#[cfg(test)]
mod tests {
    use super::*;

    /// The frontend's `HudUiState` shape must survive the added field: the
    /// original keys stay flat and top-level, `catalogUnavailable` rides
    /// alongside them.
    #[test]
    fn the_payload_is_hud_ui_state_plus_one_camel_case_flag() {
        let payload = HudStatePayload {
            state: HudUiState {
                installed: None,
                inferred: false,
                schema_supported: true,
                catalog_hash: None,
                update_available: false,
            },
            catalog_unavailable: true,
        };
        let json = serde_json::to_value(payload).unwrap();
        assert_eq!(json["catalogUnavailable"], true);
        assert_eq!(json["schemaSupported"], true);
        assert_eq!(json["updateAvailable"], false);
        assert!(json.get("state").is_none(), "the state must stay flat");
    }
}
