//! Independently declared protocol facts; no transport, filesystem or Steam calls.
//! Sources and unfinished native gates: docs/audits/2026-09-27-inventory-usability/reference-parity.md.
use prost::Message;
use std::collections::{BTreeMap, BTreeSet};

const NEW_FORMAT: u32 = 1 << 31;
const UNACKNOWLEDGED: u32 = 1 << 30;
const SLOT_MASK: u32 = 0xffff;
// A whole-backpack sort fits the app's bounded 10,000-slot inventory.
pub const MAX_POSITION_MOVES: usize = 10_000;
const MAX_CRAFT_INPUTS: usize = 12;
const MAX_CRAFT_OUTPUTS: usize = 256;

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct PositionItem {
    pub id: u64,
    pub raw_position: u32,
}

#[derive(Clone, Debug)]
pub struct PositionMove {
    pub id: u64,
    pub from_raw: u32,
    pub to_slot: u32,
}

#[derive(Clone, PartialEq, Message)]
struct PositionEntry {
    #[prost(uint64, optional, tag = "1")]
    id: Option<u64>,
    #[prost(uint32, optional, tag = "2")]
    position: Option<u32>,
}

#[derive(Clone, PartialEq, Message)]
struct PositionEntries {
    #[prost(message, repeated, tag = "1")]
    entries: Vec<PositionEntry>,
}

pub fn displayed_position(raw: u32) -> u32 {
    if raw == 0 || raw & UNACKNOWLEDGED != 0 {
        0
    } else {
        raw & SLOT_MASK
    }
}

/// Validate a complete fresh position baseline and form a message body only.
/// Parent must still validate account/session, permission and persistent intent.
pub fn positions_body(
    capacity: u32,
    items: &[PositionItem],
    moves: &[PositionMove],
    protected: &BTreeSet<u64>,
) -> Result<Vec<u8>, &'static str> {
    if capacity == 0 || capacity > SLOT_MASK || items.len() > 100_000 {
        return Err("Invalid capacity or inventory size");
    }
    if moves.is_empty() || moves.len() > MAX_POSITION_MOVES {
        return Err("Invalid move count");
    }
    let mut by_id = BTreeMap::new();
    let mut occupied = BTreeSet::new();
    for item in items {
        // Unknown legacy bits require investigation instead of silently discarding them.
        if item.id == 0 || item.raw_position & !(NEW_FORMAT | UNACKNOWLEDGED | SLOT_MASK) != 0 {
            return Err("Invalid identity or unrecognized position flags");
        }
        let slot = displayed_position(item.raw_position);
        if by_id.insert(item.id, item).is_some()
            || slot > capacity
            || (slot != 0 && !occupied.insert(slot))
        {
            return Err("Ambiguous inventory baseline");
        }
    }
    let mut targets = BTreeMap::new();
    for movement in moves {
        let item = by_id.get(&movement.id).ok_or("Unknown moved item")?;
        if protected.contains(&movement.id)
            || movement.from_raw != item.raw_position
            || movement.to_slot == 0
            || movement.to_slot > capacity
            || movement.to_slot == displayed_position(item.raw_position)
            || targets.insert(movement.id, movement.to_slot).is_some()
        {
            return Err("Protected, stale, repeated or invalid move");
        }
    }
    occupied.clear();
    for item in items {
        let slot = targets
            .get(&item.id)
            .copied()
            .unwrap_or_else(|| displayed_position(item.raw_position));
        if slot != 0 && !occupied.insert(slot) {
            return Err("Final slot collision");
        }
    }
    Ok(PositionEntries {
        entries: moves
            .iter()
            .map(|movement| PositionEntry {
                id: Some(movement.id),
                // Valve's setter writes the destination and then adds the new-format bit.
                position: Some(NEW_FORMAT | movement.to_slot),
            })
            .collect(),
    }
    .encode_to_vec())
}

/// Binary body only; the transport envelope is constructed separately.
/// An explicit nonnegative recipe index is necessary but NOT sufficient authority:
/// the caller must match the installed item schema and complete ingredient rules.
pub fn craft_body(recipe: i16, ids: &[u64]) -> Result<Vec<u8>, &'static str> {
    if recipe < 0 || ids.is_empty() || ids.len() > MAX_CRAFT_INPUTS {
        return Err("Wildcard, invalid recipe or ingredient count");
    }
    if ids.contains(&0) || ids.iter().copied().collect::<BTreeSet<_>>().len() != ids.len() {
        return Err("Invalid or repeated ingredient identity");
    }
    let mut body = Vec::with_capacity(4 + ids.len() * 8);
    body.extend_from_slice(&recipe.to_le_bytes());
    body.extend_from_slice(&(ids.len() as u16).to_le_bytes());
    for id in ids {
        body.extend_from_slice(&id.to_le_bytes());
    }
    Ok(body)
}

