//! Native review authority and durable no-replay boundary for Steam mutations.
use super::{child, enrich, failure, read_snapshot, Inventory};
use crate::{error::CommandError, WriteGate};
use execs_core::{
    inventory::operations::{EligibilityInput, OperationSchema},
    inventory_journal::{self, Journal},
};
use execs_inventory_probe::{
    InventoryItem, Operation, OperationMove, OperationRequest, OperationResult, OperationStatus,
    Snapshot,
};
use serde::{Deserialize, Serialize};
use std::{
    collections::{BTreeMap, BTreeSet},
    path::{Path, PathBuf},
    sync::{Mutex, OnceLock},
    time::{SystemTime, UNIX_EPOCH},
};

const REVIEW_LIFETIME_MS: u64 = 120_000;
const MAX_ITEMS: usize = 10_000;
const MAX_MOVES: usize = execs_inventory_probe::MAX_POSITION_MOVES;

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct PrepareRequest {
    kind: String,
    steam_id: String,
    baseline: serde_json::Value,
    #[serde(default)]
    moves: Vec<OperationMove>,
    recipe: Option<String>,
    #[serde(default)]
    input_ids: Vec<String>,
    item_id: Option<String>,
    #[serde(default)]
    protected_ids: Vec<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Review {
    token: String,
    kind: String,
    steam_id: String,
    expires_at: u64,
    summary: String,
}

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct Intent {
    root: PathBuf,
    schema_revision: Option<String>,
    request: OperationRequest,
}

struct Prepared {
    intent: Intent,
    expires_at: u64,
}
static REVIEWS: OnceLock<Mutex<BTreeMap<String, Prepared>>> = OnceLock::new();

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Response {
    operation_id: String,
    kind: String,
    status: String,
    snapshot: Option<Inventory>,
    message: String,
    consumed_ids: Vec<String>,
    acquired_ids: Vec<String>,
    deleted_ids: Vec<String>,
}

fn error(message: impl Into<String>) -> CommandError {
    CommandError::new("InventoryOperationRefused", message)
}
fn now() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis()
        .try_into()
        .unwrap_or(u64::MAX)
}
fn development() -> Result<(), CommandError> {
    if !cfg!(debug_assertions) {
        return Err(error("Live inventory operations are available only in development builds until release qualification passes."));
    }
    Ok(())
}
fn kind(operation: &Operation) -> &'static str {
    match operation {
        Operation::Layout { .. } => "layout",
        Operation::Craft { .. } => "craft",
        Operation::Delete { .. } => "delete",
    }
}
fn data() -> Result<PathBuf, CommandError> {
    execs_core::try_execs_data_dir().map_err(error)
}
fn refuse_pending(steam_id: &str) -> Result<(), CommandError> {
    if inventory_journal::read(&data()?, steam_id)
        .map_err(error)?
        .is_some_and(|journal| journal.pending)
    {
        return Err(CommandError::new(
            "InventoryOperationPending",
            "An earlier operation is unconfirmed. Reconcile it before making another change.",
        ));
    }
    Ok(())
}

pub(super) fn eligibility_input(item: &InventoryItem) -> EligibilityInput<'_> {
    EligibilityInput {
        definition: item.definition,
        quality: item.quality,
        quantity: item.quantity,
        flags: item.flags,
        origin: item.origin,
        in_use: item.in_use,
        custom_name: item.custom_name.as_deref(),
        custom_description: item.custom_description.as_deref(),
        attributes: item
            .attributes
            .iter()
            .map(|attribute| (attribute.definition, attribute.value_bytes.as_slice()))
            .collect(),
        has_interior: item.interior_item.is_some(),
    }
}

/// The reviewed backpack is unchanged when the account, capacity and every
/// item's complete bytes match. Steam's cache version is not compared: it
/// advances on each connection even when no item changed, and the operation
/// helper rebinds to the version it reads just before sending.
fn same_baseline(expected: &Snapshot, actual: &Snapshot) -> bool {
    if expected.steam_id != actual.steam_id || expected.capacity != actual.capacity {
        return false;
    }
    let mut expected = expected.items.clone();
    let mut actual = actual.items.clone();
    expected.sort_by(|a, b| a.id.cmp(&b.id));
    actual.sort_by(|a, b| a.id.cmp(&b.id));
    expected == actual
}

