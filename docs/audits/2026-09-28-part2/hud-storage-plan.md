# HUD backup storage plan (issue 7)

## Evidence

`hud.rs` moves every mounted HUD into `tf/custom/execs-hud-backups` before installs and stock restoration. `hud_ownership.rs` independently snapshots the manifest-owned bytes into the profile's `hud-backups`, so a completely owned live HUD is duplicated. Switch already removes hash-matching owned files before preserving remnants. Storage currently never enumerates the game-side backups.

## Changes

1. Before install/stock replacement, partition planned live renames: a tree whose complete regular-file inventory exactly matches manifest-owned, library-verified hashes needs no live backup. Preserve full renames for unknown files, drift, case/path uncertainty or incomplete inventories. Recheck the exact tree immediately at the transaction precommit hook, so a new file cannot be stranded or overwritten. Existing profile transaction snapshots provide rollback. Existing library originals remain recoverable.
2. Expose legacy game-side HUD backups in Storage, read-only discovery with original folder name, modification date (explicitly described as file date for legacy backups), byte count and fingerprint. Bound traversal, reject links, validate fixed container/token/name identities. Do not auto-delete existing backups.
3. Restore copies the exact backup into a new folder under a native user-picked parent outside TF2 and execs data, without deleting its source. A staged directory publishes only after all copied hashes and the source fingerprint match. This avoids activating a second HUD or overwriting the currently selected HUD and preserves arbitrary original bytes, including untracked junk. The dialog explains how to import the recovered HUD when desired. Picker cancellation remains null. Delete requires explicit themed confirmation, matching fingerprint, game closed, native write gate, no pending profile mutation, and contained removal.
4. Reuse Storage's rows, buttons, loading/error treatment and Modal. Add bridge/preview twins and native registration with narrow edits.

## Verification

Disposable Rust fixtures: fully owned replacement makes no game-side backup; unknown/modified files remain recoverable; baseline changed before commit refuses; listing shows legacy metadata; fingerprint drift refuses restore/delete; traversal/link and invalid identity refuse; restore publishes an exact external copy and preserves source; game-running refusal leaves bytes. Frontend tests cover names/dates, Restore and Delete confirmation, busy/error behavior. Full root integration checks remain with coordinating agent. No real TF2 or profile data is touched.

## Boundaries

No version/release changes, no automatic legacy deletion. This covers the existing game-side backup accumulation; profile-owned historic originals continue to be protected recovery data. Documentation and changelog integration belong to the root agent.

## Approved implementation adjustment

The root coordinator approved exact restore into a new directory under a native user-picked parent outside TF2 and execs data. No file is activated automatically, source backups stay intact, and picker cancellation stays null without success feedback. This preserves arbitrary unowned junk that profile manifests correctly refuse. Storage lists both game-side and profile-library backups. Exact repeated library snapshots share a content-derived directory; changed external recovery bytes refuse overwrite. Mixed owned/unowned trees retain a complete independent copy; ordinary fully owned HUD replacements do not create game-side copies.
