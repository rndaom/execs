# 0.2.0 combined release plan

**Design direction revised — September 23, 2026. Implementation underway; no release authorized.** The owner requested dark neutral surfaces with a restrained warm-brown cast and warm off-white text, retaining TF2 orange for selections and necessary highlights. Important warnings use orange/red and success uses green; yellow warnings are removed. The current work is called the overhaul. Decorative or redundant helper text is removed. The earlier Foundry exploration and its captures remain dated design history, not the active visual specification. The combined scope remains all 14 selected existing issues plus the whole-app overhaul. Do not bump product versions, tag or publish. See the [implementation plan](foundry-implementation-plan.md) and [planning status](planning-status.json) for the original acceptance and open native/platform checks; the revised direction takes precedence over their historical color and naming references.

## Current hosted qualification checkpoint — September 23, 2026

Draft PR #60 product commit **`65d20bd`** passed all five [CI jobs](https://github.com/rndaom/execs/actions/runs/35937290554). The [native Linux run 35937290549](implementation/linux-native/run-35937290549/README.md) passed both inactive and active cases, including Files draft retention, explicit Save, native close → Cancel, Discard with restart, Save-and-close with restart, and clean close. The [Linux package run 35937290557](implementation/package-smoke/run-35937290557/README.md) passed its unsigned development AppImage upgrade, Debian upgrade, and Debian first-install cases with exact fixture checks. These are development runs on that PR test merge; they are not signed updater, Cloud, or retail TF2 results.