fn validate_snapshot(snapshot: &Snapshot) -> Result<(), CommandError> {
    if snapshot.capacity == 0
        || snapshot.capacity > MAX_ITEMS as u32
        || snapshot.items.len() > MAX_ITEMS
        || snapshot.cache_version.is_none()
    {
        return Err(error("A complete, versioned backpack is required."));
    }
    let mut ids = BTreeSet::new();
    let mut slots = BTreeSet::new();
    for item in &snapshot.items {
        if item.id.parse::<u64>().ok().filter(|id| *id != 0).is_none()
            || !ids.insert(&item.id)
            || item.raw_item.is_empty()
            || item.position > snapshot.capacity
            || (item.position != 0 && !slots.insert(item.position))
        {
            return Err(error("The backpack contains invalid identities, positions or missing native item evidence."));
        }
    }
    Ok(())
}

fn consume_item<'a>(
    snapshot: &'a Snapshot,
    id: &str,
    protected: &BTreeSet<&str>,
) -> Result<&'a InventoryItem, CommandError> {
    if protected.contains(id) {
        return Err(error("Protected items cannot be consumed."));
    }
    let item = snapshot
        .items
        .iter()
        .find(|item| item.id == id)
        .ok_or_else(|| error("A selected item is no longer in this backpack."))?;
    if !item.equipped_state.is_empty() || item.in_use == Some(true) {
        return Err(error("Unequip the selected item before consuming it."));
    }
    Ok(item)
}

fn build_operation(
    root: &Path,
    request: &PrepareRequest,
    snapshot: &Snapshot,
) -> Result<(Operation, Option<String>), CommandError> {
    validate_snapshot(snapshot)?;
    let protected: BTreeSet<_> = request.protected_ids.iter().map(String::as_str).collect();
    if protected.len() != request.protected_ids.len() || protected.len() > MAX_ITEMS {
        return Err(error("Invalid protected-item list."));
    }
    match request.kind.as_str() {
        "layout" => {
            if request.moves.is_empty() || request.moves.len() > MAX_MOVES {
                return Err(error(
                    "Select between 1 and 10000 moves for one reviewed operation.",
                ));
            }
            let mut targets: BTreeMap<&str, u32> = snapshot
                .items
                .iter()
                .map(|item| (item.id.as_str(), item.position))
                .collect();
            let mut moved = BTreeSet::new();
            for movement in &request.moves {
                if protected.contains(movement.id.as_str())
                    || !moved.insert(&movement.id)
                    || targets.get(movement.id.as_str()) != Some(&movement.from)
                    || movement.to == 0
                    || movement.to > snapshot.capacity
                    || movement.to == movement.from
                {
                    return Err(error("A moved item is protected, repeated, stale, or has an invalid destination."));
                }
                targets.insert(&movement.id, movement.to);
            }
            let mut slots = BTreeSet::new();
            if targets
                .values()
                .any(|slot| *slot != 0 && !slots.insert(*slot))
            {
                return Err(error("Two items cannot occupy the same backpack slot."));
            }
            Ok((
                Operation::Layout {
                    moves: request.moves.clone(),
                },
                None,
            ))
        }
        "craft" | "delete" => {
            let schema = OperationSchema::load(root).map_err(error)?;
            if request
                .baseline
                .get("craftingRevision")
                .and_then(serde_json::Value::as_str)
                != Some(schema.revision.as_str())
            {
                return Err(error(
                    "Installed item rules changed. Refresh and review the operation again.",
                ));
            }
            let operation = if request.kind == "craft" {
                let key = request
                    .recipe
                    .as_deref()
                    .ok_or_else(|| error("Choose an explicit supported recipe."))?;
                // (recipe, input, count, output, output count, possible outputs)
                let (
                    recipe_id,
                    input_definition,
                    input_count,
                    output_definition,
                    output_count,
                    output_choices,
                ) = if key == "craft_hat" {
                    // Valve reserves this recipe for premium accounts; a free
                    // account's backpack has exactly 50 slots.
                    if snapshot.capacity < 300 {
                        return Err(error("Crafting a random hat needs a premium TF2 account."));
                    }
                    let recipe = schema.hat_recipe().map_err(error)?;
                    (
                        recipe.recipe_id,
                        recipe.input_definition,
                        recipe.input_count,
                        0,
                        1,
                        recipe.output_definitions,
                    )
                } else {
                    let recipe = schema.metal_recipe(key).map_err(error)?;
                    (
                        recipe.recipe_id,
                        recipe.input_definition,
                        recipe.input_count,
                        recipe.output_definition,
                        recipe.output_count,
                        Vec::new(),
                    )
                };
                if request.input_ids.len() != input_count
                    || request.input_ids.iter().collect::<BTreeSet<_>>().len()
                        != request.input_ids.len()
                {
                    return Err(error(
                        "The recipe requires an exact set of distinct ingredients.",
                    ));
                }
                for id in &request.input_ids {
                    let item = consume_item(snapshot, id, &protected)?;
                    let eligible = schema.eligibility(&eligibility_input(item));
                    if item.definition != input_definition
                        || !eligible.craftable
                        || !eligible.tradable
                        || eligible.customized
                        || item.style.is_some_and(|style| style != 0)
                    {
                        return Err(error(eligible.reason.unwrap_or_else(|| "A selected ingredient is not plain, tradable, craftable metal for this recipe.".into())));
                    }
                }
                if snapshot
                    .items
                    .len()
                    .saturating_sub(input_count)
                    .saturating_add(output_count)
                    > snapshot.capacity as usize
                {
                    return Err(error(
                        "The backpack has insufficient room for the recipe output.",
                    ));
                }
                Operation::Craft {
                    recipe_id,
                    input_ids: request.input_ids.clone(),
                    output_definition,
                    output_count: output_count as u32,
                    output_choices,
                }
            } else {
                let item_id = request
                    .item_id
                    .as_deref()
                    .ok_or_else(|| error("Choose one exact item to delete."))?;
                let item = consume_item(snapshot, item_id, &protected)?;
                let eligible = schema.eligibility(&eligibility_input(item));
                if !eligible.deletable {
                    return Err(error(
                        eligible
                            .reason
                            .unwrap_or_else(|| "This item cannot be deleted.".into()),
                    ));
                }
                Operation::Delete {
                    item_id: item_id.to_string(),
                }
            };
            Ok((operation, Some(schema.revision)))
        }
        _ => Err(error("Unsupported inventory operation.")),
    }
}

