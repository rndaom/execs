# Mods plan: part 2 items 8 and 12

## Evidence and scope

The current bypass writer preserves the updated gameinfo bytes, but the independent global bypass choice is not retained. Existing particle status already checks per-entry hashes/CRCs, including same-size updates. Preserve that behavior.

Custom pack records currently expose removal only. All payload paths participate in the recoverable profile mutation and ordinary inventory. Keep those paths on the existing supported surface rather than introduce a second unmanaged library.

Primary sources checked: GameBanana's own https://gamebanana.com/apiv11/Mod/Index returns `_tsDateUpdated` separately from `_tsDateModified`; existing canonical profile API and pinned network policy remain the source for individual installed-mod checks. Valve developer wiki Gameinfo page was unavailable during this check; the repository's byte-preserving gameinfo fixtures and mounted-path resolver establish the bounded implementation behavior. No real TF2 installation is changed for verification.

## Implementation

1. Persist global, install-bound bypass intent in the existing protected preloader state, which the existing recovery journal already snapshots. Independent review approved this over a separate sidecar to keep intent and gameinfo rollback together. Explicit bypass changes use that journal; successful selection Apply updates intent with its final state, normal profile switching preserves intent, and Restore stock clears it only after gameinfo restoration. Report `gameinfoBypassWanted` in status. Read-only status compares this with actual state; no automatic official-file rewrite. Startup/after-game Mods refresh shows the existing styled notice and one-click existing toggle command.
2. Add optional `inactivePack` to ModRecord (absent means on). A disabled pack moves atomically from its mounted path to `tf/custom/execs-inactive-<id>/content/<original-pack>`; the record's `pack` becomes that unique container and `inactivePack` preserves the original top-level name. Source therefore sees no immediate materials/models/cfg/particles or VPK. Enabling reverses the map. Reject collisions, live/library drift, unsafe names, selected particle sources and HUD-owned packs. Preserve byte hashes, source identity, stable record id and install date. Absorb, switch, export/import keep ordinary tracked container bytes.
3. Copy saved pack bytes to another existing inactive profile through one recoverable destination mutation. Verify source hashes, preserve source metadata and inactive state, allocate a noncolliding destination name, and never include unabsorbed live drift. Reject same-profile and active destination requests.
4. Add a read-only per-installed-mod update check against the existing validated GameBanana profile endpoint, retaining TF2/category validation. Compare `_tsDateUpdated` to installation time; unknown timestamps and failures remain unknown. Return `updatedAt`, `updateAvailable`, and per-row error; no automatic download/replacement.

## API/UI coordination

Root owns renderer/bridge/preview/native registration changes. Proposed commands: `set_mod_enabled(id, enabled) -> ProfileDetail`, `copy_mod_to_profile(id, targetProfileId) -> ProfileDetail` (destination detail), `check_mod_updates() -> ModUpdateStatus[] {id, updatedAt: number|null, updateAvailable: boolean, error: string|null}`. Profile source is resolved with existing `with_profile`; target must be inactive. Native preloader status gains `gameinfoBypassWanted: boolean`. ModRecord gains `inactivePack?: string`. Existing Switch, notices, button styles and modal patterns remain.

## Verification

Disposable core fixtures: stock gameinfo after simulated update retains wanted state, re-enable preserves updated bytes, explicit off clears notice, game-running refusal preserves intent. Tree/VPK disable-enable exact-byte round trips, disabled particle source exclusion, selected-source refusal, active drift and destination collision refusal, export/switch/absorb retention, copy hash verification and inactive target isolation. Native API parser checks separate update/modified dates and invalid timestamps. Root runs renderer tests, contract regeneration, style checks, build and UI review at required sizes. No version/tag/release operation.

## Native results

- `cargo test -p execs-core --lib mods::tests --locked`: 32 passed, including loose/VPK disable → absorb → export/import → switch → enable byte-exact round trips, copies of enabled and disabled packs, drift/collision/selected-particle/running-game refusal, and corrupted source rejection without target writes.
- `cargo test -p execs-core --lib preloader:: --locked`: 95 passed, 9 pre-existing source-fixture-dependent tests ignored. New tests simulate a gameinfo update, verify wanted-but-off status, repair the new file without reverting Valve's new content, clear intent on explicit off and full restore, refuse writes while TF2 runs, and keep intent bound to the correct install.
- The existing prepared-plan test compared two independent install state files byte-for-byte. Its expected state now first verifies the first install's stored canonical root, then substitutes only the second fixture's canonical root. All official-file/snapshot bytes and the full remaining state stay exact comparisons; the production prepared-plan state equality check is unchanged.
- Individual update metadata uses `_tsDateUpdated` only. Parser tests establish `_tsDateModified` alone does not indicate an update; missing/invalid dates remain unknown. Installation timestamps are validated before comparison, and copy preserves the source installation date.

These checks use disposable native fixtures. They do not assert retail TF2 rendering or a published build.

## Compatibility and limits

Older state has no durable bypass intent; an already reset pre-upgrade gameinfo cannot reveal whether the player wanted bypass on. The new preference begins with an explicit enable/disable choice or successful Casual Apply. Startup status remains a read and does not infer past intent or alter official files.

Update checks are explicit, bounded to 128 installed GameBanana records, and deduplicate repeated author IDs during one check. They flag an author update newer than the saved installation time; they do not promise a particular downloaded file changed, select a variant, or update a pack automatically. Missing/unusable dates and failed requests return row-specific unknown/error state. Copies retain the original install time so copying an old pack does not hide a newer author update.

Disabled packs keep their original bytes in an ordinary tracked container with no directly mounted content root or VPK. Old profiles deserialize with no `inactivePack` and remain enabled. Native exports/imports validate both original pack ownership and the exact inactive wrapper. A selected particle source must first be deselected and applied before its pack can be disabled. HUD and app-owned packs retain their dedicated workflows. Copies use saved, hash-verified bytes and accept only another inactive profile.
