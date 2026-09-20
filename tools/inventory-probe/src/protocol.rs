//! Minimal, independently declared wire fields for a read-only TF2 probe.
//! Wire references and limitations are documented in ../README.md.
use prost::Message;
use std::collections::HashSet;

pub const PROTOBUF: u32 = 1 << 31;
pub const MAX_MESSAGE: usize = 8 * 1024 * 1024;

#[derive(Clone, PartialEq, Message)]
pub struct Cache {
    #[prost(fixed64, optional, tag = "1")]
    pub owner: Option<u64>,
    #[prost(message, repeated, tag = "2")]
    pub objects: Vec<ObjectType>,
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
}

/// Unknown protobuf fields are retained by neither this diagnostic nor its output.
/// This is not yet the product's full item model.
pub fn summary(body: &[u8], steam_id: u64) -> Result<(usize, usize), String> {
    let cache = Cache::decode(body).map_err(|e| e.to_string())?;
    let owner = cache.owner_soid.as_ref().and_then(|o| o.id).or(cache.owner);
    if owner != Some(steam_id) || cache.owner.is_some_and(|id| id != steam_id) {
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
}
