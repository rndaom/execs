# Basic crafting implementation and qualification boundary

## Implementation update — native operation work completed later on September 27

The earlier audit below records the simulator-only baseline. Its statements that
native transport, full snapshot evidence and explicit recipe bodies are absent are
superseded by this update; live platform qualification is still pending.

- `tools/inventory-probe/src/operation.rs` now implements typed account-bound
  layout/craft/delete requests, exact full-baseline validation, a one-send latch,
  confirmation from a strictly newer complete cache, and no-replay reconciliation.
- `native.rs` drains queued preflight events before the single mutation send,
  rechecks the Steam account and closed-game guard, then requests fresh account-bound
  caches. Operations have a 45-second total deadline. A failure after the send boundary
  returns unknown with no replacement snapshot. Unknown operations are never replayed.
- Craft supports only recipe 4 (3 scrap → reclaimed), 5 (3 reclaimed → refined),
  22 (reclaimed → 3 scrap) and 23 (refined → 3 reclaimed). The parent additionally
  verifies installed schema semantics, enabled state, full eligibility and revision.
  The helper refuses any other recipe/conversion tuple. No wildcard is used.
- A matching response must have the documented response enum `OK = 0` and exact new
  output IDs. Inputs must disappear; outputs must have expected definitions, Unique
  quality and quantity 1 without restricted/customized state; unrelated items must
  remain identical, including retained unknown raw SO fields. No reply alone confirms.
