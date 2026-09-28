# Independent review: part 2

Reviewed September 28, 2026 against the combined working tree for all 14 items in Linear's part 2 document. This review was separate from the implementation owners. It covered the seven plans, native mutation and recovery boundaries, bridge/UI integration, compatibility, and the final HUD and command-catalog additions. No release or version change is approved by this report.

## Findings resolved during review

- **Steam options could still be overwritten outside Launch.** Profile switching and Viewmodels still called automatic Steam writers after the initial Launch fix. Those paths now retain pending profile options and require an explicit Launch review. The obsolete unreviewed sync path was removed. Reviewed writes bind to current profile, install, Steam account and raw options, and recheck after Steam exits.
- **Older interrupted profile updates could fail recovery.** Protected Valve cfg entries remained in historical journals' new manifests. Validation now preserves original manifest identities while excluding unchanged protected entries from ownership/file deltas. Metadata-only committed and uncommitted historical journal fixtures cover recovery. Journals requesting a newly forbidden live write still refuse rather than write Valve files.
- **Older native ZIPs and restore points could become unreadable.** Entry and payload validation originally rejected previously captured Valve cfgs. The compatibility path now stages and verifies their original hashes and archive budgets, then excludes these newly protected files and discloses the skipped count. Corrupt archived bytes still refuse import.
- **Comfig metadata needed schema-2 ZIP compatibility.** The strict schema-2 allowlist now accepts the additive release record, preserving exported profiles that also carry a stock-built Viewmodels recipe.
- **Launch waiting needed complete UI behavior.** Automatic expiry now reports why the wait ended. The Launch pane offers adoption of Steam's current options, and its review closes when hidden or its profile/saved value changes.

No blocking finding remains in the reviewed implementation. Whole-workspace and visual verification are recorded by the coordinating agent separately.

## Additional checks

- Pack decisions require exactly one valid answer per reviewed pack and a complete full-hash native fingerprint, rechecked before publication. Restores preserve saved provenance; selected particle sources remain protected from removal.
- Automatic absorb's metadata cache is separate from full-hash switch/review paths. Legacy stock entries are removed from ownership without deleting live Valve files or historical library copies.
- Disabled mods use nested, unmounted content inside ordinary tracked containers. Enabling/copying validates the wrapper, source hashes, collisions, HUD ownership and particle selections. GameBanana checks retain source/game/category validation.
- Bypass intent is install-bound and saved through the existing preloader transaction. Fresh process checks precede journal/state publication. No status read silently modifies game files.
- HUD actions bind to the exact backup location and contents. Recovery copies exact bytes, including unknown files and empty directories, to a unique external destination, rechecks the source before publication and leaves the backup intact. Delete verifies each file before removal. Fully owned HUD replacement rechecks the live tree before skipping a duplicate game-side backup; unknown/drifted trees remain recoverable.
- Menu reconciliation replaces only validated existing value tokens. World FOV retains authored bytes through unrelated edits. Custom binds use explicit ownership markers, cfglint checks and the existing key-conflict flow.
- The command-catalog supplement contains only independently described build/destroy metadata from the existing pinned Valve SDK revision. The generator checks for the handlers; strict argument counts are omitted to preserve accepted legacy forms.

## Tests run independently

All commands below completed successfully against the combined tree:

| Working directory | Command | Result |
| --- | --- | --- |
| `apps/desktop` | `pnpm exec vitest run src/components/ReadyPanel/PackPrompt.test.tsx src/components/ModList.test.tsx src/hooks/useModManagement.test.tsx src/lib/settings-part2.test.ts` | 4 files, 47 tests passed |
| `apps/desktop` | `pnpm exec vitest run src/LaunchPane.test.tsx src/ComfigPane.test.ts src/hooks/useLifecycleStatus.test.tsx src/components/HudBackupStorage.test.tsx` | 4 files, 37 tests passed |
| `packages/cfglint` | `pnpm exec vitest run test/catalog.test.ts` | 1 file, 6 tests passed |