/// Single item only. Protection, deletability and explicit review belong to the caller.
pub fn delete_body(id: u64) -> Result<[u8; 8], &'static str> {
    if id == 0 {
        return Err("Invalid delete identity");
    }
    Ok(id.to_le_bytes())
}

#[derive(Debug, PartialEq, Eq)]
pub struct CraftReply {
    pub recipe: i16,
    /// This is an actual response enum, not padding or an ignorable zero.
    pub response: u32,
    pub output_ids: Vec<u64>,
}

/// Parse a stripped binary body with exact length and bounded unique output IDs.
/// No response code, including zero, confirms consumption without cache reconciliation.
pub fn craft_reply(body: &[u8]) -> Result<CraftReply, &'static str> {
    if body.len() < 8 {
        return Err("Truncated crafting reply");
    }
    let recipe = i16::from_le_bytes([body[0], body[1]]);
    let response = u32::from_le_bytes([body[2], body[3], body[4], body[5]]);
    let count = u16::from_le_bytes([body[6], body[7]]) as usize;
    if count > MAX_CRAFT_OUTPUTS || body.len() != 8 + count * 8 {
        return Err("Invalid crafting reply count or length");
    }
    let mut output_ids = Vec::with_capacity(count);
    let mut seen = BTreeSet::new();
    for chunk in body[8..].as_chunks::<8>().0 {
        let id = u64::from_le_bytes(*chunk);
        if id == 0 || !seen.insert(id) {
            return Err("Invalid or repeated output identity");
        }
        output_ids.push(id);
    }
    Ok(CraftReply {
        recipe,
        response,
        output_ids,
    })
}

/// Steam's binary GC transport strips the message/account prefix of GCMsgHdrEx_t.
/// Its remaining header is version u16 followed by target/source job u64 values.
pub fn binary_envelope(body: &[u8]) -> Vec<u8> {
    let mut bytes = Vec::with_capacity(18 + body.len());
    bytes.extend(1u16.to_le_bytes());
    bytes.extend(u64::MAX.to_le_bytes());
    bytes.extend(u64::MAX.to_le_bytes());
    bytes.extend(body);
    bytes
}

pub fn binary_payload(bytes: &[u8]) -> Result<&[u8], &'static str> {
    if bytes.len() < 18 || bytes.len() > 8 * 1024 * 1024 || bytes[..2] != [1, 0] {
        return Err("Invalid binary GC envelope");
    }
    // Operations have no jobs; a reply to another caller is not our confirmation.
    if bytes[2..10] != u64::MAX.to_le_bytes() {
        return Err("Craft response belongs to another job");
    }
    Ok(&bytes[18..])
}

/// Retain every known AND unknown top-level protobuf field except inventory (3).
/// Used to prove moving an item changed no other authoritative bytes.
pub fn without_position(bytes: &[u8]) -> Result<Vec<u8>, &'static str> {
    fn varint(bytes: &[u8], at: &mut usize) -> Result<u64, &'static str> {
        let mut value = 0;
        for shift in (0..70).step_by(7) {
            let b = *bytes.get(*at).ok_or("Truncated protobuf varint")?;
            *at += 1;
            if shift == 63 && b > 1 {
                return Err("Overflowed protobuf varint");
            }
            value |= ((b & 127) as u64) << shift;
            if b & 128 == 0 {
                return Ok(value);
            }
        }
        Err("Overflowed protobuf varint")
    }
    let mut result = Vec::with_capacity(bytes.len());
    let mut at = 0;
    let mut position_seen = false;
    while at < bytes.len() {
        let start = at;
        let tag = varint(bytes, &mut at)?;
        let field = tag >> 3;
        if field == 0 {
            return Err("Invalid zero protobuf field");
        }
        match tag & 7 {
            0 => {
                varint(bytes, &mut at)?;
            }
            1 => {
                at = at.checked_add(8).ok_or("Length overflow")?;
            }
            2 => {
                let len =
                    usize::try_from(varint(bytes, &mut at)?).map_err(|_| "Length overflow")?;
                at = at.checked_add(len).ok_or("Length overflow")?;
            }
            5 => {
                at = at.checked_add(4).ok_or("Length overflow")?;
            }
            _ => return Err("Unsupported protobuf wire type"),
        }
        if at > bytes.len() {
            return Err("Truncated protobuf field");
        }
        if field == 3 {
            if position_seen || tag & 7 != 0 {
                return Err("Ambiguous inventory field");
            }
            position_seen = true;
        } else {
            result.extend(&bytes[start..at]);
        }
    }
    if !position_seen {
        return Err("Missing inventory field");
    }
    Ok(result)
}
