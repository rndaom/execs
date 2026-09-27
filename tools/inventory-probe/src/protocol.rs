//! Independently declared TF2 wire fields with bounded authoritative cache evidence.
//! Wire references and limitations are documented in ../README.md.
use prost::Message;
use serde::{Deserialize, Serialize};
use std::collections::HashSet;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct Snapshot {
    pub steam_id: String,
    #[serde(default)]
    pub persona_name: Option<String>,
    #[serde(default)]
    pub avatar: Option<String>,
    pub capacity: u32,
    pub items: Vec<InventoryItem>,
    #[serde(default)]
    pub cache_version: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct InventoryItem {
    pub id: String,
    pub definition: u32,
    pub position: u32,
    pub quality: u32,
    pub level: u32,
    pub custom_name: Option<String>,
    #[serde(default)]
    pub attributes: Vec<ItemAttribute>,
    pub raw_position: u32,
    pub quantity: Option<u32>,
    pub flags: Option<u32>,
    pub origin: Option<u32>,
    pub custom_description: Option<String>,
    pub in_use: Option<bool>,
    pub style: Option<u32>,
    pub original_id: Option<String>,
    pub contains_equipped_state: Option<bool>,
    pub equipped_state: Vec<EquippedState>,
    pub contains_equipped_state_v2: Option<bool>,
    pub interior_item: Option<Vec<u8>>,
    /// Original complete SO bytes retain unknown fields for conservative verification.
    pub raw_item: Vec<u8>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ItemAttribute {
    pub definition: u32,
    pub value_bytes: Vec<u8>,
}

#[derive(Clone, PartialEq, Eq, Message, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EquippedState {
    #[prost(uint32, optional, tag = "1")]
    pub new_class: Option<u32>,
    #[prost(uint32, optional, tag = "2")]
    pub new_slot: Option<u32>,
}

#[derive(Clone, PartialEq, Message)]
pub struct Attribute {
    #[prost(uint32, optional, tag = "1")]
    pub definition: Option<u32>,
    #[prost(uint32, optional, tag = "2")]
    pub value: Option<u32>,
    #[prost(bytes = "vec", optional, tag = "3")]
    pub value_bytes: Option<Vec<u8>>,
}

#[derive(Clone, PartialEq, Message)]
struct Account {
    #[prost(uint32, tag = "1")]
    additional_slots: u32,
    #[prost(bool, tag = "2")]
    trial: bool,
}

pub const PROTOBUF: u32 = 1 << 31;
pub const MAX_MESSAGE: usize = 8 * 1024 * 1024;

pub fn envelope(kind: u32, body: &[u8]) -> Vec<u8> {
    let mut bytes = (kind | PROTOBUF).to_le_bytes().to_vec();
    bytes.extend(0u32.to_le_bytes());
    bytes.extend(body);
    bytes
}

pub fn account_refresh(steam_id: u64) -> Vec<u8> {
    envelope(
        28,
        &Refresh {
            owner: Some(steam_id),
            owner_soid: Some(Owner {
                kind: Some(1),
                id: Some(steam_id),
            }),
        }
        .encode_to_vec(),
    )
}

#[derive(Clone, PartialEq, Message)]
struct SingleChange {
    #[prost(fixed64, optional, tag = "1")]
    owner: Option<u64>,
    #[prost(int32, optional, tag = "2")]
    kind: Option<i32>,
    #[prost(bytes = "vec", optional, tag = "3")]
    data: Option<Vec<u8>>,
    #[prost(fixed64, optional, tag = "4")]
    version: Option<u64>,
    #[prost(message, optional, tag = "5")]
    owner_soid: Option<Owner>,
}

#[derive(Clone, PartialEq, Message)]
struct ChangedObject {
    #[prost(int32, optional, tag = "1")]
    kind: Option<i32>,
    #[prost(bytes = "vec", optional, tag = "2")]
    data: Option<Vec<u8>>,
}

#[derive(Clone, PartialEq, Message)]
struct MultipleChanges {
    #[prost(fixed64, optional, tag = "1")]
    owner: Option<u64>,
    #[prost(message, repeated, tag = "2")]
    objects: Vec<ChangedObject>,
    #[prost(fixed64, optional, tag = "3")]
    version: Option<u64>,
    #[prost(message, optional, tag = "6")]
    owner_soid: Option<Owner>,
}

pub struct Changes {
    pub version: u64,
    pub item_ids: Vec<String>,
}

/// Validate account and version on notifications. A full cache is still required;
/// notifications are never patched into a potentially incomplete success snapshot.
pub fn changes(kind: u32, body: &[u8], steam_id: u64) -> Result<Changes, String> {
    if body.len() > MAX_MESSAGE {
        return Err("Oversized SO notification".into());
    }
    let (owner, owner_soid, version, objects) = match kind {
        21..=23 => {
            let value = SingleChange::decode(body).map_err(|e| e.to_string())?;
            (
                value.owner,
                value.owner_soid,
                value.version,
                vec![ChangedObject {
                    kind: value.kind,
                    data: value.data,
                }],
            )
        }
        26 => {
            let value = MultipleChanges::decode(body).map_err(|e| e.to_string())?;
            (value.owner, value.owner_soid, value.version, value.objects)
        }
        _ => return Err("Unexpected SO notification type".into()),
    };
    if owner_soid.as_ref().is_some_and(|o| o.kind != Some(1))
        || owner_soid.as_ref().and_then(|o| o.id).or(owner) != Some(steam_id)
        || owner.is_some_and(|o| o != steam_id)
    {
        return Err("SO notification belongs to another account".into());
    }
    if objects.len() > 100_000 {
        return Err("Too many SO changes".into());
    }
    let mut item_ids = Vec::new();
    let mut seen = HashSet::new();
    for object in objects {
        if object.kind != Some(1) {
            continue;
        }
        let bytes = object.data.ok_or("Missing changed object")?;
        if bytes.len() > 65_536 {
            return Err("Oversized changed item".into());
        }
        let item = Item::decode(bytes.as_slice()).map_err(|e| e.to_string())?;
        // Destroy notifications can contain only key fields.
        if item.account.is_some_and(|id| id != steam_id as u32) {
            return Err("Changed item belongs to another account".into());
        }
        let id = item
            .id
            .filter(|id| *id != 0)
            .ok_or("Missing changed item identity")?;
        if !seen.insert(id) {
            return Err("Duplicate changed item identity".into());
        }
        item_ids.push(id.to_string());
    }
    Ok(Changes {
        version: version.ok_or("Missing SO notification version")?,
        item_ids,
    })
}

#[derive(Clone, PartialEq, Message)]
pub struct SubscriptionCheck {
    #[prost(fixed64, optional, tag = "1")]
    pub owner: Option<u64>,
    #[prost(message, optional, tag = "3")]
    pub owner_soid: Option<Owner>,
}

#[derive(Clone, PartialEq, Message)]
pub struct Refresh {
    #[prost(fixed64, optional, tag = "1")]
    pub owner: Option<u64>,
    #[prost(message, optional, tag = "2")]
    pub owner_soid: Option<Owner>,
}

pub fn refresh(body: &[u8], steam_id: u64) -> Result<Vec<u8>, String> {
    let check = SubscriptionCheck::decode(body).map_err(|e| e.to_string())?;
    if check.owner_soid.as_ref().and_then(|o| o.id).or(check.owner) != Some(steam_id)
        || check.owner_soid.as_ref().is_some_and(|o| o.kind != Some(1))
        || check.owner.is_some_and(|id| id != steam_id)
    {
        return Err("Subscription belongs to another account".into());
    }
    let kind = PROTOBUF | 28;
    let mut message = kind.to_le_bytes().to_vec();
    message.extend(0u32.to_le_bytes());
    message.extend(
        Refresh {
            owner: check.owner,
            owner_soid: check.owner_soid,
        }
        .encode_to_vec(),
    );
    Ok(message)
}

#[derive(Clone, PartialEq, Message)]
pub struct Cache {
    #[prost(fixed64, optional, tag = "1")]
    pub owner: Option<u64>,
    #[prost(message, repeated, tag = "2")]
    pub objects: Vec<ObjectType>,
    #[prost(fixed64, optional, tag = "3")]
    pub version: Option<u64>,
    #[prost(message, optional, tag = "4")]
    pub owner_soid: Option<Owner>,
}

#[derive(Clone, PartialEq, Message)]
pub struct Owner {
    #[prost(uint32, optional, tag = "1")]
    pub kind: Option<u32>,
    #[prost(uint64, optional, tag = "2")]
    pub id: Option<u64>,
}

#[derive(Clone, PartialEq, Message)]
pub struct ObjectType {
    #[prost(int32, optional, tag = "1")]
    pub kind: Option<i32>,
    #[prost(bytes = "vec", repeated, tag = "2")]
    pub data: Vec<Vec<u8>>,
}

#[derive(Clone, PartialEq, Message)]
pub struct Item {
    #[prost(uint64, optional, tag = "1")]
    pub id: Option<u64>,
    #[prost(uint32, optional, tag = "2")]
    pub account: Option<u32>,
    #[prost(uint32, optional, tag = "3")]
    pub inventory: Option<u32>,
    #[prost(uint32, optional, tag = "4")]
    pub definition: Option<u32>,
    #[prost(uint32, optional, tag = "5")]
    pub quantity: Option<u32>,
    #[prost(uint32, tag = "6")]
    pub level: u32,
    #[prost(uint32, tag = "7")]
    pub quality: u32,
    #[prost(uint32, optional, tag = "8")]
    pub flags: Option<u32>,
    #[prost(uint32, optional, tag = "9")]
    pub origin: Option<u32>,
    #[prost(string, optional, tag = "10")]
    pub custom_name: Option<String>,
    #[prost(string, optional, tag = "11")]
    pub custom_description: Option<String>,
    #[prost(message, repeated, tag = "12")]
    pub attributes: Vec<Attribute>,
    #[prost(bytes = "vec", optional, tag = "13")]
    pub interior_item: Option<Vec<u8>>,
    #[prost(bool, optional, tag = "14")]
    pub in_use: Option<bool>,
    #[prost(uint32, optional, tag = "15")]
    pub style: Option<u32>,
    #[prost(uint64, optional, tag = "16")]
    pub original_id: Option<u64>,
    #[prost(bool, optional, tag = "17")]
    pub contains_equipped_state: Option<bool>,
    #[prost(message, repeated, tag = "18")]
    pub equipped_state: Vec<EquippedState>,
    #[prost(bool, optional, tag = "19")]
    pub contains_equipped_state_v2: Option<bool>,
}

pub fn snapshot(body: &[u8], steam_id: u64) -> Result<Snapshot, String> {
    summary(body, steam_id)?;
    let cache = Cache::decode(body).map_err(|e| e.to_string())?;
    let accounts: Vec<_> = cache
        .objects
        .iter()
        .filter(|o| o.kind == Some(7))
        .flat_map(|o| &o.data)
        .collect();
    if accounts.len() != 1 {
        return Err("Missing or ambiguous backpack capacity".into());
    }
    let account = Account::decode(accounts[0].as_slice()).map_err(|e| e.to_string())?;
    let capacity = account
        .additional_slots
        .checked_add(if account.trial { 50 } else { 300 })
        .ok_or("Invalid capacity")?;
    if capacity > 100_000 {
        return Err("Backpack capacity exceeds limit".into());
    }
    let mut items = Vec::new();
    let mut positions = HashSet::new();
    for bytes in cache
        .objects
        .iter()
        .filter(|o| o.kind == Some(1))
        .flat_map(|o| &o.data)
    {
        let item = Item::decode(bytes.as_slice()).map_err(|e| e.to_string())?;
        if item.attributes.len() > 256
            || bytes.len() > 64 * 1024
            || item.equipped_state.len() > 64
            || item.custom_name.as_ref().is_some_and(|s| s.len() > 4096)
            || item
                .custom_description
                .as_ref()
                .is_some_and(|s| s.len() > 4096)
            || item
                .attributes
                .iter()
                .any(|a| a.value_bytes.as_ref().is_some_and(|v| v.len() > 4096))
        {
            return Err("Item attributes exceed limit".into());
        }
        let mut attribute_ids = HashSet::new();
        if item.attributes.iter().any(|a| {
            a.definition.is_none_or(|id| !attribute_ids.insert(id))
                || (a.value.is_none() && a.value_bytes.as_ref().is_none_or(Vec::is_empty))
                || a.value_bytes.as_ref().is_some_and(Vec::is_empty)
        }) {
            return Err("Incomplete or duplicate authoritative item attributes".into());
        }
        let value = item.inventory.ok_or("Missing position")?;
        let position = if value & (1 << 30) != 0 {
            0
        } else {
            value & 0xffff
        };
        if position > capacity || (position != 0 && !positions.insert(position)) {
            return Err("Invalid or duplicate backpack slot".into());
        }
        items.push(InventoryItem {
            id: item.id.ok_or("Missing ID")?.to_string(),
            definition: item.definition.ok_or("Missing item definition")?,
            position,
            quality: item.quality,
            level: item.level,
            custom_name: item.custom_name,
            raw_position: value,
            quantity: item.quantity,
            flags: item.flags,
            origin: item.origin,
            custom_description: item.custom_description,
            in_use: item.in_use,
            style: item.style,
            original_id: item.original_id.map(|id| id.to_string()),
            contains_equipped_state: item.contains_equipped_state,
            equipped_state: item.equipped_state,
            contains_equipped_state_v2: item.contains_equipped_state_v2,
            interior_item: item.interior_item,
            raw_item: bytes.clone(),
            attributes: item
                .attributes
                .into_iter()
                .map(|a| ItemAttribute {
                    definition: a.definition.expect("validated attribute definition"),
                    value_bytes: a
                        .value_bytes
                        .or_else(|| a.value.map(|v| v.to_le_bytes().to_vec()))
                        .expect("validated attribute value"),
                })
                .collect(),
        });
    }
    if items.len() > 100_000 {
        return Err("Item count exceeds limit".into());
    }
    Ok(Snapshot {
        steam_id: steam_id.to_string(),
        persona_name: None,
        avatar: None,
        capacity,
        items,
        cache_version: cache.version.map(|v| v.to_string()),
    })
}

/// Validate complete ownership/identity before decoding snapshot presentation fields.
pub fn summary(body: &[u8], steam_id: u64) -> Result<(usize, usize), String> {
    let cache = Cache::decode(body).map_err(|e| e.to_string())?;
    let owner = cache.owner_soid.as_ref().and_then(|o| o.id).or(cache.owner);
    if cache.owner_soid.as_ref().is_some_and(|o| o.kind != Some(1))
        || owner != Some(steam_id)
        || cache.owner.is_some_and(|id| id != steam_id)
    {
        return Err("Cache owner does not match the connected Steam account".into());
    }
    let groups: Vec<_> = cache.objects.iter().filter(|o| o.kind == Some(1)).collect();
    if groups.len() != 1 {
        return Err("Expected one complete item cache; missing is not an empty backpack".into());
    }
    let mut ids = HashSet::new();
    let mut unplaced = 0;
    for bytes in &groups[0].data {
        let item = Item::decode(bytes.as_slice()).map_err(|e| e.to_string())?;
        if item.account != Some(steam_id as u32) {
            return Err("Item belongs to a different account".into());
        }
        let id = item
            .id
            .filter(|id| *id != 0)
            .ok_or("Missing item identity")?;
        if !ids.insert(id) {
            return Err("Duplicate item identity".into());
        }
        let inventory = item.inventory.ok_or("Missing item position")?;
        if inventory & (1 << 30) != 0 || inventory & 0xffff == 0 {
            unplaced += 1;
        }
    }
    Ok((ids.len(), unplaced))
}

pub fn payload(message_type: u32, bytes: &[u8]) -> Result<&[u8], String> {
    if bytes.len() > MAX_MESSAGE || bytes.len() < 8 || message_type & PROTOBUF == 0 {
        return Err("Invalid protobuf envelope".into());
    }
    let embedded = u32::from_le_bytes(bytes[0..4].try_into().unwrap());
    if embedded != message_type {
        return Err("Envelope message type mismatch".into());
    }
    let header_size = u32::from_le_bytes(bytes[4..8].try_into().unwrap()) as usize;
    let offset = 8usize.checked_add(header_size).ok_or("Header overflow")?;
    bytes
        .get(offset..)
        .ok_or_else(|| "Truncated protobuf header".into())
}

#[cfg(test)]
mod tests {
    use super::*;
    const USER: u64 = 76561198000000000;

    fn cache(items: Vec<Item>) -> Cache {
        Cache {
            owner: Some(USER),
            owner_soid: None,
            version: Some(1),
            objects: vec![ObjectType {
                kind: Some(1),
                data: items.iter().map(Message::encode_to_vec).collect(),
            }],
        }
    }

    fn item(id: u64, position: u32) -> Item {
        Item {
            id: Some(id),
            account: Some(USER as u32),
            inventory: Some(position),
            definition: Some(13),
            ..Default::default()
        }
    }

    #[test]
    fn preserves_large_ids_and_recognizes_unplaced_items() {
        assert_eq!(
            summary(
                &cache(vec![item(u64::MAX, 1), item(2, (1 << 30) | 5)]).encode_to_vec(),
                USER
            ),
            Ok((2, 1))
        );
    }

    #[test]
    fn rejects_foreign_missing_and_duplicate_state() {
        let mut c = cache(vec![item(1, 1)]);
        assert!(summary(&c.encode_to_vec(), USER + 1).is_err());
        c.objects.clear();
        assert!(summary(&c.encode_to_vec(), USER).is_err());
        assert!(summary(&cache(vec![item(1, 1), item(1, 2)]).encode_to_vec(), USER).is_err());
        let mut foreign = item(2, 1);
        foreign.account = Some(3);
        assert!(summary(&cache(vec![foreign]).encode_to_vec(), USER).is_err());
        assert_eq!(summary(&cache(vec![]).encode_to_vec(), USER), Ok((0, 0)));
    }

    #[test]
    fn rejects_truncated_and_mismatched_envelopes() {
        let kind = PROTOBUF | 24;
        let mut bytes = kind.to_le_bytes().to_vec();
        bytes.extend(0u32.to_le_bytes());
        bytes.extend([8, 1]);
        assert_eq!(payload(kind, &bytes).unwrap(), &[8, 1]);
        assert!(payload(kind + 1, &bytes).is_err());
        for length in 0..8 {
            assert!(payload(kind, &bytes[..length]).is_err());
        }
        bytes[4..8].copy_from_slice(&u32::MAX.to_le_bytes());
        assert!(payload(kind, &bytes).is_err());
    }

    #[test]
    fn snapshot_requires_capacity_and_preserves_string_ids() {
        let mut c = cache(vec![item(u64::MAX, 301)]);
        assert!(snapshot(&c.encode_to_vec(), USER).is_err());
        c.objects.push(ObjectType {
            kind: Some(7),
            data: vec![Account {
                additional_slots: 50,
                trial: false,
            }
            .encode_to_vec()],
        });
        let result = snapshot(&c.encode_to_vec(), USER).unwrap();
        assert_eq!(result.capacity, 350);
        assert_eq!(result.items[0].id, u64::MAX.to_string());
        assert!(serde_json::to_string(&result)
            .unwrap()
            .contains("\"18446744073709551615\""));
        c.objects[0].data.push(item(2, 301).encode_to_vec());
        assert!(snapshot(&c.encode_to_vec(), USER).is_err());
    }

    #[test]
    fn snapshot_preserves_attribute_bytes_and_rejects_oversized_values() {
        let mut source = item(1, 1);
        source.attributes = vec![
            Attribute {
                definition: Some(834),
                value: Some(99),
                value_bytes: Some(vec![1, 2, 3, 4]),
            },
            Attribute {
                definition: Some(725),
                value: Some(0x12345678),
                value_bytes: None,
            },
        ];
        let mut c = cache(vec![source.clone()]);
        c.objects.push(ObjectType {
            kind: Some(7),
            data: vec![Account::default().encode_to_vec()],
        });
        let result = snapshot(&c.encode_to_vec(), USER).unwrap();
        assert_eq!(result.items[0].attributes[0].value_bytes, [1, 2, 3, 4]);
        assert_eq!(
            result.items[0].attributes[1].value_bytes,
            [0x78, 0x56, 0x34, 0x12]
        );
        source.attributes[0].value_bytes = Some(vec![0; 4097]);
        c.objects[0].data[0] = source.encode_to_vec();
        assert!(snapshot(&c.encode_to_vec(), USER).is_err());
    }

    #[test]
    fn complete_snapshots_refuse_dropped_attributes_and_foreign_owner_kinds() {
        let mut source = item(1, 1);
        source.attributes = vec![Attribute {
            definition: None,
            value: Some(1),
            value_bytes: None,
        }];
        let mut c = cache(vec![source.clone()]);
        c.objects.push(ObjectType {
            kind: Some(7),
            data: vec![Account::default().encode_to_vec()],
        });
        assert!(snapshot(&c.encode_to_vec(), USER).is_err());
        source.attributes[0].definition = Some(153);
        source.attributes.push(source.attributes[0].clone());
        c.objects[0].data[0] = source.encode_to_vec();
        assert!(snapshot(&c.encode_to_vec(), USER).is_err());
        source.attributes.pop();
        source.attributes[0].value = None;
        c.objects[0].data[0] = source.encode_to_vec();
        assert!(snapshot(&c.encode_to_vec(), USER).is_err());
        c.objects[0].data[0] = item(1, 1).encode_to_vec();
        c.owner_soid = Some(Owner {
            kind: Some(2),
            id: Some(USER),
        });
        assert!(snapshot(&c.encode_to_vec(), USER).is_err());
    }

    #[test]
    fn snapshot_retains_field_presence_equipped_state_and_unknown_raw_bytes() {
        let mut source = item(1, 1);
        source.flags = Some(0);
        source.quantity = Some(1);
        source.origin = Some(4);
        source.custom_description = Some("named history".into());
        source.equipped_state = vec![EquippedState {
            new_class: Some(1),
            new_slot: Some(2),
        }];
        let mut raw = source.encode_to_vec();
        raw.extend([160, 6, 7]);
        let mut c = cache(vec![]);
        c.objects[0].data.push(raw.clone());
        c.objects.push(ObjectType {
            kind: Some(7),
            data: vec![Account::default().encode_to_vec()],
        });
        let item = snapshot(&c.encode_to_vec(), USER).unwrap().items.remove(0);
        assert_eq!(item.raw_item, raw);
        assert_eq!(item.flags, Some(0));
        assert_eq!(item.in_use, None);
        assert_eq!(item.origin, Some(4));
        assert_eq!(item.equipped_state.len(), 1);
        assert_eq!(item.custom_description.as_deref(), Some("named history"));
    }

    #[test]
    fn refresh_is_bound_to_the_account_and_has_the_right_envelope() {
        let check = SubscriptionCheck {
            owner: Some(USER),
            owner_soid: None,
        }
        .encode_to_vec();
        assert!(refresh(&check, USER + 1).is_err());
        let request = refresh(&check, USER).unwrap();
        let decoded = Refresh::decode(payload(PROTOBUF | 28, &request).unwrap()).unwrap();
        assert_eq!(decoded.owner, Some(USER));
    }
}
