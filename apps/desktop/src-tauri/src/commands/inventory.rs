//! Development inventory operations. Steam runs in a disposable
//! child so SDK faults, environment changes and shutdown cannot affect Tauri.
use super::shared::{with_root, RootContext};
use crate::{error::CommandError, WriteGate};
use execs_inventory_probe::Snapshot;
use serde::Serialize;
mod child;
pub(crate) mod operations;
use std::collections::{BTreeMap, BTreeSet};

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Inventory {
    #[serde(flatten)]
    snapshot: Snapshot,
    definitions: BTreeMap<u32, execs_core::inventory::Definition>,
    item_descriptions: BTreeMap<String, execs_core::inventory::ItemDescription>,
    quality_colors: BTreeMap<u32, String>,
    warning: Option<String>,
    crafting_eligibility: BTreeMap<String, execs_core::inventory::operations::Eligibility>,
    crafting_revision: Option<String>,
    pending_operation: Option<PendingOperation>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PendingOperation {
    operation_id: String,
    kind: String,
    message: String,
}

fn failure(message: impl Into<String>) -> CommandError {
    CommandError::new("InventoryUnavailable", message)
}

const MUTATIONS_UNAVAILABLE: &str = "Inventory operations require a fresh native review and its single-use token. Legacy direct-write commands are refused; release builds remain disabled until qualification.";

#[derive(Serialize)]
pub struct InventoryCapabilities {
    organizer: &'static str,
    crafting: &'static str,
    deletion: &'static str,
    reason: &'static str,
}

#[tauri::command]
pub fn get_inventory_capabilities() -> InventoryCapabilities {
    InventoryCapabilities {
        organizer: if cfg!(debug_assertions) {
            "live"
        } else {
            "unavailable"
        },
        crafting: if cfg!(debug_assertions) {
            "live"
        } else {
            "unavailable"
        },
        deletion: if cfg!(debug_assertions) {
            "live"
        } else {
            "unavailable"
        },
        reason: if cfg!(debug_assertions) {
            "Development build: reviewed operations change the signed-in Steam backpack. Release qualification is pending."
        } else {
            MUTATIONS_UNAVAILABLE
        },
    }
}

#[tauri::command]
pub fn apply_inventory_layout(request: serde_json::Value) -> Result<(), CommandError> {
    drop(request);
    Err(CommandError::new(
        "InventoryOperationUnavailable",
        MUTATIONS_UNAVAILABLE,
    ))
}

#[tauri::command]
pub fn craft_inventory(request: serde_json::Value) -> Result<(), CommandError> {
    drop(request);
    Err(CommandError::new(
        "InventoryOperationUnavailable",
        MUTATIONS_UNAVAILABLE,
    ))
}

fn read_snapshot(root: &std::path::Path) -> Result<Snapshot, CommandError> {
    child::request(root, None)
}

fn enrich(root: &std::path::Path, snapshot: Snapshot) -> Result<Inventory, CommandError> {
    let ids: BTreeSet<_> = snapshot.items.iter().map(|i| i.definition).collect();
    let inputs: Vec<_> = snapshot
        .items
        .iter()
        .map(|item| execs_core::inventory::ItemInput {
            id: &item.id,
            definition: item.definition,
            attributes: item
                .attributes
                .iter()
                .map(|a| (a.definition, a.value_bytes.as_slice()))
                .collect(),
        })
        .collect();
    let (definitions, item_descriptions, quality_colors, warning) =
        match execs_core::inventory::metadata(root, &inputs) {
            Ok(metadata) => {
                let missing = ids
                    .iter()
                    .filter(|id| !metadata.definitions.contains_key(id))
                    .count();
                (
                    metadata.definitions,
                    metadata.item_descriptions,
                    metadata.quality_colors,
                    (missing > 0).then(|| {
                        format!("Names and artwork are unavailable for {missing} item definitions.")
                    }),
                )
            }
            Err(error) => (
                BTreeMap::new(),
                BTreeMap::new(),
                BTreeMap::new(),
                Some(format!(
                    "Local item descriptions could not be read: {error}"
                )),
            ),
        };
    let schema = execs_core::inventory::operations::OperationSchema::load(root).ok();
    let crafting_eligibility = schema
        .as_ref()
        .map(|schema| {
            snapshot
                .items
                .iter()
                .map(|item| {
                    (
                        item.id.clone(),
                        schema.eligibility(&operations::eligibility_input(item)),
                    )
                })
                .collect()
        })
        .unwrap_or_default();
    let crafting_revision = schema.map(|schema| schema.revision);
    let data = execs_core::try_execs_data_dir().map_err(failure)?;
    let journal =
        execs_core::inventory_journal::read(&data, &snapshot.steam_id).map_err(failure)?;
    let pending_operation = journal.filter(|journal| journal.pending).map(|journal| PendingOperation { operation_id: journal.operation_id, kind: journal.kind, message: "An earlier operation has an unconfirmed outcome. Reconcile it before making another change.".into() });
    Ok(Inventory {
        snapshot,
        definitions,
        item_descriptions,
        quality_colors,
        warning,
        crafting_eligibility,
        crafting_revision,
        pending_operation,
    })
}

#[tauri::command]
pub async fn get_inventory(gate: tauri::State<'_, WriteGate>) -> Result<Inventory, CommandError> {
    if !cfg!(debug_assertions) {
        return Err(failure(
            "Inventory is currently available only in development builds.",
        ));
    }
    // Serialize against another connection and against Launch TF2/install changes.
    let _guard = gate.lock_for_interrupted_recovery().await?;
    with_root(|root| {
        execs_core::refuse_if_running()?;
        let context = RootContext::capture(&root);
        let snapshot = read_snapshot(&root)?;
        context.ensure_current(&super::shared::confirmed_root()?)?;
        execs_core::refuse_if_running()?;
        enrich(&root, snapshot)
    })
    .await
}

#[tauri::command]
pub async fn get_inventory_icons(
    paths: Vec<String>,
) -> Result<BTreeMap<String, execs_core::inventory::Icon>, CommandError> {
    if !cfg!(debug_assertions) {
        return Err(failure(
            "Inventory is currently available only in development builds.",
        ));
    }
    with_root(move |root| execs_core::inventory::icons(&root, &paths).map_err(failure)).await
}

#[cfg(test)]
mod operation_gate_tests {
    use super::*;

    #[test]
    fn unqualified_mutations_refuse_even_direct_ipc_requests() {
        let capabilities = get_inventory_capabilities();
        assert_eq!(
            capabilities.organizer,
            if cfg!(debug_assertions) {
                "live"
            } else {
                "unavailable"
            }
        );
        assert_eq!(capabilities.crafting, capabilities.organizer);
        for request in [
            serde_json::Value::Null,
            serde_json::json!({
                "steamId": "76561198000000000",
                "moves": [{"id": "9007199254740993", "from": 1, "to": 2}],
                "recipe": "combine_scrap",
                "inputIds": ["9007199254740993"]
            }),
        ] {
            assert_eq!(
                apply_inventory_layout(request.clone()).unwrap_err().code,
                "InventoryOperationUnavailable"
            );
            assert_eq!(
                craft_inventory(request).unwrap_err().code,
                "InventoryOperationUnavailable"
            );
        }
    }
}
