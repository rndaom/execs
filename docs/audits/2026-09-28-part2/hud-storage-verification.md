# HUD backup storage verification — issue 7

Implementation is in `hud_backups.rs`, HUD replacement/stock planning, the App settings native commands, and `HudBackupStorage` within existing Storage. Shared bridge, preview and native registration have additive entries.

## Verified locally (Windows, disposable fixtures)

- `cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml -p execs-core --lib hud --locked`: 138 passed, 0 failed, 5 ignored (existing tests requiring pinned downloaded archives/schema corpus).
- `pnpm test -- src/components/HudBackupStorage.test.tsx src/components/StorageUsage.test.tsx src/AppSettingsPane.test.tsx`: 12 passed across 3 files.
- `pnpm exec tsc --noEmit`: passed.
- Targeted Biome and rustfmt: passed after formatting.

New regression coverage verifies repeated owned HUD cycles create no game-side copies and reuse equivalent library history; exact former long-path payload remains in library recovery; a new unowned file arriving during transaction staging refuses the no-backup path; uppercase folder replacements retain the established rename behavior; unknown/edited bytes remain intact in existing regression fixtures.

Backup tests enumerate both locations, expose actual names/file dates, restore binary and unfinished files plus empty folders byte-for-byte to a new external directory, leave source and live HUD unchanged, delete only the reviewed copy, refuse stale content fingerprints, bind fingerprints to their location, reject traversal, reject destinations under TF2/app data, and refuse a running game. A Unix-only link fixture is present for Linux CI; it was not run on Windows.

Frontend tests cover names/dates, explicit delete review, exact revision payloads, restore explanation, cancelled native picker with no success report, and failure preservation. Existing theme tokens, Modal, ContextMenu, buttons and loading treatment are reused.

## Review and limits

The coordinating agent approved the plan. Independent reviewer approved external-folder restore and conservative intact copies for mixed owned/unowned trees. Final integration review and whole-repository checks remain with the coordinator. No real TF2, Steam or execs library was mutated, and no release/version/tag change was made.

The no-duplicate fast path applies only to completely owned, exact regular-file trees. Mixed or changed trees retain a standalone full recovery copy; this deliberately preserves independent exact-byte recovery. Empty old directories may remain after stock restoration but contain no HUD marker/content. Historical dates are explicitly file dates, not guessed backup creation times. Restore publishes files into a newly generated directory under the chosen parent; using them as a HUD remains an explicit HUD import. Existing backups are not automatically pruned.
