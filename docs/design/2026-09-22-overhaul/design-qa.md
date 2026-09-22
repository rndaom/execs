# Foundry integrated design and implementation review

September 22, 2026. **Implemented development candidate; browser QA passed within the evidence below. Native release qualification remains open.** Foundry is the selected and only product direction. No version bump, release tag or publication is authorized by this work.

The product implementation is committed as `7c78fbed1907dceb37bf348596fca48a8f654e66` on `rndaom/foundry-overhaul`, building on `e1fecdaaf4de2c7257eb2dbe875ac45f22ee4dcc` and the shipped 0.1.8 Mods foundation. The original 67 captures/66 accepted screenshots and 15 generated boards remain the dated design exploration. Current implementation captures are under `implementation/`; reference comparisons use all five `options/01-foundry` boards.

## Current draft and native Files checkpoint

Product **31b38b9** fixes complete cfg-path wrapping, keyboard focus when reviewing a pending pane and the close/write timing race. Its integrated local tests and all five CI jobs pass. The [current checkpoint](active-files-follow-up.md) retains eight browser dialog/focus captures. The second active Linux run now passes exact 4,881-byte draft input but fails editor scroll retention after Binds → Files; selection, position and all 12 protected files remain intact. [Native and browser comparisons](implementation/native-scroll-follow-up/README.md) separate that failure from the passing browser route. Native Save/close/restart remains unverified. The independently reviewed [Linux package harness](implementation/package-smoke/development-implementation.md) is ready for its first hosted run. All original acceptance and the no-release scope remain unchanged.

## Earlier follow-up checkpoint — September 22, 2026

The follow-up product changes are committed as **44bc5f4f54ba4d41bd9ddd27342223ae08b971da**. This checkpoint records their bounded verification separately from the earlier CI candidate. The five-job result at **542b3dd20f2847fc90a1a4e990584f03830fcc6d** and all original acceptance remain unchanged; it is not a CI result for these later edits.

| Follow-up | Current evidence and boundary |
| --- | --- |
| Browser reflow and scroll | [Interaction completion](implementation/interaction-completion/design-qa.md) fixes a P2 profile-menu clipping defect at 480×320 CSS pixels and verifies reachable keyboard actions. Browser scroll was Comfig **196 → Launch 0 → Comfig 196**; changing the preview profile reset customization scroll to **0**. These are browser reflow tests, not native zoom or OS scaling proof. |
| Inactive profile library | [Choose profile entry point](implementation/profile-management/inactive-library/verification.md) now opens and focuses the existing menu without activating a profile. Import copy applies even with no active profile. Ten ReadyPanel and 16 related import/preview/first-run tests pass; browser pointer/keyboard, focus/Escape and Cancel checks pass. The rebuilt native CTA/import-copy confirmation passed on the separate F6A0B0DE executable below. |
| Package-smoke fixtures | [Harness and independent core evidence](implementation/package-smoke/README.md) replaces the sentinel with two realistic profiles and settings, using actual v0.1.8 export payloads and authored disposable library structures. Eleven new behavioral fixture tests pass after removal of a source-string assertion. Both old/current Windows cores read and export all 12 references unchanged (**24 comparisons**, four exports); app-data/live fixtures remain unchanged. No installer was run; usable packaged webview and UI import/switch remain unverified. |
| Isolated native Windows | [Native report](implementation/native-windows/README.md) verifies the no-console startup dialog and copied full paths, retained recovery marker, rootless settings, physical keyboard preference control, data-location copy, native picker Cancel, normal close/reopen and a manual update check. This scope used Windows GUI binary **E7BC62505EFC1257ACE629EDECB8640EDAEE3860CA2505DED68038FF00D40FAD**, WebView2 **153.0.4234.48**, and isolated app-data/cache. Native inactive import review/Cancel and deletion passed; [post-delete hashes](implementation/native-windows/metadata/20260922-120750-inactivelibrary-ff33a080/post-delete-integrity.json) show 20→16 files, exactly four target files removed, only the index changed and all 15 remaining files unchanged, with no active profile or recovery remnants. The separate rebuilt **F6A0B0DE2B33E51A2F65D8BBFA25CE5746E07A852A63F60FE4AEC00AA538409F** executable passed native Choose profile/open/focus/Escape/Return and corrected import review/Cancel, with all 20 fixture files unchanged, both profiles inactive and normal exit 0 ([post-cancel integrity](implementation/native-windows/metadata/20260922-123141-inactivelibrary-e497a50a/post-cancel-integrity.json), captures 19–23). No profile was activated or real game/Cloud mutation exercised. |
| Current integrated checks | The full pnpm test run before the final menu geometry change passed **874 desktop tests / 102 files**, **160 cfglint / 10 files** and 33 tooling tests with 3 existing Linux-only skips. After review removed one source-string assertion, all four tooling files reran with **32 passed, 0 failed, 3 skipped**. The final menu correction additionally passed ReadyPanel's **10 tests**, TypeScript and browser geometry/keyboard/banner checks. The final production frontend/native build passed with only the existing Vite chunk advisory. **pnpm check passed all 443 files** after the final native metadata archive, and the final whitespace check passed. |
| Final native menu build | Product commit **44bc5f4** built successfully with no bundle in **3m08**: 23,439,872-byte executable SHA-256 **7D03B4A55499835DDEF908D228842347C60E8D2FD5803732B1DB8C0D8CBA6CA4**. The [actual native menu capture](implementation/native-windows/24-native-final-positioned-menu.jpg) verifies Choose profile → positioned menu with all actions visible at **1200×800** → Escape/focus restoration → normal exit 0. All 20 fixture files, both profile IDs and null active ID were unchanged. This spot check does not repeat E7/F6 scopes; six-profile minimum/narrow coverage remains browser-only. |

