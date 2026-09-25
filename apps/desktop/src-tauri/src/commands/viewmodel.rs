//! The Viewmodels pane: installed-source discovery and saved-pack management.

use std::collections::BTreeMap;

use execs_core::mods::MAX_MOD_BYTES;
use execs_core::viewmodel_graph::candidate_activity_graph;
use execs_core::viewmodel_group_selection::provisional_group_catalog_identity;
use execs_core::viewmodel_groups::derive_group_candidates;
use execs_core::viewmodel_items::read_stock_item_catalog;
use execs_core::viewmodel_scripts::read_stock_weapon_scripts;
use execs_core::viewmodel_source::{read_stock_animation_index, StockSourceError};
use execs_core::ProfileDetail;
use serde::Serialize;
use tauri::AppHandle;
use tauri_plugin_dialog::DialogExt;

use super::shared::{
    active_manifest, blocking, confirmed_root, read_bounded_file, vpk_too_large, with_profile,
    with_root, ActiveContext,
};
use crate::error::CommandError;
use crate::WriteGate;

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ViewmodelCatalogIdentity {
    patch_version: String,
    catalog_sha256: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ViewmodelCatalogSourceFingerprint {
    /// Canonical virtual source member, never a caller-supplied file path.
    id: String,
    sha256: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ViewmodelCatalogItem {
    id: u32,
    /// An installed schema identifier, not a localized display name.
    schema_name: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ViewmodelCatalogGroup {
    id: String,
    class: String,
    items: Vec<ViewmodelCatalogItem>,
    animations: Vec<String>,
    overlaps: Vec<String>,
    team_variants_differ: bool,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ViewmodelCatalogUnresolvedItem {
    class: String,
    item_id: u32,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ViewmodelSourceCatalog {
    /// Source-backed candidates; retail reachability and preview remain open.
    status: &'static str,
    catalog: ViewmodelCatalogIdentity,
    /// Sorted source IDs with the same shape as a stock-build recipe.
    source_fingerprints: Vec<ViewmodelCatalogSourceFingerprint>,
    groups: Vec<ViewmodelCatalogGroup>,
    unresolved_items: Vec<ViewmodelCatalogUnresolvedItem>,
    unresolved_role_count: usize,
    candidate_role_count: usize,
}

fn catalog_error(error: StockSourceError) -> CommandError {
    CommandError::new("SourceUnavailable", error.0)
}

fn insert_source_fingerprint(
    fingerprints: &mut BTreeMap<String, String>,
    path: String,
    sha256: String,
) -> Result<(), CommandError> {
    let id = path.to_ascii_lowercase();
    match fingerprints.entry(id) {
        std::collections::btree_map::Entry::Vacant(entry) => {
            entry.insert(sha256);
            Ok(())
        }
        std::collections::btree_map::Entry::Occupied(entry) => Err(CommandError::new(
            "SourceUnavailable",
            format!(
                "TF2 Viewmodels sources contain duplicate canonical member {}",
                entry.key()
            ),
        )),
    }
}

/// Inspect only the confirmed local TF2 install. The catalog hash binds group
/// membership and animations; source digests let a later Build request reject
/// stale schema, scripts or MDLs even when those groups happen to stay equal.
/// This command does not create, install, or validate a playable pack.
#[tauri::command]
pub async fn get_viewmodel_source_catalog() -> Result<ViewmodelSourceCatalog, CommandError> {
    with_root(|root| {
        let items = read_stock_item_catalog(&root).map_err(catalog_error)?;
        let scripts = read_stock_weapon_scripts(&root).map_err(catalog_error)?;
        let models = read_stock_animation_index(&root).map_err(catalog_error)?;
        let graph = candidate_activity_graph(&items, &scripts, &models).map_err(catalog_error)?;
        let unresolved_role_count = graph.unresolved_roles.len();
        let candidate_role_count = graph.candidate_roles.len();
        let candidates = derive_group_candidates(&graph).map_err(catalog_error)?;
        let identity = provisional_group_catalog_identity(&candidates).map_err(catalog_error)?;

        // These readers each recheck their own bytes. Repeat all three after
        // composition so a source changing between those reads cannot yield a
        // mixed-patch or mixed-content catalog.
        if read_stock_item_catalog(&root).map_err(catalog_error)? != items
            || read_stock_weapon_scripts(&root).map_err(catalog_error)? != scripts
            || read_stock_animation_index(&root).map_err(catalog_error)? != models
        {
            return Err(CommandError::new(
                "SourceChanged",
                "TF2 Viewmodels sources changed during catalog inspection. Refresh and try again.",
            ));
        }
        if confirmed_root()? != root {
            return Err(CommandError::new(
                "RootChanged",
                "The confirmed TF2 folder changed during catalog inspection. Refresh and try again.",
            ));
        }

        let mut groups = candidates
            .groups
            .into_iter()
            .map(|group| {
                let items = group
                    .item_ids
                    .into_iter()
                    .map(|id| {
                        let item = items.items.get(&id).ok_or_else(|| {
                            CommandError::new(
                                "SourceUnavailable",
                                format!("Viewmodels group references missing item {id}"),
                            )
                        })?;
                        Ok(ViewmodelCatalogItem {
                            id,
                            schema_name: item.name.clone(),
                        })
                    })
                    .collect::<Result<Vec<_>, CommandError>>()?;
                Ok(ViewmodelCatalogGroup {
                    id: group.id,
                    class: group.class,
                    items,
                    animations: group.animations,
                    overlaps: group.overlaps,
                    team_variants_differ: group.team_variants_differ,
                })
            })
            .collect::<Result<Vec<_>, CommandError>>()?;
        groups.sort_by(|left, right| left.id.cmp(&right.id));
        let mut source_fingerprints = BTreeMap::new();
        insert_source_fingerprint(
            &mut source_fingerprints,
            "scripts/items/items_game.txt".to_string(),
            items.schema_sha256,
        )?;
        for script in scripts.scripts.into_values() {
            insert_source_fingerprint(&mut source_fingerprints, script.path, script.sha256)?;
        }
        for (class, model) in models.models {
            insert_source_fingerprint(
                &mut source_fingerprints,
                format!("models/weapons/c_models/c_{class}_animations.mdl"),
                model.sha256,
            )?;
        }
        Ok(ViewmodelSourceCatalog {
            status: "provisional",
            catalog: ViewmodelCatalogIdentity {
                patch_version: identity.patch_version.clone(),
                catalog_sha256: identity.catalog_sha256,
            },
            source_fingerprints: source_fingerprints
                .into_iter()
                .map(|(id, sha256)| ViewmodelCatalogSourceFingerprint { id, sha256 })
                .collect(),
            groups,
            unresolved_items: candidates
                .unresolved_items
                .into_iter()
                .map(|(class, item_id)| ViewmodelCatalogUnresolvedItem { class, item_id })
                .collect(),
            unresolved_role_count,
            candidate_role_count,
        })
    })
    .await
}

/// Older frontends may still invoke this command. Refuse before reading a
/// profile, acquiring the write gate, or reaching any third-party source.
#[tauri::command]
pub async fn build_viewmodel_pack(
    hidden: Vec<String>,
    preload: bool,
    hide_mode: Option<String>,
) -> Result<ProfileDetail, CommandError> {
    let _ = (hidden, preload, hide_mode);
    Err(builder_unavailable_error())
}

fn builder_unavailable_error() -> CommandError {
    CommandError::new(
        "SourceUnavailable",
        "Viewmodel building is temporarily unavailable while the replacement builder is completed. Import a model-only VPK for now.",
    )
}

/// Refuse old preview requests before reaching any third-party source.
#[tauri::command]
pub async fn viewmodel_preview_image(name: String) -> Result<tauri::ipc::Response, CommandError> {
    let _ = name;
    Err(builder_unavailable_error())
}

/// Compatibility response for a cached older frontend.
#[tauri::command]
pub async fn viewmodel_build_available() -> Result<bool, CommandError> {
    Ok(false)
}

#[tauri::command]
pub async fn import_viewmodels(
    gate: tauri::State<'_, WriteGate>,
    app: AppHandle,
    preload: bool,
) -> Result<Option<ProfileDetail>, CommandError> {
    let (context, initial_viewmodel) = with_profile(|root, profile_id| {
        execs_core::refuse_if_running()?;
        let manifest = active_manifest(&profile_id)?;
        Ok((
            ActiveContext::capture(&root, &profile_id),
            manifest.viewmodel,
        ))
    })
    .await?;
    let picked = tauri::async_runtime::spawn_blocking(move || {
        app.dialog()
            .file()
            .set_title("Import viewmodel VPK")
            .add_filter("VPK", &["vpk"])
            .blocking_pick_file()
    })
    .await
    .map_err(|err| CommandError::unknown(err.to_string()))?;
    let Some(picked) = picked else {
        // Cancelling the picker is a no-op, not an error.
        return Ok(None);
    };
    let path = picked
        .into_path()
        .map_err(|err| CommandError::unknown(err.to_string()))?;
    // Own the bounded bytes before reserving the writer; a 512 MiB local VPK
    // should not stall unrelated autosaves while it is being read.
    let bytes =
        blocking(move || read_bounded_file(&path, MAX_MOD_BYTES, vpk_too_large(MAX_MOD_BYTES)))
            .await?;
    let _guard = gate.lock_for_write().await?;
    with_profile(move |root, profile_id| {
        context.ensure_current(&root, &profile_id)?;
        ensure_viewmodel_unchanged(&profile_id, initial_viewmodel.as_ref())?;
        Ok(execs_core::import_viewmodel_vpk(
            &root,
            &profile_id,
            &bytes,
            preload,
        )?)
    })
    .await
    .map(Some)
}

fn ensure_viewmodel_unchanged(
    profile_id: &str,
    expected: Option<&execs_core::ViewmodelRecord>,
) -> Result<(), CommandError> {
    if active_manifest(profile_id)?.viewmodel.as_ref() == expected {
        Ok(())
    } else {
        Err(CommandError::new(
            "ProfileChanged",
            "The installed viewmodel pack changed while that work was running. Try again.",
        ))
    }
}

#[tauri::command]
pub async fn remove_viewmodels(
    gate: tauri::State<'_, WriteGate>,
) -> Result<ProfileDetail, CommandError> {
    let _guard = gate.lock_for_write().await?;
    with_profile(|root, profile_id| Ok(execs_core::remove_viewmodels(&root, &profile_id)?)).await
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rejects_case_colliding_source_ids_without_replacing_the_first_digest() {
        let mut fingerprints = BTreeMap::new();
        insert_source_fingerprint(
            &mut fingerprints,
            "scripts/TF_Weapon_RocketLauncher.ctx".into(),
            "first".into(),
        )
        .unwrap();
        let error = insert_source_fingerprint(
            &mut fingerprints,
            "scripts/tf_weapon_rocketlauncher.ctx".into(),
            "second".into(),
        )
        .unwrap_err();
        assert_eq!(error.code, "SourceUnavailable");
        assert!(error
            .message
            .contains("scripts/tf_weapon_rocketlauncher.ctx"));
        assert_eq!(fingerprints.len(), 1);
        assert_eq!(
            fingerprints["scripts/tf_weapon_rocketlauncher.ctx"],
            "first"
        );
    }

    #[test]
    fn old_builder_and_preview_requests_are_refused_without_io() {
        tauri::async_runtime::block_on(async {
            assert!(!viewmodel_build_available().await.unwrap());
            let build = build_viewmodel_pack(vec!["legacy/one".into()], true, None)
                .await
                .unwrap_err();
            assert_eq!(build.code, "SourceUnavailable");
            let preview = viewmodel_preview_image("legacy_preview".into())
                .await
                .err()
                .expect("preview requests must be rejected");
            assert_eq!(preview.code, "SourceUnavailable");
        });
    }
}
