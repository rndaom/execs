//! A single bounded, account-bound operation. Transport retries only reads, never writes.
use crate::{operation_wire, protocol, InventoryItem, Snapshot};
use prost::Message;
use serde::{Deserialize, Serialize};
use std::collections::{BTreeMap, BTreeSet};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct OperationRequest {
    pub steam_id: String,
    pub baseline: Snapshot,
    pub protected_ids: Vec<String>,
    pub operation: Operation,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(
    tag = "kind",
    rename_all = "camelCase",
    rename_all_fields = "camelCase",
    deny_unknown_fields
)]
pub enum Operation {
    Layout {
        moves: Vec<OperationMove>,
    },
    Craft {
        recipe_id: i16,
        input_ids: Vec<String>,
        output_definition: u32,
        output_count: u32,
        /// The random hat recipe: every definition the coordinator may choose.
        /// Empty for the deterministic metal conversions.
        #[serde(default, skip_serializing_if = "Vec::is_empty")]
        output_choices: Vec<u32>,
    },
    Delete {
        item_id: String,
    },
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct OperationMove {
    pub id: String,
    pub from: u32,
    pub to: u32,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum OperationStatus {
    Confirmed,
    Unknown,
    Refused,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OperationResult {
    pub status: OperationStatus,
    pub snapshot: Option<Snapshot>,
    pub consumed_ids: Vec<String>,
    pub acquired_ids: Vec<String>,
    pub message: String,
}

impl OperationResult {
    pub fn failed(sent: bool, message: impl Into<String>) -> Self {
        Self {
            status: if sent {
                OperationStatus::Unknown
            } else {
                OperationStatus::Refused
            },
            snapshot: None,
            consumed_ids: vec![],
            acquired_ids: vec![],
            message: message.into(),
        }
    }
}

fn identity(id: &str) -> Result<u64, String> {
    id.parse::<u64>()
        .ok()
        .filter(|v| *v != 0 && v.to_string() == id)
        .ok_or_else(|| "Invalid canonical item/account identity".into())
}

fn index(snapshot: &Snapshot) -> Result<BTreeMap<&str, &InventoryItem>, String> {
    if snapshot.items.len() > 100_000 || snapshot.capacity == 0 || snapshot.capacity > 65_535 {
        return Err("Invalid inventory bounds".into());
    }
    let mut items = BTreeMap::new();
    let mut occupied = BTreeSet::new();
    let steam_id = identity(&snapshot.steam_id)?;
    for item in &snapshot.items {
        let id = identity(&item.id)?;
        if item.raw_item.is_empty() || item.raw_item.len() > 65_536 {
            return Err("Missing complete authoritative item bytes".into());
        }
        let raw = protocol::Item::decode(item.raw_item.as_slice()).map_err(|e| e.to_string())?;
        if raw.id != Some(id)
            || raw.account != Some(steam_id as u32)
            || raw.inventory != Some(item.raw_position)
            || raw.definition != Some(item.definition)
            || operation_wire::displayed_position(item.raw_position) != item.position
            || item.position > snapshot.capacity
            || (item.position != 0 && !occupied.insert(item.position))
            || items.insert(item.id.as_str(), item).is_some()
        {
            return Err("Inconsistent authoritative inventory baseline".into());
        }
    }
    Ok(items)
}

fn version(snapshot: &Snapshot) -> Result<u64, String> {
    snapshot
        .cache_version
        .as_deref()
        .ok_or("Missing authoritative cache version")?
        .parse()
        .map_err(|_| "Invalid cache version".into())
}

/// Compare complete authoritative item data, allowing presentation-only
/// persona/avatar changes. The cache version is not compared: Steam advances it
/// on each connection even when no item changed.
pub fn same_inventory(left: &Snapshot, right: &Snapshot) -> bool {
    left.steam_id == right.steam_id
        && left.capacity == right.capacity
        && index(left)
            .ok()
            .zip(index(right).ok())
            .is_some_and(|(a, b)| a == b)
}

/// The random hat recipe names at most this many possible outputs.
pub const MAX_OUTPUT_CHOICES: usize = 20_000;

pub(crate) struct Session {
    request: OperationRequest,
    pub sent: bool,
    highest_version: u64,
    destroyed: BTreeSet<String>,
    craft_reply: Option<operation_wire::CraftReply>,
}

impl Session {
    pub fn new(request: OperationRequest) -> Result<Self, String> {
        if request.steam_id != request.baseline.steam_id {
            return Err("Account/baseline mismatch".into());
        }
        identity(&request.steam_id)?;
        index(&request.baseline)?;
        let highest_version = version(&request.baseline)?;
        let state = Self {
            request,
            sent: false,
            highest_version,
            destroyed: BTreeSet::new(),
            craft_reply: None,
        };
        state.message()?;
        Ok(state)
    }

    pub fn steam_id(&self) -> &str {
        &self.request.steam_id
    }

    fn message(&self) -> Result<(u32, Vec<u8>), String> {
        let snapshot = &self.request.baseline;
        let items = index(snapshot)?;
        if self.request.protected_ids.len() > 100_000 {
            return Err("Too many protected IDs".into());
        }
        let protected = self
            .request
            .protected_ids
            .iter()
            .map(|id| identity(id))
            .collect::<Result<BTreeSet<_>, _>>()?;
        let (kind, body, binary) = match &self.request.operation {
            Operation::Layout { moves } => {
                let sources = items
                    .values()
                    .map(|item| {
                        Ok(operation_wire::PositionItem {
                            id: identity(&item.id)?,
                            raw_position: item.raw_position,
                        })
                    })
                    .collect::<Result<Vec<_>, String>>()?;
                let moves = moves
                    .iter()
                    .map(|m| {
                        let item = items
                            .get(m.id.as_str())
                            .ok_or("Moved item no longer exists")?;
                        if m.from != item.position {
                            return Err("Stale move origin".into());
                        }
                        Ok(operation_wire::PositionMove {
                            id: identity(&m.id)?,
                            from_raw: item.raw_position,
                            to_slot: m.to,
                        })
                    })
                    .collect::<Result<Vec<_>, String>>()?;
                (
                    1100,
                    operation_wire::positions_body(
                        snapshot.capacity,
                        &sources,
                        &moves,
                        &protected,
                    )?
                    .to_vec(),
                    false,
                )
            }
            Operation::Craft {
                recipe_id,
                input_ids,
                output_definition,
                output_count,
                output_choices,
            } => {
                let ids = input_ids
                    .iter()
                    .map(|id| identity(id))
                    .collect::<Result<Vec<_>, _>>()?;
                if input_ids.iter().any(|id| !items.contains_key(id.as_str()))
                    || ids.iter().any(|id| protected.contains(id))
                {
                    return Err("Missing or protected craft ingredient".into());
                }
                let definitions = input_ids
                    .iter()
                    .map(|id| items[id.as_str()].definition)
                    .collect::<BTreeSet<_>>();
                let input_definition = definitions.first().copied().unwrap_or(0);
                // Only the four reviewed deterministic metal conversions and the
                // random hat recipe with its reviewed output list can reach the wire.
                let random_hat = (
                    *recipe_id,
                    input_definition,
                    input_ids.len(),
                    *output_definition,
                    *output_count,
                ) == (6, 5002, 3, 0, 1);
                if definitions.len() != 1
                    || !(random_hat
                        || output_choices.is_empty()
                            && matches!(
                                (
                                    *recipe_id,
                                    input_definition,
                                    input_ids.len(),
                                    *output_definition,
                                    *output_count
                                ),
                                (4, 5000, 3, 5001, 1)
                                    | (5, 5001, 3, 5002, 1)
                                    | (22, 5001, 1, 5000, 3)
                                    | (23, 5002, 1, 5001, 3)
                            ))
                    || random_hat
                        && (output_choices.is_empty()
                            || output_choices.len() > MAX_OUTPUT_CHOICES
                            || !output_choices.windows(2).all(|pair| pair[0] < pair[1]))
                {
                    return Err("Unsupported crafting recipe".into());
                }
                if snapshot.items.len() + *output_count as usize
                    > snapshot.capacity as usize + input_ids.len()
                {
                    return Err("Not enough backpack capacity for craft outputs".into());
                }
                // Installed-schema eligibility is validated by the parent; repeat universal guards.
                for id in input_ids {
                    let item = items[id.as_str()];
                    if item.quality != 6
                        || item.quantity != Some(1)
                        || item.flags.unwrap_or(0) & !20 != 0
                        || item.in_use.unwrap_or(false)
                        || item.style.unwrap_or(0) != 0
                        || item.custom_name.as_ref().is_some_and(|s| !s.is_empty())
                        || item
                            .custom_description
                            .as_ref()
                            .is_some_and(|s| !s.is_empty())
                        || item.interior_item.is_some()
                        || !item.equipped_state.is_empty()
                    {
                        return Err("Ingredient has protected/customized state".into());
                    }
                }
                (1002, operation_wire::craft_body(*recipe_id, &ids)?, true)
            }
            Operation::Delete { item_id } => {
                let id = identity(item_id)?;
                let item = items
                    .get(item_id.as_str())
                    .ok_or("Delete item no longer exists")?;
                if protected.contains(&id)
                    || item.in_use.unwrap_or(false)
                    || !item.equipped_state.is_empty()
                {
                    return Err("Protected or equipped item cannot be deleted".into());
                }
                (1004, operation_wire::delete_body(id)?.to_vec(), true)
            }
        };
        Ok(if binary {
            (kind, operation_wire::binary_envelope(&body))
        } else {
            (protocol::PROTOBUF | kind, protocol::envelope(kind, &body))
        })
    }

    /// The flag is set BEFORE transport is invoked: any send error is conservatively unknown.
    pub fn prepare_send(&mut self, fresh: &Snapshot) -> Result<(u32, Vec<u8>), String> {
        if self.sent {
            return Err("An inventory mutation must never be replayed".into());
        }
        if !same_inventory(&self.request.baseline, fresh) {
            return Err("Inventory changed since review; review it again".into());
        }
        // Confirmation must come from a cache newer than the one read just
        // before sending, not merely newer than the reviewed connection's.
        let current = version(fresh)?;
        self.request.baseline.cache_version = fresh.cache_version.clone();
        self.highest_version = self.highest_version.max(current);
        let message = self.message()?;
        self.sent = true;
        Ok(message)
    }

    pub fn observe(&mut self, kind: u32, body: &[u8]) -> Result<(), String> {
        if !self.sent {
            return Ok(());
        }
        if kind == 1003 {
            if !matches!(self.request.operation, Operation::Craft { .. }) {
                return Err("Unexpected craft reply".into());
            }
            let reply = operation_wire::craft_reply(body)?;
            if self.craft_reply.as_ref().is_some_and(|old| old != &reply) {
                return Err("Conflicting craft replies".into());
            }
            self.craft_reply = Some(reply);
            return Ok(());
        }
        let events = protocol::changes(kind, body, identity(&self.request.steam_id)?)?;
        if events.version < self.highest_version {
            return Err("Out-of-order inventory event".into());
        }
        self.highest_version = events.version;
        if kind == 23 {
            self.destroyed.extend(events.item_ids);
        }
        Ok(())
    }

    /// An event is never sufficient: only a complete newer authoritative cache confirms.
    pub fn confirm(&self, fresh: &Snapshot) -> Result<Option<OperationResult>, String> {
        if !self.sent {
            return Err("Cannot confirm an unsent operation".into());
        }
        let before = &self.request.baseline;
        if fresh.steam_id != before.steam_id || fresh.capacity != before.capacity {
            return Err("Account/capacity changed during operation".into());
        }
        let revision = version(fresh)?;
        if revision <= version(before)? || revision < self.highest_version {
            return Ok(None);
        }
        let old = index(before)?;
        let new = index(fresh)?;
        let mut consumed = BTreeSet::new();
        let mut acquired = BTreeSet::new();
        let mut moves = BTreeMap::new();
        match &self.request.operation {
            Operation::Layout { moves: requested } => {
                for m in requested {
                    moves.insert(m.id.as_str(), m.to);
                }
            }
            Operation::Delete { item_id } => {
                if !self.destroyed.contains(item_id) {
                    return Ok(None);
                }
                consumed.insert(item_id.clone());
            }
            Operation::Craft {
                recipe_id,
                input_ids,
                output_definition,
                output_count,
                output_choices,
            } => {
                let Some(reply) = &self.craft_reply else {
                    return Ok(None);
                };
                if reply.recipe != *recipe_id
                    || reply.response != 0
                    || reply.output_ids.len() != *output_count as usize
                {
                    return Err("Coordinator did not report the exact reviewed craft".into());
                }
                consumed.extend(input_ids.iter().cloned());
                for id in &reply.output_ids {
                    let id = id.to_string();
                    let Some(item) = new.get(id.as_str()) else {
                        return Ok(None);
                    };
                    if old.contains_key(id.as_str()) {
                        return Err("Craft output differs from the reviewed output".into());
                    }
                    // A random hat is whichever reviewed hat the coordinator chose.
                    // Its quality, origin, craft number and maker attributes are its own.
                    if !output_choices.is_empty() {
                        if !output_choices.contains(&item.definition)
                            || item.quantity != Some(1)
                            || item.in_use.unwrap_or(false)
                            || item.custom_name.as_ref().is_some_and(|s| !s.is_empty())
                            || item
                                .custom_description
                                .as_ref()
                                .is_some_and(|s| !s.is_empty())
                            || item.interior_item.is_some()
                            || !item.equipped_state.is_empty()
                        {
                            return Err("Craft output is not one of the reviewed hats".into());
                        }
                        acquired.insert(id);
                        continue;
                    }
                    if item.definition != *output_definition
                        || item.quantity != Some(1)
                        || item.quality != 6
                        || item.origin != Some(4)
                        || item.flags.unwrap_or(0) & !4 != 0
                        || item.in_use.unwrap_or(false)
                        || item.style.unwrap_or(0) != 0
                        || item.custom_name.as_ref().is_some_and(|s| !s.is_empty())
                        || item
                            .custom_description
                            .as_ref()
                            .is_some_and(|s| !s.is_empty())
                        || item.interior_item.is_some()
                        || !item.equipped_state.is_empty()
                        || !item.attributes.is_empty()
                    {
                        return Err("Craft output differs from the reviewed output".into());
                    }
                    acquired.insert(id);
                }
            }
        }
        if consumed.iter().any(|id| new.contains_key(id.as_str())) {
            return Ok(None);
        }
        if new.len() + consumed.len() != old.len() + acquired.len() {
            return Ok(None);
        }
        for (id, item) in &old {
            if consumed.contains(*id) {
                continue;
            }
            let Some(after) = new.get(id) else {
                return Ok(None);
            };
            if let Some(slot) = moves.get(id) {
                if after.position != *slot || after.raw_position != ((1 << 31) | slot) {
                    return Ok(None);
                }
                let mut expected = (*item).clone();
                expected.position = after.position;
                expected.raw_position = after.raw_position;
                expected.raw_item = after.raw_item.clone();
                if &expected != *after
                    || operation_wire::without_position(&item.raw_item)?
                        != operation_wire::without_position(&after.raw_item)?
                {
                    return Err("Moved item changed beyond its backpack position".into());
                }
            } else if item != after {
                return Err("An unrelated item changed during the operation".into());
            }
        }
        if new
            .keys()
            .any(|id| !old.contains_key(id) && !acquired.contains(*id))
        {
            return Err("Unexpected acquired item during operation".into());
        }
        Ok(Some(OperationResult {
            status: OperationStatus::Confirmed,
            snapshot: Some(fresh.clone()),
            consumed_ids: consumed.into_iter().collect(),
            acquired_ids: acquired.into_iter().collect(),
            message: "Steam confirmed the exact reviewed inventory change.".into(),
        }))
    }
}

/// Reconcile a durably pending intent after interruption. Never sends or authorizes replay.
/// A complete newer cache must show the exact outcome and no unrelated item changes.
pub fn reconcile_operation(request: &OperationRequest, after: &Snapshot) -> OperationResult {
    let attempt = || -> Result<Option<OperationResult>, String> {
        let mut session = Session::new(request.clone())?;
        session.sent = true;
        match &request.operation {
            Operation::Delete { item_id } => {
                session.destroyed.insert(item_id.clone());
            }
            Operation::Craft { recipe_id, .. } => {
                let before = index(&request.baseline)?;
                let after_items = index(after)?;
                let ids = after_items
                    .keys()
                    .filter(|id| !before.contains_key(**id))
                    .map(|id| identity(id))
                    .collect::<Result<Vec<_>, _>>()?;
                session.craft_reply = Some(operation_wire::CraftReply {
                    recipe: *recipe_id,
                    response: 0,
                    output_ids: ids,
                });
            }
            Operation::Layout { .. } => {}
        }
        session.confirm(after)
    };
    match attempt() {
        Ok(Some(mut result)) => {
            result.message =
                "A fresh Steam inventory matches the exact pending change; nothing was replayed."
                    .into();
            result
        }
        Ok(None) => OperationResult::failed(
            true,
            "The pending inventory operation is still unconfirmed; it was not replayed.",
        ),
        Err(message) => OperationResult::failed(true, message),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    const USER: u64 = 76561198000000000;
    fn snapshot(version: u64, values: &[(u64, u32, u32)]) -> Snapshot {
        let items = values
            .iter()
            .map(|(id, definition, position)| {
                protocol::Item {
                    id: Some(*id),
                    account: Some(USER as u32),
                    inventory: Some((1 << 31) | position),
                    definition: Some(*definition),
                    quantity: Some(1),
                    quality: 6,
                    origin: Some(4),
                    ..Default::default()
                }
                .encode_to_vec()
            })
            .collect();
        protocol::snapshot(
            &protocol::Cache {
                owner: Some(USER),
                owner_soid: None,
                version: Some(version),
                objects: vec![
                    protocol::ObjectType {
                        kind: Some(1),
                        data: items,
                    },
                    protocol::ObjectType {
                        kind: Some(7),
                        data: vec![vec![]],
                    },
                ],
            }
            .encode_to_vec(),
            USER,
        )
        .unwrap()
    }
    fn request(baseline: Snapshot, operation: Operation) -> OperationRequest {
        OperationRequest {
            steam_id: USER.to_string(),
            baseline,
            operation,
            protected_ids: vec![],
        }
    }
    fn layout() -> OperationRequest {
        request(
            snapshot(1, &[(1, 5000, 1), (2, 5001, 2)]),
            Operation::Layout {
                moves: vec![OperationMove {
                    id: "1".into(),
                    from: 1,
                    to: 3,
                }],
            },
        )
    }

    #[test]
    fn one_send_only_and_stale_baselines_send_nothing() {
        let request = layout();
        let mut session = Session::new(request.clone()).unwrap();
        assert!(session
            .prepare_send(&snapshot(2, &[(1, 5000, 2), (2, 5001, 1)]))
            .is_err());
        assert!(!session.sent);
        let (kind, _) = session.prepare_send(&request.baseline).unwrap();
        assert_eq!(kind, protocol::PROTOBUF | 1100);
        assert!(session.sent);
        assert!(session.prepare_send(&request.baseline).is_err());
    }

    #[test]
    fn a_new_connection_version_with_unchanged_items_sends_and_rebinds_confirmation() {
        let request = layout();
        let mut session = Session::new(request).unwrap();
        // Steam advanced the cache version between review and send; no item changed.
        let reconnected = snapshot(5, &[(1, 5000, 1), (2, 5001, 2)]);
        session.prepare_send(&reconnected).unwrap();
        assert!(session.sent);
        // A cache no newer than the one read just before sending cannot confirm.
        let moved_at_old_version = snapshot(5, &[(1, 5000, 3), (2, 5001, 2)]);
        assert!(session.confirm(&moved_at_old_version).unwrap().is_none());
        let moved = snapshot(6, &[(1, 5000, 3), (2, 5001, 2)]);
        assert_eq!(
            session.confirm(&moved).unwrap().unwrap().status,
            OperationStatus::Confirmed
        );
    }

    #[test]
    fn move_requires_new_complete_cache_and_unchanged_unrelated_bytes() {
        let request = layout();
        let mut session = Session::new(request.clone()).unwrap();
        session.prepare_send(&request.baseline).unwrap();
        assert!(session.confirm(&request.baseline).unwrap().is_none());
        let after = snapshot(2, &[(1, 5000, 3), (2, 5001, 2)]);
        assert_eq!(
            session.confirm(&after).unwrap().unwrap().status,
            OperationStatus::Confirmed
        );
        let unrelated = snapshot(2, &[(1, 5000, 3), (2, 5001, 4)]);
        assert!(session.confirm(&unrelated).is_err());
        let partial = snapshot(2, &[(1, 5000, 1), (2, 5001, 2)]);
        assert!(session.confirm(&partial).unwrap().is_none());
    }

    #[test]
    fn craft_requires_reply_exact_outputs_and_preserves_unrelated_items() {
        let before = snapshot(1, &[(1, 5000, 1), (2, 5000, 2), (3, 5000, 3), (9, 13, 9)]);
        let req = request(
            before,
            Operation::Craft {
                recipe_id: 4,
                input_ids: vec!["1".into(), "2".into(), "3".into()],
                output_definition: 5001,
                output_count: 1,
                output_choices: vec![],
            },
        );
        let mut session = Session::new(req.clone()).unwrap();
        assert_eq!(session.prepare_send(&req.baseline).unwrap().0, 1002);
        let after = snapshot(2, &[(4, 5001, 1), (9, 13, 9)]);
        assert!(session.confirm(&after).unwrap().is_none());
        let mut reply = 4i16.to_le_bytes().to_vec();
        reply.extend(0u32.to_le_bytes());
        reply.extend(1u16.to_le_bytes());
        reply.extend(4u64.to_le_bytes());
        session.observe(1003, &reply).unwrap();
        let result = session.confirm(&after).unwrap().unwrap();
        assert_eq!(result.consumed_ids, ["1", "2", "3"]);
        assert_eq!(result.acquired_ids, ["4"]);
        assert!(session
            .confirm(&snapshot(2, &[(4, 5002, 1), (9, 13, 9)]))
            .is_err());
        let mut denied = Session::new(req.clone()).unwrap();
        denied.prepare_send(&req.baseline).unwrap();
        reply[2..6].copy_from_slice(&1u32.to_le_bytes());
        denied.observe(1003, &reply).unwrap();
        assert!(denied.confirm(&after).is_err());
    }

    #[test]
    fn random_hat_accepts_only_a_reviewed_hat_output() {
        let before = snapshot(1, &[(1, 5002, 1), (2, 5002, 2), (3, 5002, 3), (9, 13, 9)]);
        let hat = |choices: Vec<u32>, recipe_id: i16| {
            request(
                before.clone(),
                Operation::Craft {
                    recipe_id,
                    input_ids: vec!["1".into(), "2".into(), "3".into()],
                    output_definition: 0,
                    output_count: 1,
                    output_choices: choices,
                },
            )
        };
        let req = hat(vec![30, 31], 6);
        let mut session = Session::new(req.clone()).unwrap();
        assert_eq!(session.prepare_send(&req.baseline).unwrap().0, 1002);
        let mut reply = 6i16.to_le_bytes().to_vec();
        reply.extend(0u32.to_le_bytes());
        reply.extend(1u16.to_le_bytes());
        reply.extend(4u64.to_le_bytes());
        session.observe(1003, &reply).unwrap();
        let result = session
            .confirm(&snapshot(2, &[(4, 31, 1), (9, 13, 9)]))
            .unwrap()
            .unwrap();
        assert_eq!(result.acquired_ids, ["4"]);
        assert!(session
            .confirm(&snapshot(2, &[(4, 5001, 1), (9, 13, 9)]))
            .is_err());
        // No list, an unsorted list, or a list on a metal recipe never reaches the wire.
        for bad in [hat(vec![], 6), hat(vec![31, 30], 6), hat(vec![30], 5)] {
            assert!(Session::new(bad.clone())
                .and_then(|mut session| session.prepare_send(&bad.baseline))
                .is_err());
        }
    }

    fn destroy(owner: u64, id: u64, version: u64) -> Vec<u8> {
        let mut bytes = vec![9];
        bytes.extend(owner.to_le_bytes());
        bytes.extend([16, 1, 26, 2, 8, id as u8, 33]);
        bytes.extend(version.to_le_bytes());
        bytes
    }

    #[test]
    fn deletion_requires_account_bound_destroy_and_complete_absence() {
        let req = request(
            snapshot(1, &[(1, 13, 1), (2, 14, 2)]),
            Operation::Delete {
                item_id: "1".into(),
            },
        );
        let mut session = Session::new(req.clone()).unwrap();
        assert_eq!(session.prepare_send(&req.baseline).unwrap().0, 1004);
        let after = snapshot(2, &[(2, 14, 2)]);
        assert!(session.confirm(&after).unwrap().is_none());
        assert!(session.observe(23, &destroy(USER + 1, 1, 2)).is_err());
        session.observe(23, &destroy(USER, 1, 2)).unwrap();
        assert_eq!(
            session.confirm(&after).unwrap().unwrap().consumed_ids,
            ["1"]
        );
        assert!(session.confirm(&snapshot(2, &[])).unwrap().is_none());
    }

    #[test]
    fn interrupted_operations_reconcile_without_replay_or_inferring_refusal() {
        let req = layout();
        assert_eq!(
            reconcile_operation(&req, &req.baseline).status,
            OperationStatus::Unknown
        );
        assert_eq!(
            reconcile_operation(&req, &snapshot(2, &[(1, 5000, 3), (2, 5001, 2)])).status,
            OperationStatus::Confirmed
        );
        let mut foreign = snapshot(2, &[(1, 5000, 3), (2, 5001, 2)]);
        foreign.steam_id = (USER + 1).to_string();
        let outcome = reconcile_operation(&req, &foreign);
        assert_eq!(outcome.status, OperationStatus::Unknown);
        assert!(outcome.snapshot.is_none());
    }

    #[test]
    fn rejects_protected_items_wildcards_and_incomplete_authority() {
        let mut req = layout();
        req.protected_ids.push("1".into());
        assert!(Session::new(req).is_err());
        let mut req = layout();
        req.baseline.items[0].raw_item.clear();
        assert!(Session::new(req).is_err());
        let mut req = layout();
        req.baseline.cache_version = None;
        assert!(Session::new(req).is_err());
        let req = request(
            snapshot(1, &[(1, 5001, 1)]),
            Operation::Craft {
                recipe_id: -2,
                input_ids: vec!["1".into()],
                output_definition: 5000,
                output_count: 3,
                output_choices: vec![],
            },
        );
        assert!(Session::new(req).is_err());
    }

    #[test]
    fn metal_recipe_identity_and_output_restrictions_are_checked() {
        let before = snapshot(1, &[(1, 5001, 1)]);
        let mut req = request(
            before,
            Operation::Craft {
                recipe_id: 22,
                input_ids: vec!["1".into()],
                output_definition: 5000,
                output_count: 3,
                output_choices: vec![],
            },
        );
        req.baseline.items[0].flags = Some(4);
        let mut raw = protocol::Item::decode(req.baseline.items[0].raw_item.as_slice()).unwrap();
        raw.flags = Some(4);
        req.baseline.items[0].raw_item = raw.encode_to_vec();
        assert!(Session::new(req.clone()).is_ok());
        let mut wrong = req.clone();
        if let Operation::Craft { recipe_id, .. } = &mut wrong.operation {
            *recipe_id = 4;
        }
        assert!(Session::new(wrong).is_err());
        let mut after = snapshot(2, &[(2, 5000, 1), (3, 5000, 2), (4, 5000, 3)]);
        assert_eq!(
            reconcile_operation(&req, &after).status,
            OperationStatus::Confirmed
        );
        after.items[0].quality = 5;
        assert_eq!(
            reconcile_operation(&req, &after).status,
            OperationStatus::Unknown
        );
        after.items[0].quality = 6;
        after.items[0].origin = None;
        assert_eq!(
            reconcile_operation(&req, &after).status,
            OperationStatus::Unknown
        );
    }

    #[test]
    fn disconnect_and_conflicting_or_out_of_order_events_never_publish_snapshots() {
        let req = layout();
        let mut session = Session::new(req.clone()).unwrap();
        assert_eq!(
            OperationResult::failed(session.sent, "disconnected").status,
            OperationStatus::Refused
        );
        session.prepare_send(&req.baseline).unwrap();
        let result = OperationResult::failed(session.sent, "disconnected after send");
        assert_eq!(result.status, OperationStatus::Unknown);
        assert!(result.snapshot.is_none());
        session.observe(23, &destroy(USER, 1, 3)).unwrap();
        assert!(session.observe(23, &destroy(USER, 1, 2)).is_err());
        assert!(session
            .confirm(&snapshot(2, &[(1, 5000, 3), (2, 5001, 2)]))
            .unwrap()
            .is_none());
    }
}
