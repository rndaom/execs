# Jengerer reference parity and native operation implementation map

September 27, 2026. This is a source/code audit, not evidence of live writes. No Steam mutation or Computer Use was performed. The user wants reference functionality in the backpack itself and authorizes independent recreation, not copying unlicensed code/assets.

## What the reference actually promises

[Jengerer's published feature list](https://www.jengerer.com/item_manager/) describes single and Ctrl-selected batch dragging, sequential placement skipping occupied slots, arrow-key/button/edge-drag page navigation with wrap, cycling/placing unplaced items, ingredient-selected crafting, and confirmed single-item deletion. It also describes crate series, Strange names/counters, remaining uses and paint colors. Sorting, recipe selection and automatic crafting appear as planned features. Equip is not documented as a working feature; a button in its screenshot does not establish enabled behavior. No reference executable was run to infer more.

Reference-shaped interaction therefore means a full backpack with direct selection and drag/drop, page navigation, a small accessible unplaced strip, and actions for the selected items. Explicit review can remain for irreversible operations; it does not require a separate settings-style workbench. Safer exact recipe resolution is a deliberate behavior change from the reference's ambiguous crafting, not a claim of complete recipe parity.

## Current execs boundary

The development pane reads live inventory and the separate fixture can simulate arrangement and four metal conversions. It cannot move, craft, delete or equip Steam items. `commands/inventory.rs` reports operations unavailable and its mutation commands refuse. Production frontend/native read gates remain separate. Single deletion has no command, model or test fixture yet. Equipping has none either. The metal subset is not full JIM crafting parity.

The current helper is a connect/read/exit process. `native.rs` only sends hello 4006 and account-bound refresh 28, handles complete cache 24, and exits after a welcome/snapshot pair. It ignores item create/update/destroy/multiple-update events. `protocol.rs::payload` accepts only protobuf envelopes; binary crafting replies cannot currently be decoded through it. A child exiting or being killed cannot distinguish an accepted-but-unobserved write from a refused write.

## Source evidence and independent implementation

Pinned sources reviewed:

- Valve SDK `b8cfb12c0e083a2ef5b2f9f9b50f3902fa034474`: [message IDs](https://github.com/ValveSoftware/source-sdk-2013/blob/b8cfb12c0e083a2ef5b2f9f9b50f3902fa034474/src/game/shared/econ/econ_gcmessages.proto), [binary body fields](https://github.com/ValveSoftware/source-sdk-2013/blob/b8cfb12c0e083a2ef5b2f9f9b50f3902fa034474/src/game/shared/econ/econ_gcmessages.h), [inventory mutation/recipe access](https://github.com/ValveSoftware/source-sdk-2013/blob/b8cfb12c0e083a2ef5b2f9f9b50f3902fa034474/src/game/shared/econ/econ_item_inventory.cpp), [position constants](https://github.com/ValveSoftware/source-sdk-2013/blob/b8cfb12c0e083a2ef5b2f9f9b50f3902fa034474/src/game/shared/econ/econ_item_constants.h).
- Current protocol dump `623ebf57b33a837e204914d27630360344e9ea6a`: [base messages](https://github.com/SteamTracking/Protobufs/blob/623ebf57b33a837e204914d27630360344e9ea6a/tf2/base_gcmessages.proto) and [item message IDs](https://github.com/SteamTracking/Protobufs/blob/623ebf57b33a837e204914d27630360344e9ea6a/tf2/econ_gcmessages.proto).
- node-tf2 `d9cf0ff70b3162d530f7f6a82493a74f6ce800ea`: [its own methods](https://github.com/DoctorMcKay/node-tf2/blob/d9cf0ff70b3162d530f7f6a82493a74f6ce800ea/index.js) and [reply/cache handlers](https://github.com/DoctorMcKay/node-tf2/blob/d9cf0ff70b3162d530f7f6a82493a74f6ce800ea/handlers.js) are cross-checks, not production dependencies or evidence that execs works.

| Operation | Observed protocol facts | Boundary still to implement |
| --- | --- | --- |
| Batch movement | Protobuf message 1100 contains repeated item ID (`uint64`) and position (`uint32`) pairs. | Send through a bounded session; correlate changes and reread cache. No atomic-batch guarantee established. |
| Craft | Binary message 1002: signed 16-bit recipe index, unsigned 16-bit ingredient count, then 64-bit IDs. | Validate an explicit schema recipe and ingredients; establish legacy envelope. |
| Craft result | Binary message 1003: signed 16-bit recipe index, 32-bit response enum, unsigned 16-bit output count, output IDs. | Check response, then reconcile consumed/acquired IDs against a fresh cache. |
| Single delete | Binary message 1004 has one 64-bit item ID. | Eligibility/review, single send and destroy/cache confirmation. |
| Equip | Protobuf message 1059 carries item ID, new class and new slot. | Full loadout/schema rules, displaced items and equipped-state reconciliation. Not established JIM parity. |

Two traps matter. node-tf2 writes two uint64 fields for its legacy single-position message, while Valve's packed struct declares uint64 + uint32. Use the protobuf batch path after qualification. Its craft handler labels the 32-bit response field as unknown, whereas Valve identifies a response enum; do not discard it or interpret receipt as success.

The [node-tf2 license](https://github.com/DoctorMcKay/node-tf2/blob/d9cf0ff70b3162d530f7f6a82493a74f6ce800ea/LICENSE) is MIT and carries notice requirements when code is copied. No code is copied here. Valve's [Source 1 SDK license](https://github.com/ValveSoftware/source-sdk-2013/blob/b8cfb12c0e083a2ef5b2f9f9b50f3902fa034474/LICENSE) is not a blanket permissive license for this companion. The chosen implementation is independently authored from field/behavior facts, with provenance. Do not vendor SDK implementation, JIM implementation, its icons, or its game artwork. Keep existing JIM credit and read installed TF2 art through the existing bounded decoder.

## Concrete native work, in dependency order

### 1. Preserve authoritative state (`tools/inventory-probe/src/protocol.rs`)

Extend both decoded and serialized item records with the raw position token, quantity (field 5), flags (8), origin (9), custom description (11), in-use state (14), style (15), original ID (16), and equipped-state presence/list fields (17–19). Preserve field presence: default zero/false does not prove complete evidence. Bound attributes and recursive interior items or explicitly mark their eligibility unknown. Require consistent account owner and supported owner type. Keep all identity fields exact across JSON.

Add the relevant single/multiple shared-object message decoders and a versioned cache reducer. Apply create/update/destroy events only for the connected owner, detect missing/duplicate/conflicting updates, and invalidate on unsubscribe or account change. A fresh complete refresh remains the final authority after operations. Tests must feed out-of-order, duplicate, foreign-account and truncated events; missing cache data must never imply deletion.

### 2. Native operation session (`native.rs`, helper boundary, command runner)

Split connection/read logic from a bounded session state machine: connect → complete baseline → validate/review token → persist intent → one bounded send → observe → authoritative refresh → result. Keep callbacks, account/game checks and message/output/deadline caps. Add a typed single-use operation request delivered through bounded stdin, not command-line JSON. The parent binds it to the confirmed install and expected account under `WriteGate`. Keep write operations disabled until the test sender is qualified.

The parent process must distinguish rejection before sending from any failure after sending. Write the account-bound intent/outcome using an `execs-core` journal before dispatch, with atomic replacement and bounded retention. On restart, pending craft/delete means reconcile, never replay. Parent timeout/kill is `unknown`. Freeze browsing refreshes during the operation; do not open competing helper sessions.

### 3. Live moves

Reuse the existing frontend planner as a proposal, then repeat its invariants natively against the fresh complete baseline. Compare account, capacity, exact ID set and raw position tokens. Refuse protected items, stale origins, duplicate targets/IDs and out-of-range slots. Single swaps include both items. Batch placement is deterministic and skips unrelated occupied slots. Unknown legacy position bits refuse until understood.

Valve's setter replaces the destination token with the chosen slot and marks nonzero updates with `0x80000000`; the unacknowledged marker is `0x40000000` and the display slot mask is `0xffff`. The present decoder loses raw flags, so it cannot supply an adequate write baseline yet. Record each intended before/after token. Verify every requested position and all unaffected items after refresh; incomplete matches are partial/unknown, not success. Restoring an applied layout is another checked operation, never guaranteed rollback.

### 4. Actual crafting beyond the simulator

Add a bounded parser for the installed/current `items_game.txt` `recipes` block beside `core/src/inventory.rs`. **Do not wait for historical recipe shared objects:** pinned Valve inventory access reads `GetRecipeDefinitionMap()` from the schema and states there are no remaining SO recipes. Bind the schema version/hash, input criteria, dupe counts, same-class/slot conditions, output criteria and disabled state. Validate current schema-version evidence from the coordinator; unknown/stale schema refuses.

Implement item eligibility using [Valve's item-interface conditions](https://github.com/ValveSoftware/source-sdk-2013/blob/b8cfb12c0e083a2ef5b2f9f9b50f3902fa034474/src/game/shared/econ/econ_item_interface.cpp), including static/dynamic attributes, flags, origin, temporary/purchased restrictions and complete schema; [the item implementation](https://github.com/ValveSoftware/source-sdk-2013/blob/b8cfb12c0e083a2ef5b2f9f9b50f3902fa034474/src/game/shared/econ/econ_item.cpp) also checks in-use state. Protect favorites and customized items separately. Metal conversions initially require all inputs tradable; supporting restriction propagation needs its own reviewed output contract.

Resolve the exact selected set to one supported explicit recipe and show every ingredient/output. Broader JIM crafting requires implementing additional schema criteria and testing those recipe families, not replacing an unknown recipe with wildcard `-2`. Refuse ambiguous candidates until the user chooses a supported explicit outcome. The wire response is only one piece of evidence; all selected inputs must disappear and the reported expected outputs must exist. Never auto-repeat or offer Undo for consumption.

### 5. Confirmed single-item deletion

Add dedicated request/review/result types and a preview twin; do not overload craft or layout operations. Require exactly one selected ID across all pages, current account, exact item fingerprint, complete deletability evidence and no protection/favorite. The review names the item/account and irreversible consequence. Bind confirmation to a single-use native token. Send one delete body only after final validation. Require the intended destroy event plus fresh absence and no unrelated removals. Timeout, unexpected deletion or account switch remains unknown and blocks another deletion until reconciled.

### 6. Equip only as an explicit additional feature

An equip control would need schema class/slot capability data, equip regions/conflicts, stock/unequip sentinel handling, preset ownership, equipped-state presence and the complete existing loadout. [Valve's TF inventory implementation](https://github.com/ValveSoftware/source-sdk-2013/blob/b8cfb12c0e083a2ef5b2f9f9b50f3902fa034474/src/game/shared/tf/tf_item_inventory.cpp) checks compatible loadout slots and class usability. A visible class label in execs is not sufficient. Review displaced occupants and verify the resulting loadout after refresh. Do not ship a disabled decorative Equip button as functional parity.

### 7. Reference metadata and packaged acceptance

Current `core/src/inventory.rs::enrich` handles paint-kit identity/wear, kit targets, killstreak tiers/effects and particles. It does not yet implement a general crate-series, Strange-score/rank, remaining-use or ordinary paint-can color contract. Add installed-schema-backed attribute interpretation and fixture coverage, including duplicate/malformed attributes; unknown values stay absent rather than guessed. Read quantity and schema display rules before showing remaining uses. These are display features, not permission to invoke tools, duels or noisemakers.

The release gate is concrete: verify single moves, swaps, batch/cross-page placement, unplaced placement and full capacity; each promised crafting family; single deletion with an explicitly chosen disposable item; reconnect/restart persistence; stale/account-switch/game-launch refusal; interrupted/partial responses; and Windows/Linux packaged builds. Update all release gates together only after evidence exists. Current UI/fixture tests do not meet this gate.

## Native implementation update after this audit

`tools/inventory-probe/src/operation_wire.rs` is independently authored and now used by the bounded operation helper. It validates complete move baselines, emits canonical protobuf position bodies, explicit-recipe craft bodies and single-ID deletion bodies, and parses exact bounded craft responses. It preserves the real response enum and uses the documented 18-byte Steam binary transport header. All input IDs remain exact uint64 values.

`operation.rs` and `native.rs` implement typed stdin, fresh account/full baseline checks, one-send semantics, guarded SO event evidence, and complete post-send cache verification. Only the four explicit metal conversions are supported; the parent validates installed schema and eligibility and persists intent. Post-send uncertainty returns unknown without replacing the inventory; restart reconciliation never replays. Raw item evidence and unknown SO fields are preserved. The numbered sections above describe the earlier audit's implementation gaps; these transport/state gaps are now implemented, while broader recipe families, equip, metadata work and live platform qualification remain separate.

The probe currently passes 25 automated tests, including fake operation sessions and independent wire decoding. `cargo test --manifest-path tools/inventory-probe/Cargo.toml --locked` and Clippy with warnings denied pass. No live mutation was performed. See the updated [crafting protocol boundary](../2026-09-27-inventory-020/crafting-protocol.md) for implementation and remaining qualification details.
