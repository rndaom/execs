# Installed mod content diagnostics (issues 6 and 7)

The Mods pane now explains installed custom content without changing a pack or claiming that a retail Casual match has passed. Each recorded mod gets a Casual note; the Casual setup fold covers every inspected installed pack, including HUD and managed packs. The Custom packs fold names overlapping virtual paths, the expected first custom mount when known, possible mixed model sets, and whole sound-script replacements that may become stale after a TF2 update.

## Evidence and decisions

- [Linear 0.2.1 list](https://linear.app/rndaom/document/021-issue-list-154e1b4f5037), sections 6 and 7, supplies the reported pack examples and requires retail verification before claiming that models work.
- [Valve SDK filesystem initialization](https://github.com/ValveSoftware/source-sdk-2013/blob/master/src/public/filesystem_init.cpp) expands custom mounts using a case-insensitive alphabetical sort, excludes dot-prefixed outer entries and removes numbered VPK shards when a directory VPK is present. The diagnostic predicts the first ordinary custom mount; it does not inspect an active game's search path, map mounts, or cache.
- The installed Valve `tf/cfg/pure_server_full.txt` was read on September 27, 2026. It requires trusted sources for sound, models, materials, particles and seven explicit sound scripts. This is evidence of the base policy, not a captured live Casual server whitelist. Hit/kill sound path exceptions are retained from the issue's stated requirements. Other server-specific exceptions are not inspected.
- `core/src/preloader/mod.rs` explicitly excludes sound from its implemented bypass. Model/material notes require the profile preload flag, Steam launch option and material bypass, and still say that retail behavior is unverified. Particle notes use the issue 8 qualification reason and the applied selection, never infer success from selection alone.

## Read-only boundaries and uncertainty

The existing content-index reader now also accepts all virtual paths. It reads directory entries and VPK trees, not file payloads. It has shared bounds of 1,024 outer entries, 200,000 loose entries, depth 16, 256 VPKs, 50,000 retained source entries and 8 MiB of retained path strings. Duplicate paths count separately toward the source limit. The output retains at most 200 overlap details and 200 mixed model sets and names omitted detail counts.

Unreadable, linked, malformed and over-budget input produces a visible incomplete notice. No overlap winner is asserted from an incomplete index, case-fold collisions, non-ASCII source identities, or ambiguous Linux loose-path casing. Hidden outer packs and the excluded HUD backup container are omitted. Source-like VPK directory/shard sets are represented once by their directory tree. Model families group `.mdl`, `.phy`, `.vvd`, plain `.vtx` and `.dx90.vtx` / `.dx80.vtx` / `.sw.vtx` companions by stem; parts from different candidate packs are warnings, not a diagnosis of broken geometry.

The report is returned by the existing off-main-thread preloader status request. There is no new write command, background polling loop or load-order editor. Existing pane/profile refreshes update it after library changes. A failed particle qualification becomes an unavailable reason rather than preventing recovery controls from loading.

## Verification

- `cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml -p execs-core --lib mod_audit --locked`: 3 passed.
- `cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml -p execs-core --lib content_index --locked`: 6 passed, including cross-VPK duplicate-source budget exhaustion.
- Targeted frontend tests for mod audit notes, the audit component and ModList: 9 passed. They cover sound exceptions, missing hooks, unavailable selected particles, missing/incomplete results and an incomplete warning outside the closed details fold.
- `pnpm --filter @execs/desktop exec tsc --noEmit`: passed after initial implementation.

These are implementation and fixture checks. No game was launched, no custom pack was changed and no retail Casual match or console-log acceptance was performed. The requested match using the reported model packs remains required before changing the cautious product wording to a confirmed compatibility claim. This work does not publish or tag version 0.2.1.
