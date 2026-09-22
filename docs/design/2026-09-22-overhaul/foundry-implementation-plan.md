# Foundry implementation plan

**September 22, 2026 — Foundry selected; implementation authorized; no release.**

The owner chose **Foundry only** and authorized the whole application and all selected features to be implemented, tested and visually verified with multiple agents. The prior visual-selection gate is satisfied. The task ends with an implemented, reviewable and evidence-backed development candidate; it does not authorize a version bump, release tag or publication. No issue is made Done by selecting a visual direction or writing this plan.

The scope is **all 14 selected existing issues plus the whole-app overhaul tracked within RND-208**, not 15 issue records. The 25 optional `execs-candidate` items remain separate. Inventory remains a read-only, account-owned development pane, excluded from production. There is no committed delivery date.

[Linear project](https://linear.app/rndaom/project/execs-a89f9a30e95c) · [Existing combined plan](https://linear.app/rndaom/document/020-combined-release-and-whole-application-overhaul-1fe7c93751c6) · [Combined local scope](combined-release-plan.md) · [Machine-readable source and status](planning-status.json).

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

## Baseline and evidence rules

Public **v0.1.8**, published September 21, 2026 at 02:26:18 UTC, commit `85aaf6bc0dd28f43351d4cb5cdb62502737688d5`, remains the last verified public compatibility baseline. The original audit ran on inventory development `9ac45a3847b65da087661b1c08cf719fc6b9df11` plus a separate shipped Mods capture. The parent has now integrated the 0.1.8 forward-port on `rndaom/foundry-overhaul` at `e1fecdaaf4de2c7257eb2dbe875ac45f22ee4dcc`. Critical missing-source observations below were rechecked after that integration. The product implementation is now committed locally at `7c78fbed1907dceb37bf348596fca48a8f654e66`. The current verification checkpoint records its integrated Windows and scoped browser passes; native/platform qualification remains open. Initial source assessments below are retained as history.

Authoritative Linear descriptions were read directly for all 14 selected records. The current implementation ownership/state readback at 14:24 UTC confirms all 14 In Progress; the earlier 13:32 planning snapshot remains historical. Exact descriptions, issue UUIDs, acceptance extracts and original states are preserved in `planning-status.json`. Old issue audit prose can describe already-repaired code: inspect the current entry point and retain working foundations. At the initial source audit, RND-202 and RND-215 already had partial foundations. Their completed code integration and current proof limits appear below.

The initial audit has 67 captures, 66 accepted, mainly at **1280×720**. Its source and limitations are in [audit-coverage.md](audit-coverage.md). It does not pass the required **1200×800** default and **960×640** minimum candidate checks or native runtime requirements. Prior unit/CI/package evidence is useful within its recorded scope and never promoted to an unperformed current-candidate result.

Every verification entry should identify candidate commit/build, platform/runtime, fixture or real input, action, expected/observed result, and evidence path. Code written, tests passed, browser visual match, native runtime qualification and release eligibility are separate states. Keep unrun or unavailable rows open with a concrete explanation. Tests that only restate CSS are not required; interaction, transaction and regression behavior needs meaningful evidence.

## Selected Foundry reference and corrections

Use all five boards together:

| Board | Implementation role |
| --- | --- |
| [01-core.png](options/01-foundry/01-core.png) | Comfig, Binds, Gameplay, HUD browsing and shared shell. |
| [02-customization.png](options/01-foundry/02-customization.png) | Crosshair, installed HUD controls, Viewmodels and Sounds. |
| [03-workspaces.png](options/01-foundry/03-workspaces.png) | Mods Browse/Installed/Casual, Files workbench and Launch. |
| [04-profiles.png](options/01-foundry/04-profiles.png) | Profiles, import trust, onboarding and app settings. |
| [05-states.png](options/01-foundry/05-states.png) | Locked/deferred/error/destructive states and clearly separate development Inventory. |

Foundry uses warm near-black surfaces, warm readable ink, restrained orange emphasis, hairlines, compact controls and task-specific composition. Central tokens/shared controls belong to the shared-shell owner; pane agents must use the same system. The implemented shared system uses background `#151310`, panel `#211e19`, raised `#2c2821`, ink `#f0e9db`, muted `#bcb3a3`, accent `#d98449`, a 180px sidebar, 1160px content maximum, 24px page padding and 28px section gaps. The shared-system report records measured contrast ratios; each pane retains a task-specific composition.

The source-backed reconciliation in [concept-review.md](concept-review.md) is required:

- Preserve all real presets/addons, module categories, numeric ranges and nine-class/group controls; generated labels/checkmarks are not the product catalog.
- Preserve Binds and small-setting autosave. Crosshair tint/display size may autosave, but mounted mode/assets keep explicit actions. **Save to library** and **Build pack** are distinct. Keep supported Viewmodel build/import, Mods **Apply mods**, explicit HUD actions and Files **Save/Discard**.
- Correct wrong/duplicate navigation highlights, tiny secondary copy, duplicate Hit/Kill assignment actions, garbled Restore text and the unsupported Files viewer/editor mode.
- Do not ship generated game/HUD/weapon/Inventory preview art, fabricated GameBanana authors/stars/downloads, sample import findings, invented lint errors or calibrated-looking FOV outcomes. Use authorized credited sources and actual data/metadata, including missing-statistics coverage.
- `r_drawtracers_firstperson` is a real supported command; the concept warning is false. Launch token editing and the explicit **Write to Steam** action are parent-designed enhancements within the owner's authorized gap-filling scope. They must preserve the same native save/check/copy contract: profile-owned options, prohibited-token checks, no Steam configuration write while Steam runs, and truthful copy/pending/saved feedback. The Launch reviewer verified its browser/helper/component paths in `implementation/launch/design-qa.md`; native Steam writes remain open and this does not select or complete the separate RND-231 candidate.
- Profile deletion and app settings are selected functional additions (RND-213/214), not merely visual mockups. Their exact backend effects and persistence must be designed and tested. Finder/root confirmation precedes writes; exact-byte import trust and real progress remain authoritative.
- Inventory stays view-only, Steam-account-owned and development-only; concept identities/effects are illustrative. Do not add live rearrangement or infer release shipment.

Motion follows [motion-spec.md](research/motion-spec.md): immediate input/value/focus feedback, about 150ms color/opacity and 220ms local movement, bounded menu/dialog/disclosure transitions, no perpetual decorative animation or queued hidden-pane effects. Follow OS reduction; app Reduce may reduce further, never override OS preference upward. Preserve 700ms autosave debounce, delayed Saving feedback and real operation progress. Measure actual interaction/background cost; images cannot establish motion quality.

## Work allocation and summary

All 14 selected issues are now **In Progress** and have bounded owners. This reflects authorized work underway, not Done or release qualification. The 25 optional candidates, published issues, assignees, labels and milestone membership are unchanged. The status readback and exact source acceptance remain in planning-status.json. Initial source findings are retained below for provenance; current implementation/proof notes supersede their older missing-work assessment.

| Issue | Current Linear state | Current implementation | Code owner | Verification |
| --- | --- | --- | --- | --- |
| [RND-246](https://linear.app/rndaom/issue/RND-246/clear-stale-update-offers-when-a-later-check-reports-no-update) | In Progress | authoritative updater reconciliation implemented; Windows integration passed | /root/app_settings | 32 shared settings/updater tests; E7BC native manual check passed; signed install/failure/stale-offer runtime remains open |
| [RND-290](https://linear.app/rndaom/issue/RND-290/show-an-actionable-startup-error-when-durable-maintenance-preflight) | In Progress | native startup reporting implemented; Windows fixtures passed | /root | 15 startup/content fixtures plus E7BC no-console native dialog, full copy and retained marker passed; package/Linux dialog matrix open |
| [RND-291](https://linear.app/rndaom/issue/RND-291/keep-each-settings-pane-at-a-predictable-scroll-position) | In Progress | pane scroll retention implemented; scoped browser and integration checks passed | /root/surface_inventory | 6 scroll tests plus browser Comfig 196→Launch 0→Comfig 196 and profile reset 0; native scroll matrix open |
| [RND-292](https://linear.app/rndaom/issue/RND-292/make-meaningful-helper-and-status-text-meet-minimum-contrast) | In Progress | Foundry contrast tokens implemented; accepted browser scope reviewed | /root/surface_inventory | Calculated token ratios and accepted browser scope; native pending |
| [RND-294](https://linear.app/rndaom/issue/RND-294/correct-installer-platform-and-casual-compatibility-claims-in-player) | In Progress | documentation and promo corrections integrated in product commit | /root/release_scope | Docs/media checked and committed; public media remains explicitly earlier release |
| [RND-325](https://linear.app/rndaom/issue/RND-325/audit-execs-windows-polling-for-periodic-tf2-frame-stalls) | In Progress | source audit and bounded polling reductions implemented; runtime benchmark pending | /root/release_scope | 22 frontend + 7 helper tests; native trace pending |
| [RND-251](https://linear.app/rndaom/issue/RND-251/run-the-cumulative-windows-and-linux-functional-release-matrix-before) | In Progress | Windows/Linux automated CI passed; native and package matrix open | /root | Recorded five-job CI, old-profile/core fixtures and bounded E7BC/F6 native scopes passed; full native/package/engine matrix open |
| [RND-213](https://linear.app/rndaom/issue/RND-213/delete-profiles-safely-from-the-profile-menu) | In Progress | safe profile deletion implemented; Windows fixtures and integration passed | /root/profile_management | Disposable fixtures plus E7BC native inactive deletion/Cancel passed with exact retained hashes; active/last-profile/package matrix open |
| [RND-214](https://linear.app/rndaom/issue/RND-214/add-app-settings-for-updates-motion-install-location-and-support) | In Progress | global App settings implemented; Windows integration passed | /root/app_settings | 13 core + 32 shared frontend tests; E7BC native rootless preferences/keyboard/copy/picker Cancel/reopen passed; full native/package scope open |
| [RND-202](https://linear.app/rndaom/issue/RND-202/replace-shared-preloader-selections-with-the-target-profile-during) | In Progress | profile-owned native preloader integration implemented; Windows fixtures passed | /root/profile_management | 5 orchestration + 78 core fixtures and Windows integration passed |
| [RND-274](https://linear.app/rndaom/issue/RND-274/switch-local-only-particle-profiles-without-requiring-the-default-mod) | In Progress | local-only library predicate implemented; Windows fixtures passed | /root/profile_management | Shared orchestration/preloader fixtures and Windows integration passed |
| [RND-215](https://linear.app/rndaom/issue/RND-215/enforce-one-hud-per-profile-across-replacement-import-switch-and) | In Progress | HUD ownership and exact-byte boundaries implemented; Windows and Linux fixtures passed | /root/foundry_hud | 69 frontend, recorded CI/corpus and isolated native HUD import review/Cancel pass; native activation/rendering/package matrix open |
| [RND-324](https://linear.app/rndaom/issue/RND-324/make-the-execs-tf2-preload-hook-startup-safe) | In Progress | partial startup improvement; engine acceptance unresolved | /root/foundry_mods | Partial; 19 viewmodel fixtures; native engine gaps |
| [RND-208](https://linear.app/rndaom/issue/RND-208/validate-and-publish-the-combined-020-overhaul-and-profile-management) | In Progress | Foundry candidate and accepted review gallery committed; five-job CI passed | /root with bounded pane agents | Committed candidate, accepted gallery, five-job CI and bounded 0.1.8 compatibility pass; no release |

Shared ownership: /root coordinates native startup, Files, App/bridge integration and qualification; /root/surface_inventory owns shell/tokens/scroll/contrast and development Inventory; /root/design_research owns core panes and onboarding; /root/foundry_customization owns customization panes and Launch review. Other bounded domains are named in the table.

RND-208 also owns the overhaul. The quota fallback remains valid; no new issue was created. Scope and acceptance are preserved.

## Whole-application overhaul — required coverage

Overhaul coordination: **/root**, shared shell: **/root/surface_inventory**, with the bounded pane owners above. Implementation: **underway**. Scoped verification: **recorded below**. Integrated/native qualification: **pending**. This matrix is binding for implementation and qualification; the selected boards are visual references, not an exhaustive state specification. Reusable patterns can share components, but every materially different pane/group/state must remain usable.

| Surface | Required Foundry implementation and verification coverage |
| --- | --- |
| Shell and navigation | Active profile/pane, wide and compact navigation, long-page scroll, profile menu open, hover/focus/selected states, install context, launch/locked state, footer and support. |
| Finder and onboarding | No/one/multiple install results, selection and Confirm, invalid/missing path/error, existing-setup capture, unused-install wizard, new profile Current setup/Fresh TF2, preset/addon selections and busy/locked behavior. |
| Profiles and imports | Active/inactive list, save current, export feedback, exact-byte ZIP review with findings expanded, trust/cancel, real progress/completion, switch stages, absorb Update/Restore/Keep, unsafe-folder review and recovery. Include active/inactive/last-profile deletion flows for RND-213. |
| Comfig | Selected/default/None preset, all presets, module groups/search/no result, changed module, official addons, package install/update/import, locked/deferred differences. |
| Binds | Action groups, bound/unbound rows, recording/listening, keyboard/mouse/scroll input, unsupported input/Escape, deferred draft and save outcome. |
| Gameplay | Main FOV/viewmodel controls, changed values, Advanced expanded, switches with prerequisites, transparency’s explicit addon action and running-game draft state. |
| HUD | Stock and installed/updated states, six-entry catalog/paging/jump, search/empty/missing artwork, each ranking with coverage, image lightbox, import modal, options including different schema-control types, unsupported/invalid controls, cached/partial/error/retry and reviewed HUD replacement. |
| Crosshair | In-game/default/stock/custom modes, actual-size scene and tint, color popup/validation, built-in/My designs/Community/PNG sources, designer styles, empty/search/import error, per-weapon popup and all nine class groups, pending build/discard/remove and locked state. |
| Viewmodels | All nine classes and their different group lists, shown/hidden group preview, Full/Weapon, Hide/Show all, no/imported/built pack, draft/build status, import/replace/remove and Windows/Linux capability feedback. |
| Sounds | Hit/Kill slots, enabled/disabled and assigned states, stock/custom/boost, library sources/sort/search/empty, advanced pitch/repeat controls, playing/stopped/error, WAV import/removal, pending/deferred saves. Use real audio evidence for behavior claims. |
| Mods — shipped 0.1.8 | Browse default, Installed and Casual setup tasks, truthful GameBanana filter/sort/result scope, top/bottom paging, source-rich card/detail/install/progress/retry states, Import mod choices, installed/remove confirmation, library/profile particle picks, Apply/Restore, skipped report and maintenance/recovery states. |
| Files | Stable workbench and file list, editable/provided/read-only/dirty/multiple drafts, file/editor context menus, Find/replace/completion, New cfg/Save as/collision, Problems/Help/Guides/Snippets, source conflict/compare, analysis unavailable/retry, explicit Save and transition guards. |
| Launch | Options draft, permitted/forbidden explanation, copy outcome, Steam-open/closed/pending state, saved state and game-running retention. Preserve the actual backend contract. |
| App settings | RND-214 entry distinct from gameplay panes, usable before profiles; startup updates, Follow system/Reduce motion, confirmed install change, copy locations, diagnostics/support/credits, persistence/error/locked behavior. |
| Shared operational states | Loading/empty/error/retry/partial-cache; selected vs focused; saving/success/persistent failure/deferred draft; Save/Discard/Cancel and route-to-pane guards; update available/checking/no update/downloading/installing/failure; release notes; actionable native startup error; real progress and recovery. |
| Inventory — development only | Account/persona, backpack pages, selected detail and metadata, query/quality/sort/no result, ordinary/named/kit/war-paint items, stale/refresh/error/retry. Clearly label preview artwork/data and the absence of live rearrangement or release assignment. |

Capture the actual Foundry implementation at both required sizes, with useful first-viewport content and complete action access. Check long lists, long names, zoom/reflow, keyboard-only operation, focus return/containment, semantic names/status announcements, disabled explanations and contrast on computed surfaces. Match layout intent while recording deliberate source-backed differences from generated boards.

## Integration order and acceptance handling

1. Preserve the integrated public 0.1.8 fixes and shipped Mods tasks; qualify their interaction with minor-track profile-owned preloaders.
2. Build shared Foundry shell/tokens/controls, app Settings and global motion/update preferences; resolve updater freshness, startup errors, scroll and contrast.
3. Implement profile deletion, remaining preloader/HUD transaction boundaries and startup-hook changes in separate owned backend domains. Keep profile/preview bridge parity.
4. Adapt every pane and global state to Foundry without reducing control coverage or weakening autosave, source-owned feedback, drafts, locks or explicit destructive/heavy actions.
5. Run the appropriate unit/component/core checks and integrated frontend/Rust/Windows/Linux checks. Inspect every pane/state at both sizes; resolve real visual and behavioral failures.
6. Perform available native/package/live qualification within the existing authorization and containment rules. Keep unavailable or release-only evidence open; no product version/tag/publication step is part of this task.

The issue excerpts below are copied from current Linear descriptions. Historical October 1/three-feature/old-patch references are superseded by the combined scope and Foundry selection; acceptance itself is preserved. RND-208's future tag/publish steps are retained for later release planning and explicitly excluded now.

## RND-246 — Clear stale update offers when a later check reports no update

Source: [authoritative Linear issue](https://linear.app/rndaom/issue/RND-246/clear-stale-update-offers-when-a-later-check-reports-no-update). UUID: `b3de698f-58a8-4dbf-920f-6afab295c96f`. Current Linear state: **In Progress**. Code owner: **/root/app_settings**. Original acceptance/source snapshot is preserved in planning-status.json. Current implementation: **authoritative updater reconciliation implemented; Windows integration passed**.

**Current implementation and proof:** Authoritative update checks reconcile null/newer/dismissed/failed offers, request order, Strict Mode and install/check guards. The parent fixed the newly exposed bridge resource-close identity race by publishing the version after cleanup. Final scoped App settings/updater run passed 32 tests: pane 7, preferences 5, updater 11, bridge 7 and footer 2. The delayed-resource-close and native-close readiness regressions pass; scoped TypeScript and Biome pass. Included in the passing 863-test desktop integration; actual update installation remains unperformed.

**Follow-up native proof:** E7BC6250 native WebView2 manual checking reached the expected up-to-date result for local 0.2.0 against public 0.1.8. This proves that check/result path only; no offer replacement, download or installation occurred. [Native evidence](implementation/native-windows/README.md).

**Remaining implementation/qualification:** Actual signed Windows/Linux updater discovery/install/failure/stalled-payload/dirty-close behavior and stale-offer reconciliation in native runtime. The bounded Windows manual no-update check is passed.

**Current evidence:** [implementation/app-settings/design-qa.md](implementation/app-settings/design-qa.md).

The source assessment and acceptance below retain the initial planning context; the current note above is authoritative for progress.

**Initial source foundation:** The launch/manual update hook and signed native installation path exist.

**Required remaining work:** A null manual result only changes feedback; it leaves the available offer. Add authoritative request ordering shared by launch/manual checks, reconciliation of availability/dismissal/feedback, and race/failure regressions.

Source evidence: [`apps/desktop/src/hooks/useAppUpdate.ts:41`](G:/Projects/execs/apps/desktop/src/hooks/useAppUpdate.ts:41); [`apps/desktop/src/hooks/useAppUpdate.ts:67`](G:/Projects/execs/apps/desktop/src/hooks/useAppUpdate.ts:67); [`apps/desktop/src/lib/bridge.ts:1`](G:/Projects/execs/apps/desktop/src/lib/bridge.ts:1). Line numbers describe the recorded baseline and may move during parallel implementation.

**Exact issue acceptance** (Linear link markup normalized; historical version/date references do not override the current authorization):

Reconcile available/dismissed/check feedback from the latest authoritative check and prevent old concurrent checks restoring stale offers. Test offer→none, newer offer, failure, dismissed offer, out-of-order launch/manual requests. Retain signed Rust-side install verification.

**Implementation verification:**

- Controlled React lifecycle: offer→none, newer offer, failure, dismissal, out-of-order launch/manual requests.
- Native signed install behavior remains intact; test updater UI states in Foundry.

**Native/platform limits:**

- Actual candidate updater lifecycle and packaged Windows/Linux verification remain separate from mocked hook tests.

## RND-290 — Show an actionable startup error when durable maintenance preflight fails

Source: [authoritative Linear issue](https://linear.app/rndaom/issue/RND-290/show-an-actionable-startup-error-when-durable-maintenance-preflight). UUID: `a512eeb9-45f1-4adc-aa96-1fbd26a75c1c`. Current Linear state: **In Progress**. Code owner: **/root**. Original acceptance/source snapshot is preserved in planning-status.json. Current implementation: **native startup reporting implemented; Windows fixtures passed**.

**Current implementation and proof:** The working tree adds a native pre-webview startup error with full version, state location, preservation statement and safe report/copy guidance; recovery markers remain intact. Thirteen startup and two diagnostic-content fixtures pass on Windows, including exact marker preservation and unreadable-marker handling. The full Windows workspace passes. A packaged native dialog was not exercised. Linux CI at 542b3dd20f2847fc90a1a4e990584f03830fcc6d passed 867 workspace tests with 16 ignored; its separate pinned HUD step passed 6 tests. These are platform fixture results, not desktop/live qualification. The final Windows CI job also passed 859 workspace tests with 16 ignored and 6 separate pinned HUD checks; all five CI jobs succeeded on that same head.

**Follow-up native proof:** The E7BC6250 Windows GUI executable showed the native pre-WebView2 error with no console; UIA exposed its message and Ctrl+C copied the complete state paths. OK closed normally and the invalid recovery marker hash stayed unchanged. This is an actual isolated local native pass, not a signed installer or Linux result. [Native evidence](implementation/native-windows/README.md).

**Remaining implementation/qualification:** Signed-package Windows startup/dialog cases, the remaining isolated failure variants and Linux native dialog/copy/dismissal behavior. The local E7BC no-console corrupt-marker dialog/copy/preservation case is passed.

**Current evidence:** [research/rnd-290-startup-error.md](research/rnd-290-startup-error.md).

The source assessment and acceptance below retain the initial planning context; the current note above is authoritative for progress.

**Initial source foundation:** Startup data-directory and restored-operation preflight already fail closed and have native fixture tests.

**Required remaining work:** Error paths print to stderr and return before a window. Add an OS-native pre-webview error with full diagnostic version/state path and safe copy/report guidance without clearing markers.

Source evidence: [`apps/desktop/src-tauri/src/lib.rs:622`](G:/Projects/execs/apps/desktop/src-tauri/src/lib.rs:622); [`apps/desktop/src-tauri/src/lib.rs:633`](G:/Projects/execs/apps/desktop/src-tauri/src/lib.rs:633); [`apps/desktop/src-tauri/src/main.rs:1`](G:/Projects/execs/apps/desktop/src-tauri/src/main.rs:1). Line numbers describe the recorded baseline and may move during parallel implementation.

**Exact issue acceptance** (Linear link markup normalized; historical version/date references do not override the current authorization):

show an OS-native error before webview initialization, including the app's full diagnostic version and affected state path where available. Explain that the app stopped to protect the install and how to copy/report the error. Preserve the marker and fail-closed write behavior. Cover absent data-directory environment, corrupt/mismatched marker, access denial, multiple markers, and a successful normal startup. Do not automatically clear recovery markers to make the app open. Use isolated data directories for validation; this audit did not corrupt real user state.

**Implementation verification:**

- Isolated missing environment, corrupt/mismatched/unreadable/multiple marker fixtures, preserved bytes and no writers.
- Visible native failure from an ordinary no-console Windows launch, plus Linux dialog and normal startup.

**Native/platform limits:**

- A browser modal cannot satisfy a pre-webview native failure.
- Real user maintenance markers must not be corrupted for testing.

## RND-291 — Keep each settings pane at a predictable scroll position

Source: [authoritative Linear issue](https://linear.app/rndaom/issue/RND-291/keep-each-settings-pane-at-a-predictable-scroll-position). UUID: `2410d645-584e-4c41-b369-6426e9377205`. Current Linear state: **In Progress**. Code owner: **/root/surface_inventory**. Original acceptance/source snapshot is preserved in planning-status.json. Current implementation: **pane scroll retention implemented; scoped browser and integration checks passed**.

**Current implementation and proof:** Snapshot-before-update retains per-pane positions across short-pane clamping and retained drafts. Profile/install changes reset customization positions; Inventory account and global App settings remain independent. Async restoration cancels on deliberate user input. Six SettingsLayout regressions passed; owner also reports Modal 8, Toast 5 and retained-pane 4 checks. Foundry shell visual evidence includes 960px Comfig/Gameplay and HUD/Mods views.

**Remaining implementation/qualification:** Native Windows/Linux runtime coverage and any states outside the accepted browser evidence matrix.

**Current evidence:** [foundry-system.md](foundry-system.md) · [implementation/core/08-comfig-960.png](implementation/core/08-comfig-960.png) · [implementation/core/05-gameplay-960.png](implementation/core/05-gameplay-960.png).

The source assessment and acceptance below retain the initial planning context; the current note above is authoritative for progress.

**Initial source foundation:** SettingsLayout retains pane instances/drafts in a shared scroll surface.

**Required remaining work:** Choose reset-on-switch or per-pane restoration; first visit must start at the heading. Keep active nav visible through keyboard changes and resize while retaining drafts.

Source evidence: [`apps/desktop/src/SettingsLayout.tsx:99`](G:/Projects/execs/apps/desktop/src/SettingsLayout.tsx:99); [`docs/audits/2026-09-14-project/ui-ux.md:1`](G:/Projects/execs/docs/audits/2026-09-14-project/ui-ux.md:1). Line numbers describe the recorded baseline and may move during parallel implementation.

**Exact issue acceptance** (Linear link markup normalized; historical version/date references do not override the current authorization):

a first visit starts at the pane heading. Choose and consistently implement restore-per-pane or reset-on-switch behavior for subsequent visits without discarding drafts. Keep the active navigation entry visible on tab changes and responsive resize. Verify Sounds → Mods → Files with long content, keyboard navigation, and draft retention at 1200×800 and 960×640.

**Implementation verification:**

- Sounds→Mods→Files long-page navigation at 1200×800 and 960×640; first and later visits.
- Keyboard nav, active item visibility, draft state, profile changes and resize.

**Native/platform limits:**

- Initial visual audit at 1280×720 does not qualify both native window sizes or native keyboard behavior.

## RND-292 — Make meaningful helper and status text meet minimum contrast

Source: [authoritative Linear issue](https://linear.app/rndaom/issue/RND-292/make-meaningful-helper-and-status-text-meet-minimum-contrast). UUID: `84d083bd-8fd7-4fab-95c5-504577a888cf`. Current Linear state: **In Progress**. Code owner: **/root/surface_inventory**. Original acceptance/source snapshot is preserved in planning-status.json. Current implementation: **Foundry contrast tokens implemented; accepted browser scope reviewed**.

**Current implementation and proof:** Warm Foundry ink/muted/faint tokens replace low-contrast meaningful copy on shared surfaces. Calculated minima across three solid bases: ink 12.13:1, muted 7.06:1, faint 5.42:1; destructive button 4.82:1. Owner reports source-token calculations and direct shared-style inspection in HUD, Mods and core captures. These values do not certify every composited/native state.

**Remaining implementation/qualification:** Native/composited text, helper, error and focus states outside recorded browser evidence; no OS accessibility certification claimed.

**Current evidence:** [foundry-system.md](foundry-system.md) · [implementation/hud/](implementation/hud/) · [implementation/mods/design-qa.md](implementation/mods/design-qa.md).

The source assessment and acceptance below retain the initial planning context; the current note above is authoritative for progress.

**Initial source foundation:** Central tokens and reduced-motion support exist.

**Required remaining work:** Meaningful small text uses the faint #6f695c token. The original measured pairs are 3.435:1 on #121212 and 3.256:1 on #181818. Validate new Foundry computed pairs at ≥4.5:1 on real surfaces and visible focus.

Source evidence: [`apps/desktop/src/index.css:36`](G:/Projects/execs/apps/desktop/src/index.css:36); [`docs/design/2026-09-22-overhaul/audit-findings.md:1`](G:/Projects/execs/docs/design/2026-09-22-overhaul/audit-findings.md:1). Line numbers describe the recorded baseline and may move during parallel implementation.

**Exact issue acceptance** (Linear link markup normalized; historical version/date references do not override the current authorization):

use an existing sufficient token (for example ink-muted) or adjust the token usage to reach 4.5:1 for meaningful small text on all real backgrounds. Audit helper rules, empty/error states, source credit links and placeholders; preserve intentional decorative/disabled exceptions. Keep design tokens centralized. Verify actual computed foreground/background pairs and keyboard focus visibility. This is a specific readability defect, not a claim of a complete accessibility audit. Add the user-facing changelog entry.

**Implementation verification:**

- Computed foreground/background contrast for helper rules, errors, empty states, source links and placeholders in all panes.
- Hover/focus/selected/disabled states on background, panels, tiles, menus and dialogs; retain intentional non-meaningful exceptions.

**Native/platform limits:**

- Passing token arithmetic alone does not prove alpha-composited, image-backed or native rendered text.

## RND-294 — Correct installer, platform and Casual compatibility claims in player documentation

Source: [authoritative Linear issue](https://linear.app/rndaom/issue/RND-294/correct-installer-platform-and-casual-compatibility-claims-in-player). UUID: `62e0501b-5246-48e1-960d-a304bcb8ccf4`. Current Linear state: **In Progress**. Code owner: **/root/release_scope**. Original acceptance/source snapshot is preserved in planning-status.json. Current implementation: **documentation and promo corrections integrated in product commit**.

**Current implementation and proof:** README platform, installer, cfg-surface and scoped Casual claims corrected; earlier-release fixture media labeled; promo regenerated with corrected claims. Release playbook now names verified public 0.1.8 without changing release policy. Standalone promo TypeScript check, 636-frame render and reviewed Mods/outro frames passed. See the documentation review; generated GIF hash retained. README, promo, release baseline and Unreleased entries are present in the committed candidate.

**Remaining implementation/qualification:** Refresh public product media only after an actual release. Authenticode and unperformed live Casual compatibility remain unclaimed.

**Current evidence:** [research/rnd-294-documentation-review.md](research/rnd-294-documentation-review.md) · [research/rnd-294-promo-mods-review.png](research/rnd-294-promo-mods-review.png) · [research/rnd-294-promo-outro-review.png](research/rnd-294-promo-outro-review.png).

The source assessment and acceptance below retain the initial planning context; the current note above is authoritative for progress.

**Historical implementation follow-up (13:59 UTC):** README now corrects SmartScreen/source verification, Windows compile/Linux prebuilt, cfg/local Cloud and scoped Casual/Restore wording. The four old 0.1.0 fixture screenshots and promo are labeled as an earlier interface/sample data. The corrected GIF was rendered (636 frames) and changed Mods/outro stills visually reviewed; standalone TypeScript and diff checks passed. No unreleased Foundry media is advertised as shipped. At 13:59 parent integration and the Unreleased entry remained; both are now in the committed candidate. [Documentation/media evidence](research/rnd-294-documentation-review.md).

The existing/missing-work paragraphs below preserve the initial baseline assessment; the current follow-up above supersedes their completion status.

**Initial source foundation:** README and promo describe shipping capabilities and third-party sources.

**Required remaining work:** Remove one-time SmartScreen and blanket keep-download claims; accurately document Windows build/Linux import, real cfg/Cloud surfaces and scoped Casual support. Refresh public-facing visuals without representing unreleased Foundry as shipped.

Source evidence: [`README.md:21`](G:/Projects/execs/README.md:21); [`README.md:27`](G:/Projects/execs/README.md:27); [`README.md:29`](G:/Projects/execs/README.md:29); [`README.md:45`](G:/Projects/execs/README.md:45); [`tools/promo/src/Promo.tsx:1`](G:/Projects/execs/tools/promo/src/Promo.tsx:1). Line numbers describe the recorded baseline and may move during parallel implementation.

**Exact issue acceptance** (Linear link markup normalized; historical version/date references do not override the current authorization):

remove the one-time SmartScreen promise and blanket instruction to keep any browser-flagged download; explain source/publisher/hash verification and that managed devices may prohibit running unsigned apps. State Windows compile/Linux prebuilt capability accurately. Describe supported cfg surfaces and scope Casual compatibility to verified supported content with explicit Restore. Review README screenshots/promo against the current public release; do not advertise unreleased 0.2.0 capabilities as shipped. Keep Authenticode implementation in [RND-191](https://linear.app/rndaom/issue/RND-191/windows-code-signing-authenticode-for-the-installer-and-updater). No claim that current Casual support is universally broken. Add a concise \[Unreleased\] documentation correction with implementation.

**Implementation verification:**

- Compare every capability/compatibility claim with current code, verified public v0.1.8 and authoritative installer guidance.
- Check README/screenshots/promo and support links; retain Authenticode as optional RND-191.

**Native/platform limits:**

- Docs must distinguish prepared 0.2.0 work from public v0.1.8 until an independently authorized release.

## RND-325 — Audit execs Windows polling for periodic TF2 frame stalls

Source: [authoritative Linear issue](https://linear.app/rndaom/issue/RND-325/audit-execs-windows-polling-for-periodic-tf2-frame-stalls). UUID: `50decf46-e32e-499a-920a-28ed8fd32ab6`. Current Linear state: **In Progress**. Code owner: **/root/release_scope**. Original acceptance/source snapshot is preserved in planning-status.json. Current implementation: **source audit and bounded polling reductions implemented; runtime benchmark pending**.

**Current implementation and proof:** Lifecycle presentation polling now uses 5s idle/1s active, fail-closed initial/resume reads, coalescing and bounded failure backoff; hidden/unfocused polling pauses. Inventory helper requests process names only. Native game write-lock cadence stays intact. 22 targeted frontend tests and 7 helper tests passed, with scoped Biome/Rust fmt/Clippy. Timer inventory and paired on/off PresentMon protocol are recorded.

**Remaining implementation/qualification:** Actual TF2 foreground/dual-display on/off traces, clean startup/presentation and causal classification. No measured frame-stall fix is claimed.

**Current evidence:** [research/rnd-325-polling-audit.md](research/rnd-325-polling-audit.md).

The source assessment and acceptance below retain the initial planning context; the current note above is authoritative for progress.

**Historical implementation follow-up (13:59 UTC):** The source timer/process inventory and scoped lifecycle/helper reductions are implemented. Lifecycle polling sleeps hidden/unfocused, keeps fail-closed initial/resume/post-operation reads and active-lease cadence, backs off idle/failures, coalesces fresh reads and ignores obsolete/equal results. The development Inventory helper now uses names-only metadata at its unchanged 100ms abort cadence. **22 frontend tests and 7 helper tests passed**, with targeted Biome, probe fmt/Clippy and diff checks. Actual TF2/PresentMon on/off, dual-display/independent-flip and priority/causal evidence remain open. [Audit and benchmark protocol](research/rnd-325-polling-audit.md). No frame-stall fix is claimed.

The existing/missing-work paragraphs below preserve the initial baseline assessment; the current follow-up above supersedes their completion status.

**Initial source foundation:** Process monitor runs in a worker, catches panic, emits on change, and samples names rather than full process metadata.

**Required remaining work:** Inventory every timer/process/window query, measure impact, and remove or back off unnecessary work without weakening game detection or write safety. Do not imply that previously observed correlation proves causation.

Source evidence: [`apps/desktop/src-tauri/src/lib.rs:774`](G:/Projects/execs/apps/desktop/src-tauri/src/lib.rs:774); [`apps/desktop/src-tauri/src/lib.rs:499`](G:/Projects/execs/apps/desktop/src-tauri/src/lib.rs:499); [`apps/desktop/src-tauri/core/src/process_lock.rs:106`](G:/Projects/execs/apps/desktop/src-tauri/core/src/process_lock.rs:106); [`apps/desktop/src/hooks/useInventorySnapshot.ts:1`](G:/Projects/execs/apps/desktop/src/hooks/useInventorySnapshot.ts:1). Line numbers describe the recorded baseline and may move during parallel implementation.

**Exact issue acceptance** (Linear link markup normalized; historical version/date references do not override the current authorization):

* Identify every timer/poll interval and process/window query used by the Windows companion while TF2 is running.
* Replace unnecessary high-frequency polling with event-driven or backoff-based checks where practical.
* Ensure monitoring runs at normal/background priority and cannot block the UI, launch path, or profile/preloader transactions.
* Add a reproducible on/off benchmark using a short PresentMon capture with TF2 foreground and both displays active.
* Demonstrate that execs enabled versus disabled does not introduce periodic CPU stalls or degrade independent-flip presentation.
* Record the result explicitly as root cause, contributing factor, or ruled out; do not claim causation from correlation alone.

**Implementation verification:**

- Catalog lock poll (1s), launch monitor (5s), development Inventory refresh/backoff, focus/visibility and UI timers; verify priority and thread boundaries.
- Reproducible execs on/off PresentMon capture with TF2 foreground and both displays active; classify root cause/contributor/ruled out.

**Native/platform limits:**

- No new PresentMon, retail TF2, dual-display or independent-flip evidence was collected by this planning review.
- All native frame behavior remains an open evidence requirement even if source changes/tests pass.

## RND-251 — Run the cumulative Windows and Linux functional release matrix before 0.2.0

Source: [authoritative Linear issue](https://linear.app/rndaom/issue/RND-251/run-the-cumulative-windows-and-linux-functional-release-matrix-before). UUID: `f577f8f5-365f-4d32-9962-74a1a9d8e542`. Current Linear state: **In Progress**. Code owner: **/root**. Original acceptance/source snapshot is preserved in planning-status.json. Current implementation: **Windows/Linux automated CI passed; native and package matrix open**.

**Current implementation and proof:** The committed Foundry development candidate has a passing integrated Windows frontend/tooling/Rust/static/build run and accepted scoped browser QA. This is separate from packaged/native/live release acceptance. pnpm test: 863 desktop + 160 cfglint + 21 tooling passed, 3 platform skips. Windows workspace: 859 passed, 0 failed, 16 ignored. Required pinned HUD script separately passed 6 tests, exit 0. Biome, frontend build, Rust fmt, all-target workspace Clippy and diff checks pass. Linux CI at 542b3dd20f2847fc90a1a4e990584f03830fcc6d passed 867 workspace tests with 16 ignored; its separate pinned HUD step passed 6 tests. These are platform fixture results, not desktop/live qualification. The final Windows CI job also passed 859 workspace tests with 16 ignored and 6 separate pinned HUD checks; all five CI jobs succeeded on that same head. The actual public v0.1.8 exporter (85aaf6bc0dd28f43351d4cb5cdb62502737688d5) to current importer/re-exporter (542b3dd20f2847fc90a1a4e990584f03830fcc6d) passed four disposable Windows core-library cases with 32 exact payload comparisons. All eight retained ZIP hashes were independently verified; active profile/manifest and synthetic live root were unchanged, imported preloader selections were empty, and ambiguous HUD choice/reset requirements were preserved. Packaged/native GUI/Linux/Cloud/live-engine qualification is not established by this fixture pass.

**Remaining implementation/qualification:** The remaining Windows native matrix, Linux native runtime, signed-package startup and updater/profile compatibility, actual Cloud and approved TF2/Casual/performance matrix. The isolated E7BC/F6 Windows scopes in the follow-up checkpoint pass; they do not close the full native matrix. Four actual public-v0.1.8 export/import fixtures pass at the Windows core-library level; this does not close packaged migration acceptance. Draft PR #60 CI passes at 542b3dd20f2847fc90a1a4e990584f03830fcc6d.

**Current evidence:** [design-qa.md](design-qa.md) · [implementation/verification/frontend-tests-windows.txt](implementation/verification/frontend-tests-windows.txt) · [implementation/verification/workspace-tests-windows.txt](implementation/verification/workspace-tests-windows.txt) · [implementation/verification/frontend-build.txt](implementation/verification/frontend-build.txt) · [implementation/verification/workspace-clippy-windows.txt](implementation/verification/workspace-clippy-windows.txt) · [implementation/hud/pinned-huds-windows.txt](implementation/hud/pinned-huds-windows.txt).

The source assessment and acceptance below retain the initial planning context; the current note above is authoritative for progress.

**Initial source foundation:** Prior maintenance releases and audits provide scoped unit/fixture/CI/package evidence, including public v0.1.8. Those are inherited evidence, not proof of the new candidate.

**Required remaining work:** Execute the complete current-candidate matrix below, with actual commit/build/platform/input/result/evidence for every row. Retain every unrun native/platform condition explicitly.

Source evidence: [`docs/audits/2026-09-14-project/README.md:1`](G:/Projects/execs/docs/audits/2026-09-14-project/README.md:1); [`docs/audits/2026-09-20-0.1.8-mods/README.md:1`](G:/Projects/execs/docs/audits/2026-09-20-0.1.8-mods/README.md:1); [`scripts/smoke-packages.mjs:86`](G:/Projects/execs/scripts/smoke-packages.mjs:86); [`docs/design/2026-09-22-overhaul/audit-coverage.md:1`](G:/Projects/execs/docs/design/2026-09-22-overhaul/audit-coverage.md:1). Line numbers describe the recorded baseline and may move during parallel implementation.

**Exact issue acceptance** (Linear link markup normalized; historical version/date references do not override the current authorization):

Attach candidate commit,installer hashes, platform and observed result for each:

* Windows NSIS upgrade from the last published version, profile/settings preservation, restart and signed updater success/failure. Linux AppImage first launch/update and .deb first install; no .deb self-update offer.
* TF2 open before launch, starting during a save/download/switch, quit/absorb, failed lock subscription, Steam-open launch-options copy/pending behavior and Steam-closed reconciliation.
* Every pane: edit/save/reload, navigate during debounce/in-flight work, failed write retry, offline catalog behavior, A/B profile isolation. Verify [RND-209](https://linear.app/rndaom/issue/RND-209/keep-unsaved-files-drafts-when-leaving-the-pane-or-switching-profiles)/[RND-210](https://linear.app/rndaom/issue/RND-210/wait-for-a-successful-cfg-save-before-save-and-switch-navigates) and [RND-233](https://linear.app/rndaom/issue/RND-233/record-right-and-middle-mouse-buttons-with-the-correct-tf2-bind-names)–[RND-250](https://linear.app/rndaom/issue/RND-250/keep-the-ui-write-lock-closed-after-subscription-failure-despite-late).
* Native export/import from the public version; case-only paths, unreadable inventory, Keep/Restore, canceled creator review and interrupted transaction recovery.
* Actual Steam Cloud server round trip plus offline restart without losing either local copy. A filesystem dual-write pass does not satisfy this item.
* Viewmodel build/import/remove on Windows; supported prebuilt path and unavailable compiler feedback on Linux. Crosshair stock/custom behavior and installed sound playback on actual TF2.
* Preloader Apply→Casual→Restore, selected carrier removal, TF2 update/Steam verification, restart after interruption, exact restoration of stock particle DATA and unchanged directory VPK.

Run pnpm test/check/build, cargo fmt, workspace tests and Clippy, and both CI platform targets on the candidate. File new defects with reproduction and the earliest appropriate patch milestone; do not mark unmet rows pass or keep serious bugs waiting for a themed date.

Add native closewith pending settings during debounce, locked TF2 and failed saves ([RND-273](https://linear.app/rndaom/issue/RND-273/protect-pending-settings-drafts-when-closing-execs)); profile-owned preloader command switch/migration and selected-source remove/absorb ([RND-202](https://linear.app/rndaom/issue/RND-202/replace-shared-preloader-selections-with-the-target-profile-during)/248); local-only particles without default library cache ([RND-274](https://linear.app/rndaom/issue/RND-274/switch-local-only-particle-profiles-without-requiring-the-default-mod)); owner Low flat textures ↔ Ultra Ultimate TF2 Fix Pack isolation across restart/export/import. Capture UI selections plus actual VPK/particle bytes and unchanged \_dir.vpk. Cover notification provider integration ([RND-269](https://linear.app/rndaom/issue/RND-269/renew-success-toast-lifetime-for-every-completion)–272), not only passing reducer tests. Details: docs/audits/2026-09-13-release/README.md.

**Add final-candidate evidence:**[RND-275](https://linear.app/rndaom/issue/RND-275/preserve-distinct-dashed-and-undashed-custom-pack-identities-during), [RND-277](https://linear.app/rndaom/issue/RND-277/avoid-source-reserved-directory-names-when-installing-loose-mods-and), [RND-278](https://linear.app/rndaom/issue/RND-278/refuse-profile-export-when-vpk-cfg-members-contain-server-credentials), [RND-279](https://linear.app/rndaom/issue/RND-279/retain-new-crosshair-asset-bytes-when-build-pack-fails-or-is-refused), [RND-280](https://linear.app/rndaom/issue/RND-280/preserve-newer-sound-edits-when-an-earlier-boost-save-finishes), [RND-281](https://linear.app/rndaom/issue/RND-281/stop-dormant-cfg-and-deferred-bind-or-alias-commands-from-seeding), [RND-282](https://linear.app/rndaom/issue/RND-282/bound-total-cfg-exec-traversal-so-small-graphs-cannot-freeze-the), [RND-288](https://linear.app/rndaom/issue/RND-288/time-out-stalled-updater-payload-downloads-and-release-the-update); cfg-layer/valid-FOV preservation; export re-import after deleted packs; false/cancel/native-error host callback conventions; sound edits during older save acknowledgement; harmless dormant/class cfgs and bounded repeated execs; literal dash peer packs; Source-reserved custom folders; packed cfg credential refusal; cached/partial HUD refresh; corrupt startup marker shown visibly; meaningful text contrast and per-pane navigation.

**Strengthen the packaged smoke assertions:** scripts/smoke-packages.mjs:86 preserves a text sentinel; :229–244 checks process survival (and a Linux window name). These are useful limited checks, not proof that Windows rendered a usable webview or that a real prior-version profile migrated and remains switchable. Add/retain exact candidate screenshots or semantic interaction evidence and a realistic fixture library round trip on both packaged OS paths. Exercise the app's actual update lifecycle on stalled payloads, not only the updater example probe.

Keep this gate In Progress. No fresh Linux runtime, actual installer/update, retail TF2 launch, Steam Cloud server round trip or Casual/preloader session was run in this audit. A full Tauri probe encountered a host loader failure before main and is not a product finding. Prior green Linux CI at this commit is supporting evidence, not a new runtime result. Steam's [Cloud documentation](https://partner.steamgames.com/doc/features/cloud) does not make a local dual-write an acknowledged upload. Include immediate relaunch, offline/reconnect, multiple accounts and cross-platform cases. Preserve directory-VPK hashes in all particle checks.

**Implementation verification:**

- Full frontend/Rust/Windows/Linux checks on the integrated candidate; public-profile compatibility and actual UI/native flows.
- Visible packaged webview and realistic prior-version library round trip, not only process survival or text sentinels.
- Foundry full pane/state comparison at both sizes, focus/contrast/reduced motion, source-owned draft/error/recovery.
- Keep live Cloud acknowledgement, actual TF2 audio/crosshair/viewmodel/preloader/Casual, platform accessibility and update lifecycle evidence distinct.

**Native/platform limits:**

- Linux runtime/WebKitGTK, signed package/updater, screen-reader/IME, native close, real media, Cloud server round trip and approved TF2/Casual/PresentMon require their own evidence.
- No tag/publication is authorized; package/release-only steps stay explicitly pending where outside this implementation turn.

## RND-213 — Delete profiles safely from the profile menu

Source: [authoritative Linear issue](https://linear.app/rndaom/issue/RND-213/delete-profiles-safely-from-the-profile-menu). UUID: `8fcd4821-386b-49b9-a30f-6d3353a36516`. Current Linear state: **In Progress**. Code owner: **/root/profile_management**. Original acceptance/source snapshot is preserved in planning-status.json. Current implementation: **safe profile deletion implemented; Windows fixtures and integration passed**.

**Current implementation and proof:** Named export-first deletion review supports inactive removal, active verified switch-first or keep-installed/untrack, and the last profile. Atomic index publication uses bounded recovery cleanup; shared references and unreadable remaining manifests protect shared data. Nine disposable core deletion tests, five native orchestration fixtures rerun after HUD metadata changes, 78 preloader-filter tests and the 31-test profile frontend group passed. Legacy HUD record removal covers sole and preserved-original branches. The integrated Windows suites pass; browser captures 00–06 show the final review flows. Linux CI at 542b3dd20f2847fc90a1a4e990584f03830fcc6d passed 867 workspace tests with 16 ignored; its separate pinned HUD step passed 6 tests. These are platform fixture results, not desktop/live qualification. The final Windows CI job also passed 859 workspace tests with 16 ignored and 6 separate pinned HUD checks; all five CI jobs succeeded on that same head.

**Follow-up native proof:** On E7BC6250, actual isolated native Import review/Cancel and inactive deletion passed with activeProfileId remaining null. Independent hashes show 20→16 files, four target-only removals, only index bytes changed and all 15 remaining files identical, with no recovery remnants and normal exit. F6A0B0DE separately passed the new Choose profile CTA/focus/Escape and truthful import-copy/Cancel flow; all 20 files remained unchanged. Neither run activated a profile. [Native evidence](implementation/native-windows/README.md).

**Remaining implementation/qualification:** Native active/last-profile switch-or-untrack and failure/dirty-close cases, Linux native flows and realistic prior-profile packaged compatibility. The bounded Windows inactive deletion and chooser/import-Cancel cases are passed; no real player library was deleted.

**Current evidence:** [implementation/profile-management/verification.md](implementation/profile-management/verification.md) · [implementation/profile-management/00-profile-actions.png](implementation/profile-management/00-profile-actions.png) · [implementation/profile-management/01-active-delete.png](implementation/profile-management/01-active-delete.png) · [implementation/profile-management/02-inactive-delete.png](implementation/profile-management/02-inactive-delete.png) · [implementation/profile-management/03-switch-first-delete.png](implementation/profile-management/03-switch-first-delete.png).

The source assessment and acceptance below retain the initial planning context; the current note above is authoritative for progress.

**Initial source foundation:** Profile create/import/export/switch and recoverable core transactions exist.

**Required remaining work:** Implement deletion command, preview twin, menu action and themed review/export affordance. Inactive removes only own data; active chooses switch-away or leave-live-files/clear-tracking. Last profile cannot silently reset TF2. Preserve shared references and recovery.

Source evidence: [`apps/desktop/src/components/ReadyPanel/ProfileMenu.tsx:1`](G:/Projects/execs/apps/desktop/src/components/ReadyPanel/ProfileMenu.tsx:1); [`apps/desktop/src/lib/bridge.ts:1`](G:/Projects/execs/apps/desktop/src/lib/bridge.ts:1); [`apps/desktop/src-tauri/core/src/profile.rs:1`](G:/Projects/execs/apps/desktop/src-tauri/core/src/profile.rs:1); [`apps/desktop/src-tauri/src/commands/library.rs:1`](G:/Projects/execs/apps/desktop/src-tauri/src/commands/library.rs:1). Line numbers describe the recorded baseline and may move during parallel implementation.

**Exact issue acceptance** (Linear link markup normalized; historical version/date references do not override the current authorization):

* Add a clearly named Delete profile action with a themed confirmation naming the profile and explaining what is removed; offer export before deletion.
* Inactive deletion removes only that profile's library data. Never remove another profile's files or shared mastercomfig base while still referenced.
* For an active profile, explicitly choose another profile to switch to first, or choose to leave the current TF2 files installed and clear tracking. Handle the last-profile case without silently resetting TF2.
* Refuse while TF2 runs or a recovery/write operation is pending; use the durable write gate and recover safely after interruption.
* Verify active/inactive/last profile, cancel, missing/corrupt library entries, shared content, and restart failure. Keep older profiles readable.

**Implementation verification:**

- Active/inactive/last, cancel/export, game running, busy/recovery, missing/corrupt entries, shared base still referenced, interruption/restart.
- Backend disk assertions in disposable fixtures and front-end keyboard/focus/explicit-effect review.

**Native/platform limits:**

- Destructive effect text must derive from backend ownership, not generated concept wording.
- Native integration on both platforms is not established by menu fixtures.

## RND-214 — Add app settings for updates, motion, install location and support

Source: [authoritative Linear issue](https://linear.app/rndaom/issue/RND-214/add-app-settings-for-updates-motion-install-location-and-support). UUID: `4d7dcf10-f473-4977-89a1-315215a917a8`. Current Linear state: **In Progress**. Code owner: **/root/app_settings**. Original acceptance/source snapshot is preserved in planning-status.json. Current implementation: **global App settings implemented; Windows integration passed**.

**Current implementation and proof:** Global settings work before profile creation, persist atomically while preserving the root, control startup update checks and Follow system/Reduce motion, and offer guarded install change, path copying, diagnostics/support and credits. 13 disposable core settings tests and native cargo check passed. Final shared frontend settings/updater group passed 32 tests, including pane 7, preferences 5, updater 11, bridge 7 and footer 2; native-close readiness regression passes. Scoped TypeScript/Biome and browser 1280/corrected 960x640 review pass. Linux CI at 542b3dd20f2847fc90a1a4e990584f03830fcc6d passed 867 workspace tests with 16 ignored; its separate pinned HUD step passed 6 tests. These are platform fixture results, not desktop/live qualification. The final Windows CI job also passed 859 workspace tests with 16 ignored and 6 separate pinned HUD checks; all five CI jobs succeeded on that same head.

**Follow-up native proof:** E7BC6250 actual native rootless App settings passed visible Reduce selection, physical keyboard startup-update toggling, isolated data-location copy, native folder-picker Cancel without confirming an install, normal close/reopen persistence and the manual no-update result. These are isolated local Windows preferences; no player configuration or update installation was changed. [Native evidence](implementation/native-windows/README.md).

**Remaining implementation/qualification:** Actual update installation, Linux native execution, dirty-draft/native-close handoff and confirmed or packaged install changes. Bounded Windows rootless preferences/keyboard/copy/picker Cancel/normal close-reopen are passed.

**Current evidence:** [implementation/app-settings/design-qa.md](implementation/app-settings/design-qa.md) · [implementation/app-settings/07-app-settings-final-1280.png](implementation/app-settings/07-app-settings-final-1280.png) · [implementation/app-settings/09-app-settings-minimum-960.png](implementation/app-settings/09-app-settings-minimum-960.png).

The source assessment and acceptance below retain the initial planning context; the current note above is authoritative for progress.

**Initial source foundation:** Footer/profile actions and root/schema settings persistence exist.

**Required remaining work:** Provide pre-profile app Settings, startup-check default on/manual always, Follow system/Reduce motion, existing root Confirm flow, locations/support/credits and atomic global preferences. Existing settings loader treats an empty TF2 root as no settings, so new preferences must work independently of configured root.

Source evidence: [`apps/desktop/src/components/AppFooter.tsx:1`](G:/Projects/execs/apps/desktop/src/components/AppFooter.tsx:1); [`apps/desktop/src/components/ReadyPanel/ProfileMenu.tsx:1`](G:/Projects/execs/apps/desktop/src/components/ReadyPanel/ProfileMenu.tsx:1); [`apps/desktop/src-tauri/core/src/settings.rs:16`](G:/Projects/execs/apps/desktop/src-tauri/core/src/settings.rs:16); [`apps/desktop/src/hooks/useAppUpdate.ts:41`](G:/Projects/execs/apps/desktop/src/hooks/useAppUpdate.ts:41). Line numbers describe the recorded baseline and may move during parallel implementation.

**Exact issue acceptance** (Linear link markup normalized; historical version/date references do not override the current authorization):

* Add one app-level Settings entry distinct from profile gameplay panes, usable before a profile exists.
* Provide Check for updates on startup (current behavior as default; manual check always available) and Motion: Follow system / Reduce. Honor OS reduced motion and never add an enable-over-system override.
* Group existing change-install, copy install/data location, check update, diagnostics, report bug and credits/third-party notices in clear sections; use existing finder Confirm flow for changing the root.
* Store preferences atomically in app data with backwards-compatible defaults; they are global and do not travel in profile exports.
* Keep update install click-only; no analytics, release-channel selector, arbitrary cfg write paths or tuning knobs for autosave.
* Validate keyboard/focus/Escape, app restart, missing settings, both OS paths and behavior while TF2 runs. Update durable spec alongside the implementation.
* Reserve a later maintenance/uninstall section, but do not include new uninstall or cache-deletion behavior in this feature.

**Implementation verification:**

- Backward defaults, missing settings, pre-profile persistence, restart, both data-directory OS paths and profile-export independence.
- Keyboard/focus/Escape, TF2-running behavior, startup/manual checks, OS Reduce and app Reduce; never force motion above OS preference.

**Native/platform limits:**

- No new uninstall/cache deletion/release channels/telemetry/autosave tuning belongs to this feature.
- Actual restart and native OS-motion behavior need platform evidence.

## RND-202 — Replace shared preloader selections with the target profile during switching

Source: [authoritative Linear issue](https://linear.app/rndaom/issue/RND-202/replace-shared-preloader-selections-with-the-target-profile-during). UUID: `90ca1d9a-49b0-470e-b4d7-94ad053509b9`. Current Linear state: **In Progress**. Code owner: **/root/profile_management**. Original acceptance/source snapshot is preserved in planning-status.json. Current implementation: **profile-owned native preloader integration implemented; Windows fixtures passed**.

**Current implementation and proof:** Legacy global clear/reconcile was removed from native switch, absorb and removal. Core profile-aware projection owns selection transitions; selected source removal refuses safely. Five native orchestration fixtures were rerun successfully after HUD metadata changes. The 78 core preloader-filter tests and shared 31-test profile frontend group pass, and the final Windows workspace passes. Fixtures remain disposable; retail TF2/Cloud behavior was not exercised. Linux CI at 542b3dd20f2847fc90a1a4e990584f03830fcc6d passed 867 workspace tests with 16 ignored; its separate pinned HUD step passed 6 tests. These are platform fixture results, not desktop/live qualification. The final Windows CI job also passed 859 workspace tests with 16 ignored and 6 separate pinned HUD checks; all five CI jobs succeeded on that same head.

**Remaining implementation/qualification:** Actual owner two-profile game/Casual/restart and stock-byte/presentation validation, plus native Windows/Linux desktop qualification.

**Current evidence:** [implementation/profile-management/verification.md](implementation/profile-management/verification.md).

The source assessment and acceptance below retain the initial planning context; the current note above is authoritative for progress.

**Initial source foundation:** Profile-owned preloader selection metadata, capture, projection, stock restoration and switch rollback journal exist. Selected-source removal now contains profile-aware transaction/capture work; old September issue evidence is not a description of every current path.

**Required remaining work:** The command still clears source particle state through legacy cleanup before core switch. Basic target validation checks manifest/path/hash but does not preflight every target preloader input. Reconcile all cleanup/migration/removal/absorb/normal/recovery entry points and prove recoverable ordering.

Source evidence: [`apps/desktop/src-tauri/src/commands/library.rs:102`](G:/Projects/execs/apps/desktop/src-tauri/src/commands/library.rs:102); [`apps/desktop/src-tauri/src/commands/preloader.rs:232`](G:/Projects/execs/apps/desktop/src-tauri/src/commands/preloader.rs:232); [`apps/desktop/src-tauri/src/commands/preloader.rs:274`](G:/Projects/execs/apps/desktop/src-tauri/src/commands/preloader.rs:274); [`apps/desktop/src-tauri/core/src/preloader/profiles.rs:1`](G:/Projects/execs/apps/desktop/src-tauri/core/src/preloader/profiles.rs:1); [`apps/desktop/src-tauri/core/src/switch.rs:415`](G:/Projects/execs/apps/desktop/src-tauri/core/src/switch.rs:415). Line numbers describe the recorded baseline and may move during parallel implementation.

**Exact issue acceptance** (Linear link markup normalized; historical version/date references do not override the current authorization):

use the profile-aware selection transaction for all cleanup entry points; persist the corresponding profile metadata under recoverable ordering; avoid clearing source choices merely to switch away; migrate before destructive cleanup; validate all target preloader inputs before changing source bytes. Test Tauri command orchestration or an extracted shared command-level function, not just direct calls to `core::switch_profile_to`. Cover selected source removal, external removal plus absorb, legacy migration, failed target preflight, return to the source profile, and crash recovery.

Verify the owner's exact two-profile case both directions, restart, empty/imported profiles and export/import. Legacy global state cannot recover distinct historical choices that were never saved.

**Implementation verification:**

- Command orchestration or extracted shared command function: source removal/external absorb, legacy migration before cleanup, failed target preflight without source mutation, return to source, crash/restart.
- Owner Low/flat-textures↔Ultra/Ultimate-TF2-Fix-Pack both directions, empty/imported profiles, export/import, actual projection bytes and unchanged directory VPK.

**Native/platform limits:**

- Core-only tests cannot establish Tauri sequencing.
- Legacy global choices that were never saved cannot be reconstructed; disclose this limit rather than inventing historical selections.

## RND-274 — Switch local-only particle profiles without requiring the default mod library

Source: [authoritative Linear issue](https://linear.app/rndaom/issue/RND-274/switch-local-only-particle-profiles-without-requiring-the-default-mod). UUID: `cf40160b-22b9-41f7-9448-b14b0a1da6f0`. Current Linear state: **In Progress**. Code owner: **/root/profile_management**. Original acceptance/source snapshot is preserved in planning-status.json. Current implementation: **local-only library predicate implemented; Windows fixtures passed**.

**Current implementation and proof:** The shared needs_default_library predicate lets empty and local-only selections switch without a downloaded default ZIP. Default-library selections retain strict pinned validation. Covered by five native orchestration fixtures and the 78 preloader tests reported for profile management; these are overlapping groups, not additional independent totals. Native orchestration fixtures were rerun after HUD changes and the final Windows workspace passes. Linux CI at 542b3dd20f2847fc90a1a4e990584f03830fcc6d passed 867 workspace tests with 16 ignored; its separate pinned HUD step passed 6 tests. These are platform fixture results, not desktop/live qualification. The final Windows CI job also passed 859 workspace tests with 16 ignored and 6 separate pinned HUD checks; all five CI jobs succeeded on that same head.

**Remaining implementation/qualification:** Native Windows/Linux offline/source-availability cases beyond the disposable automated fixtures.

**Current evidence:** [implementation/profile-management/verification.md](implementation/profile-management/verification.md).

The source assessment and acceptance below retain the initial planning context; the current note above is authoritative for progress.

**Initial source foundation:** Apply and core catalog/archive readers already support local profile particle selections without default-library ZIP.

**Required remaining work:** Target preparation still selects the empty-library path only when selection.is_empty(), so local-only particles require the default ZIP. Use actual default-addon/default-particle need consistently in normal switch and recovery.

Source evidence: [`apps/desktop/src-tauri/core/src/preloader/profiles.rs:207`](G:/Projects/execs/apps/desktop/src-tauri/core/src/preloader/profiles.rs:207); [`apps/desktop/src-tauri/src/commands/preloader.rs:439`](G:/Projects/execs/apps/desktop/src-tauri/src/commands/preloader.rs:439); [`apps/desktop/src-tauri/core/src/preloader/apply.rs:48`](G:/Projects/execs/apps/desktop/src-tauri/core/src/preloader/apply.rs:48). Line numbers describe the recorded baseline and may move during parallel implementation.

**Exact issue acceptance** (Linear link markup normalized; historical version/date references do not override the current authorization):

target preparation should use the same library-needed predicate as Apply. Test local-only switch/reapply/export-import without the default cache, while retaining strict hash verification for actual library selections. Cache absence must not mutate the previous profile before refusal.

Requirement selection must follow the actual chosen addon/default-particle sources in normal switch and recovery.

**Implementation verification:**

- No-cache local-only switch/reapply/export-import/recovery and empty selection.
- Actual library selection retains strict size/hash verification; refusal leaves previous profile projection unchanged.

**Native/platform limits:**

- Native command integration and failure ordering interact with RND-202.

## RND-215 — Enforce one HUD per profile across replacement, import, switch and absorb

Source: [authoritative Linear issue](https://linear.app/rndaom/issue/RND-215/enforce-one-hud-per-profile-across-replacement-import-switch-and). UUID: `2d0dc29f-8fa7-40c6-a060-8c3cdaf72208`. Current Linear state: **In Progress**. Code owner: **/root/foundry_hud**. Original acceptance/source snapshot is preserved in planning-status.json. Current implementation: **HUD ownership and exact-byte boundaries implemented; Windows and Linux fixtures passed**.

**Current implementation and proof:** Explicit HUD ownership/replacement, multi-HUD ZIP choice, exact-byte import pending-reset review, generic Mods guidance, bounded genuine-UI3 HUD-VPK refusal, switch/absorb gates, preserved originals, legacy journal recovery and precommit source/cfg drift protection are integrated. HUD frontend seven-suite run passed 69 tests. Windows core passed 738 tests (709 unit + 29 integration), with 12 ignored as run; all-target core Clippy passed. The full Windows workspace passed 859 tests with 16 ignored. The required pinned HUD script separately passed 6 tests: four schema cases, one font-template case and exact-payload catalog install/update over three SHA-pinned HUD archives, including beyond-MAX_PATH fixture paths. Final browser captures 09–14 and 16–17 are documented. Linux CI at 542b3dd20f2847fc90a1a4e990584f03830fcc6d passed 867 workspace tests with 16 ignored; its separate pinned HUD step passed 6 tests. These are platform fixture results, not desktop/live qualification. The final Windows CI job also passed 859 workspace tests with 16 ignored and 6 separate pinned HUD checks; all five CI jobs succeeded on that same head. The actual public v0.1.8 exporter (85aaf6bc0dd28f43351d4cb5cdb62502737688d5) to current importer/re-exporter (542b3dd20f2847fc90a1a4e990584f03830fcc6d) passed four disposable Windows core-library cases with 32 exact payload comparisons. All eight retained ZIP hashes were independently verified; active profile/manifest and synthetic live root were unchanged, imported preloader selections were empty, and ambiguous HUD choice/reset requirements were preserved. Packaged/native GUI/Linux/Cloud/live-engine qualification is not established by this fixture pass.

**Remaining implementation/qualification:** Native Windows/Linux desktop command/close/restart/recovery and packaged long-path/runtime qualification beyond the passing pinned fixture runs. No retail TF2/Cloud evidence is claimed.

**Current evidence:** [implementation/hud/design-qa.md](implementation/hud/design-qa.md) · [implementation/hud/core-tests-windows.txt](implementation/hud/core-tests-windows.txt) · [implementation/hud/core-clippy-windows.txt](implementation/hud/core-clippy-windows.txt) · [implementation/hud/frontend-tests.txt](implementation/hud/frontend-tests.txt) · [implementation/hud/pinned-huds-windows.txt](implementation/hud/pinned-huds-windows.txt) · [implementation/profile-management/verification.md](implementation/profile-management/verification.md) · [implementation/profile-management/hud-integrity-review.md](implementation/profile-management/hud-integrity-review.md).

The source assessment and acceptance below retain the initial planning context; the current note above is authoritative for progress.

**Initial source foundation:** Selected-HUD inference, inactive library HUD exclusion, safe backup-container moves, legacy recovery, switch projection and absorb exclusions exist with tests. Earlier F15 is not proof that those fixes are absent.

**Required remaining work:** Generic Mods install still mirrors HUD-shaped tree bytes and extends mod records without HUD detection/replacement. Unify remaining entry points and provide explicit legacy/multi-HUD review/disclosure policy, while retaining exact excluded bytes.

Source evidence: [`apps/desktop/src-tauri/core/src/hud.rs:325`](G:/Projects/execs/apps/desktop/src-tauri/core/src/hud.rs:325); [`apps/desktop/src-tauri/core/src/hud.rs:880`](G:/Projects/execs/apps/desktop/src-tauri/core/src/hud.rs:880); [`apps/desktop/src-tauri/core/src/hud.rs:1582`](G:/Projects/execs/apps/desktop/src-tauri/core/src/hud.rs:1582); [`apps/desktop/src-tauri/core/src/mods.rs:622`](G:/Projects/execs/apps/desktop/src-tauri/core/src/mods.rs:622); [`apps/desktop/src-tauri/core/src/switch.rs:543`](G:/Projects/execs/apps/desktop/src-tauri/core/src/switch.rs:543); [`apps/desktop/src-tauri/core/src/absorb.rs:495`](G:/Projects/execs/apps/desktop/src-tauri/core/src/absorb.rs:495). Line numbers describe the recorded baseline and may move during parallel implementation.

**Exact issue acceptance** (Linear link markup normalized; historical version/date references do not override the current authorization):

* Reconcile catalog install/update, archive/folder import, generic Mods import, creator/native profile import, switch and absorb to the same single-HUD policy.
* Keep exactly the selected HUD managed and mounted; remove obsolete generated option cfgs/execs. Recovery copies must never be offered as newly discovered customization or silently adopted as secondary HUDs.
* Legacy profiles/multi-HUD archives need an explicit keep/review policy. Preserve excluded original bytes safely and disclose the result; do not delete unknown or modified files.
* Retain transactional rollback and case/path safety, including pre-existing disabled-name collisions.
* Test A→B→absorb Update→switch away/back, same-HUD update, generic Mods import, mixed archives, failure mid-publish, restart recovery and running-game refusal on both platforms.

**Implementation verification:**

- A→B→absorb Update→switch away/back; same HUD update; Mods import; creator/native and mixed archive policy.
- Case/path/disabled-name collisions, unknown/modified originals, obsolete generated cfg removal, mid-publish/restart/game-running refusal on both platforms.

**Native/platform limits:**

- Do not replace existing safe backup behavior with destructive deletion.
- Native Windows fixture evidence and source review do not establish Linux runtime or actual HUD rendering.

## RND-324 — Make the execs TF2 preload hook startup-safe

Source: [authoritative Linear issue](https://linear.app/rndaom/issue/RND-324/make-the-execs-tf2-preload-hook-startup-safe). UUID: `b16f386a-2ba2-4b3a-bfde-f94a7091cd53`. Current Linear state: **In Progress**. Code owner: **/root/foundry_mods**. Original acceptance/source snapshot is preserved in planning-status.json. Current implementation: **partial startup improvement; engine acceptance unresolved**.

**Current implementation and proof:** The hook preserves established offline itemtest preload, logs boundaries, removes console clear and unreliable post-disconnect VScript, and normalizes duplicate managed launch spellings. Casual UI explicitly discloses the map behavior. All 19 viewmodel fixtures passed in the reported integrated core run, including cfg/launch-token regressions. Mods frontend has 59 scoped checks and real browser evidence. These do not prove engine startup safety. The current bounded fixes are included in the passing Windows workspace. They do not establish the unresolved engine acceptance.

**Remaining implementation/qualification:** No verified map-free replacement; missing itemtest.cfg warning, after-initialization once-only behavior, external re-entry, failure cleanup, retail launch and PresentMon independent-flip remain unresolved/unperformed. The optional owner question about retaining the disclosed offline workflow versus requiring map-free completion is pending; acceptance is unchanged.

**Current evidence:** [research/rnd-324-preload-startup.md](research/rnd-324-preload-startup.md) · [implementation/mods/design-qa.md](implementation/mods/design-qa.md).

The source assessment and acceptance below retain the initial planning context; the current note above is authoritative for progress.

**Initial source foundation:** The supported +exec hook and profile-owned selections exist; its current itemtest bootstrap is intentional mod preload.

**Required remaining work:** serialize_preload_cfg still emits an implicit map/disconnect/clear plus menu-music sequence. Separate actual preload from side effects, make any required temporary work explicit and bounded, run once after initialization, and handle failure without stranding the user.

Source evidence: [`apps/desktop/src-tauri/core/src/viewmodel.rs:41`](G:/Projects/execs/apps/desktop/src-tauri/core/src/viewmodel.rs:41); [`apps/desktop/src-tauri/core/src/viewmodel.rs:1084`](G:/Projects/execs/apps/desktop/src-tauri/core/src/viewmodel.rs:1084). Line numbers describe the recorded baseline and may move during parallel implementation.

**Exact issue acceptance** (Linear link markup normalized; historical version/date references do not override the current authorization):

* `+exec overrides/execs_preload` remains supported and preloads the active profile's mods.
* Normal TF2 launch does not produce avoidable missing-`itemtest.cfg` warnings or an implicit map/disconnect/clear cycle.
* The hook runs once after TF2 initialization and cannot recursively or repeatedly re-enter itself.
* Failure is logged clearly without leaving TF2 in a temporary server or disconnected state.
* Validate with a clean launch and a short PresentMon capture; no regression to exclusive fullscreen/D3D9Ex independent-flip presentation.
* Preserve compatibility with existing profile-owned preloader selections and the 0.2.0 preloader work.

**Implementation verification:**

- Generated hook idempotence/no recursion and missing-config prevention; preserve active profile preload and older compatibility.
- Clean TF2 launch plus short PresentMon showing fullscreen/D3D9Ex independent-flip unchanged.

**Native/platform limits:**

- Removing required preloading merely to remove warnings does not satisfy this feature.
- No live launch/presentation claim follows from generated cfg text tests; recurring FPS hitches are not proven caused by this startup-only hook.

## RND-208 — Validate and publish the combined 0.2.0 overhaul and profile-management release

Source: [authoritative Linear issue](https://linear.app/rndaom/issue/RND-208/validate-and-publish-the-combined-020-overhaul-and-profile-management). UUID: `a1d54c31-0e84-4d81-b89d-0687b935c7b5`. Current Linear state: **In Progress**. Code owner: **/root with bounded pane agents**. Original acceptance/source snapshot is preserved in planning-status.json. Current implementation: **Foundry candidate and accepted review gallery committed; five-job CI passed**.

**Current implementation and proof:** All 14 selected records have assigned implementations or explicitly bounded remaining gaps. Foundry is the sole selected direction; whole-app styling and interaction changes are committed locally at 7c78fbed1907dceb37bf348596fca48a8f654e66. This existing issue continues to track the overhaul under the quota fallback. The integrated design QA report links accepted 1200×800 and 960×640 browser captures and scoped reports. Windows frontend/tooling/Rust/static/build checks pass, and the six pinned HUD checks pass separately. No unresolved P0/P1 remains in the inspected browser scope; native/platform evidence remains separate. Linux CI at 542b3dd20f2847fc90a1a4e990584f03830fcc6d passed 867 workspace tests with 16 ignored; its separate pinned HUD step passed 6 tests. These are platform fixture results, not desktop/live qualification. The final Windows CI job also passed 859 workspace tests with 16 ignored and 6 separate pinned HUD checks; all five CI jobs succeeded on that same head. The actual public v0.1.8 exporter (85aaf6bc0dd28f43351d4cb5cdb62502737688d5) to current importer/re-exporter (542b3dd20f2847fc90a1a4e990584f03830fcc6d) passed four disposable Windows core-library cases with 32 exact payload comparisons. All eight retained ZIP hashes were independently verified; active profile/manifest and synthetic live root were unchanged, imported preloader selections were empty, and ambiguous HUD choice/reset requirements were preserved. Packaged/native GUI/Linux/Cloud/live-engine qualification is not established by this fixture pass.

**Remaining implementation/qualification:** Resolve the RND-324 product/engine gap and complete native/package/Cloud/TF2/PresentMon qualification and any uncovered matrix states. PR #60, the accepted 85-capture gallery and four passing actual v0.1.8 library compatibility cases are available. Future release publication requires separate authorization.

**Current evidence:** [design-qa.md](design-qa.md) · [foundry-system.md](foundry-system.md) · [implementation/verification/frontend-tests-windows.txt](implementation/verification/frontend-tests-windows.txt) · [implementation/verification/workspace-tests-windows.txt](implementation/verification/workspace-tests-windows.txt) · [implementation/hud/pinned-huds-windows.txt](implementation/hud/pinned-huds-windows.txt).

The source assessment and acceptance below retain the initial planning context; the current note above is authoritative for progress.

**Initial source foundation:** The whole-app screenshot audit and three image-generated alternatives exist. The owner selected Foundry's five boards. Public v0.1.8 and the combined scope are reconciled in planning.

**Required remaining work:** Implement all selected functional work and every Foundry pane/state, reconcile concept inaccuracies, qualify the integrated candidate, and keep future release steps pending. This issue also carries the overhaul because a separate issue hit the workspace quota.

Source evidence: [`docs/design/2026-09-22-overhaul/concept-review.md:1`](G:/Projects/execs/docs/design/2026-09-22-overhaul/concept-review.md:1); [`docs/design/2026-09-22-overhaul/combined-release-plan.md:1`](G:/Projects/execs/docs/design/2026-09-22-overhaul/combined-release-plan.md:1); [`docs/design/2026-09-22-overhaul/audit-coverage.md:1`](G:/Projects/execs/docs/design/2026-09-22-overhaul/audit-coverage.md:1); [`docs/design/2026-09-22-overhaul/research/motion-spec.md:1`](G:/Projects/execs/docs/design/2026-09-22-overhaul/research/motion-spec.md:1). Line numbers describe the recorded baseline and may move during parallel implementation.

**Exact issue acceptance** (Linear link markup normalized; historical version/date references do not override the current authorization):

1. Capture and inspect every production pane and meaningful alternate state: Comfig, Binds, Gameplay, HUD, Crosshair, Viewmodels, Sounds, shipped 0.1.8 Mods, Files and Launch; shell/navigation/profile menus; finder/onboarding; profile import/switch/absorb/repair; save/draft/lock/error/recovery/update states. Include development Inventory distinctly labeled. Cover all materially different control patterns, not every numeric permutation. Maintain source/build/preview/native/viewport/state/artwork provenance and explicit unobserved gaps.
2. Produce three separately organized, comparable image-generated directions using the same pane/state matrix. Each must show multiple relevant states of Comfig, Binds, Gameplay and HUD plus all other panes and global decisions, with full-size images and a comparison gallery. Include planned deletion and app settings flows with clear concept labels. Avoid treating optional candidates or Inventory shipment as selected scope.
3. Give each direction a visual-system sheet and motion treatment: color/contrast, typography, spacing, density, controls, focus/selection, imagery, overlays, feedback, pane/selection/menu/dialog/disclosure transitions and reduced-motion equivalents. Include default 1200×800 and minimum 960×640 layouts. Static images cannot establish actual motion quality or accessibility.
4. Record owner choice/refinement before app-wide product implementation. Document the chosen tokens and rules, build common shell/components, then adapt all pane compositions while preserving distinct jobs. TF2 influence must remain restrained; do not invent game preview assets, metrics, success states, cloud sharing or unsupported account actions.
5. Preserve profile/session drafts, explicit Files Save, source-owned feedback, truthful progress, game/Steam write guards, ownership and recoverable transactions. Validate actual contrast/focus/keyboard behavior, native names/status announcements, resize/zoom/reduced motion and performance. Qualify Windows WebView2 and Linux WebKitGTK on the implementation candidate, not only browser fixtures.
6. Design completion is separate from implementation/release completion. Final candidate gates remain [RND-251](https://linear.app/rndaom/issue/RND-251/run-the-cumulative-windows-and-linux-functional-release-matrix-before) and [RND-208](https://linear.app/rndaom/issue/RND-208/validate-and-publish-020-after-the-functional-fixes-and-profile), with latest-public profile/updater compatibility and required approved live evidence. The old October 1 date is tentative pending selected direction and estimate.

**Historical release gates — publication/version/tag actions are excluded from the current implementation authorization.**

* Verify [RND-209](https://linear.app/rndaom/issue/RND-209/keep-unsaved-files-drafts-when-leaving-the-pane-or-switching-profiles)/[RND-210](https://linear.app/rndaom/issue/RND-210/wait-for-a-successful-cfg-save-before-save-and-switch-navigates) and [RND-233](https://linear.app/rndaom/issue/RND-233/record-right-and-middle-mouse-buttons-with-the-correct-tf2-bind-names)–[RND-250](https://linear.app/rndaom/issue/RND-250/keep-the-ui-write-lock-closed-after-subscription-failure-despite-late) acceptance on the final candidate. Convert the audit's bad-outcome probes into meaningful regression expectations; passing diagnostic assertions currently means the bugs exist.
* Import profiles exported by the last public version. Test creator review/cancel/replay, exact-byte trust, independent imported profiles, deletion rules, interrupted transactions, single-HUD reconciliation and settings persistence.
* Test live Steam Cloud server round trip and offline restart. Filesystem dual-write tests alone are insufficient.
* Test selected particle-carrier removal, preloader Apply/Restore, Casual compatibility, stock-byte restoration, TF2-update/Steam-verify recovery and interrupted switch. Confirm \_dir.vpk is unchanged.
* Run Windows and Linux CI and packaged runtime checks: NSIS upgrade, AppImage update, .deb first install, write-lock/Steam-running refusal, relaunch/recovery and signed updater. September 5 audit ran Windows only; it did not certify Linux, new installer upgrades or real Casual behavior.
* Recheck dependency/third-party dispositions from [RND-205](https://linear.app/rndaom/issue/RND-205/disposition-the-inherited-linux-glib-advisory-before-the-next-release)/[RND-206](https://linear.app/rndaom/issue/RND-206/record-community-source-permission-status-and-verify-packaged-third), preserving the completed 0.1.1 evidence; Authenticode remains separately tracked by [RND-191](https://linear.app/rndaom/issue/RND-191/windows-code-signing-authenticode-for-the-installer-and-updater).
* Freeze notes, add a real CHANGELOG version section, bump all four version files, then follow docs/RELEASE.md: tag, draft verification, both updater entries/signatures, installer verification, publication.

**Implementation verification:**

- Common Foundry tokens/shell/controls plus task-specific layouts across every production pane, global flow and development Inventory.
- Exact selected acceptance plus cumulative RND-251; record meaningful visual differences and unrun native/platform checks.
- No version bump, release tag, publication or Done claim during current authorization.

**Native/platform limits:**

- Design selection is complete, not product implementation or release qualification.
- Historical tag/publish acceptance remains future work requiring a later explicit release request.

## Recorded candidate checkpoint — 542b3dd

**Development candidate: `7c78fbed1907dceb37bf348596fca48a8f654e66` on `rndaom/foundry-overhaul`.** The product implementation and evidence documentation are committed and pushed in [draft PR #60](https://github.com/rndaom/execs/pull/60); exact CI head is `542b3dd20f2847fc90a1a4e990584f03830fcc6d`. Public compatibility baseline remains v0.1.8. The [integrated design QA report](design-qa.md) records the accepted browser evidence, resolved findings and native limits. No issue is Done or release-qualified; no version bump, tag or publication is authorized.

| Check | Recorded result | Evidence |
| --- | --- | --- |
| Integrated `pnpm test` | 863 desktop + 160 cfglint + 21 tooling passed; 3 platform-specific tooling skips | [Complete frontend/tooling transcript](implementation/verification/frontend-tests-windows.txt) |
| Windows Rust workspace | 859 passed, 0 failed, 16 ignored as run: 121 native app + 738 core/integration passes | [Complete workspace transcript](implementation/verification/workspace-tests-windows.txt) |
| Required pinned HUD corpus, separate run | 6 passed, 0 failed, exit 0: four schema cases, one font-template case and catalog install/update exact payload checks over hypnotizehud, kinhud and m0re-rockz, including beyond-MAX_PATH fixture paths | [Pinned HUD transcript](implementation/hud/pinned-huds-windows.txt) |
| Static/build checks | `pnpm check` passed (375 files at product handoff); frontend build, Rust fmt and workspace all-target Clippy with warnings denied passed; diff check passed | [Build transcript](implementation/verification/frontend-build.txt), [Clippy transcript](implementation/verification/workspace-clippy-windows.txt), [integrated QA](design-qa.md) |
| Foundry browser review | Accepted pane/state captures at 1200×800 and 960×640; HUD/App settings also include 1280×720. No unresolved P0/P1 in the inspected browser scope. Individual reports identify accepted and superseded captures. | [Integrated QA and scoped reports](design-qa.md) |
| Inventory helper, separate scoped check | 7 tests plus helper fmt/Clippy passed; no retail TF2 performance trace | [Polling audit](research/rnd-325-polling-audit.md) |

The separate pinned HUD run qualifies six tests that are ignored by the default workspace invocation; the recorded default total remains **859 passed / 16 ignored**. Scoped test groups overlap the integrated totals and are not added again. The successful build retains its existing large-chunk advisory.

The earlier failed frontend/lint attempt remains preserved in [initial integration results](implementation/verification/2026-09-22-integration-results.md). Its stale Comfig selector and reported lint failures were corrected before the integrated pass above. The original design gallery has its own [accessibility/control verification](implementation/verification/gallery-accessibility-review.md). The accepted [implementation review gallery](implementation/review.html) now contains 85 captures across 15 pages and flows, paired with all five selected Foundry boards. Its [verification report](implementation/review-qa.md) records artifact and control checks; it does not extend native application qualification.

**Open qualification:** RND-324 retains its disclosed offline itemtest workflow. The parent's optional owner question about retaining that behavior versus requiring map-free completion is pending; no answer or acceptance change is inferred. Initialization/re-entry/failure-cleanup and real TF2 presentation remain unproven. The bounded local Windows startup/rootless/inactive-library results above now pass; signed Windows package startup and remaining media/dirty-close/updater cases, Linux native runtime, realistic prior-library installer upgrades, Cloud acknowledgement, actual Casual/stock restoration and on/off PresentMon remain separate uncompleted rows. Draft PR #60 is open and all five CI jobs passed on `542b3dd20f2847fc90a1a4e990584f03830fcc6d`; native/package/engine acceptance remains open.

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

## Native and platform qualification matrix

| Evidence family | Required evidence | Current result |
| --- | --- | --- |
| Browser visual/state | All matrix rows at 1200×800 and 960×640; focus/keyboard, resize/zoom, contrast, reduced motion, retained drafts and honest errors. | Accepted primary pane/state captures cover 1200×800 and 960×640 in the integrated QA report; HUD/App settings also include 1280×720. No unresolved P0/P1 in inspected browser scope. Native and any uninspected matrix states remain open. |
| Windows native | WebView2 rendered/usable; native dialogs/pickers/close, startup error without console, accessibility names/speech, actual media and process guards. | Bounded actual E7BC startup/rootless-settings/inactive-deletion and F6A0 chooser/import-Cancel scopes passed; see the separate follow-up identity/hash evidence. Full pane/media/dirty-close/process-guard and screen-reader speech coverage, plus signed packages, remain open. |
| Linux native | WebKitGTK rendered/usable; AppImage/.deb paths as applicable, keyboard/accessibility, media, safe unsupported viewmodel-build feedback and profile compatibility. | Linux CI passed at `542b3dd20f2847fc90a1a4e990584f03830fcc6d`: 867 default workspace passes plus 6 separate pinned HUD passes. Native desktop/runtime remains pending; CI does not establish it. |
| Transactions/compatibility | Disposable old/new profile fixtures; source hashes, write gate, shared content, interrupted recovery, HUD/particle ownership, exact export/import and unchanged directory VPK. | Windows workspace passes 859 tests; exact-byte HUD ownership/import/recovery boundaries and profile fixtures are included. The separate pinned HUD run passes 6 tests including exact payloads and long paths. Linux CI now also passes 867 workspace and 6 separate pinned HUD tests. Four actual public v0.1.8 exporter/current importer cases preserve 32 payloads in isolated Windows libraries. Packaged/native cases remain open. |
| Packages/updater | Realistic prior-public library round trip, visible app startup, signed discovery/install/error/stalled payload, Windows NSIS and Linux update/install distinctions. | Harness now checks realistic tagged-export fixture preservation and has 11 behavioral tests; old/current core export validation passed 24 payload comparisons. Actual signed installer and packaged UI round-trip executions remain open; no release tag/publication authorized. |
| Steam Cloud | Actual server acknowledgement and offline/reconnect/immediate restart, multi-account and cross-platform cases with original-state protection. | Not run by this planning review; filesystem dual-write is insufficient. |
| TF2/Casual/media | Active-profile preload, Apply→Casual→Restore, selected carriers, update/Steam-verify, real crosshair/audio/viewmodels and exact stock restoration. | Requires separately recorded actual native/live evidence; do not fabricate success. |
| Performance/presentation | Repeatable execs on/off PresentMon, TF2 foreground, both displays, clean startup and independent-flip/fullscreen preserved. | Pending; correlation alone does not establish cause. |

## Optional pool — explicitly outside current selected scope

There are **25** `execs-candidate` issues. Their location in milestone 0.2.0 and any pre-existing status do not add them to this implementation assignment. A visual redesign may improve composition within existing behavior; it must not silently implement adjacent candidates.

- [RND-298 — Review GameBanana file variants before choosing a download](https://linear.app/rndaom/issue/RND-298/review-gamebanana-file-variants-before-choosing-a-download) (Backlog; unchanged).
- [RND-229 — Show which particle mod wins each conflicting file before Apply](https://linear.app/rndaom/issue/RND-229/show-which-particle-mod-wins-each-conflicting-file-before-apply) (Backlog; unchanged).
- [RND-299 — Explain the cfg source and class context of a setting](https://linear.app/rndaom/issue/RND-299/explain-the-cfg-source-and-class-context-of-a-setting) (Backlog; unchanged).
- [RND-295 — Preview profile differences before switching](https://linear.app/rndaom/issue/RND-295/preview-profile-differences-before-switching) (Backlog; unchanged).
- [RND-302 — Remove or restrict unused whole-backup gameinfo restoration helpers](https://linear.app/rndaom/issue/RND-302/remove-or-restrict-unused-whole-backup-gameinfo-restoration-helpers) (Backlog; unchanged).
- [RND-300 — Extract settings loading and mutation coordination from SettingsHost](https://linear.app/rndaom/issue/RND-300/extract-settings-loading-and-mutation-coordination-from-settingshost) (Backlog; unchanged).
- [RND-204 — Trim redundant comments across panes, shared UI, hooks, and Rust commands](https://linear.app/rndaom/issue/RND-204/trim-redundant-comments-across-panes-shared-ui-hooks-and-rust-commands) (In Progress; unchanged).
- [RND-191 — Windows code signing (Authenticode) for the installer and updater](https://linear.app/rndaom/issue/RND-191/windows-code-signing-authenticode-for-the-installer-and-updater) (Todo; unchanged).
- [RND-267 — Let Linux users build custom per-class viewmodel setups inside execs](https://linear.app/rndaom/issue/RND-267/let-linux-users-build-custom-per-class-viewmodel-setups-inside-execs) (Backlog; unchanged).
- [RND-232 — Show local storage usage and safely clear rebuildable caches in Settings](https://linear.app/rndaom/issue/RND-232/show-local-storage-usage-and-safely-clear-rebuildable-caches-in) (Backlog; unchanged).
- [RND-231 — Show whether profile launch options are copied, pending or saved to Steam](https://linear.app/rndaom/issue/RND-231/show-whether-profile-launch-options-are-copied-pending-or-saved-to) (Backlog; unchanged).
- [RND-230 — Add Return to stock HUD without changing the rest of the profile](https://linear.app/rndaom/issue/RND-230/add-return-to-stock-hud-without-changing-the-rest-of-the-profile) (Backlog; unchanged).
- [RND-227 — Simplify Sounds browsing around the selected hit or kill sound](https://linear.app/rndaom/issue/RND-227/simplify-sounds-browsing-around-the-selected-hit-or-kill-sound) (Backlog; unchanged).
- [RND-226 — Add whole-profile viewmodel visibility presets with an exact change review](https://linear.app/rndaom/issue/RND-226/add-whole-profile-viewmodel-visibility-presets-with-an-exact-change) (Backlog; unchanged).
- [RND-225 — Bring visibility, FOV and transparent viewmodels together in Viewmodels](https://linear.app/rndaom/issue/RND-225/bring-visibility-fov-and-transparent-viewmodels-together-in-viewmodels) (Backlog; unchanged).
- [RND-223 — Duplicate any saved profile without switching it into the game](https://linear.app/rndaom/issue/RND-223/duplicate-any-saved-profile-without-switching-it-into-the-game) (Backlog; unchanged).
- [RND-222 — Rename profiles without rebuilding or copying their contents](https://linear.app/rndaom/issue/RND-222/rename-profiles-without-rebuilding-or-copying-their-contents) (Backlog; unchanged).
- [RND-221 — Add a safe uninstall and leave-TF2-as-is flow in app settings](https://linear.app/rndaom/issue/RND-221/add-a-safe-uninstall-and-leave-tf2-as-is-flow-in-app-settings) (Backlog; unchanged).
- [RND-220 — Add a curated Gameplay section for reload, healing and damage feedback](https://linear.app/rndaom/issue/RND-220/add-a-curated-gameplay-section-for-reload-healing-and-damage-feedback) (Backlog; unchanged).
- [RND-219 — Add precise mouse and zoom sensitivity controls to Gameplay](https://linear.app/rndaom/issue/RND-219/add-precise-mouse-and-zoom-sensitivity-controls-to-gameplay) (Backlog; unchanged).
- [RND-218 — Review bind conflicts and provide explicit clear and secondary-key actions](https://linear.app/rndaom/issue/RND-218/review-bind-conflicts-and-provide-explicit-clear-and-secondary-key) (Backlog; unchanged).
- [RND-217 — Expand Binds with combat, weapon, communication and menu actions](https://linear.app/rndaom/issue/RND-217/expand-binds-with-combat-weapon-communication-and-menu-actions) (Backlog; unchanged).
- [RND-301 — Keep serialized Rust records and TypeScript bridge types in sync](https://linear.app/rndaom/issue/RND-301/keep-serialized-rust-records-and-typescript-bridge-types-in-sync) (Backlog; unchanged).
- [RND-297 — Add bounded local profile restore points with a change review](https://linear.app/rndaom/issue/RND-297/add-bounded-local-profile-restore-points-with-a-change-review) (Backlog; unchanged).
- [RND-296 — Show local installation health and offline readiness](https://linear.app/rndaom/issue/RND-296/show-local-installation-health-and-offline-readiness) (Backlog; unchanged).

Inventory remains separate development work, not an optional feature silently promoted by the overhaul. The combined milestone still has 39 records: 14 selected plus 25 candidates.

## Planning execution record

The initial planning pass moved RND-208 to In Progress and recorded Foundry selection in the existing Linear plan/project/milestone notes, preserving all other issue state at that time. A later parent assignment authorized this agent's scoped RND-325 lifecycle/helper changes and RND-294 README/promo correction; both now have In Progress descriptions with actual checks and remaining gates. RND-325 readback additionally shows a related RND-324 link; no relationship field was sent and all prior relationships remain. No new issue, external comment/message, AGENTS/CHANGELOG edit, commit, version bump, tag or publication was performed by this agent. The parent owns integration, Unreleased entries and final disposition.

Machine-readable readback verification and exact metadata are in [planning-status.json](planning-status.json). Update this ledger as code owners report actual results; do not turn source inspection into a test pass.

The final candidate checkpoint above updates evidence only. This follow-up changes no Linear issue state, optional scope or original acceptance and sends no external comments/messages.