**Additional P2 resolved:** six inactive profiles at 960×640 exposed ancestor overflow clipping lower menu actions. The final menu uses its measured summary anchor and viewport bounds. The [completed browser report](implementation/interaction-completion/design-qa.md) verifies six profiles at 960×640, 600×400 and 480×320, keyboard reachability, normal active-header alignment at 1200×800 and the running-game banner offset at 960×640. ReadyPanel's 10 tests, TypeScript and targeted Biome pass. This closes the scoped layout finding; the earlier F6 native chooser result predates this geometry change. The final 7D native spot separately verifies the positioned menu at 1200×800; the six-profile minimum/narrow and banner cases remain browser evidence.

All 14 issues remain **In Progress**; the 25 optional candidates remain unselected and Inventory stays development-only. The complete native/package/Cloud/engine matrix, RND-324's engine criteria and any release remain open. Linear updates are recorded separately; publication remains outside this work.

## What is implemented

The shared shell and every product pane use Foundry's warm dark surfaces, readable typography, restrained copper selection and finite motion. Composition follows the task: configuration rows with previews, genuine catalog cards, paired sound slots, a crosshair design workspace and the persistent Files workbench. Controls, catalog statistics, game assets and operation progress come from actual sources or clearly labeled browser fixtures, never generated concept artwork or invented activity.

The work includes global App settings, safe profile deletion, explicit HUD ownership/import reviews with original-file preservation, profile-owned preloader integration, updater reconciliation, background polling reductions, onboarding changes, and draft protection for explicit build/apply workflows. The current profile format remains readable; new recovery and HUD ownership fields are additive. The offline preload mechanism remains supported and disclosed; map-free initialization and runtime re-entry proof remain unresolved research, not a claimed implementation.

## Visual and interaction evidence

Open the [implementation review gallery](implementation/review.html) to compare 85 accepted captures across 15 pages and flows with the selected Foundry references. The [gallery verification](implementation/review-qa.md) records its asset, layout and viewer checks. The original [three-direction concept gallery](index.html) remains dated design history.

| Surface | Current scoped report |
| --- | --- |
| Comfig, Binds, Gameplay | [Core panes](implementation/core/design-qa.md) |
| Finder, existing setup, new-profile wizard | [Onboarding](implementation/onboarding/design-qa.md) |
| HUD browse, installed controls, replacement and ownership | [HUD](implementation/hud/design-qa.md), [review dialog](implementation/app-settings/design-qa.md) |
| Crosshair, Viewmodels, Sounds | [Customization](implementation/customization/design-qa.md) |
| Mods browse, installed and Casual setup | [Mods](implementation/mods/design-qa.md) |
| Files, App settings transitions, dirty/explicit draft guards | [Shell and Files](implementation/shell-files/design-qa.md), [fresh minimum-size Files correction](implementation/files-diagnostic/diagnostic.md) |
| Launch options and Steam-open guidance | [Launch](implementation/launch/design-qa.md) |
| Profile deletion and ZIP trust/choice | [Profiles](implementation/profile-management/verification.md) |
| Global settings, updater and HUD review | [App settings](implementation/app-settings/design-qa.md) |
| Account-owned, read-only development Inventory | [Inventory](implementation/inventory/design-qa.md) |

Actual screenshots were inspected at 1200×800 and 960×640 across the shell and primary panes; the HUD/App settings detailed passes additionally use 1280×720. Each scoped report identifies accepted images, actual dimensions, fixture limitations and superseded captures. Native-only artwork, dialogs, audio, compiler execution and real Steam writes are not inferred from browser fixtures.

Accepted deviations from generated concepts: real catalog content and options replace invented examples; no fake Files errors or viewer mode; autosave stays for existing small settings while build/install and Files retain explicit actions; Inventory stays account-owned and development-only. The existing Inter/Phosphor identity, Source syntax, supported presets, classes, modules and source credits remain intact.

