# 0.2.0 readiness — Inventory follow-up, September 27, 2026

This updates readiness only. The owner explicitly requested no 0.2.0 release,
tag or publication. The previously completed release work remains accepted;
this checkpoint adds the Inventory changes without reopening unrelated Done
issues or claiming new platform evidence.

## Prior qualified baseline

- PR #60 merged the previous 0.2.0 scope into `main` at `acd39fb7`.
- [Private candidate 36313433526](https://github.com/rndaom/execs/actions/runs/36313433526)
  succeeded on `8e77a2219683e0a4450f21d1aaf9ed7cef95c0b0`, including Windows/Linux
  builds, signed updater upgrades from public v0.1.8, profile preservation and
  feed verification. This remains evidence for that exact prior candidate.
- [Release PR #136](https://github.com/rndaom/execs/pull/136) is still open. Its
  observed head is `27adf931e853c8e4f9daced2b884cfbaa9a48ffd`; its checks pass.
  The private draft exists; public v0.1.8 remains latest. This Inventory branch
  is not yet incorporated into that PR or its candidate artifacts.

## Inventory implementation checkpoint

The `rndaom/inventory-manager` work adds a ten-column, five-row backpack;
Ctrl/Shift selection; single/group drag/drop; repeating held-arrow page turns;
actual-slot sorting by name, quality and type; Undo/Redo; compact inspection;
account-owned protected favorites, saved layouts/searches and operation history.
Sorting leaves protected items fixed and uses the same reviewed layout path as
dragging. Compressed search results cannot be dragged as if they were real slots.

Native development builds support reviewed Steam moves, four plain tradable
metal conversions and confirmed single-item deletion. Exact account/raw-item
baselines, installed-schema eligibility, single-use review tokens, a durable
intent journal and complete-cache reconciliation guard every operation. Unknown
outcomes never replay automatically. The 10,000-move bound covers the supported
whole backpack. No unlicensed Jengerer implementation or product assets were
imported; the reference inspired an independent implementation.

After testing the updated development app, the owner reported: “Okay, I think it
works.” This records positive owner feedback on the current interaction flow.
It does not invent individual crafting/deletion, Linux, or packaged acceptance
results that were not supplied. Agents did not move, consume or delete live items.

A later pass the same day, which the owner called "absolutely perfect", adds
Valve's own item renders and description lines for a public Steam inventory
(painted weapons, war paints and kits look as in game), quoted Name Tags with
the original name, description tags, a TF2-style Inspect panel, batched metal
crafting and Valve's premium-only random hat recipe with a reveal. Those crafts
were exercised only in the simulator; a read-only test fetched the owner's real
inventory art through the app's network client. The owner then tested live
crafting in the development app and reported that it works. Which recipes and
counts were used was not specified, and Linux and packaged builds remain
untested.

## Remaining delta before shipping Inventory

Inventory is **still development-only in source**: production navigation and
rendering exclude it, native release commands refuse, and release helper entry
points cannot mutate. This is an explicit readiness item, not a claim that the
new manager is already in the signed release candidate.

1. Complete and record Inventory-specific live/platform acceptance using
   [LIVE-TESTING.md](audits/2026-09-27-inventory-usability/LIVE-TESTING.md), including
   exact in-game positions, the four metal recipes including a batch, a random
   hat, deletion, refusal and unknown-outcome recovery, and Steam item art. Preserve the owner's positive interaction feedback.
2. Enable the production Inventory surface and native entry points only with
   that qualification, then integrate the final changes into the release branch.
3. Refresh hosted checks and the private signed candidate on the resulting
   revision. The previous successful candidate cannot attest to newly added code.
4. Keep publication waiting for a separate explicit owner request. Updating
   readiness or committing this work does not authorize tagging or publishing.

The earlier whole-application sign-offs remain intact. The work above is the
incremental Inventory/revised-candidate gate, tracked under existing RND-208.

## Validation of this checkpoint

Art and crafting pass: 1,219 desktop tests, 170 cfglint tests, 1,039 Rust
workspace tests and 27 helper tests passed; Biome, workspace/helper Clippy,
rustfmt and the production build passed. Earlier counts follow.

- Full frontend suite: 1,206 desktop tests, 170 cfglint tests and 110 script
  checks passed; five platform-dependent script checks skipped.
- Standalone Inventory helper: 26 protocol/session/wire tests passed.
- Biome, TypeScript, workspace and helper Clippy with warnings denied pass.
  Rust formatting passes. The production frontend build passes with its existing
  large-chunk warning. The native development executable was rebuilt.
- Full Windows Rust workspace: 1,032 tests passed, 32 opt-in tests ignored.
  The first attempt stopped at five existing command-fixture tests with
  `GameRunning`; after the owner closed TF2, the complete rerun passed without
  bypassing the normal process guard.
- No new Linux, packaged or live mutation result is inferred from these checks.

The earlier audit and UI screenshots are dated history. Current behavior and
manual checks live in the linked Inventory testing document.
