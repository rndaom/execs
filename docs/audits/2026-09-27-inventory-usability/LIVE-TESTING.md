# Native Inventory development testing

The September 27 native implementation supports reviewed Steam layout changes, four metal conversions and single-item deletion in debug builds. The browser test backpack remains a separate simulator. Production Inventory stays gated until Windows/Linux live and packaged acceptance passes.

## What changed

More now contains the page/slot destination fields directly. The Move rules and availability dropdown was removed. Live controls use the same compact backpack and exact review as the simulator, but their final labels identify Steam operations.

The native path obtains a fresh backpack before preparing a review, validates exact account/items/raw positions and installed item rules, and issues an expiring single-use token. Execution records an account-owned pending intent before opening a bounded Steam child session. That session rechecks the full baseline and game/account, sends one mutation, and waits for authoritative evidence. A craft requires a successful matching response and its exact inputs/outputs; deletion requires the intended destroy event and a complete cache showing absence. Moves verify every destination and unchanged unrelated items.

Unknown results remain pending across restarts. Reconcile only reads and compares; it never resends a move, craft or deletion. A fresh inventory that still matches the original baseline does not prove a request failed, so it does not automatically clear an uncertain outcome. An interrupted craft/deletion cannot be undone by a local journal.

## Test in the native development app

Use the disposable account, with Steam signed in and TF2 closed. Verify the displayed persona/account before acting. The developer did not move, consume or delete items on your behalf.

1. Drag one expendable item into an empty slot. Choose Review changes, check the item and before/after positions, then Apply to Steam. Wait for a confirmed result. Refresh, then check the position in TF2. Restoring the old position is a new reviewed move.
2. Check a single-item swap, a selected group across a page boundary, and placement of an unplaced item. For both one item and a selected group, hold the drag over Next or Previous: pages should turn every 650 ms while held, wrapping at either end. Move off the arrow to stop paging, then drop onto the desired slot. Cancelling the drag or releasing on the arrow must leave item positions unchanged. Confirm that unrelated items keep their positions. Choose Sort by name, quality or type: the whole backpack should fill actual draft slots, leaving protected items fixed. Check Undo/Redo, then drag a sorted item, review the final destinations and Apply to Steam. Reopen TF2 to verify those exact positions. Search/quality filters only find items; clear them before dragging. Sorting clears filters and returns to the full slot grid.
3. Select exactly three plain tradable scrap, three reclaimed, one reclaimed, or one refined. Craft selected shows the exact IDs and resulting metal. Confirm only the disposable ingredients you intend to consume. Check the new output after reconnecting. Customized, protected, restricted, equipped, stacked or incompletely described ingredients refuse.
4. Select exactly one disposable item, open Delete selected, and verify its name and ID. Cancel first; it must remain present. Reopen and confirm only when ready to permanently remove it. Verify absence after reconnecting. Deletion has no Undo.
5. Check protected/favorite refusal, an expired review, changed account, TF2 running, and changed inventory. A stale review must never silently substitute other items.
6. If an operation reports an unknown result, use Reconcile. Do not repeat it. Record the operation type, message and observed before/after state. Keep full account/item records private; sanitized evidence is sufficient for the release checklist.

Only the four listed metal recipes are currently supported. Weapon recipes, tools, equipping and automatic crafting are not implemented.

## Evidence and release boundary

Automated protocol/session tests use synthetic caches and replies. Native authority tests cover stale snapshots, protected/colliding layouts, review expiry/reuse, item eligibility and durable pending evidence. Frontend tests cover exact reviews, native preparation/execution, cancellation, account changes, token failures and unexpected outcomes. An opt-in core test read the actual installed schema and matched all four supported metal recipes without contacting Steam.

A read-only run of the updated helper returned 1,347 items / 1,900 slots with cache-version and raw-item evidence. The 201 metal items had quantity 1, craft origin, no extra attributes and ordinary/free-account-trading flags. No mutation was sent during this check.

After testing the latest development app, the owner reported “Okay, I think it works.” This is positive interaction feedback; individual crafting/deletion, Linux and packaged outcomes were not specified. Remaining Inventory-specific acceptance and candidate integration are tracked in [the current 0.2.0 readiness record](../../release-0.2.0-readiness.md). Previous whole-application release sign-offs remain accepted. The previous signed candidate hid Inventory and does not qualify this new implementation.

## Local validation record

Final readiness rerun: 1,206 desktop tests, 170 cfglint tests and 110 script
checks passed (five platform skips); the full Windows Rust workspace passed
1,032 tests (32 opt-in ignored) after the owner closed TF2. The helper passed
26 tests. Biome, production frontend build, workspace/helper Clippy and Rust
formatting passed. Earlier counts below are the preceding implementation checks.

- Full `pnpm test`: 1,190 desktop tests, 170 cfglint tests, 110 script checks passed; 5 platform-dependent script checks skipped. Subsequent metadata-warning/result regressions were checked in the affected Inventory suites.
- Full Windows `cargo test --workspace --locked`: 1,031 tests passed, 32 opt-in tests ignored. Workspace all-target Clippy with warnings denied and rustfmt passed.
- Standalone probe: 25 protocol/session/wire tests passed; all-target Clippy passed.
- `pnpm check` passed across 648 files. Production frontend build passed with the existing large-chunk warning. Native debug executable rebuilt successfully.
- The new development executable was launched through Explorer and verified unpackaged (`GetPackageFullName` 15700). No Computer Use was used. Native GUI and live mutation acceptance remain for the owner to exercise.
- Final result-handling regressions passed (33 crafting tests plus TypeScript/Biome): consuming the last item of a definition may remove its optional display metadata without turning success into unknown; unrelated raw item or eligibility changes still fail verification. The active development app receives these frontend changes through Vite.

- Sorting follow-up: 72 targeted frontend tests passed, including each sort followed by drag, review and simulated Apply, protected slots, capacity refusal and Undo/Redo. TypeScript, Biome and Rust formatting/Clippy passed. Five native operation tests and 26 helper/protocol tests passed, including a 10,000-item layout and its independently decoded message (under 256 KiB). Native Apply now shares the 10,000-move limit with the helper, covering the full supported backpack. The development executable was rebuilt. No live sorting operation was sent.