The final parent review also compared the Comfig and Gameplay desktop captures directly with board 01 and the Files correction with board 03. The two-by-two preset arrangement prioritizes readable descriptions beside the fixed 360px preview; real module controls and addon switches replace the generated board's inaccurate examples. Gameplay labels the genuine static TF2 reference honestly instead of implying a calibrated live FOV simulation. These are intentional functional/readability corrections, not unfinished visual substitutions.

## Findings and closure

- **P1, resolved:** competing HUDs could enter through generic Mods and multi-HUD profile imports. Detection now leads to a specific review, activation requires one chosen root, and originals remain outside the mounted surface. Native fixtures and an independent [integrity review](implementation/profile-management/hud-integrity-review.md) cover legacy journals, stale fingerprints, case collisions, bounds and active cfg drift.
- **P1, resolved:** imported cfg bytes could be reset implicitly when another HUD was chosen. Import now preserves the exact approved bytes; any generated-option reset requires a separate pending ownership review.
- **P1, resolved:** late update checks could alter the installation identity or retain obsolete offers; newest successful completion now controls both UI and native identity, including the resource-close race.
- **P1, resolved:** unfinished explicit drafts lacked a truthful transition action, and late HUD import errors could leak across profiles. Explicit drafts route to their pane; review outcomes cancel generic install feedback, and stale profile errors are suppressed.
- **P2, resolved:** narrow-window Find controls, helper destination paths and expanded HUD review actions clipped. Fresh screenshots verify wrapped paths, the compact Find panel and reachable modal actions. Search-option keyboard focus and Find close state are corrected.
- **P2, resolved:** Inventory density truncated ordinary item names and pagination retained an inconvenient scroll offset. Its grid now has readable density; page changes reveal the first slot without changing account ownership or sort behavior.

**final result: passed** for the inspected browser visual and interaction scope. No unresolved P0/P1 finding remains in that scope. Native platform and engine qualification remains open as detailed below.

## Integrated checks

Local Windows checks at the original product handoff:

| Check | Result |
| --- | --- |
| `pnpm test` | 863 desktop tests + 160 cfglint tests + 21 release/tooling tests passed; 3 platform-specific tooling tests skipped. |
| `pnpm check` | Passed, 375 files at the code handoff; gallery additions receive their own final check. |
| `pnpm build` | TypeScript and production build passed; existing large-chunk advisory remains. |
| `cargo fmt --check` | Passed. |
| Workspace `cargo clippy --all-targets -- -D warnings` | Passed. |
| Workspace `cargo test --locked` | 859 passed, 16 explicit ignores, no failures. Includes 121 native app tests and 738 core/integration tests. |
| Pinned real HUD corpus | 6 explicit tests passed: four schema/option tests, one font-template test and installation/update byte preservation across three genuine catalog packages, including long Windows paths. |
| Inventory helper | 7 fixture tests plus formatting and Clippy passed in the scoped polling work. |
| `git diff --check` | Passed. |

Logs: [frontend tests](implementation/verification/frontend-tests-windows.txt), [production build](implementation/verification/frontend-build.txt), [Rust workspace](implementation/verification/workspace-tests-windows.txt), [Clippy](implementation/verification/workspace-clippy-windows.txt), [pinned HUD corpus](implementation/hud/pinned-huds-windows.txt). Scoped test totals overlap the integrated suites and are not additional counts. The six pinned-corpus checks explicitly exercise tests ignored by the default run; its reported 16 ignores remain accurate as run. The exact Windows/Linux CI results and candidate are recorded below; those reruns remain separate from these local counts.

## Remote CI and review checkpoint

