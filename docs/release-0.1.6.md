# 0.1.6 release preparation

Status: all 14 issues implemented and all required candidate acceptance gates
passed, including live HUD rendering and native screen-reader speech. The owner
has authorized release, and the candidate is ready for final integration and
tagging. Publication and its public-download verification are still pending.
Public latest remains 0.1.5 until the tagged workflow publishes successfully.

## Scope and baseline

The September 18 owner request covers all 14 issues in Linear's 0.1.6 milestone.
The candidate starts at public `v0.1.5` (`9976464`) on
`rndaom/release-0.1.6`, targeting maintenance `rndaom/release-0.1`.
The creator-import work from PR #49 and the Windows long-path fix are integrated
into this candidate. Unrelated 0.2.0 work stays on main. The milestone explicitly
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
| RND-293 | Clip/source/slot accessible names, stable duplicate ordinals and keyboard focus are tested. Browser layout checked at 1200×800 and 960×640; Windows WebView2/NVDA and Linux WebKit/Orca actual speech passes. |
| RND-201 | Creator ZIP review uses a single-use exact-byte token; root/lock/hash are rechecked. `user.scr` remains opaque and survives import/switch/export. Public native exports remain compatible. |
| RND-303 | Both native Windows move endpoints support extended paths. Actual HypnotizeHUD install/update passes with local long-path policy disabled. |
| RND-304 | ZIP/7z/folder extraction and ownership share a case-insensitive junk policy. Actual kinhud and m0re Rockz install/update preserve retained payload hashes. |
| RND-305 | Legacy single-byte and BOM-marked UTF-16 edits preserve unchanged spans. Full default/alternate rayshud matrix passes, including non-ASCII comments. |
| RND-306 | Validated file/directory choices restore deselected variants, reject collisions atomically and preserve bytes; actual budhud choices round-trip. |
| RND-307 | Canonical and legacy HypnotizeHUD identities work; all six checkbox include pairs pass both states against the pinned package and their live rendering checks. |
| RND-308 | Incompatible m0rehud options are unavailable with guidance. Duplicate identities fail except exact verified pinned-data adaptations; saved options are retained/migrated. |
| RND-309 | Unsupported log-based controls are disabled with guidance and reject changed IPC values. Full supported FlawHUD matrix passes without creating unused snippet files. |
| RND-310 | Bounded reference/ternary evaluation rejects unresolved expressions before commit. All four actual font templates resolve to declared fonts. |
| RND-311 | Logical included-resource headers are edited inside their validated root; ambiguous roots fail. Existing siblings/includes survive and repeated applies are idempotent. |
| RND-312 | Crosshair 1/2/hitmarker targets retain independent sizes 13/17/23 and outline choices. Emitted resources and live A/B rendering pass, including hitmarker activation from actual damage. |

Detailed source research and reproducible commands are in the
[audit record](audits/2026-09-18-0.1.6/README.md). Unsupported schema controls
are an explicit supported outcome of RND-308/309, not silently successful saves.

## Required release evidence

- [x] All 14 acceptance criteria mapped to implementation and checks/limitations
- [x] Frontend tests, Biome and production build
- [x] Windows Rust formatting, clippy and workspace tests
- [x] GitHub Linux CI and package smoke
- [x] Previous-public profile import/export compatibility
- [x] Changed UI interaction, layout and accessible-name checks
- [x] Real pinned HUD resource semantics and manifest/live-byte integrity
- [x] Signed private candidate and updater upgrade from public 0.1.5
- [x] Startup, app-data preservation and no-repeat-update checks
- [x] Maintenance and forward-port product changes pass CI
- [x] Matching four version files, Cargo lockfile and 0.1.6 changelog section
- [x] TF2 gameplay rendering for changed HUD includes and independent crosshairs
- [x] Windows WebView2/NVDA and Linux WebKit/Orca announced names

