//! The HUD pane: hud-db catalog, pinned zip installs, schema options.

use std::collections::BTreeMap;
use std::path::Path;

use execs_core::{HudCatalogEntry, HudSchemaView, HudUiState, ProfileDetail};
use serde::Serialize;
use tauri::AppHandle;
use tauri_plugin_dialog::DialogExt;

use super::shared::{
    active_manifest, archive_too_large, blocking, read_bounded_file, with_profile, with_root,
    ActiveContext,
};
use crate::error::CommandError;
use crate::hud_fetch::HUD_ZIP_MAX_BYTES;
use crate::WriteGate;

#[tauri::command]
pub async fn get_hud_ownership(
    profile_id: String,
) -> Result<execs_core::hud::HudOwnershipReview, CommandError> {
    with_root(move |root| {
        Ok(execs_core::hud::get_hud_ownership_to(
            &execs_core::profiles_dir(),
            &root,
            &profile_id,
        )?)
    })
    .await
}

#[tauri::command]
pub async fn select_profile_hud(
    gate: tauri::State<'_, WriteGate>,
    profile_id: String,
    hud_folder: String,
    expected_fingerprint: String,
) -> Result<ProfileDetail, CommandError> {
    let _guard = gate.lock_for_write().await?;
    with_root(move |root| {
        Ok(execs_core::hud::select_profile_hud_to(
            &execs_core::profiles_dir(),
            &root,
            &profile_id,
            &hud_folder,
            &expected_fingerprint,
            execs_core::process_lock::live_process_names(),
        )?)
    })
    .await
}

#[tauri::command]
pub async fn get_hud_catalog(
    refresh: bool,
) -> Result<crate::hud_fetch::HudCatalogPayload, CommandError> {
    blocking(move || Ok(crate::hud_fetch::load_catalog_payload(refresh)?)).await
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
    pub profile_id: String,
}

/// TF2 HUDs listing activity and popularity per hud-db id. The date describes
/// the tf2huds.dev listing, not a hud-db release. Cached for a day.
#[tauri::command]
pub async fn get_hud_stats(
    refresh: bool,
) -> Result<crate::hud_stats::HudStatsPayload, CommandError> {
    blocking(move || Ok(crate::hud_stats::load_or_fetch_stats(refresh)?)).await
}

/// The pictures behind a HUD's external album (Imgur, or a GitHub showcase
/// page), so the lightbox can show them in-app instead of linking out.
#[tauri::command]
pub async fn get_hud_album(
    id: String,
    refresh: Option<bool>,
) -> Result<Vec<crate::hud_fetch::AlbumImage>, CommandError> {
    blocking(move || {
        let entry = crate::hud_fetch::catalog_entry(&id)?;
        let Some(album) = entry.album else {
            return Ok(Vec::new());
        };
        Ok(crate::hud_fetch::fetch_hud_album(
            &album,
            refresh.unwrap_or(false),
        )?)
    })
    .await
}

#[tauri::command]
pub async fn get_hud_state() -> Result<HudStatePayload, CommandError> {
    with_profile(|_root, profile_id| {
        // This command is local even with an empty/offline catalog. The UI
        // refreshes the catalog independently and asks for update state again.
        let catalog = crate::hud_fetch::load_cached_catalog_payload()
            .ok()
            .flatten();
        let catalog_unavailable = catalog.as_ref().is_none_or(|value| value.warning.is_some());
        let catalog = catalog.map(|value| value.entries).unwrap_or_default();
        let manifest = active_manifest(&profile_id)?;
        Ok(HudStatePayload {
            state: execs_core::hud_ui_state(&manifest, &catalog),
            catalog_unavailable,
            profile_id,
        })
    })
    .await
}

