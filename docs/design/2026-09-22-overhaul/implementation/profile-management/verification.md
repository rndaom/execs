# Profile management verification

The implementation follows the selected Foundry profile menu and confirmation surfaces. The active-profile choices expand the concept to satisfy RND-213: switch to a named replacement first, or explicitly keep the installed TF2 files and stop tracking the setup.

## Visual evidence

Captured at 1280 × 720 from browser fixtures at `?preview=settings-comfig` and `?preview=profile-import-huds`. These are application screenshots; no player library was used.

- `00-profile-actions.png`: contextual Export profile / Delete profile menu.
- `01-active-delete.png`: last active profile, Cancel focused, no keep-installed choice selected, Delete disabled.
- `02-inactive-delete.png`: named inactive profile, preserved-live-setup disclosure, export-first action, distinct destructive action.
- `03-switch-first-delete.png`: explicit switch-first choice and named replacement before enabling the combined action.
- `04-multi-hud-import.png`: both HUD folders visible with no default choice; Trust and import is disabled.
- `05-multi-hud-import-choice.png`: the chosen HUD has the shared selected ring/dot and import becomes available.
- `06-import-complete.png`: saved profile confirmation; Main remains active until the separate Switch to profile action.

The browser check confirmed that Cancel preserves the profile, a keep-installed selection enables deletion, and switch-first deletion remains disabled until a replacement is selected. The multi-HUD import completes the real preview read/review/save flow after an explicit choice. The review and its confirmation buttons fit the 720 px viewport. Shared destructive colors use the dedicated Foundry dark-red fill, and existing modal focus, keyboard trapping and reduced-motion behavior remain in use.

## Automated evidence

- `cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml -p execs-core profile::deletion --locked`: 9 passed.
- Native `commands::library::orchestration_tests`: 5 passed. Covers local-only particle selection without the default library, repeated switching/reapply/restart, legacy migration, archive export/import, failed target validation, interruption recovery, and refusal to remove a selected particle source directly or through absorb.
- `cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml -p execs-core preloader --locked`: 78 passed.
- `mods::tests::legacy_hud_mod_removal_clears_its_record_without_promoting_an_inactive_original`: passed for both a sole HUD and a profile with another preserved original, including running-game refusal.
- `pnpm exec vitest run src/hooks/useProfileLibrary.test.ts src/components/ProfileImportDialog.test.ts src/components/ProfileDeleteDialog.test.ts`: 31 passed.
- Targeted Biome checks and `pnpm exec tsc --noEmit`: passed.

The deletion fixtures cover inactive/active/last-profile semantics, live-byte preservation, shared base references, missing/corrupt entries, a corrupt remaining manifest, running TF2, pending switch, a prepared request interrupted before index commit, committed cleanup resumed after restart, and a changed index refusing cleanup. Frontend tests cover Cancel, export, focus, named replacement, failure without deletion, running/write-state guards, HUD-review routing, and explicit multi-HUD import choice.

## Disk behavior

Deletion publishes an atomic index change behind a bounded recovery journal, then cleans only the target profile. Startup cancels an uncommitted request or resumes committed cleanup. It preserves live TF2 files, preloader original snapshots and the current installed projection. A deleted projection owner remains a tombstone until the next Apply or switch, preventing migration of that selection to another saved profile. Shared base cleanup is skipped if any remaining manifest cannot be read safely.

The native switch no longer clears profile particle choices before the core transaction. Empty and local-only selections use the same default-library predicate as Apply; default-library selections retain strict cache validation.

Multiple-HUD profile imports require a visible selection. Unselected roots remain preserved originals in the profile library and are not mounted by TF2. `HudReviewRequired` routes to the requested profile; `HudLiveReviewRequired` routes to the active profile. A switch-first deletion blocked by HUD review preserves the saved profile and closes the deletion review before opening HUD selection.

## Qualification limits

Native verification uses disposable fixtures only. No actual player library was deleted, TF2 or Steam was launched, or Cloud configuration was touched. Integrated repository verification is run separately after the concurrent HUD ownership changes settle. The browser captures verify deletion review states and multi-HUD import. Component/hook tests additionally cover failure and error routing.