#[tauri::command]
pub async fn prepare_inventory_operation(
    request: PrepareRequest,
    gate: tauri::State<'_, WriteGate>,
) -> Result<Review, CommandError> {
    development()?;
    let _guard = gate.lock_for_interrupted_recovery().await?;
    super::super::shared::with_root(move |root| {
        execs_core::refuse_if_running()?;
        if serde_json::to_vec(&request.baseline)
            .map_err(|e| error(e.to_string()))?
            .len()
            > 32 * 1024 * 1024
            || request.protected_ids.len() > MAX_ITEMS
            || request.moves.len() > MAX_MOVES
            || request.input_ids.len() > 3
            || request
                .recipe
                .as_ref()
                .is_some_and(|recipe| recipe.len() > 80)
        {
            return Err(error("The inventory review exceeds its bounds."));
        }
        refuse_pending(&request.steam_id)?;
        let baseline: Snapshot =
            serde_json::from_value(request.baseline.clone()).map_err(|_| {
                error("The review has incomplete native item evidence. Refresh the backpack.")
            })?;
        let actual = read_snapshot(&root)?;
        if request.steam_id != actual.steam_id || !same_baseline(&baseline, &actual) {
            return Err(error(
                "The backpack or signed-in account changed. Refresh and review again.",
            ));
        }
        let (operation, schema_revision) = build_operation(&root, &request, &actual)?;
        let token = inventory_journal::new_token();
        let expires_at = now().saturating_add(REVIEW_LIFETIME_MS);
        let kind = kind(&operation).to_string();
        let prepared = Prepared {
            expires_at,
            intent: Intent {
                root,
                schema_revision,
                request: OperationRequest {
                    steam_id: actual.steam_id.clone(),
                    baseline: actual,
                    protected_ids: request.protected_ids,
                    operation,
                },
            },
        };
        let mut reviews = REVIEWS
            .get_or_init(|| Mutex::new(BTreeMap::new()))
            .lock()
            .map_err(|_| error("Inventory review store unavailable."))?;
        reviews.retain(|_, review| review.expires_at > now());
        if reviews.len() >= 8 {
            return Err(error(
                "Too many pending inventory reviews. Wait two minutes and retry.",
            ));
        }
        reviews.insert(token.clone(), prepared);
        Ok(Review {
            token,
            kind,
            steam_id: request.steam_id,
            expires_at,
            summary: "Exact items and installed rules verified. Confirmation is single-use.".into(),
        })
    })
    .await
}