[Draft PR #60](https://github.com/rndaom/execs/pull/60) contains the pushed Foundry branch. **CI candidate: `542b3dd20f2847fc90a1a4e990584f03830fcc6d`**, which adds the design/evidence documentation to product commit `7c78fbed1907dceb37bf348596fca48a8f654e66`. The [implementation review gallery](implementation/review.html) is accepted: **85 captures across 15 pages and flows**, paired with the five selected Foundry boards. Its [verification report](implementation/review-qa.md) records actual asset, viewport and viewer checks.

**[CI run 35744828442](https://github.com/rndaom/execs/actions/runs/35744828442) completed successfully: all five jobs passed on that exact head.** The last job, Windows Rust, completed at **September 22, 2026, 15:22:02 UTC**. The later documentation update records these results; it does not claim a different code revision was tested.

| Job / check | Verified result |
| --- | --- |
| [rust-linux](https://github.com/rndaom/execs/actions/runs/35744828442/job/106803597602) | Success. Default workspace: **867 passed, 0 failed, 16 ignored** (120 app + 722 core + 11 absorb + 3 HUD integrity + 11 pack identity). |
| [rust-windows](https://github.com/rndaom/execs/actions/runs/35744828442/job/106803597998) | Success. Default workspace: **859 passed, 0 failed, 16 ignored** (121 app + 709 core + 15 absorb + 3 HUD integrity + 11 pack identity). |
| Pinned HUD corpus, separate step on each OS | **6 passed, 0 failed on Linux and 6 passed, 0 failed on Windows**: each runs 4 schema cases + 1 font-template case + 1 catalog installation/update case. Each default workspace's 16 ignored count remains accurate as run. |
| Rust static/dependency gates | Linux fmt, both Rust Clippy jobs and Linux advisory disposition passed. Local Windows fmt also passed. |
| [frontend](https://github.com/rndaom/execs/actions/runs/35744828442/job/106803598005) | Success: unit tests, lint/format and production frontend build. |
| [inventory-probe, Linux](https://github.com/rndaom/execs/actions/runs/35744828442/job/106803597835) and [Windows](https://github.com/rndaom/execs/actions/runs/35744828442/job/106803598196) | Both jobs succeeded. |

Evidence: complete [Linux CI transcript](implementation/verification/rust-linux-ci.txt) and [Windows CI transcript](implementation/verification/rust-windows-ci.txt), with ANSI controls removed, CRLF/CRCRLF normalized to LF and trailing spaces trimmed. Exact remote job links remain above. Local/scoped results overlap these runs and are not additional unique test counts.

This closes the automated CI gate for the recorded candidate. It does **not** establish native Windows/WebKitGTK desktop behavior, native file/media dialogs, packaged prior-version upgrades, Cloud acknowledgement or retail TF2/Casual/PresentMon results. Those requirements and RND-324's engine criteria remain open. The separate actual public v0.1.8 exporter/current-importer fixture run also passed within the Windows library-level limits below. All 14 issues remain In Progress; no merge, version bump, tag or publication is recorded.

### Actual public v0.1.8 export compatibility

**Passed on Windows at the core-library level: four cases, 32 payload comparisons, eight retained archive hashes verified.** The actual public-tag exporter at `v0.1.8` / `85aaf6bc0dd28f43351d4cb5cdb62502737688d5` produced each source ZIP. The current importer and re-exporter at `542b3dd20f2847fc90a1a4e990584f03830fcc6d` reviewed, imported and re-exported it. The harness ran offline with the tagged dependency lock; no product code changed.

| Case | Payloads | Result |
| --- | ---: | --- |
| No HUD | 4 | Exact import/re-export bytes preserved; no ownership review pending. |
| Single HUD | 8 | HUD record, options, cfg and payloads preserved; no ownership review pending. |
| Multiple HUDs, keep owner | 10 | Ambiguous import refused without a choice; explicit original-owner choice preserved both HUDs and cfg bytes. |
| Multiple HUDs, change owner | 10 | Ambiguous import refused without a choice; changed choice preserved all original cfg/HUD bytes and requires the separate pending ownership-reset review before activation. |

The old source library, current active profile id and manifest, and every synthetic live-root file remained unchanged. Imported preloader selections defaulted to empty. All source and current re-export ZIP hashes were independently rechecked from the retained files. [Final compatibility report](implementation/profile-management/compatibility-v018/README.md), [machine-readable results](implementation/profile-management/compatibility-v018/results.json) and [executed harness](implementation/profile-management/compatibility-v018/harness/src/main.rs) retain the revisions, exact archives, manifests, isolation and assertions.

This is a bounded **Windows library-level compatibility pass for these four cases**. It does not qualify packaged installer/updater migration, native GUI, Linux compatibility execution, exhaustive historical profiles, real Steam Cloud, HUD rendering or live TF2/Casual/performance. The pending HUD ownership follow-up was asserted, not activated. Those remaining gates and all issue states are unchanged.

## Remaining qualification

The combined 0.2.0 milestone retains all 14 selected items In Progress; 25 optional candidates remain unselected. RND-251's packaged Windows/Linux matrix remains open. The separate local Windows evidence above covers the startup dialog, rootless preferences, picker cancellation and inactive-library review/deletion within its stated isolation. It does not establish signed installer behavior, Linux native dialogs, active-profile/live writes, full media/file-picker coverage, Steam-closed launch writes, update installation, Windows viewmodel compilation or paired in-game PresentMon measurements. RND-325 polling changes do not establish the cause or resolution of the reported frame stalls. [RND-290 evidence](research/rnd-290-startup-error.md) and [RND-324 engine research](research/rnd-324-preload-startup.md) state the exact limits. No retail TF2 process was launched and no player Cloud or customization files were used as a test sandbox.
