# Issue 10: per-pack external changes

Source: Linear 0.2.1 part 2 issue list, section 10 (document bf498fbb-1347-4c70-a442-bce9a98ebb71).

## Audit
The prompt uses an unnamed active profile and one bulk choice. Its hook binds the visible delta to the active profile, but absorb_packs reclassifies without a native review identity. Existing profile transactions already support checked precommit and recovery of live and library bytes. Existing Keep blocks switching with still-installed unowned packs.

## Plan
- Name the profile and give each added pack Add to profile / Leave in TF2, and each missing pack Remove from profile / Restore / Keep saved. Explain each selected consequence and switching; defer remains available.
- Reuse Modal, Segmented, tokens, and their existing motion. Bound the list height and wrap long pack names.
- Add an optional pack review fingerprint to absorb-owned output, covering profile manifest, confirmed root, complete pack inventory and live bytes. New resolve command takes expected profile/fingerprint plus exactly one valid choice per displayed pack. Refuse stale, missing, duplicate, or invalid choices.
- Stage accepted additions, removed paths, restored library bytes and ignore metadata in one checked profile transaction; full recheck at precommit and process guards. Retain the old bulk API for existing capture-kept flows.
- Reuse absorb record/provenance reconciliation; only chosen removals participate in particle-source removal guards. Restoration must not mark source provenance changed.

## Validation
Disposable core fixtures: mixed add/remove/restore/keep, exact manifest/live results, stale content/profile/snapshot refusal, malformed/duplicate choices, selected particle refusal, missing restore source and TF2-running refusal with no partial publication. Component tests cover independent choices, profile name, switching guidance, disabled state and long names. Hook tests verify complete snapshot ownership; preview implements the new bridge method. Run targeted Vitest, core tests, TypeScript and formatting; parent runs integrated checks and visual evidence.

No real player files, release/version changes, commits or pushes in this workstream.