fn unknown(message: impl Into<String>) -> OperationResult {
    OperationResult {
        status: OperationStatus::Unknown,
        snapshot: None,
        consumed_ids: vec![],
        acquired_ids: vec![],
        message: message.into(),
    }
}

fn finish(
    root: &Path,
    journal: &mut Journal,
    result: OperationResult,
) -> Result<Response, CommandError> {
    let confirmed = matches!(result.status, OperationStatus::Confirmed);
    let refused = matches!(result.status, OperationStatus::Refused);
    journal.pending = !confirmed && !refused;
    journal.outcome = Some(serde_json::to_value(&result).map_err(|e| failure(e.to_string()))?);
    if let Err(error) = data()
        .map_err(|error| error.to_string())
        .and_then(|data| inventory_journal::save(&data, journal))
    {
        return Ok(Response {operation_id:journal.operation_id.clone(),kind:journal.kind.clone(),status:"unknown".into(),snapshot:None,message:format!("The operation outcome could not be saved ({error}). Reconcile before another change."),consumed_ids:vec![],acquired_ids:vec![],deleted_ids:vec![]});
    }
    let deleted_ids = if confirmed && journal.kind == "delete" {
        result.consumed_ids.clone()
    } else {
        vec![]
    };
    let snapshot = if confirmed {
        result.snapshot.map(|snapshot| {
            enrich(root, snapshot.clone()).unwrap_or_else(|error| Inventory {
                snapshot,
                definitions: BTreeMap::new(),
                item_descriptions: BTreeMap::new(),
                quality_colors: BTreeMap::new(),
                warning: Some(format!(
                    "The operation was confirmed; optional local details are unavailable: {error}"
                )),
                crafting_eligibility: BTreeMap::new(),
                crafting_revision: None,
                pending_operation: None,
            })
        })
    } else {
        None
    };
    Ok(Response {
        operation_id: journal.operation_id.clone(),
        kind: journal.kind.clone(),
        status: if confirmed {
            "confirmed"
        } else if refused {
            "refused"
        } else {
            "unknown"
        }
        .into(),
        snapshot,
        message: result.message,
        consumed_ids: result.consumed_ids,
        acquired_ids: result.acquired_ids,
        deleted_ids,
    })
}

fn take_prepared(
    reviews: &mut BTreeMap<String, Prepared>,
    token: &str,
    root: &Path,
    at: u64,
) -> Result<Prepared, CommandError> {
    let prepared = reviews
        .remove(token)
        .ok_or_else(|| error("This inventory review expired or was already used."))?;
    if prepared.expires_at <= at || prepared.intent.root != root {
        return Err(error(
            "The review expired or the TF2 folder changed. Review again.",
        ));
    }
    Ok(prepared)
}