Total: **90 independently executed tests across 9 files**. Implementation owners' native results are additional evidence, not tests rerun by this reviewer.

## Limits and explicit choices

- Vanilla-to-mastercomfig installation remains blocked pending a complete reviewed cfg migration, as explicitly allowed by item 3. This prevents silent loss of startup/class cfg behavior; it does not implement that migration.
- A material-bypass choice made before intent tracking existed cannot be reconstructed after an external reset. A successful explicit toggle or selection apply records intent going forward. Status reads remain read-only.
- Matching file metadata is a performance hint, not cryptographic proof. A same-size rewrite preserving metadata can evade an automatic drift pass; full switch/review/mutation paths do not authorize writes from that hint.
- Existing inventory limits still refuse incomplete captures with a responsible path and recovery guidance. Benchmark timings are fixture/hardware measurements, not an HDD performance guarantee.
- This review did not launch retail TF2, mutate player data, qualify a packaged Windows/Linux build, or perform the coordinator's viewport review. Browser/component and disposable native fixtures do not establish in-game or release acceptance.

## Hosted fixture compatibility follow-up

The first pushed revision passed the native unit suites, but hosted Linux native/package smoke checks exposed a fixture assumption: automatic absorb now creates a disposable cache beside the active manifest, while the older fixture expected no additional library files. The correction changes fixture validation only; product versions, public package pins, export provenance and release guards remain unchanged.

Independent review approved the narrow exception:

- The cfg-only active fixture permits only its active profile's exact `absorb-cache.json`, containing precisely `{ "entries": {} }`. It remains optional and is reported separately from protected bytes. The twelve protected files, metadata, live payloads and directory/link checks remain exact.
- Package fixtures permit a bounded cache only for the known active profile, and the validated imported profile only after an authorized switch. Cache entries must name the fixture's known ordinary custom paths, carry its exact expected SHA-256 values, and have the exact platform stamp shape matching the authored baseline or current observed source. Unknown, inactive, nested, partial, malformed and linked cache cases still refuse.
- Review caught and corrected two draft-validator problems: a pre-switch cache may retain its original timestamps after an atomic live replacement, and containment/link checks must still run before the imported index is read. The final code preserves both boundaries.
- Removing a validated cache from checkpoint hashes does not exclude any manifest, index, settings, shared blob, profile payload, live file or recovery journal. Regression cases still detect payload corruption when a valid cache is present.

Independently ran `node --test scripts/linux-native-active-fixture.test.mjs scripts/package-smoke-fixture.test.mjs scripts/development-package-fixture.test.mjs scripts/development-package-guard.test.mjs`: **61 tests passed, no skips or failures**. This includes the 13 active-fixture tests also run separately during the first correction. No blocking finding remains in the reviewed fixture changes. Hosted native/package reruns must still establish the final pushed revision's result; these validator unit tests do not claim that result.

The next hosted package run passed cache validation and exposed a second obsolete fixture assumption: switching no longer attempts Steam synchronization, so the harness must observe the explicit pending-review completion instead of the old absent-account message. The revised predicate requires a native session, the expected profile name and the exact `NotRequested` completion text. Since the imported profile deliberately shares the original name, the following unchanged disk check still requires the imported UUID, exact active index and exact projection. Close, reopen and final cleanup preserve the same checkpoint, including the pending flag and authored launch options. New rejection cases cover stale/incomplete UI outcomes and clearing the pending flag or changing launch options before restart validation.

Independently ran `node --test scripts/development-package-guard.test.mjs scripts/development-package-fixture.test.mjs`: **39 tests passed, no skips or failures**, including the actual native session switch flow with a mocked driver. These overlap the earlier fixture suite and are not an additional distinct-test total. No blocking finding remains in this expectation-only follow-up; the hosted package rerun remains necessary.
