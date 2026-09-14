# Import names and private VPK exports — 0.1.5

Date: 14 September 2026. Scope: [RND-277](https://linear.app/rndaom/issue/RND-277/avoid-source-reserved-directory-names-when-installing-loose-mods-and) and [RND-278](https://linear.app/rndaom/issue/RND-278/refuse-profile-export-when-vpk-cfg-members-contain-server-credentials).

Implementation starts at maintenance commit `fae34cf5f6bcb248e6144dadc20ca8ba3fd90692`, in `codex/0.1.5-import-export`. The starting findings and reproducer are in [core-integrity.md](../2026-09-14-project/core-integrity.md) and [core-repro.rs](../2026-09-14-project/core-repro.rs). This work changes no product version and does not publish a build.

## Source and reproduced failures

Valve's [filesystem loader](https://github.com/ValveSoftware/source-sdk-2013/blob/b8cfb12c0e083a2ef5b2f9f9b50f3902fa034474/src/public/filesystem_init.cpp#L814), reviewed on the audit date, compares wildcard entry names without case sensitivity against `materials`, `maps`, `resource`, `scripts`, `sound` and `models`, then reports a fatal bad search path. The neighboring code accepts a VPK file as a separate mount. The fix therefore applies to the final loose outer directory, while `materials.vpk` remains valid. The retail check below verifies the safe destinations against the installed engine rather than relying only on that SDK source.

The existing native ZIP cfg validator rejects a synthetic saved server credential, but the former export helper skipped every outer extension except `.cfg`. Two regression probes restored only those old decision points in the working tree under a `try/finally` restoration: the packed-credential export succeeded, and a loose `materials.zip` import selected `materials`. Both new assertions failed as expected. This was a controlled reproduction of the old decision paths, not a complete build of the unmodified public tag. Logs: `G:/Projects/execs-015-evidence/imports-baseline-export.log` and `imports-baseline-names.log`. No real credentials or user configuration were used.

## RND-277 implementation

- Loose mod imports prefix reserved results with `mod-`; generated HUD names use `hud-`. Existing collision allocation still runs after this normalization. The HUD install sanitizer also refuses a reserved final ID supplied directly by a caller.
- Native ZIPs and old profiles retain their original paths and payloads. Read-time library diagnostics expose affected folders. Profiles shows **Needs repair** and **Repair folder names**; the active profile also has a repair banner. Switch preflight and native launch refuse the unsafe layout before projecting or launching it.
- The themed repair dialog lists every old and proposed outer folder. Confirmation rechecks the plan, game lock, source containment, source hashes and destination collisions. Only the outer container is renamed; the author's inner paths and bytes remain exact. The old stored HUD-ID syntax remains accepted when reading native metadata.
- An inactive repair changes its library tree only. An active repair requires saved and live contents to agree, preserves the old live trees under `tf/custom/execs-hud-backups/<token>/<old-name>/`, and uses the existing journaled profile transaction for projection and rollback. HUD IDs, mod IDs/packs and ignored-pack records follow the repaired paths.
- Drift refuses repair with **Save current as…** guidance. Active profile-particle selections that would lose their mod ID refuse before any mutation and direct the user to turn them off with **Apply mods**, or use **Restore stock files**. Cancellation writes nothing. Save/Discard/Cancel protects Files drafts before confirmation.
- Windows manifest entries using different capitalization for one physical ancestor produce one repair. Distinct Linux ancestors that differ only by case receive an explicit source-layout diagnostic; they are not merged. Case-only live drift on Linux uses the same capture-current guidance as other drift.

No persisted profile schema or new live write target was introduced. Diagnostics are an optional, default-empty library response field. The existing excluded HUD-backup namespace is reused without broadening transaction rename permissions.

## RND-278 implementation

Export and native import share a VPK inspection helper. A file with Source's four-byte signature must pass the existing bounded tree walker; a malformed signed VPK cannot fall back to opaque treatment. CFG members, including preload bytes and mixed-case extensions, use the existing cfg policy with an `outer.vpk/member.cfg` label. Errors identify that path without echoing the credential value. Export does not redact or rewrite payloads.

The file-handle reader retains only selected cfg members. It hashes the captured tree and streams every remaining byte in 64 KiB chunks; those same chunks supply the inspected member data. Comparing the result with the manifest hash binds inspection to the exact approved bytes. The subsequent ZIP copy also retains its existing length and hash verification. A source mutation in either phase refuses publication, and the temporary export is removed while an existing destination stays intact.

Limits remain bounded: 20,000 tree entries, 8 MiB aggregate path metadata, 16 MiB tree, 8 MiB per inspected cfg, and the existing materialization budget of twice the archive size plus 1 MiB, capped at 512 MiB. Existing 1 GiB per-file and 2 GiB profile ZIP limits, portable-path collision checks, source containment, staging and atomic destination replacement remain in force. Selected cfg members requiring a split archive fail closed rather than opening sibling paths.

Legacy `.vpk` files lacking the four-byte Source signature retain the former narrow opaque compatibility. The signature bytes that select that exception are included in the same hash stream, and ordinary archive limits and exact hashes still apply. This exception cannot establish whether an arbitrary non-VPK binary contains credentials; it preserves the previous public format's opaque-file behavior.

## Verification

All core checks use the isolated `CARGO_TARGET_DIR=G:/Projects/execs-015-evidence/target-imports`; simultaneous worktrees sharing a target had produced stale test artifacts, so shared-target results were discarded.

The focused regressions cover:

- All six reserved names without case sensitivity, safe mod/HUD final names, duplicate allocation, and valid `materials.vpk`.
- Read-only diagnosis, reviewed active/inactive repair, metadata preservation, exact payloads, game lock, stale plans/collisions, live drift, source-particle refusal and mixed-case ancestors.
- A failure injected after an active source folder moves: the transaction restores the complete pre-operation file/hash snapshot, and a later retry succeeds.
- Exclusive and shared VPK credentials, safe non-cfg members, ordinary loose cfg checks, allowed archived `password "0"`, malformed signed archives, opaque legacy packs, and changed sources before inspection and before copying.
- A reader fixture with preload-only cfg and a cfg spanning multiple stream chunks, plus a selected-member size limit failure.
- A literal schema-1 ZIP fixture with no new optional fields, representing the previous public format: import retains the reserved HUD folder and bytes, the diagnostic blocks switching, explicit inactive repair preserves the original ZIP and live install, and export/reimport preserves cfg and HUD bytes and produces a switchable profile.

Browser verification used `?preview=folder-repair` with the real React components: the active repair banner appeared, Launch was disabled, the centered modal displayed old/new names, Escape canceled and restored focus, and successful preview confirmation cleared the diagnostic and enabled Launch. These UI checks simulate the bridge write; the core tests exercise disk transactions.

Final Windows checks pass:

- `cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml -p execs-core --locked`: 587 unit tests passed, 3 existing tests ignored; all 7 integration tests passed. Log: `G:/Projects/execs-015-evidence/imports-core-tests-final.log`.
- `cargo clippy --manifest-path apps/desktop/src-tauri/Cargo.toml -p execs-core --all-targets -- -D warnings` and `cargo fmt --all --manifest-path apps/desktop/src-tauri/Cargo.toml --check`.
- `pnpm check`, `pnpm --dir apps/desktop exec tsc --noEmit`, and the focused `useProfileLibrary.test.ts` suite: 10 tests covering read-only review, cancellation/game lock, retained review on failure and refreshed library after success.
- `git diff --check`.

## Retail Windows fixture

[prepare-retail-pack-names.rs](prepare-retail-pack-names.rs) creates a new synthetic fake install and imports through the production core mod and HUD routines. It refuses an existing output directory. The resulting `G:/Projects/execs-015-evidence/retail-pack-names/custom/` contains:

```text
mod-materials/materials/audit/sample.vmt
mod-materials-2/materials/audit/sample.vmt
hud-resource/info.vdf
hud-resource/resource/ui/execs_fixture.res
materials.vpk  -> cfg/execs_fixture_vpk.cfg
```

The VPK cfg prints `EXECS_RESERVED_VPK_OK`. All fixture payloads are first-party synthetic bytes. The parent verification task supplied an isolated `-game` root with independent write paths and launched installed retail TF2 without video flags. The completed check returned exit code 0; the mount-complete and packed-cfg markers appeared, and all three loose folders were mounted. Protected original install hashes were unchanged. Evidence: `G:/Projects/execs-015-evidence/retail-pack-names/result.json` and `console.log`. No fixture was installed into the real `tf/custom` or `tf/cfg` trees. Native write tests paused while that engine process ran and resumed only after it closed.

## Limits and remaining gates

The Windows retail check covers mounting and packed cfg lookup, not every possible third-party pack or HUD appearance. Distinct Linux folders differing only by case require the author/user to resolve the source layout; the repair does not silently merge them. Active repairs require the affected saved/live contents to agree and profile-sourced particle patches to be cleared first. Core tests use temporary synthetic libraries, not live user data. The combined candidate still needs the parent task's complete native workspace and Linux CI checks; live Linux verification remains the explicitly outstanding user handoff.

## Release-branch integration

The combined ReadyPanel retains named launch blockers and adds an explicit folder-name reason. Repair failures belong to their review dialog; unrelated export/settings errors are not copied into it or cleared by repair. Plan-read errors have their own source identity. Focused profile, pending-settings and feedback checks passed (28 tests), along with TypeScript and Rust formatting.

Combined native checks exposed a fixture precondition conflict: the new cfg-loader inspection already rejects malformed signed VPKs during capture. The export regression now seeds a historical library record with matching hashes after capturing the supported opaque legacy form, then independently verifies export refusal and destination preservation. The focused regression passes; production validation is unchanged.

## 0.2.0 forward port

The minor track retains creator review, approval tied to exact ZIP bytes, and
profile-owned preloader selections. VPK validation combines the new hash-bound
inspection with the existing creator trust policy. A regression fixture imports
an approved VPK with saved credentials byte-for-byte, refuses its export without
replacing the destination, and rejects malformed or changed source archives.

Folder repairs remap saved profile particle IDs in the same transaction as their
mod records. Active and inactive profiles retain all other selections. Installed
particle sources still require explicit clearing or restoring; an inactive
profile that owns the shared projection also refuses repair. Tests verify both
profile states, unrelated profile and projection isolation, and rollback/retry
after the old live folder has moved. All eight folder-repair tests pass.

Completed imports with unsafe folders lead directly to the existing repair review
instead of offering a switch that the native guard must refuse. A real DOM test
verifies the imported profile ID reaches the repair action, the switch callback
stays unused, and the TF2 lock still disables the action.

The forward-port frontend check passes 527 desktop tests, 140 cfglint tests and
21 release-script tests (three platform-specific skips). Biome, TypeScript/Vite,
Rust formatting and workspace clippy with warnings denied pass. The core suite
passes 609 unit tests and 20 integration tests (five opt-in fixtures ignored),
including the combined-branch legacy VPK fixture correction. These checks use
synthetic temporary libraries only. Frontend and core test logs are
`G:/Projects/execs-015-evidence/forward-port-frontend-tests.log` and
`G:/Projects/execs-015-evidence/forward-port-core-tests.log`.
