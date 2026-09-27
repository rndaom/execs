# Inventory manager sandbox — September 27, 2026

Work branch: `rndaom/inventory-manager`, based on `acd39fb7`. This is follow-up implementation to the read-only audit in README.md. The owner requested three agents: backpack organizer, basic crafting, and useful polish. Their work shares one integrated Inventory pane.

The subsequent compact redesign and current test results are recorded in [the usability follow-up](../2026-09-27-inventory-usability/README.md). Earlier screenshots below describe the superseded task-mode UI, not the final layout.

## Available to test

- The backpack uses ten columns and five rows per complete page. Direct selection and dragging replace Browse / Arrange / Craft mode controls. The organizer supports Ctrl/Shift selection, occupied-slot swaps, batch placement, unplaced items, Undo/Redo/Reset and an exact change review. Page arrows wrap and accept a held drag to turn pages; Page Up/Down preserves the relative focused slot. A folded page/slot destination supplies a keyboard alternative.
- Account-owned drafts survive customization-profile changes. Dirty drafts participate in the existing exit/launch review; an exit never auto-applies Inventory. Refresh pauses while drafting or applying. Hidden Inventory dialogs release their keyboard/focus handling.
- Four explicit metal conversions simulate consumption and output creation. Select the exact metal in the backpack and choose Craft selected; one dialog reviews those ingredients and the inferred supported outcome before confirmation. There is no recipe picker or nested review. Missing restrictions, protected/favorite/customized items, wrong metals/counts, stale snapshots and capacity conflicts refuse.
- Inspect opens on demand (also on double-click); there is no permanent detail sidebar. Art fills compact tiles, with names in accessible labels and the selection bar. Saved layouts, favorites and history stay in a collapsed section. Unplaced art participates in bounded artwork loading.
- Favorites imply protection. Account-local preferences include saved searches and layouts. Restoring a layout changes the draft only. Local history labels simulated and uncertain results honestly; storage failures do not silently remove protection.
- The fixture owns mutable authoritative state separately from UI drafts. Item IDs remain decimal uint64 strings, including values above JavaScript's safe integer limit. Result checks reject account/identity/layout mismatches. Unknown results block blind retries; late reads or responses cannot overwrite newer state.

## Release boundary

This is a runnable development sandbox, not a live inventory writer. Production frontend builds still hide Inventory. Native Steam reads are unchanged; the new native capability reports mutations unavailable and native move/craft commands unconditionally refuse before I/O. The three optional eligibility flags exist only as a contract for simulation; the native reader does not infer them from display metadata.

The owner has a disposable TF2 account available. The native development app subsequently read the signed-in account successfully; no Steam items were moved or consumed during this work. Live transport, authoritative native eligibility and single-use review tokens, a persistent intent/reconciliation journal, protocol evidence and Windows/Linux disposable-account qualification are still required. See crafting-protocol.md and the existing rearrangement plan.

The prior 0.2.0 candidate excluded Inventory. Shipping a real manager in 0.2.0 requires completing those gates, re-running package/platform acceptance and making a new candidate. The sandbox cannot inherit the prior candidate's sign-off. No release, merge, push or tracker publication was performed here.

## Earlier sandbox validation (before the compact redesign)

- Full `pnpm test`: 127 desktop files / 1162 tests; 10 cfglint files / 170 tests; 110 release/script checks passed, 5 script checks skipped. Subsequent added regression checks are recorded below.
- `pnpm build`: passed; existing large-chunk warning remains.
- `cargo clippy --manifest-path apps/desktop/src-tauri/Cargo.toml --workspace --all-targets --locked -- -D warnings`: passed on Windows.
- `cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml --workspace --locked`: passed on Windows, with the repository's opt-in live/network tests ignored.
- Native direct-IPC refusal test passed for null and crafted request payloads.
- Added SettingsHost hidden-Inventory activity regression plus existing modal suite: 33 tests passed.

Final integration checks: `pnpm check` passed across 642 files; 90 focused Inventory/SettingsHost tests passed after the last fixes; the production build passed again. `git diff --check` and `cargo fmt --check` passed. Linux and real Steam mutation acceptance have not run.

Browser checks passed for move-to-empty, Undo/Redo, exact arrangement review and simulated Apply; exact three-scrap review, cancel and successful simulated craft (12 items to 10); favorite protection refusing a selected ingredient; saved-search restore; saved-layout restore into a draft; and separate simulated move/craft history. Tested the layout with 1200x800 and 960x640 viewport overrides, including keyboard task switching and compact craft review. A browser-only review positioning bug was found and fixed in both dialogs: they now use the existing centered, bounded sheet styling above the scrim. The fixture was reloaded to 12 items for handoff and the viewport override reset. Artwork placeholders in these screenshots are intentional fixture data.

Run the preview and follow the concrete scenarios in TESTING.md. The original screenshots and README remain evidence of the pre-implementation audit; new screenshots are named `05-` onward.
