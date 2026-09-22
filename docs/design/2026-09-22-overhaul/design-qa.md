# Foundry integrated design and implementation review

September 22, 2026. **Implemented development candidate; browser QA passed within the evidence below. Native release qualification remains open.** Foundry is the selected and only product direction. No version bump, release tag or publication is authorized by this work.

The product implementation is committed as `7c78fbed1907dceb37bf348596fca48a8f654e66` on `rndaom/foundry-overhaul`, building on `e1fecdaaf4de2c7257eb2dbe875ac45f22ee4dcc` and the shipped 0.1.8 Mods foundation. The original 67 captures/66 accepted screenshots and 15 generated boards remain the dated design exploration. Current implementation captures are under `implementation/`; reference comparisons use all five `options/01-foundry` boards.

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

Final local checks on Windows:

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

Logs: [frontend tests](implementation/verification/frontend-tests-windows.txt), [production build](implementation/verification/frontend-build.txt), [Rust workspace](implementation/verification/workspace-tests-windows.txt), [Clippy](implementation/verification/workspace-clippy-windows.txt), [pinned HUD corpus](implementation/hud/pinned-huds-windows.txt). Scoped test totals overlap the integrated suites and are not additional counts. The six pinned-corpus checks explicitly exercise tests ignored by the default run; its reported 16 ignores remain accurate as run. Remote Linux results must be recorded separately with their exact candidate identity.

## Remaining qualification

The combined 0.2.0 milestone retains all 14 selected items In Progress; 25 optional candidates remain unselected. RND-251's packaged Windows/Linux matrix remains open. Native no-console startup dialogs, real media/file pickers, Steam-closed launch writes, update installation, Windows viewmodel compilation and paired in-game PresentMon measurements have not been established by this browser pass. RND-325 polling changes do not establish the cause or resolution of the reported frame stalls. [RND-290 evidence](research/rnd-290-startup-error.md) and [RND-324 engine research](research/rnd-324-preload-startup.md) state the exact limits. No retail TF2 process was launched and no player Cloud or customization files were used as a test sandbox.
