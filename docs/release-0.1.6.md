# 0.1.6 release preparation

Status: all 14 issues implemented; automated candidate verification is running.
Gameplay rendering and native screen-reader acceptance remain open, so this is
not yet unconditional release approval. Publication and a release tag are not
authorized. Public latest remains 0.1.5.

## Scope and baseline

The September 18 owner request covers all 14 issues in Linear's 0.1.6 milestone.
The candidate starts at public `v0.1.5` (`9976464`) on
`codex/release-0.1.6`, targeting maintenance `rndaom/release-0.1.3`.
The existing creator-import PR #49 and Windows long-path branch are retained
and integrated. Unrelated 0.2.0 work stays on main. The milestone explicitly
assigns creator cfg/custom ZIP import as a bounded, compatible patch addition.

## Implementation plan

| Workstream | Issues | Implementation and verification |
| --- | --- | --- |
| Sound audition and identity | RND-245, RND-287, RND-293 | Invalidate installed previews by profile/content identity, match source identities, and name clip/slot controls accessibly. Exercise stale requests, replacements, boosts and newer drafts. |
| Creator profile import | RND-201 | Review the existing maintenance backport, single-use trust confirmation and exact-byte cfg/user.scr preservation. Verify native exports and active-profile isolation. |
| HUD installation | RND-303, RND-304 | Retain safe long Windows paths and consistently omit excluded backup files. Test archive/folder imports and transactional preservation. |
| HUD resource editing | RND-305, RND-306, RND-307, RND-310, RND-311 | Preserve legacy encoding; make folder variants reversible; handle conditional base includes, bounded expressions and included resource headers. Verify resource bytes against real pinned HUDs and official Source/editor semantics. |
| HUD schema compatibility | RND-308, RND-309, RND-312 | Match supported schema revisions, reject duplicate identities, correct effective FlawHUD toggles and independent kbnhud size targets. Verify changed resources, not merely successful return values. |

Implementation branches carry focused regressions and user-facing Unreleased
notes. The integrated candidate receives a second review, Windows tests and
GitHub Linux CI. Changes are forward-ported to the unreleased minor track.

## Verified implementation

| Issue | Result and evidence |
| --- | --- |
| RND-245 | Installed auditions read current bytes; stale replies, replaced URLs, profile changes and removal/reinstall are covered by hook lifecycle tests. |
| RND-287 | Comfig assignments compare stable source hashes/tokens; same-name and legacy-identity regressions pass. |
| RND-293 | Clip/source/slot accessible names, stable duplicate ordinals and keyboard focus are tested. Browser layout checked at 1200×800 and 960×640; native spoken output remains open. |
| RND-201 | Creator ZIP review uses a single-use exact-byte token; root/lock/hash are rechecked. `user.scr` remains opaque and survives import/switch/export. Public native exports remain compatible. |
| RND-303 | Both native Windows move endpoints support extended paths. Actual HypnotizeHUD install/update passes with local long-path policy disabled. |
| RND-304 | ZIP/7z/folder extraction and ownership share a case-insensitive junk policy. Actual kinhud and m0re Rockz install/update preserve retained payload hashes. |
| RND-305 | Legacy single-byte and BOM-marked UTF-16 edits preserve unchanged spans. Full default/alternate rayshud matrix passes, including non-ASCII comments. |
| RND-306 | Validated file/directory choices restore deselected variants, reject collisions atomically and preserve bytes; actual budhud choices round-trip. |
| RND-307 | Canonical and legacy HypnotizeHUD identities work; all six checkbox include pairs pass both states against the pinned package. |
| RND-308 | Incompatible m0rehud options are unavailable with guidance. Duplicate identities fail except exact verified pinned-data adaptations; saved options are retained/migrated. |
| RND-309 | Unsupported log-based controls are disabled with guidance and reject changed IPC values. Full supported FlawHUD matrix passes without creating unused snippet files. |
| RND-310 | Bounded reference/ternary evaluation rejects unresolved expressions before commit. All four actual font templates resolve to declared fonts. |
| RND-311 | Logical included-resource headers are edited inside their validated root; ambiguous roots fail. Existing siblings/includes survive and repeated applies are idempotent. |
| RND-312 | Crosshair 1/2/hitmarker targets retain independent sizes 13/17/23 and outline choices. Actual emitted resources pass; in-game visual confirmation remains open. |

Detailed source research and reproducible commands are in the
[audit record](audits/2026-09-18-0.1.6/README.md). Unsupported schema controls
are an explicit supported outcome of RND-308/309, not silently successful saves.

## Required release evidence

- [x] All 14 acceptance criteria mapped to implementation and checks/limitations
- [x] Frontend tests, Biome and production build
- [x] Windows Rust formatting, clippy and workspace tests
- [ ] GitHub Linux CI and package smoke
- [x] Previous-public profile import/export compatibility
- [x] Changed UI interaction, layout and accessible-name checks
- [x] Real pinned HUD resource semantics and manifest/live-byte integrity
- [ ] Signed private candidate and updater upgrade from public 0.1.5
- [ ] Startup, app-data preservation and no-repeat-update checks
- [ ] Maintenance and forward-port PRs with passing checks
- [x] Matching four version files, Cargo lockfile and 0.1.6 changelog section
- [ ] TF2 gameplay rendering for changed HUD includes and independent crosshairs
- [ ] Windows WebView2/NVDA and Linux WebKit/Orca announced names

Local final Windows results: 769 native tests passed; 16 opt-in fixture/network
tests are excluded from the ordinary suite. The separate pinned-HUD gate passes
four full option-matrix tests, one declared-font test and the three-package
installation/update probe. Workspace Clippy denies warnings and formatting
passes. Frontend: 542 desktop tests, 140 cfglint tests and 21 release-script
tests pass (three Linux-only script checks skip locally); Biome, TypeScript and
production build pass. The normal Vite large-chunk advisory remains.

The actual public 0.1.5 exporter generated the compatibility ZIP; candidate
import/export/import preserved bytes, hashes, metadata and active-profile state.
See [machine-readable evidence](audits/2026-09-18-0.1.6/public-profile-compatibility.json).

Maintenance [PR #50](https://github.com/rndaom/execs/pull/50) incorporates PR #49.
Forward-port [PR #51](https://github.com/rndaom/execs/pull/51) preserves main's
0.2.0 feature work and passes 774 local Windows native tests plus Clippy.
Private candidate [run 35353749221](https://github.com/rndaom/execs/actions/runs/35353749221)
builds product commit `c001e96`; later preparation commits change documentation
only. Its release workflow must leave publication skipped.

## Retail verification limitation

One attempted disposable `-game` smoke exposed that TF2 still writes Steam
Cloud. The test stopped immediately after the isolation check failed. The exact
original local and remote configuration bytes were restored and verified;
all 369 protected files and captured Source registry settings match the
pre-run state. No subsequent retail runs were made. The
[incident and recovery evidence](audits/2026-09-18-0.1.6/retail-hud-smoke.md)
records the failed gate. A future gameplay check must establish Steam Cloud
isolation independently; bootstrap/font loading is not visual acceptance.

Release tag, publication, public issue closure and milestone completion remain
pending the owner's later release authorization. Any unavailable real-game or
platform validation is recorded explicitly; CI is not a claim of live rendering.
