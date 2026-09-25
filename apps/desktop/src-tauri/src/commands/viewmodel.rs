//! The Viewmodels pane: installed-source discovery and saved-pack management.

use std::collections::{BTreeMap, BTreeSet};

use execs_core::mods::MAX_MOD_BYTES;
use execs_core::viewmodel_graph::candidate_activity_graph;
use execs_core::viewmodel_group_selection::provisional_group_catalog_identity;
use execs_core::viewmodel_group_selection::{
    ProvisionalGroupCatalogIdentity, ProvisionalGroupChoice, ProvisionalGroupRequest,
    ProvisionalHideMode,
};
use execs_core::viewmodel_groups::derive_group_candidates;
use execs_core::viewmodel_items::read_stock_item_catalog;
use execs_core::viewmodel_scripts::read_stock_weapon_scripts;
use execs_core::viewmodel_selected_pack::{
    prototype_selected_group_vpk_from_install, InstalledGroupVpkCandidate,
};
use execs_core::viewmodel_source::{read_stock_animation_index, StockSourceError};
use execs_core::{ProfileDetail, ProfileError};
use serde::{Deserialize, Serialize};
use tauri::AppHandle;
use tauri_plugin_dialog::DialogExt;

use super::shared::{
    active_manifest, blocking, confirmed_root, read_bounded_file, vpk_too_large, with_profile,
    with_root, ActiveContext,
};
use crate::error::CommandError;
use crate::WriteGate;

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ViewmodelCatalogIdentity {
    patch_version: String,
    catalog_sha256: String,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
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
    /// Installed weapon type, such as `tf_weapon_jar_milk`; reskins share it with their base.
    item_class: String,
    /// Effective loadout slot for the group's class, when the schema names one.
    slot: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ViewmodelCatalogGroup {
    id: String,
    class: String,
    items: Vec<ViewmodelCatalogItem>,
    animations: Vec<String>,
    /// An inspect-route group, separate from the weapon's ordinary actions.
    inspect: bool,
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

const MAX_BUILD_CHOICES: usize = 2048;
const MAX_BUILD_FINGERPRINTS: usize = 1024;

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ViewmodelBuildRequest {
    catalog: ViewmodelCatalogIdentity,
    source_fingerprints: Vec<ViewmodelCatalogSourceFingerprint>,
    choices: Vec<ViewmodelBuildChoice>,
    preload: bool,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct ViewmodelBuildChoice {
    group_id: String,
    mode: ViewmodelBuildMode,
}

#[derive(Debug, Clone, Copy, Deserialize)]
#[serde(rename_all = "camelCase")]
enum ViewmodelBuildMode {
    Full,
    Weapon,
}

fn invalid_build_selection(message: impl Into<String>) -> CommandError {
    CommandError::new("InvalidSelection", message)
}

fn is_sha256(value: &str) -> bool {
    value.len() == 64
        && value
            .bytes()
            .all(|byte| byte.is_ascii_digit() || (b'a'..=b'f').contains(&byte))
}

fn validate_build_request(request: &ViewmodelBuildRequest) -> Result<(), CommandError> {
    if request.catalog.patch_version.is_empty()
        || request.catalog.patch_version.len() > 128
        || request.catalog.patch_version.contains('\0')
        || !is_sha256(&request.catalog.catalog_sha256)
    {
        return Err(invalid_build_selection(
            "The Viewmodels catalog identity is invalid. Refresh the catalog.",
        ));
    }
    if request.choices.is_empty() || request.choices.len() > MAX_BUILD_CHOICES {
        return Err(invalid_build_selection(
            "Choose between one and 2048 Viewmodels groups to build.",
        ));
    }
    let mut choices = BTreeSet::new();
    for choice in &request.choices {
        let Some((class, digest)) = choice.group_id.split_once('/') else {
            return Err(invalid_build_selection("A Viewmodels group ID is invalid."));
        };
        if !matches!(
            class,
            "scout"
                | "soldier"
                | "pyro"
                | "demoman"
                | "heavy"
                | "engineer"
                | "medic"
                | "sniper"
                | "spy"
        ) || !is_sha256(digest)
            || !choices.insert(choice.group_id.as_str())
        {
            return Err(invalid_build_selection(
                "A Viewmodels group ID is invalid or repeated.",
            ));
        }
    }
    if request.source_fingerprints.is_empty()
        || request.source_fingerprints.len() > MAX_BUILD_FINGERPRINTS
    {
        return Err(invalid_build_selection(
            "The Viewmodels source list is invalid. Refresh the catalog.",
        ));
    }
    let mut previous = None;
    for source in &request.source_fingerprints {
        let id = source.id.as_str();
        if id.is_empty()
            || id.len() > 256
            || !id.bytes().all(|byte| {
                byte.is_ascii_lowercase() || byte.is_ascii_digit() || b"/_.-".contains(&byte)
            })
            || id
                .split('/')
                .any(|part| part.is_empty() || part == "." || part == "..")
            || !is_sha256(&source.sha256)
            || previous.is_some_and(|prior| prior >= id)
        {
            return Err(invalid_build_selection(
                "The Viewmodels source list is invalid or unsorted. Refresh the catalog.",
            ));
        }
        previous = Some(id);
    }
    Ok(())
}

fn expected_source_fingerprints(candidate: &InstalledGroupVpkCandidate) -> Vec<(String, String)> {
    let mut fingerprints = BTreeMap::new();
    fingerprints.insert(
        "scripts/items/items_game.txt".to_string(),
        candidate.sources.item_schema_sha256.clone(),
    );
    for (id, sha256) in &candidate.sources.weapon_script_sha256 {
        fingerprints.insert(id.clone(), sha256.clone());
    }
    for (class, sha256) in &candidate.sources.class_model_sha256 {
        fingerprints.insert(
            format!("models/weapons/c_models/c_{class}_animations.mdl"),
            sha256.clone(),
        );
    }
    fingerprints.into_iter().collect()
}

fn matches_catalog_sources(
    request: &ViewmodelBuildRequest,
    candidate: &InstalledGroupVpkCandidate,
) -> bool {
    request.catalog.patch_version == candidate.catalog.patch_version
        && request.catalog.catalog_sha256 == candidate.catalog.catalog_sha256
        && request
            .source_fingerprints
            .iter()
            .map(|source| (source.id.clone(), source.sha256.clone()))
            .collect::<Vec<_>>()
            == expected_source_fingerprints(candidate)
}

fn stale_source_error() -> CommandError {
    CommandError::new(
        "SourceChanged",
        "Installed TF2 Viewmodels sources or the selected catalog changed. Refresh the catalog and review your choices before building.",
    )
}

fn committed_build_error(error: ProfileError) -> CommandError {
    match &error {
        ProfileError::Io(message)
            if message.starts_with("Could not verify installed TF2 Viewmodels sources:")
                || message.starts_with(
                    "Installed TF2 Viewmodels sources or the selected output changed;",
                )
                || message == "The selected Viewmodels catalog and installed sources disagree."
                || message.starts_with("The installed Viewmodels sources contain colliding") =>
        {
            CommandError::new("SourceChanged", error.message())
        }
        _ => error.into(),
    }
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
                let class = group.class.clone();
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
                            item_class: item.item_class.clone(),
                            slot: item.class_loadout_slots.get(&class).cloned().flatten(),
                        })
                    })
                    .collect::<Result<Vec<_>, CommandError>>()?;
                Ok(ViewmodelCatalogGroup {
                    id: group.id,
                    class: group.class,
                    items,
                    animations: group.animations,
                    inspect: group.inspect,
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

/// Build from an exact installed-source catalog selection. Composition stays
/// read-only outside the write gate; the core transaction recomposes and
/// compares the same output before its durable journal is published.
#[tauri::command]
pub async fn build_selected_viewmodel_pack(
    gate: tauri::State<'_, WriteGate>,
    request: ViewmodelBuildRequest,
) -> Result<ProfileDetail, CommandError> {
    validate_build_request(&request)?;
    let preload = request.preload;
    let (context, initial_viewmodel, selection, candidate) = with_profile(move |root, profile_id| {
        execs_core::refuse_if_running()?;
        let initial_viewmodel = active_manifest(&profile_id)?.viewmodel;
        let context = ActiveContext::capture(&root, &profile_id);
        let selection = ProvisionalGroupRequest {
            catalog: ProvisionalGroupCatalogIdentity {
                patch_version: request.catalog.patch_version.clone(),
                catalog_sha256: request.catalog.catalog_sha256.clone(),
            },
            choices: request
                .choices
                .iter()
                .map(|choice| ProvisionalGroupChoice {
                    group_id: choice.group_id.clone(),
                    mode: match choice.mode {
                        ViewmodelBuildMode::Full => ProvisionalHideMode::Full,
                        ViewmodelBuildMode::Weapon => ProvisionalHideMode::Weapon,
                    },
                })
                .collect(),
        };
        let candidate = prototype_selected_group_vpk_from_install(&root, &selection)
            .map_err(|error| CommandError::new("SourceChanged", error.0))?;
        if !matches_catalog_sources(&request, &candidate) {
            return Err(stale_source_error());
        }
        if confirmed_root()? != root {
            return Err(CommandError::new(
                "RootChanged",
                "The confirmed TF2 folder changed while preparing Viewmodels. Refresh and try again.",
            ));
        }
        Ok((context, initial_viewmodel, selection, candidate))
    })
    .await?;
    let _guard = gate.lock_for_write().await?;
    with_profile(move |root, profile_id| {
        context.ensure_current(&root, &profile_id)?;
        ensure_viewmodel_unchanged(&profile_id, initial_viewmodel.as_ref())?;
        execs_core::refuse_if_running()?;
        execs_core::viewmodel::install_selected_viewmodel_pack(
            &root,
            &profile_id,
            &selection,
            &candidate,
            initial_viewmodel.as_ref(),
            preload,
        )
        .map_err(committed_build_error)
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
    use execs_core::viewmodel_selected_pack::InstalledViewmodelSourceFingerprints;

    fn valid_build_request() -> ViewmodelBuildRequest {
        ViewmodelBuildRequest {
            catalog: ViewmodelCatalogIdentity {
                patch_version: "123".into(),
                catalog_sha256: "a".repeat(64),
            },
            source_fingerprints: vec![
                ViewmodelCatalogSourceFingerprint {
                    id: "models/weapons/c_models/c_scout_animations.mdl".into(),
                    sha256: "b".repeat(64),
                },
                ViewmodelCatalogSourceFingerprint {
                    id: "scripts/items/items_game.txt".into(),
                    sha256: "c".repeat(64),
                },
                ViewmodelCatalogSourceFingerprint {
                    id: "scripts/tf_weapon_bat.txt".into(),
                    sha256: "d".repeat(64),
                },
            ],
            choices: vec![ViewmodelBuildChoice {
                group_id: format!("scout/{}", "e".repeat(64)),
                mode: ViewmodelBuildMode::Full,
            }],
            preload: false,
        }
    }

    #[test]
    fn build_request_rejects_duplicate_choices_and_fingerprint_ids_before_io() {
        let mut request = valid_build_request();
        assert!(validate_build_request(&request).is_ok());
        request.choices.push(ViewmodelBuildChoice {
            group_id: request.choices[0].group_id.clone(),
            mode: ViewmodelBuildMode::Weapon,
        });
        assert_eq!(
            validate_build_request(&request).unwrap_err().code,
            "InvalidSelection"
        );
        request.choices.pop();
        request
            .source_fingerprints
            .push(ViewmodelCatalogSourceFingerprint {
                id: "scripts/tf_weapon_bat.txt".into(),
                sha256: "d".repeat(64),
            });
        assert_eq!(
            validate_build_request(&request).unwrap_err().code,
            "InvalidSelection"
        );
    }

    #[test]
    fn build_request_binds_every_installed_source_digest() {
        let mut request = valid_build_request();
        let candidate = InstalledGroupVpkCandidate {
            vpk_bytes: Vec::new(),
            catalog: ProvisionalGroupCatalogIdentity {
                patch_version: "123".into(),
                catalog_sha256: "a".repeat(64),
            },
            sources: InstalledViewmodelSourceFingerprints {
                patch_version: "123".into(),
                item_schema_sha256: "c".repeat(64),
                weapon_script_sha256: BTreeMap::from([(
                    "scripts/tf_weapon_bat.txt".into(),
                    "d".repeat(64),
                )]),
                class_model_sha256: BTreeMap::from([("scout".into(), "b".repeat(64))]),
            },
        };
        assert!(matches_catalog_sources(&request, &candidate));
        request.source_fingerprints[2].sha256 = "f".repeat(64);
        assert!(!matches_catalog_sources(&request, &candidate));
        assert_eq!(stale_source_error().code, "SourceChanged");
    }

    #[test]
    fn transaction_source_changes_have_a_specific_error_code() {
        let error = committed_build_error(ProfileError::Io(
            "Installed TF2 Viewmodels sources or the selected output changed; refresh the catalog and try again.".into(),
        ));
        assert_eq!(error.code, "SourceChanged");
    }

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