#[tauri::command]
pub async fn execute_inventory_operation(
    token: String,
    gate: tauri::State<'_, WriteGate>,
) -> Result<Response, CommandError> {
    development()?;
    let _guard = gate.lock_for_interrupted_recovery().await?;
    super::super::shared::with_root(move |root| {
        let prepared = {
            let mut reviews = REVIEWS
                .get_or_init(|| Mutex::new(BTreeMap::new()))
                .lock()
                .map_err(|_| error("Inventory review store unavailable."))?;
            take_prepared(&mut reviews, &token, &root, now())?
        };
        execs_core::refuse_if_running()?;
        let intent = prepared.intent;
        refuse_pending(&intent.request.steam_id)?;
        if let Some(revision) = &intent.schema_revision {
            if OperationSchema::load(&root).map_err(error)?.revision != *revision {
                return Err(error("Installed item rules changed. Review again."));
            }
        }
        let bytes = serde_json::to_vec(&intent.request).map_err(|e| error(e.to_string()))?;
        let mut journal = Journal {
            operation_id: token,
            steam_id: intent.request.steam_id.clone(),
            kind: kind(&intent.request.operation).into(),
            pending: true,
            intent: serde_json::to_value(&intent).map_err(|e| error(e.to_string()))?,
            outcome: None,
        };
        inventory_journal::save(&data()?, &journal).map_err(error)?;
        let result: OperationResult = child::request(&root, Some(&bytes)).unwrap_or_else(|error| {
            unknown(format!(
                "The helper outcome is unconfirmed: {error}. Reconcile before another change."
            ))
        });
        let result = if matches!(result.status, OperationStatus::Confirmed) {
            result
                .snapshot
                .as_ref()
                .map(|snapshot| {
                    execs_inventory_probe::reconcile_operation(&intent.request, snapshot)
                })
                .unwrap_or_else(|| {
                    unknown("The helper returned no snapshot for its claimed result.")
                })
        } else {
            result
        };
        finish(&root, &mut journal, result)
    })
    .await
}

#[tauri::command]
pub async fn reconcile_inventory_operation(
    steam_id: String,
    gate: tauri::State<'_, WriteGate>,
) -> Result<Response, CommandError> {
    development()?;
    let _guard = gate.lock_for_interrupted_recovery().await?;
    super::super::shared::with_root(move |root| {
        execs_core::refuse_if_running()?;
        let mut journal = inventory_journal::read(&data()?, &steam_id)
            .map_err(error)?
            .ok_or_else(|| error("No operation evidence exists for this account."))?;
        let intent: Intent = serde_json::from_value(journal.intent.clone())
            .map_err(|_| error("Operation evidence is unreadable; it will not be replayed."))?;
        if !journal.pending {
            return Err(error(
                "This operation already has a recorded outcome. Refresh the backpack normally.",
            ));
        }
        let after = read_snapshot(&root)?;
        if after.steam_id != steam_id {
            return Err(error(
                "Sign into the account that owns this pending operation.",
            ));
        }
        let result = execs_inventory_probe::reconcile_operation(&intent.request, &after);
        finish(&root, &mut journal, result)
    })
    .await
}

#[cfg(test)]
mod tests {
    use super::*;

    fn snapshot() -> Snapshot {
        serde_json::from_value(serde_json::json!({
            "steamId":"76561198000000000", "capacity":100, "cacheVersion":"41",
            "items": (["100", "101"].iter().enumerate().map(|(index,id)| serde_json::json!({
                "id":id,"definition":5000,"position":index+1,"quality":6,"level":1,
                "customName":null,"rawPosition":index+1,"quantity":1,"flags":0,"origin":0,
                "customDescription":null,"inUse":false,"style":null,"originalId":null,
                "containsEquippedState":null,"equippedState":[],"containsEquippedStateV2":null,
                "interiorItem":null,"rawItem":[8,index+1]
            })).collect::<Vec<_>>())
        }))
        .unwrap()
    }

    fn request(moves: &[(usize, u32)]) -> PrepareRequest {
        let baseline = snapshot();
        PrepareRequest {
            kind: "layout".into(),
            steam_id: baseline.steam_id.clone(),
            baseline: serde_json::to_value(&baseline).unwrap(),
            moves: moves
                .iter()
                .map(|(index, to)| OperationMove {
                    id: baseline.items[*index].id.clone(),
                    from: baseline.items[*index].position,
                    to: *to,
                })
                .collect(),
            recipe: None,
            input_ids: vec![],
            item_id: None,
            protected_ids: vec![],
        }
    }

    #[test]
    fn baseline_binds_account_capacity_and_complete_item_bytes() {
        let baseline = snapshot();
        let mut changed = baseline.clone();
        changed.persona_name = Some("New name".into());
        changed.items.reverse();
        // A new Steam connection advances the cache version without item changes.
        changed.cache_version = Some("42".into());
        assert!(same_baseline(&baseline, &changed));
        for change in 0..4 {
            let mut changed = baseline.clone();
            match change {
                0 => changed.steam_id.push('1'),
                1 => changed.capacity += 1,
                2 => changed.items[0].raw_item.push(0),
                _ => changed.items[0].position = 3,
            }
            assert!(!same_baseline(&baseline, &changed));
        }
    }