/// Download outside the write gate so autosave and absorb can continue.
/// Check TF2 before downloading; core checks again under the gate before writing.
#[tauri::command]
pub async fn install_hud(
    gate: tauri::State<'_, WriteGate>,
    id: String,
) -> Result<ProfileDetail, CommandError> {
    let (context, initial_hud, fetched) = with_profile(move |root, profile_id| {
        execs_core::refuse_if_running()?;
        let manifest = active_manifest(&profile_id)?;
        Ok((
            ActiveContext::capture(&root, &profile_id),
            manifest.hud,
            fetch_hud_from_catalog(&id, false)?,
        ))
    })
    .await?;
    let _guard = gate.lock_for_write().await?;
    with_profile(move |root, profile_id| {
        context.ensure_current(&root, &profile_id)?;
        ensure_hud_unchanged(
            &profile_id,
            initial_hud.as_ref(),
            "The installed HUD changed while that download was running. Try again.",
        )?;
        install_fetched_hud(&root, &profile_id, fetched, false)
    })
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
    let (context, initial_hud) = with_profile(|root, profile_id| {
        execs_core::refuse_if_running()?;
        let manifest = active_manifest(&profile_id)?;
        Ok((ActiveContext::capture(&root, &profile_id), manifest.hud))
    })
    .await?;
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
    // Reading and unpacking a user-controlled archive can take seconds. Keep
    // it outside the write gate, then verify the initiating profile before
    // publishing the fully owned tree.
    let (name, tree) = blocking(move || {
        let name = path
            .file_name()
            .map(|name| name.to_string_lossy().into_owned())
            .unwrap_or_default();
        let bytes = read_bounded_file(
            &path,
            HUD_ZIP_MAX_BYTES,
            archive_too_large(HUD_ZIP_MAX_BYTES),
        )?;
        Ok((
            name,
            execs_core::extract_hud_archive(&bytes)
                .map_err(hud_input_error)?
                .tree,
        ))
    })
    .await?;
    let _guard = gate.lock_for_write().await?;
    with_profile(move |root, profile_id| {
        context.ensure_current(&root, &profile_id)?;
        ensure_hud_unchanged(
            &profile_id,
            initial_hud.as_ref(),
            "The installed HUD changed while that archive was being read. Try again.",
        )?;
        Ok(Some(install_local_hud(&root, &profile_id, &name, tree)?))
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
    let (context, initial_hud) = with_profile(|root, profile_id| {
        execs_core::refuse_if_running()?;
        let manifest = active_manifest(&profile_id)?;
        Ok((ActiveContext::capture(&root, &profile_id), manifest.hud))
    })
    .await?;
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
    let (name, tree) = blocking(move || {
        let name = path
            .file_name()
            .map(|name| name.to_string_lossy().into_owned())
            .unwrap_or_default();
        Ok((
            name,
            execs_core::hud_tree_from_dir(&path)
                .map_err(hud_input_error)?
                .tree,
        ))
    })
    .await?;
    let _guard = gate.lock_for_write().await?;
    with_profile(move |root, profile_id| {
        context.ensure_current(&root, &profile_id)?;
        ensure_hud_unchanged(
            &profile_id,
            initial_hud.as_ref(),
            "The installed HUD changed while that folder was being read. Try again.",
        )?;
        Ok(Some(install_local_hud(&root, &profile_id, &name, tree)?))
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
    Ok(execs_core::install_hud_pack_with_cfgs(
        root,
        profile_id,
        &tree,
        execs_core::HudRecord {
            id,
            hash: None,
            source: execs_core::HudSource::Local,
            options: BTreeMap::new(),
        },
        &[],
    )?)
}

// These errors describe rejected input before any profile write. Keep the
// core error code without its generic profile-library write failure prefix.
fn hud_input_error(error: execs_core::ProfileError) -> CommandError {
    match error {
        execs_core::ProfileError::Io(message) => CommandError::new("Io", message),
        other => other.into(),
    }
}

/// Pair a local HUD record with its hud-db entry. The catalog read may hit
/// the network; the manifest write under it takes the gate like every other
/// profile write.
#[tauri::command]
pub async fn match_hud_catalog(
    gate: tauri::State<'_, WriteGate>,
    id: String,
) -> Result<ProfileDetail, CommandError> {
    let (context, initial_hud, entry) = with_profile(move |root, profile_id| {
        let manifest = active_manifest(&profile_id)?;
        Ok((
            ActiveContext::capture(&root, &profile_id),
            manifest.hud,
            crate::hud_fetch::catalog_entry(&id)?,
        ))
    })
    .await?;
    let _guard = gate.lock_for_write().await?;
    with_profile(move |root, profile_id| {
        context.ensure_current(&root, &profile_id)?;
        ensure_hud_unchanged(
            &profile_id,
            initial_hud.as_ref(),
            "The installed HUD changed while the catalog was loading. Try again.",
        )?;
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
    let (context, initial_hud, fetched) = with_profile(|root, profile_id| {
        execs_core::refuse_if_running()?;
        let manifest = active_manifest(&profile_id)?;
        let status = execs_core::resolve_hud(&manifest)
            .ok_or_else(|| CommandError::unknown("Install a HUD first."))?;
        Ok((
            ActiveContext::capture(&root, &profile_id),
            status.record.clone(),
            fetch_hud_from_catalog(
                &status.record.id,
                execs_core::schema_supported(&status.record.id)
                    && !status.record.options.is_empty(),
            )?,
        ))
    })
    .await?;
    let _guard = gate.lock_for_write().await?;
    with_profile(move |root, profile_id| {
        context.ensure_current(&root, &profile_id)?;
        ensure_hud_unchanged(
            &profile_id,
            Some(&initial_hud),
            "The installed HUD changed while its update was downloading. Try again.",
        )?;
        install_fetched_hud(&root, &profile_id, fetched, true)
    })
    .await
}

#[tauri::command]
pub async fn get_hud_schema(
    expected_profile_id: String,
    expected_hud_id: String,
) -> Result<Option<HudSchemaView>, CommandError> {
    with_profile(move |_root, profile_id| {
        if profile_id != expected_profile_id {
            return Err(CommandError::new(
                "ProfileChanged",
                "The active profile changed. Reload HUD options.",
            ));
        }
        let manifest = active_manifest(&profile_id)?;
        let Some(status) = execs_core::resolve_hud(&manifest) else {
            return Ok(None);
        };
        if status.record.id != expected_hud_id {
            return Err(CommandError::new(
                "ProfileChanged",
                "The installed HUD changed. Reload HUD options.",
            ));
        }
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
    expected_profile_id: String,
    expected_hud_id: String,
) -> Result<ProfileDetail, CommandError> {
    let (context, initial_hud, schema) = with_profile(move |root, profile_id| {
        execs_core::refuse_if_running()?;
        let manifest = active_manifest(&profile_id)?;
        let initial_hud = manifest.hud.clone();
        let status = execs_core::resolve_hud(&manifest)
            .ok_or_else(|| CommandError::unknown("Install a HUD first."))?;
        ensure_hud_identity(
            &profile_id,
            &status.record.id,
            &expected_profile_id,
            &expected_hud_id,
        )?;
        if !execs_core::schema_supported(&status.record.id) {
            return Err(CommandError::unknown("This HUD has no in-app options."));
        }
        let raw = crate::hud_fetch::fetch_hud_schema(&status.record.id)?;
        Ok((
            ActiveContext::capture(&root, &profile_id),
            initial_hud,
            execs_core::parse_hud_schema(&raw)?,
        ))
    })
    .await?;
    let _guard = gate.lock_for_write().await?;
    with_profile(move |root, profile_id| {
        context.ensure_current(&root, &profile_id)?;
        ensure_hud_unchanged(
            &profile_id,
            initial_hud.as_ref(),
            "The installed HUD changed while its options were loading. Try again.",
        )?;
        Ok(execs_core::apply_schema_options(
            &root,
            &profile_id,
            &schema,
            options,
        )?)
    })
    .await
}

fn ensure_hud_unchanged(
    profile_id: &str,
    expected: Option<&execs_core::HudRecord>,
    message: &str,
) -> Result<(), CommandError> {
    let current = active_manifest(profile_id)?;
    if current.hud.as_ref() == expected {
        Ok(())
    } else {
        Err(CommandError::new("ProfileChanged", message))
    }
}

fn ensure_hud_identity(
    profile_id: &str,
    hud_id: &str,
    expected_profile_id: &str,
    expected_hud_id: &str,
) -> Result<(), CommandError> {
    if profile_id == expected_profile_id && hud_id == expected_hud_id {
        Ok(())
    } else {
        Err(CommandError::new(
            "ProfileChanged",
            "The profile or installed HUD changed. Reload HUD options before saving.",
        ))
    }
}

/// A catalog HUD with its archive already extracted: the network half of an
/// install, done before the write gate is taken.
struct FetchedHud {
    entry: HudCatalogEntry,
    tree: execs_core::HudTree,
    schema: Option<execs_core::HudSchema>,
}

fn fetch_hud_from_catalog(id: &str, include_schema: bool) -> Result<FetchedHud, CommandError> {
    let entry = crate::hud_fetch::catalog_entry(id)?;
    if !entry.install.installable() {
        return Err(CommandError::unknown(
            crate::hud_fetch::no_download_message(),
        ));
    }
    let bytes = crate::hud_fetch::fetch_hud_archive(&entry)?;
    let extracted = execs_core::extract_hud_archive(&bytes).map_err(hud_input_error)?;
    let schema = if include_schema {
        let raw = crate::hud_fetch::fetch_hud_schema(&entry.id)?;
        Some(execs_core::parse_hud_schema(&raw)?)
    } else {
        None
    };
    Ok(FetchedHud {
        entry,
        tree: extracted.tree,
        schema,
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
    let FetchedHud {
        entry,
        mut tree,
        schema,
    } = fetched;
    let manifest = execs_core::load_manifest(&execs_core::profiles_dir(), profile_id)?;
    if preserve_options
        && manifest
            .hud
            .as_ref()
            .is_none_or(|record| record.id != entry.id)
    {
        return Err(CommandError::new(
            "ProfileChanged",
            "The installed HUD changed while its update was downloading. Try again.",
        ));
    }
    let layer = execs_core::apply::cfg_layer_from_manifest(&execs_core::profiles_dir(), &manifest)?;
    let mut options = BTreeMap::new();
    if preserve_options {
        if let Some(hud) = manifest.hud {
            options = hud.options;
        }
    }
    let mut cfg_writes = Vec::new();
    if execs_core::schema_supported(&entry.id) && !options.is_empty() {
        let schema = schema.ok_or_else(|| {
            CommandError::unknown(
                "The HUD options changed while the download was running. Try again.",
            )
        })?;
        let applied = execs_core::apply_hud_options_for_layer(
            &mut tree, &schema, &entry.id, &options, layer,
        )?;
        cfg_writes = applied.cfg_writes;
    }
    Ok(execs_core::install_hud_pack_with_cfgs(
        root,
        profile_id,
        &tree,
        execs_core::HudRecord {
            id: entry.id.clone(),
            hash: Some(entry.hash),
            source: execs_core::HudSource::HudDb,
            options,
        },
        &cfg_writes,
    )?)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn queued_options_refuse_another_profile_or_hud_before_fetching_or_writing() {
        assert!(ensure_hud_identity("profile-a", "rayshud", "profile-a", "rayshud").is_ok());
        for (profile, hud) in [("profile-b", "rayshud"), ("profile-a", "budhud")] {
            let error = ensure_hud_identity(profile, hud, "profile-a", "rayshud").unwrap_err();
            assert_eq!(error.code, "ProfileChanged");
            assert!(error.message.contains("before saving"));
        }
    }

    #[test]
    fn rejected_hud_input_keeps_guidance_without_claiming_a_profile_write_failed() {
        let guidance = "This download contains multiple HUD folders: CRUELTY DEATH, CRUELTY LIFE. Extract it, then import the one HUD folder you want.";
        let error = hud_input_error(execs_core::ProfileError::Io(guidance.into()));
        assert_eq!(error.code, "Io");
        assert_eq!(error.message, guidance);

        let invalid = hud_input_error(execs_core::extract_hud_archive(b"garbage").unwrap_err());
        assert!(invalid.message.contains("not a zip or 7z"));
        assert!(!invalid.message.contains("profile library"));

        let lock = hud_input_error(execs_core::ProfileError::GameRunning);
        assert_eq!(lock.code, "GameRunning");
        assert_eq!(
            lock.message,
            execs_core::ProfileError::GameRunning.message()
        );
        let write_error: CommandError = execs_core::ProfileError::Io("disk full".into()).into();
        assert!(write_error.message.contains("profile library"));
    }

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
            profile_id: "profile-a".into(),
        };
        let json = serde_json::to_value(payload).unwrap();
        assert_eq!(json["catalogUnavailable"], true);
        assert_eq!(json["profileId"], "profile-a");
        assert_eq!(json["schemaSupported"], true);
        assert_eq!(json["updateAvailable"], false);
        assert!(json.get("state").is_none(), "the state must stay flat");
    }
}