Direct-download DNS hardening head **`a077f16`** passed [all five CI jobs](https://github.com/rndaom/execs/actions/runs/35940690985), the local Rust workspace and direct/proxy network fixtures, and an ignored live GitHub metadata fetch. Its [Linux native rerun](https://github.com/rndaom/execs/actions/runs/35940690981) passed. Its [Linux package rerun](https://github.com/rndaom/execs/actions/runs/35940690993) **failed** at candidate GTK Import file selection after the previous public AppImage exported a byte-verified profile and the candidate launched and read the preserved setup. The exact existing ZIP path was visible in the chooser, but the same owned GTK dialog stayed mapped after one Return; the artifact does not show why. The guarded, import-only second Return with still-open capture and identity/focus checks passed 44 local package tests and was exercised in both upgrade cases of [run 35942107825](implementation/package-smoke/run-35942107825/README.md). That current-head unsigned package run passed AppImage upgrade, Debian upgrade and Debian first install with import/switch/reopen, exact fixture and cleanup checks. The prior failed run remains recorded as a harness failure; it did not qualify the product on its own.

The [Windows previous-public capability run 35937290574](implementation/package-smoke/run-35937290574-windows/README.md) failed after a verified public v0.1.8 NSIS install. Its old app and WebView2 child launched; the first early snapshot had no private debug listener, and later inspection and cleanup rejected process identity. The [direct-DNS rerun](https://github.com/rndaom/execs/actions/runs/35940690983) and [later rerun](https://github.com/rndaom/execs/actions/runs/35942107708) repeated that pattern. Follow-up found a harness ISO-string-versus-`DateTime` creation-time comparison that falsely rejected the same process. The [UTC-tick fix run 35944325809](implementation/package-smoke/run-35944325809-windows/README.md) confirmed the app listener on `127.0.0.1`, then failed because EdgeDriver bound the IPv6 wildcard `::`; driver-child cleanup refused an unapproved process, and UI Automation still failed to load. Its 51 artifact files are archived with SHA-256 provenance. No Windows export, candidate upgrade, or native UI qualification is claimed. [All five CI jobs](https://github.com/rndaom/execs/actions/runs/35944326001), [native Linux](https://github.com/rndaom/execs/actions/runs/35944325817) and [Linux packages](https://github.com/rndaom/execs/actions/runs/35944325738) passed on the UTC-tick fix head. The prior strict-mode registry enumeration failure was fixed before these runs, and the first failure evidence is retained. [RND-251](https://linear.app/rndaom/issue/RND-251/run-the-cumulative-windows-and-linux-functional-release-matrix-before) stays open for the Windows diagnosis and other unperformed gates. The audit remains at **33/35**; D7 permissions and D8 proxied CONNECT destination binding remain open. No release is authorized.

## Earlier September 23 integration checkpoint

The [program audit](../../audits/2026-09-23-program-audit/README.md) and its [remediation tracker](../../audits/2026-09-23-program-audit/remediation.md) record 33 of 35 findings addressed with targeted tests. D7 remains an owner/third-party permission decision; D8 needs a proxy-aware DNS and connection design with direct/proxy regression fixtures. The tracker distinguishes implementation evidence from retail TF2, Steam Cloud, and installer qualification. Inventory stays development-only and the 25 optional candidate issues remain unselected.

The newer [native Linux run 35780701908](implementation/linux-native/run-35780701908/README.md) passed its inactive-profile/keyboard-zoom/preferences-restart case. Its active Files case verified draft retention, explicit Save and native close → Cancel, then stopped on a WebDriver error after the Discard click; Discard completion, process exit/restart and Save-and-close remain open. The newer [package run 35780702038](implementation/package-smoke/run-35780702038/README.md) passed the complete AppImage prior-release export → candidate import/switch/reopen path with retained byte evidence. Its Debian cases stopped on a harness assertion before installation; Debian qualification remains open. Neither run qualifies the signed updater or release. The original artifact files are preserved with SHA-256 provenance; repository formatting excludes only those byte-preserved run directories.

Local integrated frontend, Rust, formatting and lint gates for this work pass as recorded in the remediation tracker. Remote CI and full Windows/Linux native, package, Steam Cloud and retail TF2 gates must be evaluated on the eventual PR head. This branch remains a draft; no product version, release tag, or publication is authorized.

## Earlier native Files checkpoint — run 35777278322

Product **d80fe57** passes the [native Files retention and explicit Save checks](implementation/linux-native/run-35777278322/README.md): both editor axes, selection and the exact 4,881-byte draft survive Binds → Files → Tab; Save verifies live/library bytes and manifest metadata. Five native states were individually inspected. The run stopped before sending a close request because the harness found three candidate windows, leaving Cancel/Discard/Save-on-close/restart unexecuted. The targeted [focus correction](implementation/native-scroll-follow-up/focus-fix/README.md) also passes 1,144 integrated local tests, TypeScript, production build and formatting, with browser forward/reverse-Tab evidence. All five [current-product CI jobs](https://github.com/rndaom/execs/actions/runs/35777278516) pass. The [Linux package run](implementation/package-smoke/run-35777278336/README.md) passes builds and the 470-package notices gate, and the authentic previous-release AppImage reads its fixture. It stops at GTK Save-window detection; the created export was not payload-validated and no candidate package was launched. The close/dialog harness corrections are independently reviewed, with 101 tooling tests passing and five platform skips; their next hosted execution remains pending. All selected acceptance and the no-release scope remain unchanged.

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

## Release decision and baseline

The combined target is **0.2.0**. The seven remaining 0.1.9 issues are consolidated into it; no separate 0.1.9 tag is planned. The scope is the **14 selected existing issues below plus the whole-app overhaul**. The owner’s explicit larger-release request expands the former feature budget; it does not automatically select the 25 optional `execs-candidate` issues.

The previous public baseline is [execs v0.1.8](https://github.com/rndaom/execs/releases/tag/v0.1.8), published **September 21, 2026 at 02:26:18 UTC**, at `85aaf6bc0dd28f43351d4cb5cdb62502737688d5`. Its [Mods release PR #59](https://github.com/rndaom/execs/pull/59) is merged and the maintenance release is complete. Use the actual latest public version again when preparing the final candidate if another urgent patch ships meanwhile.

**Date: unset, pending implementation and qualification estimates.** Foundry is selected. October 1 was the prior minor checkpoint, not a promise for this expanded release. Both milestone target dates were cleared during consolidation; October 1 remains only the superseded historical checkpoint. Choose the delivery date after the implementation/qualification scope is estimated. Urgent install, updater, data-loss or write-lock fixes still need prompt independent delivery if the overhaul is not ready.

The original audit workspace was `rndaom/inventory-manager` at `9ac45a3`; its captures included a separate shipped 0.1.8 Mods surface. Implementation now proceeds on `rndaom/foundry-overhaul`; the parent integrated the 0.1.8 forward-port at `e1fecdaaf4de2c7257eb2dbe875ac45f22ee4dcc`. Qualify the combined Mods behavior against minor-track profile-owned preloaders. The product implementation is committed locally at `7c78fbed1907dceb37bf348596fca48a8f654e66`; the current checkpoint records passing Windows automated and scoped browser checks. Native/platform/release qualification remains open.

## Selected issue scope

All 14 selected records are now **In Progress**, reflecting parent-assigned implementation underway. No item is Done or release-qualified. Original acceptance remains authoritative; assignees, labels, dependencies, milestone membership, the 25 optional candidates and published issue states are preserved. Current owner/proof details follow.

| Issue | Original milestone | Current status | Completion outcome |
| --- | --- | --- | --- |
| [RND-246](https://linear.app/rndaom/issue/RND-246/clear-stale-update-offers-when-a-later-check-reports-no-update) | 0.1.9 | In Progress | Reconcile update offers and check feedback with the latest authoritative result. |
| [RND-290](https://linear.app/rndaom/issue/RND-290/show-an-actionable-startup-error-when-durable-maintenance-preflight) | 0.1.9 | In Progress | Show actionable native startup failures while retaining recovery markers and fail-closed writes. |
| [RND-291](https://linear.app/rndaom/issue/RND-291/keep-each-settings-pane-at-a-predictable-scroll-position) | 0.1.9 | In Progress | Make pane scroll and active-navigation visibility predictable without losing drafts. |
| [RND-292](https://linear.app/rndaom/issue/RND-292/make-meaningful-helper-and-status-text-meet-minimum-contrast) | 0.1.9 | In Progress | Make meaningful helper, status and error text readable on every actual surface. |
| [RND-294](https://linear.app/rndaom/issue/RND-294/correct-installer-platform-and-casual-compatibility-claims-in-player) | 0.1.9 | In Progress | Correct platform, installer, cfg-surface and Casual claims; refresh public screenshots after implementation. |
| [RND-325](https://linear.app/rndaom/issue/RND-325/audit-execs-windows-polling-for-periodic-tf2-frame-stalls) | 0.1.9 | In Progress | Measure and resolve or rule out companion polling as a contributor to TF2 frame stalls. |
| [RND-251](https://linear.app/rndaom/issue/RND-251/run-the-cumulative-windows-and-linux-functional-release-matrix-before) | 0.1.9 | In Progress | Complete the cumulative final-candidate Windows/Linux, profile, updater, Cloud and real-game matrix. |
| [RND-213](https://linear.app/rndaom/issue/RND-213/delete-profiles-safely-from-the-profile-menu) | 0.2.0 | In Progress | Add safe profile deletion with explicit active/last-profile handling and interruption recovery. |
| [RND-214](https://linear.app/rndaom/issue/RND-214/add-app-settings-for-updates-motion-install-location-and-support) | 0.2.0 | In Progress | Add global app settings for updates, reduced motion, confirmed install changes and support. |
| [RND-202](https://linear.app/rndaom/issue/RND-202/replace-shared-preloader-selections-with-the-target-profile-during) | 0.2.0 | In Progress | Finish profile-owned preloader switching, migration, cleanup and rollback integration. |
| [RND-274](https://linear.app/rndaom/issue/RND-274/switch-local-only-particle-profiles-without-requiring-the-default-mod) | 0.2.0 | In Progress | Switch local-only particle profiles without an unnecessary default-library dependency. |
| [RND-215](https://linear.app/rndaom/issue/RND-215/enforce-one-hud-per-profile-across-replacement-import-switch-and) | 0.2.0 | In Progress | Complete one-HUD ownership across install/import, Mods, switching and absorb. |
| [RND-324](https://linear.app/rndaom/issue/RND-324/make-the-execs-tf2-preload-hook-startup-safe) | 0.2.0 | In Progress | Make the TF2 preload startup hook explicit, idempotent and startup-safe. |
| [RND-208](https://linear.app/rndaom/issue/RND-208/validate-and-publish-the-combined-020-overhaul-and-profile-management) | 0.2.0 | In Progress | Implement and qualify the combined Foundry scope; release publication remains a later, separately authorized gate. |

Creator ZIP import/trust review shipped in 0.1.6, Files workspace in 0.1.7 plus Hotfix 2, and the Browse/Installed/Casual Mods organization in 0.1.8. Preserve and redesign those inherited capabilities. Do not count them as pending new features. RND-248 is Done for the 0.1.8 global-preloader removal guard; its profile-owned integration remains part of RND-202.

The optional pool remains explicitly unselected. Its full list is in [release-scope.md](research/release-scope.md). Inventory also remains development-only and unassigned to release shipment unless the owner chooses it separately.

## Current implementation ownership and verified scope

All 14 selected issues remain **In Progress** with their assigned owners. Current code and recorded proof are listed below; no issue is Done or release-qualified. The 25 optional candidates, published issues, assignees, labels, dependencies and milestone membership are unchanged. Original acceptance/source snapshots remain in planning-status.json.

| Issue | Owner | Current work | Evidence / limitation |
| --- | --- | --- | --- |
| RND-246 | /root/app_settings | authoritative updater reconciliation implemented; Windows integration passed | 32 shared settings/updater tests; E7BC native manual check passed; signed install/failure/stale-offer runtime remains open |
| RND-290 | /root | native startup reporting implemented; Windows fixtures passed | 15 startup/content fixtures plus E7BC no-console native dialog, full copy and retained marker passed; package/Linux dialog matrix open |
| RND-291 | /root/surface_inventory | pane scroll retention implemented; scoped browser and integration checks passed | 6 scroll tests plus browser Comfig 196→Launch 0→Comfig 196 and profile reset 0; native scroll matrix open |
| RND-292 | /root/surface_inventory | Foundry contrast tokens implemented; accepted browser scope reviewed | Calculated token ratios and accepted browser scope; native pending |
| RND-294 | /root/release_scope | documentation and promo corrections integrated in product commit | Docs/media checked and committed; public media remains explicitly earlier release |
| RND-325 | /root/release_scope | source audit and bounded polling reductions implemented; runtime benchmark pending | 22 frontend + 7 helper tests; native trace pending |
| RND-251 | /root | Windows/Linux automated CI passed; native and package matrix open | Recorded five-job CI, old-profile/core fixtures and bounded E7BC/F6 native scopes passed; full native/package/engine matrix open |
| RND-213 | /root/profile_management | safe profile deletion implemented; Windows fixtures and integration passed | Disposable fixtures plus E7BC native inactive deletion/Cancel passed with exact retained hashes; active/last-profile/package matrix open |
| RND-214 | /root/app_settings | global App settings implemented; Windows integration passed | 13 core + 32 shared frontend tests; E7BC native rootless preferences/keyboard/copy/picker Cancel/reopen passed; full native/package scope open |
| RND-202 | /root/profile_management | profile-owned native preloader integration implemented; Windows fixtures passed | 5 orchestration + 78 core fixtures and Windows integration passed |
| RND-274 | /root/profile_management | local-only library predicate implemented; Windows fixtures passed | Shared orchestration/preloader fixtures and Windows integration passed |
| RND-215 | /root/foundry_hud | HUD ownership and exact-byte boundaries implemented; Windows and Linux fixtures passed | 69 frontend, recorded CI/corpus and isolated native HUD import review/Cancel pass; native activation/rendering/package matrix open |
| RND-324 | /root/foundry_mods | partial startup improvement; engine acceptance unresolved | Partial; 19 viewmodel fixtures; native engine gaps |
| RND-208 | /root with bounded pane agents | Foundry candidate and accepted review gallery committed; five-job CI passed | Committed candidate, accepted gallery, five-job CI and bounded 0.1.8 compatibility pass; no release |

Launch token editing and the explicit **Write to Steam** action are parent-designed enhancements within the owner's authorized gap-filling scope. They preserve the native save/check/copy contract: profile-owned options, prohibited-token checks, no Steam configuration write while Steam runs, and truthful copy/pending/saved feedback. The [Launch review](implementation/launch/design-qa.md) records 19 component/helper checks and accepted 1200×800/960×640 browser behavior. Real Steam-file writes remain unperformed. The separate RND-231 candidate remains unselected.

App settings/updater has a 32-test scoped pass including delayed resource-close and native-close readiness. Profile deletion/preloader checks use disposable fixtures. HUD exact-byte reset review and legacy recovery are implemented; 69 frontend checks, the full Windows core/workspace and the separate six-test pinned corpus pass. Native Cloud/TF2/Casual/PresentMon outcomes remain unperformed. RND-324 remains open with its pending owner preference and engine criteria.

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

## Added workstream: complete visual overhaul

Workstream: **Redesign execs across every pane and interaction state for 0.2.0**.

The full workstream and owner design-selection gate are tracked in [RND-208](https://linear.app/rndaom/issue/RND-208/validate-and-publish-the-combined-020-overhaul-and-profile-management) and the [Linear planning document](https://linear.app/rndaom/document/020-combined-release-and-whole-application-overhaul-1fe7c93751c6). Linear's free issue limit rejected creating a separate overhaul issue. No historical Done issue was reopened. RND-208 is now In Progress following the owner's Foundry selection; its existing dependencies are preserved.

The result should feel like a polished desktop product from a major game studio: restrained TF2 character, clear hierarchy, high-quality typography and spacing, responsive controls, purposeful motion and credible operational states. The three alternatives remain available as historical comparisons. Foundry is the selected system and must be applied consistently to unlike tasks. A catalog, editor, form and visual builder should retain layouts suited to their jobs.

### Audit deliverable and acceptance

- Capture settled screenshots for every current production pane and all meaningful state families below, including different selections, expanded controls, menus and dialogs. Use the [surface inventory](research/surface-inventory.md) as the detailed checklist and supplement its older Mods entries with the shipped 0.1.8 layout.
- Include the development Inventory pane in the audit as a separate development surface. Make its Steam-account ownership and release status explicit.
- Record screenshot ID, source ref/build, preview or native context, viewport, entry action/selection, observation and artwork/data provenance in the capture ledger. Link findings to evidence.
- Distinguish visually observed defects, reproduced interactions, source-derived risks and unobserved native-only states. Browser fixtures do not prove native media, screen readers, installers, Steam Cloud or successful live writes.
- Inspect default **1200×800** and minimum **960×640** windows, focus/keyboard states, long content, zoom/reflow and reduced motion. A test below the native minimum can supplement but does not replace those sizes.
- Cover each distinct control/state pattern and every materially different page/group. Repeating every numerical value or all catalog items is unnecessary; record the equivalence used and list any unobserved state explicitly.
- Provide a findings report with severity, evidence, consequence and design response. Audit completion requires a reconciled ledger, not a raw screenshot count or an unsupported “everything checked” claim.

### Required pane and state coverage

The matrix now defines required Foundry implementation and qualification coverage. Every production-pane baseline and the stated decision states need a usable treatment; reusable state patterns may share components when their application to all panes is documented. Native-only gaps in the audit may receive clearly labeled proposed designs, never fabricated current screenshots.

| Surface | Required Foundry implementation and verification coverage |
| --- | --- |
| Shell and navigation | Active profile/pane, wide and compact navigation, long-page scroll, profile menu open, hover/focus/selected states, install context, launch/locked state, footer and support. |
| Finder and onboarding | No/one/multiple install results, selection and Confirm, invalid/missing path/error, existing-setup capture, unused-install wizard, new profile Current setup/Fresh TF2, preset/addon selections and busy/locked behavior. |
| Profiles and imports | Active/inactive list, save current, export feedback, exact-byte ZIP review with findings expanded, trust/cancel, real progress/completion, switch stages, absorb Update/Restore/Keep, unsafe-folder review and recovery. Add labeled planned active/inactive/last-profile deletion flows for RND-213. |
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
| App settings — planned | RND-214 entry distinct from gameplay panes, usable before profiles; startup updates, Follow system/Reduce motion, confirmed install change, copy locations, diagnostics/support/credits, persistence/error/locked behavior. |
| Shared operational states | Loading/empty/error/retry/partial-cache; selected vs focused; saving/success/persistent failure/deferred draft; Save/Discard/Cancel and route-to-pane guards; update available/checking/no update/downloading/installing/failure; release notes; actionable native startup error; real progress and recovery. |
| Inventory — development only | Account/persona, backpack pages, selected detail and metadata, query/quality/sort/no result, ordinary/named/kit/war-paint items, stale/refresh/error/retry. Clearly label preview artwork/data and the absence of live rearrangement or release assignment. |

### Initial three-option design package and acceptance (selection complete)

- Produce **three separately organized image-generated design sets** with the same pane/state coverage, legible at desktop scale. Each option includes Comfig, Binds, Gameplay and HUD in multiple relevant states, plus every other production pane and global flows in the matrix.
- Give each option a short visual-system sheet: color/contrast roles, typography, spacing, control shapes, density, imagery, focus/selection, feedback and overlay rules. Preserve consistency without imposing one repeated page template.
- Keep TF2 influence subtle and intentional. Use credible existing media and source attribution. Avoid generated game previews presented as real, invented performance metrics, fake success, cloud profile sharing or account features.
- Include comparable compact-window views and an options gallery/contact sheet so the owner can compare the same page across A/B/C and inspect full-size images within one option.
- Provide a motion specification and storyboard or local interactive demonstration for pane changes, selection, menus/dialogs, disclosure, visual adjustment and save/operation feedback. Static images alone cannot establish animation quality.
- Document reduced-motion equivalents. Current 150 ms color/opacity and 220 ms movement defaults remain a baseline until the selected system is recorded; nonessential motion becomes immediate under Reduce/OS preference.
- Clearly mark proposed new RND-213/RND-214 flows and development Inventory. A visual direction may reserve space for optional ideas without turning them into approved functional scope.
- The owner selected Foundry only. Implement the five boards in `options/01-foundry/`, with all source-backed corrections in [concept-review.md](concept-review.md). Signal and Afterhours are historical alternatives; no mixture or implementation of them is requested.

### Implementation and qualification acceptance after selection

- Document the chosen system in the project guide and centralized tokens; build shared controls, shell, menus and feedback before applying pane-specific compositions.
- Preserve draft/session identity, keyboard capture release, explicit Files Save, retained failed/deferred drafts, write guards, exact profile switching, truthful progress and source-owned feedback. A visual refactor must not weaken those contracts.
- Validate readable text and essential controls on real backgrounds, visible keyboard focus, focus return/containment, disabled explanations, screen-reader names and error/status announcements.
- Implement functional motion without input delay, decorative perpetual animation or unmeasured in-game overhead. RND-325’s benchmark remains separate evidence for companion performance.
- Compare implemented screens against the selected images at both native window sizes. Track deliberate differences; do not silently accept clipping, missing actions or oversimplified state behavior.
- Complete appropriate component/integration tests and the existing frontend/Rust/CI gates. Use meaningful interaction/state tests for changed behavior; do not add tests that only restate CSS.
- Qualify the candidate on Windows WebView2 and Linux WebKitGTK, including keyboard/accessibility, density/zoom, native media and operation states within the recorded scope.
- The overhaul workstream can be design-complete before it is implementation-complete. It is release-complete only after RND-251 and RND-208 accept the actual candidate.

## Delivery sequence and dependencies

| Stage | Concrete deliverable | Exit criterion |
| --- | --- | --- |
| 1. Reconcile baseline | Shipped 0.1.8 plus current minor/development surfaces identified; all existing selected issue IDs retained. | Capture plan does not miss current Mods or mislabel Inventory as public. |
| 2. Complete visual audit | Labeled screenshots, state ledger, findings and explicit gaps. | Every matrix row resolved to evidence or a bounded gap. |
| 3. Present three full directions | Three comparable image sets, system sheets and motion treatment. | Owner can inspect every pane and major state in each consistent option. |
| 4. Select and estimate | Foundry selected; exact acceptance and implementation ledger recorded. | Design gate passed; date remains unset pending implementation/qualification estimate. |
| 5. Implement and integrate | Chosen shell/components/panes; 0.1.8 forward-port; RND-202/274/215/324; selected repairs/features. | Scoped behavior and compatibility tests pass; candidate UI covers the chosen state set. |
| 6. Qualify candidate | RND-251 Windows/Linux, public-profile/updater, native and approved live evidence. | All required gates are passed or explicitly resolved without claiming unrun checks. |
| 7. Release — not authorized now | Future frozen changelog, four matching versions, immutable tag and signed stable publication. | Requires a later release request after qualification; do not execute during Foundry implementation. |

Carry 0.1.8 into the minor before final screen and native qualification. Profile deletion depends on safe profile/preloader ownership; single-HUD work spans multiple import surfaces. App settings owns the new motion preference. Contrast and scroll belong to the new system rather than a parallel visual patch. Startup/updater failures still require backend and race-condition work in addition to new presentations.

## Scope protections and release evidence

Keep existing profile/export readability, atomic writes, current write targets, game/Steam locks, recovery and the no-write directory-VPK rule. Preserve updater URL/key and both supported platforms. A new write target, unreadable schema, dropped OS or updater-identity change needs explicit breaking-change handling, not accidental inclusion in the overhaul.

The latest published profile and updater path is the baseline at candidate time. Browser screenshots and synthetic fixtures are valuable but do not stand in for native screen readers, real Cloud acknowledgements, or approved TF2/Casual tests. Existing evidence retains its scope; the redesign requires fresh evidence where it changes the flow.

Current authorization covers Foundry implementation, all selected functional work, tests, visual verification and repository/Linear updates. Keep existing live-game/data-containment rules and accurately record native gaps. Do not bump product versions, create a release tag, publish or notify external participants. Shipping requires a later explicit release request.

## Historical Linear consolidation

Completed September 22, 2026 at 08:55:58 UTC. [Project](https://linear.app/rndaom/project/execs-a89f9a30e95c) · [Combined release and overhaul plan](https://linear.app/rndaom/document/020-combined-release-and-whole-application-overhaul-1fe7c93751c6) · [Release/workstream tracker RND-208](https://linear.app/rndaom/issue/RND-208/validate-and-publish-the-combined-020-overhaul-and-profile-management).

- Moved all seven selected 0.1.9 issues into the existing 0.2.0 milestone. 0.1.9 is empty and retained as an absorbed historical planning bucket.
- Verified 0.2.0 has **39 records: 14 selected existing issues and 25 unchanged optional candidates**. The overhaul is tracked inside RND-208 and the linked plan; no new issue exists.
- Cleared both fixed milestone target dates. The release date follows visual selection, implementation estimation and qualification.
- Preserved every selected/candidate issue's status, assignee and labels. The nine published 0.1.8 issues and RND-208's existing blocking dependencies are unchanged.
- Added current scope, public 0.1.8 baseline, full overhaul acceptance and owner design-selection gate to milestone/project planning, RND-208 and RND-251. Historical evidence remains below the new issue/project notes.
- A separate overhaul issue was attempted once and rejected by Linear's free workspace issue limit. The linked project document was created successfully, with full pane/state coverage; no work was dropped.

[Consolidation verification](combined-release-consolidation.json) records the exact before/after issue identities and checks. [Linear handoff and execution record](combined-release-linear-handoff.json) retains the original proposal for history and marks the actual operations/results complete; do not replay it.

That consolidation step performed no product implementation, AGENTS.md changes, version bump, commit, branch/tag, publication, optional-feature selection, or messages/comments to people. The later Foundry implementation authorization supersedes its design-only boundary; version/tag/publication remain excluded.

## Foundry implementation planning update

The owner selected all five Foundry boards (`01-core`, `02-customization`, `03-workspaces`, `04-profiles`, `05-states`) as the sole direction. Exact acceptance and source-based implementation/proof gaps for every selected issue are in [foundry-implementation-plan.md](foundry-implementation-plan.md). Known image inaccuracies remain in [concept-review.md](concept-review.md); generated metrics, game art and unsupported actions are not product requirements.

The initial selection update moved RND-208 from Todo to In Progress. The later authorized implementation-allocation update moved the remaining selected Backlog/Todo records to In Progress; all 14 are now in that state. The 25-candidate pool, assignees/labels/dependencies and shipped 0.1.8 records are preserved. No new issue is needed under the existing workspace-quota fallback. The project document and current milestone/project notes record Foundry selection, implementation underway and no release. Machine-readable verification is in [planning-status.json](planning-status.json).

## Assigned implementation follow-up

RND-325's timer/process audit, lifecycle presentation polling reduction and names-only development Inventory helper reads are implemented; 22 frontend and 7 helper tests plus targeted formatting/Clippy checks passed. Its real TF2/PresentMon, dual-display presentation and causal classification are still pending. See [polling audit and protocol](research/rnd-325-polling-audit.md).

RND-294's README and rendered promo corrections are locally verified, with earlier-release fixture media explicitly labeled. Parent integration and Unreleased notes remain. See [documentation/media evidence](research/rnd-294-documentation-review.md). Both assigned issues are In Progress, not Done. No release is authorized.

## Supporting material

- [Release research and exact existing scope](research/release-scope.md)
- [Source/milestone evidence snapshot](research/release-scope-evidence.json)
- [Detailed surface inventory and capture boundaries](research/surface-inventory.md)
- [Visual and motion research](research/design-research.md)
- [Public v0.1.8](https://github.com/rndaom/execs/releases/tag/v0.1.8)
- [Linear execs project](https://linear.app/rndaom/project/execs-a89f9a30e95c)
