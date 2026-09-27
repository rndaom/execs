# Compact backpack follow-up

The later native-operation implementation supersedes the unavailable-operation status below. See [native testing and current boundaries](LIVE-TESTING.md). This page records the preceding UI-only checkpoint.

September 27, 2026. This follows the owner's rejection of the form-heavy Inventory sandbox. The reference is [Jengerer's Item Manager](https://www.jengerer.com/item_manager/). Interaction ideas were independently recreated; no reference code or artwork was imported.

## Implemented and tested

- Full-width ten-column, five-row backpack pages, compact artwork, and no permanent details sidebar.
- Ctrl/Shift selection, single-item swaps, selected-group placement and unplaced-item dragging. Drops change a local draft. External drag payloads cannot initiate moves.
- Wrapping page arrows; holding dragged items over an arrow for 650 ms changes pages. Arrow keys move focus by one slot or one ten-slot row. Page Up/Down preserves relative focus.
- Compact Undo, Redo, Reset and change review. Optional numeric destinations, saved layouts, favorites and history are folded away.
- Inspect and double-click open item details. Craft selected opens one exact ingredient review, deriving only a supported metal conversion from the selection. No recipe picker, nested review or platform-inappropriate Command symbol.
- Failed/unknown operations, protection, stale/account-changed snapshots and running-game guards remain covered. Craft opens with focus on Back to backpack.

The native debug app previously read the owner's real backpack. It can display those items and make local drafts, but Steam moves, crafting and deletion remain unavailable. No Steam item was changed. The fixture simulates moves and four metal conversions. This is not complete Jengerer parity or a release-ready manager.

## Verification

After the redesign, `pnpm test` passed: 128 desktop files / 1177 tests, 10 cfglint files / 170 tests, and 110 release/script checks (5 platform-dependent skips). `pnpm check` passed across 642 files. `pnpm build` passed with the existing large-chunk warning.

The isolated inventory helper passed its 7 existing tests and 6 new pure wire-format/validator tests; all-target clippy and rustfmt passed. The new wire module is test-only and has no transport calls. Earlier Windows desktop Rust workspace checks remain recorded in the sandbox implementation log; no later native desktop code was changed during this compact UI pass. `git diff --check` passed.

No Computer Use was used after the owner prohibited it. Final visual inspection and native manual interaction remain pending; DOM tests do not establish pixel layout or WebView drag behavior. The before image is `02-native-before.png`; `03-grid-first-pass.png` is rejected evidence because it captured a stale loading state and must not be presented as the completed design.

Use the updated [testing handoff](../2026-09-27-inventory-020/TESTING.md) for exact scenarios. The development preview server was listening on port 1420 at final verification; no native execs process was running at that check. Existing sessions were not restarted or discarded during this pass.

## What still blocks 0.2.0 inclusion

The [reference parity and native implementation map](reference-parity.md) lists the concrete remaining work: authoritative raw item state and restrictions, an operation session with durable reconciliation, verified live moves, supported schema recipes, confirmed single-item deletion, missing reference counters/metadata, and Windows/Linux packaged acceptance. Broader crafting is also outstanding; four metal conversions do not reproduce all reference recipes.

If the manager remains a requirement for 0.2.0, that release must wait for these implementations and a new qualified candidate. The earlier candidate hid Inventory and cannot qualify this expansion. No release, merge, push or external tracker update was performed.
