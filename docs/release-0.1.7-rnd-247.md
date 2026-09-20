# RND-247: absorbed inventory and installed records

The 0.1.6 maintenance baseline retained a ModRecord after Update accepted the
last file's external removal. Native export then produced a ZIP its own import
rejected. RND-247's September 14 reproduction documents this failure in Linear.
The referenced main-track audit files are absent from this maintenance baseline;
the committed integration regressions reproduce the production-core operations
directly in unique disposable Windows fixtures.

Absorb now updates records in the existing recoverable file transaction's
metadata callback. Only touched pack identities are reconciled. Whole removal
drops the mod record, and partial additions, changes and removals recompute the
retained file count and byte total. New bytes use the transaction's bounded exact
source lengths; unchanged bytes use the validated library sources. Names, origin
and installation timestamps remain unchanged. Renames retain exact payloads but
do not guess a new mod identity or transfer provenance to a different pack.

The selected HUD record is cleared when its accepted inventory no longer has a
HUD marker in that pack. Sound, crosshair and viewmodel packs are app-owned and
are repaired before classification; external deletion is therefore not accepted
as removal. The sound/viewmodel regression verifies retained records and exact
restored bytes. Keep/Restore paths do not enter this reconciliation. Unreadable
inventory fails before it, and the existing entry-point and mutation-boundary
process checks remain in place. No profile schema or write surface changes.

## Verification

`core/tests/absorb_integrity.rs` exercises actual core install, absorb, export,
import and switch functions, with no Steam discovery, game launch or real profile
writes. Added regressions cover folder/VPK whole removals, partial counts/bytes,
new files, Keep/Restore, leading-dash rename identity, unreadable Windows files,
the running-game lock, HUD records and managed sound/viewmodel self-repair.

Windows verification completed on September 19, 2026:

- `cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml -p execs-core --locked`:
  643 unit tests, 14 absorb integration tests, 3 HUD integrity tests and 11 pack
  identity tests passed. Eleven existing asset-dependent tests remained ignored.
- `cargo clippy --manifest-path apps/desktop/src-tauri/Cargo.toml -p execs-core --all-targets --locked -- -D warnings`: passed.
- `cargo fmt --all --manifest-path apps/desktop/src-tauri/Cargo.toml -- --check`: passed.

No UI layout changes: Your mods receives the corrected manifest records through
the existing library reload. Release-wide UI and Linux checks remain the parent
release candidate's responsibility. No tag, build dispatch or publication was
performed by this change.