[Windows NVDA](audits/2026-09-18-0.1.6/native-a11y/windows.md) and
[Linux Orca](audits/2026-09-18-0.1.6/native-a11y/linux.md) verify actual generated
speech using native WebView engines and the unchanged fixture UI. Playback
remains disabled in fixtures; this evidence verifies announced names, not audio
audition. The [live HUD qualification](audits/2026-09-18-0.1.6/native-hud.md)
records the six HypnotizeHUD controls and kbnhud crosshair/hitmarker A/B checks.
Transparent viewmodels were observed after applying the HUD author's cvars and
reloading the map; this does not establish a universal cause or prerequisite.

Local final Windows results: 769 native tests passed; 16 opt-in fixture/network
tests are excluded from the ordinary suite. The separate pinned-HUD gate passes
four full option-matrix tests, one declared-font test and the three-package
installation/update probe. Workspace Clippy denies warnings and formatting
passes. Frontend: 542 desktop tests, 140 cfglint tests and 21 release-script
tests pass (three Linux-only script checks skip locally); Biome, TypeScript and
production build pass. The normal Vite large-chunk advisory remains.
GitHub Linux passes 778 native tests plus the separately invoked pinned-HUD
gate; GitHub Windows matches the 769-test local suite and passes that gate.
The [HUD browser interaction check](audits/2026-09-18-0.1.6/hud-ui.md)
also verifies keyboard behavior and explicit unavailable-control guidance.

The actual public 0.1.5 exporter generated the compatibility ZIP; candidate
import/export/import preserved bytes, hashes, metadata and active-profile state.
See [machine-readable evidence](audits/2026-09-18-0.1.6/public-profile-compatibility.json).

Maintenance [PR #52](https://github.com/rndaom/execs/pull/52) incorporates PR #49.
Forward-port [PR #53](https://github.com/rndaom/execs/pull/53) preserves main's
0.2.0 feature work and passes 774 local Windows native tests plus Clippy.
Private candidate [run 35353749221](https://github.com/rndaom/execs/actions/runs/35353749221)
builds product commit `c001e96`; later preparation commits change documentation
only, including the merge of maintenance's post-publication 0.1.5 evidence.
The run passed all validation, both package builds, both updater/installer
smokes and release verification. Publication was **skipped**. The separate
[maintenance product CI](https://github.com/rndaom/execs/actions/runs/35353755294)
and [forward-port CI](https://github.com/rndaom/execs/actions/runs/35355011186)
also pass. Both PRs are mergeable and remain drafts pending final integration
and tagging. PR #49 is closed as superseded by #52.

Independent downloads verify Minisign signatures for the Windows NSIS,
Linux AppImage and Debian artifacts, and bind the updater feed to the exact
draft assets. `release-commit.json` names the exact candidate commit and run.
See [candidate-verification.json](audits/2026-09-18-0.1.6/candidate-verification.json),
[Windows package smoke](audits/2026-09-18-0.1.6/windows-package-smoke.json) and
[Linux package smoke](audits/2026-09-18-0.1.6/linux-package-smoke.json).
The draft is not a public prerelease. No `v0.1.6` Git tag exists, and the
public latest release and downloaded public updater feed still name 0.1.5.

## Retail verification and restoration

One attempted disposable `-game` smoke exposed that TF2 still writes Steam
Cloud. The test stopped immediately after the isolation check failed. The exact
original local and remote configuration bytes were restored and verified;
all 369 protected files and captured Source registry settings match the
pre-run state. No further runs used that failed isolation method. The
[incident and recovery evidence](audits/2026-09-18-0.1.6/retail-hud-smoke.md)
preserves that initial failed gate.

The later [live qualification](audits/2026-09-18-0.1.6/native-hud.md) passed with
independently verified Cloud isolation. All 363 freshly protected local files
and the API-read Cloud configuration remained unchanged before restoration.
Afterward, an independent check verified all 369 protected files and the captured
Source registry baseline. TF2 changed `ScreenWindowed` and `ScreenNoBorder` during
runtime despite receiving no video flags; both were restored exactly. The
original enabled Steam Cloud setting was restored. Live rendering evidence,
rather than bootstrap or font loading alone, closes the gameplay gate.

The owner's readiness condition is satisfied. Release integration, tag and
publication remain pending; public issue closure and milestone completion follow
successful publication and independent public-download/updater verification.
