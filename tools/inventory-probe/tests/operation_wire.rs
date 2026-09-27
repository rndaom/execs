// Independently decode the wire bodies used by the operation helper.
#[path = "../src/operation_wire.rs"]
mod wire;

#[test]
fn binary_envelope_is_versioned_and_reply_jobs_are_checked() {
    let bytes = wire::binary_envelope(&[1, 2, 3]);
    assert_eq!(bytes.len(), 21);
    assert_eq!(&bytes[..2], &[1, 0]);
    assert_eq!(wire::binary_payload(&bytes).unwrap(), &[1, 2, 3]);
    assert!(wire::binary_payload(&bytes[..17]).is_err());
    let mut other_job = bytes.clone();
    other_job[2] = 0;
    assert!(wire::binary_payload(&other_job).is_err());
}

#[test]
fn position_comparison_preserves_unknown_protobuf_fields() {
    let first = [8, 1, 24, 1, 162, 6, 2, 12, 34];
    let second = [8, 1, 24, 2, 162, 6, 2, 12, 34];
    assert_eq!(
        wire::without_position(&first).unwrap(),
        wire::without_position(&second).unwrap()
    );
    let changed = [8, 1, 24, 2, 162, 6, 2, 12, 35];
    assert_ne!(
        wire::without_position(&first).unwrap(),
        wire::without_position(&changed).unwrap()
    );
    assert!(wire::without_position(&[24, 1, 24, 2]).is_err());
    assert!(wire::without_position(&[24, 128]).is_err());
}

use prost::Message;
use std::collections::BTreeSet;
use wire::{
    craft_body, craft_reply, delete_body, displayed_position, positions_body, PositionItem,
    PositionMove,
};

#[derive(Clone, PartialEq, Message)]
struct IndependentEntry {
    #[prost(uint64, optional, tag = "1")]
    item: Option<u64>,
    #[prost(uint32, optional, tag = "2")]
    position: Option<u32>,
}
#[derive(Clone, PartialEq, Message)]
struct IndependentPositions {
    #[prost(message, repeated, tag = "1")]
    values: Vec<IndependentEntry>,
}

#[test]
fn encodes_a_full_backpack_sort_in_one_bounded_message() {
    let capacity = wire::MAX_POSITION_MOVES as u32;
    let items: Vec<_> = (1..=capacity)
        .map(|slot| PositionItem {
            id: u64::MAX - u64::from(slot),
            raw_position: 0x80000000 | slot,
        })
        .collect();
    let moves: Vec<_> = items
        .iter()
        .enumerate()
        .map(|(index, item)| PositionMove {
            id: item.id,
            from_raw: item.raw_position,
            to_slot: (index as u32 + 1) % capacity + 1,
        })
        .collect();
    let body = positions_body(capacity, &items, &moves, &BTreeSet::new()).unwrap();
    assert!(body.len() < 256 * 1024);
    let decoded = IndependentPositions::decode(body.as_slice()).unwrap();
    assert_eq!(decoded.values.len(), moves.len());
    for (entry, movement) in decoded.values.iter().zip(&moves) {
        assert_eq!(entry.item, Some(movement.id));
        assert_eq!(entry.position, Some(0x80000000 | movement.to_slot));
    }
    let mut oversized = moves;
    oversized.push(oversized[0].clone());
    assert_eq!(
        positions_body(capacity, &items, &oversized, &BTreeSet::new()),
        Err("Invalid move count")
    );
}

#[test]
fn encodes_exact_positions_and_conserves_swapped_identities() {
    let items = [
        PositionItem {
            id: u64::MAX,
            raw_position: 0x80000001,
        },
        PositionItem {
            id: 2,
            raw_position: 2,
        },
    ];
    let moves = [
        PositionMove {
            id: u64::MAX,
            from_raw: 0x80000001,
            to_slot: 2,
        },
        PositionMove {
            id: 2,
            from_raw: 2,
            to_slot: 1,
        },
    ];
    let body = positions_body(50, &items, &moves, &BTreeSet::new()).unwrap();
    let decoded = IndependentPositions::decode(body.as_slice()).unwrap();
    assert_eq!(
        decoded
            .values
            .iter()
            .map(|v| (v.item.unwrap(), v.position.unwrap()))
            .collect::<Vec<_>>(),
        [(u64::MAX, 0x80000002), (2, 0x80000001)]
    );
    assert_eq!(items[0].raw_position, 0x80000001);
}