    #[test]
    fn layout_accepts_swap_but_rejects_collisions_stale_foreign_and_protected_items() {
        let baseline = snapshot();
        assert!(
            build_operation(Path::new("unused"), &request(&[(0, 2), (1, 1)]), &baseline).is_ok()
        );
        for moves in [
            &[(0, 2)][..],
            &[(0, 0)][..],
            &[(0, 101)][..],
            &[(0, 3), (0, 4)][..],
        ] {
            assert!(build_operation(Path::new("unused"), &request(moves), &baseline).is_err());
        }
        let mut changed = request(&[(0, 3)]);
        changed.moves[0].id = "999".into();
        assert!(build_operation(Path::new("unused"), &changed, &baseline).is_err());
        changed = request(&[(0, 3)]);
        changed.moves[0].from = 4;
        assert!(build_operation(Path::new("unused"), &changed, &baseline).is_err());
        changed = request(&[(0, 3)]);
        changed.protected_ids.push("100".into());
        assert!(build_operation(Path::new("unused"), &changed, &baseline).is_err());
        changed = request(&[(0, 3)]);
        changed.moves = vec![changed.moves[0].clone(); MAX_MOVES + 1];
        assert!(build_operation(Path::new("unused"), &changed, &baseline).is_err());
    }

    #[test]
    fn layout_accepts_a_complete_backpack_sort_above_one_thousand_moves() {
        let mut baseline = snapshot();
        baseline.capacity = MAX_ITEMS as u32;
        let template = baseline.items[0].clone();
        baseline.items = (1..=MAX_ITEMS as u32)
            .map(|slot| {
                let mut item = template.clone();
                item.id = (u64::MAX - u64::from(slot)).to_string();
                item.position = slot;
                item.raw_position = slot;
                item
            })
            .collect();
        let mut request = request(&[]);
        request.baseline = serde_json::to_value(&baseline).unwrap();
        request.moves = baseline
            .items
            .iter()
            .map(|item| OperationMove {
                id: item.id.clone(),
                from: item.position,
                to: item.position % baseline.capacity + 1,
            })
            .collect();
        assert!(build_operation(Path::new("unused"), &request, &baseline).is_ok());
    }

    #[test]
    fn incomplete_evidence_and_equipped_consumables_refuse() {
        let baseline = snapshot();
        for change in 0..3 {
            let mut changed = baseline.clone();
            match change {
                0 => changed.cache_version = None,
                1 => changed.items[0].raw_item.clear(),
                _ => changed.items[1].position = 1,
            }
            assert!(validate_snapshot(&changed).is_err());
        }
        let mut changed = baseline.clone();
        changed.items[0]
            .equipped_state
            .push(execs_inventory_probe::EquippedState {
                new_class: Some(1),
                new_slot: Some(0),
            });
        assert!(consume_item(&changed, "100", &BTreeSet::new()).is_err());
        assert!(consume_item(&baseline, "100", &BTreeSet::from(["100"])).is_err());
    }

    #[test]
    fn reviews_are_consumed_on_use_expiry_and_root_change() {
        for (at, root, valid) in [(99, "tf2", true), (100, "tf2", false), (99, "other", false)] {
            let baseline = snapshot();
            let prepared = Prepared {
                expires_at: 100,
                intent: Intent {
                    root: PathBuf::from("tf2"),
                    schema_revision: None,
                    request: OperationRequest {
                        steam_id: baseline.steam_id.clone(),
                        baseline,
                        protected_ids: vec![],
                        operation: Operation::Delete {
                            item_id: "100".into(),
                        },
                    },
                },
            };
            let mut reviews = BTreeMap::from([("token".into(), prepared)]);
            assert_eq!(
                take_prepared(&mut reviews, "token", Path::new(root), at).is_ok(),
                valid
            );
            assert!(reviews.is_empty());
            assert!(take_prepared(&mut reviews, "token", Path::new("tf2"), 0).is_err());
        }
    }
}
