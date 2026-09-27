# Inventory testing handoff

For the new native move/craft/delete path, use [native development testing](../2026-09-27-inventory-usability/LIVE-TESTING.md). The sandbox instructions below remain useful; later live implementation supersedes this earlier native-unavailable checkpoint.

## Test the manager sandbox now

Start from `G:\Projects\execs` with `pnpm dev --host 127.0.0.1`, then open [Inventory test mode](http://127.0.0.1:1420/?preview=settings-inventory).

The fixture has 12 items and 300 slots, including three scrap, three reclaimed and two refined metal items (one unplaced). It never contacts Steam. Reload resets the simulated inventory; account-local favorites, protection, saved searches/layouts and history persist in this browser. Artwork unavailable is expected for these fixtures.

1. Drag Scattergun from slot 1 to empty slot 12. Check Undo, Redo and Reset. Repeat using occupied slot 2 to check a two-item swap; **Review changes** must list both IDs and both moves. **Apply simulation** updates only the fixture.
2. Ctrl-click several items (Shift selects a page range), then drag the group. Hold the drag over a page arrow to change pages, then drop in an empty slot. Page arrows wrap at the first and last page. Drag the unplaced metal from its strip into an empty slot. Filters and view order never move items; the selection count includes off-page items.
3. Check the keyboard route: arrows move focus across the ten-column grid; Page Up/Down keeps the same relative slot focused on the next page. Space selects the focused item. **More → Move to page / slot** supplies a keyboard alternative to dragging.
4. Expand **Saved layouts, favorites and history**, then **Favorites and protection**. Favorite an item and verify it is protected from moves and crafting. Unfavorite/unprotect it to use it again. Preferences belong to the Steam account, not a customization profile.
5. With no pending arrangement, select scrap in slots 4, 5 and 6 (Ctrl-click to add), then choose **Craft selected**. Verify all three exact IDs and the one-reclaimed output; returning to the backpack changes nothing. Open it again and explicitly simulate the craft. The backpack goes from 12 items to 10. Crafting has no Undo. Reload to restore the starting fixture.
6. Select three reclaimed, one reclaimed and one refined in turn to check the other conversions. The selected metal determines the recipe; there is no recipe dropdown. Wrong counts, mixed metals, protected ingredients and a dirty arrangement must refuse confirmation.
7. In the collapsed extra tools, save a named search and draft layout, change them and restore. Restoring a layout only changes the draft; review and Apply remain separate. Inspect **Local operation history** for simulated outcomes.
8. Manually check 1200×800 and 960×640. A complete unfiltered page must have ten columns and five rows. Double-click an item or use **Inspect** to open details. There is no permanent details sidebar. Final visual checks are still pending; automated UI control was stopped at the owner's request.

The sandbox is implemented; live Steam moves and crafting are not. The ordinary debug desktop app can read a real backpack and make local layout drafts, but native operation capabilities report unavailable and every native mutation command refuses before I/O.

## Read your real backpack with the current development app

Use Steam signed in as the intended account, TF2 closed and a confirmed TF2 install. A debug desktop build is required; production installers deliberately hide/refuse Inventory.

On Windows, open a normal terminal from the desktop/Start menu, stop any existing preview server using port 1420, change to the repo and run:

```powershell
pnpm desktop:dev
```

Use the same normal user/elevation as Steam. A launch from packaged Codex can inherit MSIX AppData virtualization; repository policy requires an Explorer-owned launch when an agent starts the executable. Do not merge or delete profile libraries to work around that context. The development app was subsequently launched through Explorer and read the signed-in account successfully. No Steam items were moved or consumed. Keep an existing session open to preserve its in-memory layout drafts.

Select Inventory and keep the app visible/focused. The helper can briefly show TF2 as playing while connecting. Compare persona, item count, capacity, known slots and selected item details against the game. Close TF2 before reconnecting. Refresh occurs while visible/focused approximately every two minutes and after the game closes, with a reconnect cooldown; Retry appears on failure.

For a diagnostic that only reads inventory, follow `tools/inventory-probe/README.md` with the actual installed Valve library path. Raw diagnostic JSON contains account/item identities and should remain private. Live native Linux connectivity still needs specific qualification.

## Repeat the checks run in this audit

```powershell
pnpm --filter @execs/desktop test -- src/lib/inventory-ui.test.ts src/InventoryPane.test.tsx src/hooks/useInventorySnapshot.test.tsx
cargo test --manifest-path tools/inventory-probe/Cargo.toml --locked
cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml -p execs-core --lib inventory:: --locked
```

Observed September 27 at `acd39fb7`: 15 frontend, 7 helper and 10 core tests passed. These were the historical viewer baseline. Current sandbox validation is recorded in IMPLEMENTATION.md; no live write qualification has occurred.

## Remaining release acceptance matrix

| Layer | Test | Pass condition |
| --- | --- | --- |
| Fixture organizer | Single move to empty, occupied-slot swap, move across pages, unplaced item, full backpack | Explicit expected layout; no item loss, duplication or silent displacement |
| Fixture organizer | Ctrl/Shift selection, hidden/off-page selection, keyboard-only move | Complete selected count and exact review; no invisible destructive targets |
| Fixture organizer | Undo/Redo/Reset; sort/filter while dirty; profile switch; account switch; app close | Account ownership preserved, no profile writes, explicit discard/save-local rules |
| Fixture organizer | Protected items and smart arrangement; large inventory; 1200×800 and 960×640 | Protected slots respected, stable interaction, reachable controls and clear focus |
| Native validator | Foreign/duplicate IDs, invalid or colliding destinations, 64-bit IDs, stale revisions/capacity | Reject before any send; no JS numeric loss |
| Fake coordinator | Stale cache, reordered updates, disconnect before/after send, partial acceptance, timeout, crash/restart | Truthful confirmed/partial/unknown state; reconcile before retry; no blind replay |
| Native guards | TF2 already running or starts during apply; account change; simultaneous refresh/launch/apply | Refuse/stop before further sends and reconcile any possible partial result |
| Live move | Small chosen set on a disposable/test account; reconnect; open TF2; restore old positions | Same authoritative slots after reconnect and in TF2; restoration is another verified operation |
| Craft fixtures | Supported explicit recipe, wrong ingredients, protected/noncraftable/unknown items, no capacity, stale account/items | Exact review and fail-closed validation; only unambiguous supported metal combinations; no wildcard GC request |
| Live craft | Owner explicitly chooses disposable input IDs; one verified recipe; reconnect and inspect TF2 | Exact inputs consumed once and actual output IDs observed; no Undo promise |
| Packaged platforms | Current Windows NSIS, Linux AppImage and deb; Steam launch contexts, offline recovery, account switching | Release-mode commands/helper available intentionally; native Steam session succeeds on each supported target |
| Regression | Existing full frontend/Rust gates, prior-public library import/upgrade, profile separation and signed updater | New cumulative candidate passes; old hidden-Inventory evidence is not reused as feature qualification |

Introduce a clearly labeled development fixture mode with controls for account changes, stale baseline, partial success, disconnect and unknown outcome during slice 1/2. Give the owner a runnable fixture preview after each slice, then a private native test build for verified moves. No public prerelease channel is needed.

Record candidate commit, platform, Steam/TF2 context, scenario, expected result, actual result and sanitized evidence per row. A fixture pass is not a live Steam pass. Never use valuable items to discover whether a crafting payload works.