#[test]
fn placing_unacknowledged_item_clears_reason_and_does_not_look_like_its_reason_slot() {
    let items = [PositionItem {
        id: 1,
        raw_position: 0xc000000a,
    }];
    let moves = [PositionMove {
        id: 1,
        from_raw: 0xc000000a,
        to_slot: 10,
    }];
    assert_eq!(displayed_position(items[0].raw_position), 0);
    let body = positions_body(50, &items, &moves, &BTreeSet::new()).unwrap();
    assert_eq!(
        IndependentPositions::decode(body.as_slice())
            .unwrap()
            .values[0]
            .position,
        Some(0x8000000a)
    );
}

#[test]
fn refuses_stale_raw_flags_protection_and_occupied_destination() {
    let items = [
        PositionItem {
            id: 1,
            raw_position: 0x80000001,
        },
        PositionItem {
            id: 2,
            raw_position: 2,
        },
    ];
    let mut moves = [PositionMove {
        id: 1,
        from_raw: 1,
        to_slot: 3,
    }];
    assert!(positions_body(50, &items, &moves, &BTreeSet::new()).is_err());
    moves[0].from_raw = items[0].raw_position;
    assert!(positions_body(50, &items, &moves, &BTreeSet::from([1])).is_err());
    moves[0].to_slot = 2;
    assert!(positions_body(50, &items, &moves, &BTreeSet::new()).is_err());
    moves[0].to_slot = 51;
    assert!(positions_body(50, &items, &moves, &BTreeSet::new()).is_err());
}

#[test]
fn refuses_unknown_position_bits_duplicate_baselines_and_unbounded_plans() {
    let mut items = vec![PositionItem {
        id: 1,
        raw_position: 0x10000001,
    }];
    let moves = [PositionMove {
        id: 1,
        from_raw: items[0].raw_position,
        to_slot: 2,
    }];
    assert!(positions_body(50, &items, &moves, &BTreeSet::new()).is_err());
    items[0].raw_position = 1;
    items.push(items[0].clone());
    assert!(positions_body(50, &items, &moves, &BTreeSet::new()).is_err());
    assert!(positions_body(65536, &[], &moves, &BTreeSet::new()).is_err());
    assert!(positions_body(50, &[], &[], &BTreeSet::new()).is_err());
    assert!(positions_body(
        50,
        &[],
        &vec![moves[0].clone(); wire::MAX_POSITION_MOVES + 1],
        &BTreeSet::new()
    )
    .is_err());
}

#[test]
fn binary_bodies_keep_large_ids_and_never_offer_wildcard_or_batch_deletion() {
    let body = craft_body(7, &[u64::MAX, 9007199254740993]).unwrap();
    assert_eq!(&body[..4], &[7, 0, 2, 0]);
    assert_eq!(&body[4..12], &[255; 8]);
    assert_eq!(&body[12..], &9007199254740993u64.to_le_bytes());
    assert!(craft_body(-2, &[1]).is_err());
    assert!(craft_body(7, &[1, 1]).is_err());
    assert!(craft_body(7, &[0]).is_err());
    assert!(craft_body(7, &[]).is_err());
    assert!(craft_body(7, &(1..=13).collect::<Vec<_>>()).is_err());
    assert_eq!(delete_body(u64::MAX).unwrap(), [255; 8]);
    assert!(delete_body(0).is_err());
}

#[test]
fn craft_reply_keeps_nonzero_result_code_and_rejects_truncation_trailing_or_duplicate_ids() {
    let mut body = vec![7, 0, 4, 0, 0, 0, 1, 0];
    body.extend_from_slice(&u64::MAX.to_le_bytes());
    let reply = craft_reply(&body).unwrap();
    assert_eq!(reply.recipe, 7);
    assert_eq!(reply.response, 4);
    assert_eq!(reply.output_ids, [u64::MAX]);
    for length in 0..body.len() {
        assert!(craft_reply(&body[..length]).is_err());
    }
    let mut trailing = body.clone();
    trailing.push(0);
    assert!(craft_reply(&trailing).is_err());
    body[6] = 2;
    body.extend_from_slice(&u64::MAX.to_le_bytes());
    assert!(craft_reply(&body).is_err());
    assert!(craft_reply(&[0, 0, 0, 0, 0, 0, 1, 1]).is_err());
}
