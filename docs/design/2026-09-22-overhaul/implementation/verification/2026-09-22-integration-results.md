# Integration verification — September 22, 2026, 14:07–14:09 UTC

## Scope and environment

One full `pnpm test` attempt and one full `pnpm check` attempt were run after the requested App test-edit settling period. An additional read-only `pnpm exec biome check . --max-diagnostics=100` retrieved diagnostics suppressed by the default limit. No formatter, autofix, pane edit, build, real-game launch, installer action or publication was performed.

The shared checkout was actively changing during the checks. These are observed working-tree results, not final-candidate qualification. Branch: `rndaom/foundry-overhaul`. Base HEAD: `e1fecdaaf4de2c7257eb2dbe875ac45f22ee4dcc`. Node: `v24.14.0`; pnpm: `9.15.9`; host: Windows. The only installed Rust target is `x86_64-pc-windows-msvc`.

## Results

| Check | Result | Evidence |
| --- | --- | --- |
| `pnpm test` | Exit 1. cfglint: 160 passed, 10 files. Desktop: 803 passed, 1 failed, 95 files. | [Complete test log](pnpm-test-20260922-1407.log) |
| Root Node release-script tests | **Not reached**: the root script chains them with `&&` after the failed recursive suite. | Test command and exit in the complete test log. |
| `pnpm check` | Exit 1. 369 files checked; 32 errors, 7 warnings; default reporter omitted 19 diagnostics. No fixes applied. | [Complete check log](pnpm-check-20260922-1407.log) |
| Expanded Biome diagnostics | Exit 1. 370 files checked; 33 errors, 7 warnings. No omitted diagnostics and no fixes applied. Count differs because collaborators changed the tree between observations. | [Expanded diagnostic log](biome-expanded-diagnostics-20260922-1409.log) |

The sole test failure is `MutationDrafts.test.tsx > Comfig saved selections > does not bundle failed module or addon choices into the next write`. Line 343 attempts to click `[data-testid="comfig-modules"] summary`, which the new Comfig layout no longer provides. The core/onboarding owner, `/root/design_research`, acknowledged ownership and is updating navigation through the current UI while preserving the failed-write/draft assertions. No product failure is inferred solely from this obsolete selector.

## Actionable diagnostics by owner

These are handoff assignments, not assertions that the current tree still has every diagnostic. The complete logs preserve the exact observations.

| Owner | Files / category | Action |
| --- | --- | --- |
| `/root/design_research` | `MutationDrafts.test.tsx` | Repair the obsolete Comfig navigation selector and rerun the targeted suite. |
| Parent integration | `App.tsx`, `SettingsHost.tsx`, `useFilesExitGuard.tsx`, `lib/bridge.ts`, `lib/preview-bridge.ts` | Apply file-scoped formatting/import ordering after concurrent edits settle. |
| Parent with Mods/HUD owner | `SettingsHost.tsx:202`, `useExhaustiveDependencies` | The `profileId` dependency deliberately clears the Mods HUD-import prompt across profiles. Preserve that behavior via keyed state or a justified scoped lint treatment; blindly removing the dependency changes behavior. This is an error, not one of the seven warnings. |
| Parent / shell / App settings owners | `AppFooter.tsx`, `LaunchPane.tsx`, `lib/launch-ui.ts`, `lib/launch-ui.test.ts` | Coordinate scoped formatting/import ordering with the current owner. |
| `/root/design_research` | `FinderPanel.tsx`, `OnboardingFrame.tsx` | Formatting observed in expanded diagnostics during active onboarding edits. |
| `/root/profile_management` | `ProfileImportDialog.tsx`, `ReadyPanel.tsx`, `useProfileLibrary.ts` | Formatting/import ordering observed in the initial check; some disappeared by the expanded pass. |
| `/root/foundry_customization` | `crosshair/PngImportField.tsx` | Formatting observed in the initial check; absent from the expanded pass. |
| Parent, design gallery | `gallery.js` | Two `forEach` callbacks implicitly return DOM method results; use block bodies. Remove redundant `"use strict"` and format the file. |
| Parent, design gallery | `index.html` | Explicit submit type for the dialog-form button; semantic grouping; valid initial original-image link; accessible semantics for the labeled, keyboard-scrollable image stage. Preserve keyboard scrolling when resolving tabindex diagnostics. |
| Parent, design gallery | `gallery.css` | Format; review six `!important` warnings, including reduced-motion rules, without weakening reduced-motion behavior. |
| `/root/release_scope` | `combined-release-consolidation.json`, `combined-release-linear-handoff.json`, `planning-status.json`, `research/release-scope-evidence.json` | File-scoped JSON formatting after planning updates settle. |
| Parent, generated concept records | `options/generation-record.json`, `options/manifest.json` | File-scoped JSON formatting. |

## RND-251 prerequisite check

[RND-251](https://linear.app/rndaom/issue/RND-251/run-the-cumulative-windows-and-linux-functional-release-matrix-before) was freshly read before this run and remains **In Progress**. It requires exact-candidate Windows and Linux CI, native browser accessibility/media and 1200×800 / 960×640 coverage, packaged upgrade/update behavior, actual Steam Cloud server evidence, and approved TF2/Casual/preloader verification. This frontend check does not satisfy those runtime gates.

The CI workflow has separate inventory-helper Windows/Linux, frontend, Rust Windows, and Rust Linux jobs. Linux jobs require WebKitGTK 4.1 and related native dependencies. Local Windows-only Rust tooling cannot establish a Linux runtime result. No fresh CI run, installer hash, packaged test, Cloud acknowledgement, TF2 launch, Casual session or PresentMon trace was produced by this task.

Documentation discrepancy for integration: `docs/RELEASE.md` still names **0.1.7+2** as the current public version, while the verified public baseline for this effort is [v0.1.8](https://github.com/rndaom/execs/releases/tag/v0.1.8). The combined plan's target date remains unset/tentative pending implementation and qualification. No release is authorized.

## Log integrity

- `pnpm-test-20260922-1407.log`: SHA-256 `c6365796588fdb7ed97d3a4577478b50e0e24e990632c0ccbbd0bc2c7e9f21cd`
- `pnpm-check-20260922-1407.log`: SHA-256 `82b2fc04494dd7ff46aabea4f46df6b03e5a50a5c56eaab738a344a4720aa7e6`
- `biome-expanded-diagnostics-20260922-1409.log`: SHA-256 `a0c87a3064adf4c58979c4b820a90f8eb6281f5096ec533b7f00db1751072f08`
