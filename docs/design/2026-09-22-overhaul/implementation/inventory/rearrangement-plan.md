# Backpack rearrangement plan

Inventory is account-owned and development-only. Its current helper reads a Steam snapshot using ClientHello and account-bound refresh messages; it sends no item mutations. Sorting, filtering, selection and page changes never alter Steam positions. Rearrangement is future minor-release work and is not part of the current overhaul.

## Evidence and protocol gate

- The [TF2 coordinator protobuf](https://github.com/SteamTracking/Protobufs/blob/master/tf2/base_gcmessages.proto) describes `CMsgSetItemPositions` with 64-bit item IDs and 32-bit positions. That describes a possible protocol shape, not evidence that an external companion may reliably send it or receive a durable acknowledgement on a current Steam session.
- The [Steam Inventory API](https://partner.steamgames.com/doc/api/ISteamInventory) covers item result retrieval and item operations; it does not provide an ordinary backpack-position setter for TF2. Do not treat a local UI reorder as a Steam write.
- Before enabling writes, verify the exact current TF2 coordinator message ID, envelope, account/session binding, conflict behavior, rate limits and acknowledgement path against a disposable test account. Record protocol evidence and a rollback/reconciliation procedure. If this cannot be verified, keep the pane read-only.

## Proposed implementation

1. Keep a draft layout keyed by Steam account ID, never by customization profile. Drag/drop and keyboard move actions update only this draft. Show changed slots, Undo and Reset. Preserve the original item IDs, positions and capacity as a baseline fingerprint. Search and sort remain view-only views and cannot become a write order accidentally.
2. On Apply, take the existing native `WriteGate`, require the confirmed TF2 root and a closed game, then obtain a fresh snapshot through the bounded child. Refuse when the Steam account, item ID set, positions or capacity differs from the draft baseline. Validate every submitted ID belongs to that snapshot, every target position is within capacity, and the resulting occupied positions are unique. Keep the 64-bit IDs as strings in JavaScript.
3. Add a narrowly scoped write helper only after the protocol gate above passes. Send the minimum position changes through the signed-in account session. Never edit Steam files, profile manifests or TF2 game files for this operation. Bound the helper's lifetime, message count and output as with the read helper.
4. Read a new authoritative snapshot after sending. Report success only when all requested positions match; otherwise show the actual Steam layout and an explicit conflict/unknown-result state. A timeout or disconnect must never claim success or blindly replay a potentially applied command. Rebase a retained draft only after the player reviews the new snapshot.
5. Test swap, move-to-empty, full backpack, unplaced items, account change, game launch during apply, stale baseline, disconnect, partial coordinator acceptance and duplicate positions. Qualify with a disposable account on Windows and Linux before any release assignment.

Deleting or consuming items is a separate destructive feature. It needs its own verified protocol, exact item identity review and explicit confirmation; it is not implied by rearrangement or by the user's request to improve the current Inventory view.