- The binary Steam transport header is version `u16 = 1`, followed by target/source
  `u64` job IDs set to the no-job sentinel. This 18-byte Steam payload header corresponds
  to [Valve's declared GC extended header](https://github.com/ValveSoftware/source-sdk-2013/blob/b8cfb12c0e083a2ef5b2f9f9b50f3902fa034474/src/public/gcsdk/gcmsg.h)
  after the transport removes the message/account prefix, as independently documented
  by [node-steam-user's GC sender and receiver](https://github.com/DoctorMcKay/node-steam-user/blob/master/components/gamecoordinator.js).
  [The pinned response enum](https://github.com/SteamDatabase/Protobufs/blob/623ebf57b33a837e204914d27630360344e9ea6a/tf2/econ_gcmessages.proto)
  distinguishes success, denied, error, timeout, invalid and no-match replies. Field
  facts informed independently authored code; no implementation was copied.
- Snapshot records retain raw position, quantity, flags, origin, custom description,
  in-use/style/original ID, equipped-state presence and entries, interior bytes, cache
  version, and complete bounded item SO bytes. Missing/duplicate attributes and foreign
  SO owner types refuse rather than silently discarding eligibility evidence.
- Single/multiple SO notifications are account/version validated. They are evidence
  for the operation, never patched into a purported complete success snapshot. A full
  authoritative cache is always required. Single deletion also requires its destroy
  event in-session. Restart reconciliation only checks state and never sends.

Automated fake-session and wire tests pass; no live mutation was invoked during this
implementation. Windows/Linux disposable-item and packaged-candidate checks remain
release requirements. The parent owns single-use review tokens, installed-schema
eligibility and the durable pre-send journal; the standalone helper is not a bypass
for that product review flow.

## Earlier audit baseline (superseded implementation gaps; retained provenance)

September 27, 2026. This work supplies a testable metal-crafting simulator and its input/result validators. It does not qualify live Steam crafting or authorize any account mutation. The user has a disposable account available; its exact Steam ID and ingredients have not yet been selected for a live test.

## Implemented test surface

`InventoryCrafting.tsx` uses the organizer's explicit selection, including off-page items. It resolves the selected definitions and count to exactly one of four metal conversions, with no recipe picker or automatic substitutes: three scrap to one reclaimed, three reclaimed to one refined, one reclaimed to three scrap, and one refined to three reclaimed. The simulator uses item definitions 5000/5001/5002. These local keys are **not GC recipe indices**. No wildcard/default recipe or live recipe index is encoded.

Opening Craft selected is the review boundary: the single parent sheet lists the account, every exact item ID and its slot, and the output, followed by the final Simulate craft action. There is no nested Review craft dialog. Closing does nothing. Protection/favorites, name or quality changes, missing/unknown craftability, customization or tradability, nontradable inputs, stale snapshots, duplicate IDs, conflicting slots and insufficient output capacity refuse the operation. A changed open review must be closed and reopened; it never silently captures new ingredients. Selection does not silently add substitutes. Confirmation is guarded against repeated clicks. Crafting has no Undo.

The in-memory simulator removes only the reviewed IDs, allocates fresh uint64-safe IDs without recycling inputs, preserves unrelated items and places outputs in vacant slots. Its result says `simulated`. Result verification checks consumed IDs, acquired IDs, account, capacity, output definitions/restrictions and preserved unrelated item data, restrictions and descriptions. Since only simulation is exposed, an unexpected `confirmed` result also becomes `unknown`. Non-success results never publish their unverified snapshots or item IDs. An incomplete or inconsistent claimed success becomes `unknown`; a missing response blocks another attempt. This UI check supplements the future native authority; it is not that authority.

The session remembers unresolved/unknown crafting by API function and Steam account. Changing tabs, remounting the component, or switching away and back does not reset that block. A fresh simulator API starts a separate fixture. Deferred responses cannot publish into a replaced API/account or an unmounted component. This is session protection for the sandbox, not the persistent native operation journal required before enabling live crafting.

The current snapshot restriction fields are an explicit three-state contract: `craftable`, `tradable`, and `customized` are true/false/null. Missing/null is unavailable. Fixtures populate them deliberately. The existing native reader does not supply enough evidence to populate authoritative live values; it must not infer them from names or metal definitions.

## Primary-source evidence

Reviewed Valve's public SDK on this date; GitHub's `master` resolved to `b8cfb12c0e083a2ef5b2f9f9b50f3902fa034474`.

- Valve's [crafting panel](https://github.com/ValveSoftware/source-sdk-2013/blob/b8cfb12c0e083a2ef5b2f9f9b50f3902fa034474/src/game/client/tf/vgui/crafting_panel.cpp) sends the selected recipe definition and a list of exact uint64 item IDs. A successful response carries newly crafted item IDs, and the panel waits until its inventory cache contains those outputs before reporting completion. It checks disabled recipes and separately asks about untradable ingredients. This supports explicit recipe validation and separate response/cache reconciliation; it does not establish execs' wire envelope or a live recipe-index allowlist.
- Correction after deeper source inspection: [inventory recipe access](https://github.com/ValveSoftware/source-sdk-2013/blob/b8cfb12c0e083a2ef5b2f9f9b50f3902fa034474/src/game/shared/econ/econ_item_inventory.cpp) enumerates the item schema's recipe map. Its definition-index lookup explicitly has no remaining shared-object recipes. Parse and bind the current schema's `recipes` block rather than depending on the historical recipe cache object.
- Valve's [item interface](https://github.com/ValveSoftware/source-sdk-2013/blob/b8cfb12c0e083a2ef5b2f9f9b50f3902fa034474/src/game/shared/econ/econ_item_interface.cpp) determines crafting eligibility from schema presence, economy/crafting flags, attributes, temporary status, origin, purchase capabilities and quality. Tradability also depends on flags, attributes, origin and time restrictions. Display metadata alone is insufficient.
- Valve's [item implementation](https://github.com/ValveSoftware/source-sdk-2013/blob/b8cfb12c0e083a2ef5b2f9f9b50f3902fa034474/src/game/shared/econ/econ_item.cpp) adds an in-use check before applying the shared craftability rules.

No numeric live recipe IDs or craft message envelope are claimed as verified by this work. No live requests were sent. Third-party helpers can inform investigation but must not substitute for the pinned schema, recipe cache and captured test results needed below.

## Required path to real-account testing

1. Read a fresh signed-in Steam ID and full bounded item/restriction evidence. Display the exact disposable account and candidate input IDs for the owner. Keep the ordinary account inaccessible to the test operation. Record the installed/current schema revision and compare coordinator schema-version evidence.
2. Implement a native allowlist only after matching each intended recipe's concrete item-schema definition, input criteria, output criteria and enabled state. Validate the full binary message envelope, recipe field and item count against current protocol evidence. Unknown definitions or recipe changes refuse.
3. Derive eligibility from the full native item/schema state, including static and dynamic attributes, in-use status, flags, origin, expiration and trade restrictions. Preserve unknown as unknown. Recheck account, TF2-closed lock, capacity, protected IDs and exact ingredients under the operation gate immediately before sending. Frontend fields and its JSON comparison token are not trusted authority; native review requires a single-use token bound to a fresh snapshot.
4. Persist bounded intent before a single send. Capture craft response plus item destroy/create/update events and reconcile a fresh cache. Confirm only when the reviewed inputs are absent, exactly the returned expected outputs are present, their restrictions are known, and unrelated changes are accounted for. A timeout or dropped response is unknown, never proof of non-consumption and never an automatic retry.
5. Start with one explicitly reviewed disposable conversion. Record the exact consumed/acquired IDs and before/after state, reconnect and verify persistence in TF2. Repeat the four recipe paths and full-backpack, stale/account-switch, malformed/partial-response, disconnect and restart-reconciliation scenarios. Test both Windows and Linux; a working browser simulator does not meet this gate.
6. Qualify the packaged candidate and production entry points only after those checks. A local intent journal cannot restore consumed items. Draft Undo cannot apply to a craft.

Until this path passes, `getInventoryCapabilities` reports native crafting unavailable and `craft_inventory` must refuse before any transport send. The preview exposes simulation for interaction testing. This is an incomplete 0.2.0 live-crafting requirement, not a release-ready crafting feature.

## Focused checks

`pnpm --filter @execs/desktop test -- src/InventoryCrafting.test.tsx src/lib/inventory-crafting.test.ts` covers all four conversions, metal conservation, exact uint64 handling, unrelated-item preservation, capacity/collision/identity/refusal paths, incomplete outcome evidence, complete off-page review, cancellation, duplicate submits, changed protection/selection/name/game lock, unknown result lockout through remount/account switches, late results after account/API/unmount changes, unexpected live-success status and non-success snapshot stripping. Additional shared simulator and organizer integration checks belong to the parent workstream.
