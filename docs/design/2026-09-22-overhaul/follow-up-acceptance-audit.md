# Remaining acceptance: concrete follow-up work

September 22, 2026. Read-only requirement audit at repository head `03b406e973d5188347622f51e9b4518da713274e`; product follow-up commit `44bc5f4f54ba4d41bd9ddd27342223ae08b971da`. This report preserves all **14 selected issues**, including the overhaul in RND-208, their original acceptance and In Progress states. The 25 optional candidates remain unselected and Inventory remains development-only. No product change, native test, Linear update or new pass is performed by this audit.

The exact original requirements remain in [`planning-status.json`](planning-status.json), `selectedIssues[].acceptance`, and the [implementation plan](foundry-implementation-plan.md). The requirement summaries below are a checklist, not replacement acceptance. Earlier per-issue verification fields describe their recorded checkpoint; the later `execution.followupCheckpoint` and [native Windows report](implementation/native-windows/README.md) supply the newer, narrowly attributed runtime evidence. CI on `542b3dd20f2847fc90a1a4e990584f03830fcc6d` is not reassigned to a newer head.

## Follow-up outcomes at c006dda

The root subsequently executed the queue below. The [current checkpoint](native-reflow-follow-up.md) separates each executable/fixture identity and retains the original acceptance. The detailed audit below remains the dated 03b406e assessment; its previously missing steps are superseded only by the scoped evidence in this table.

| Proposed work | Current outcome and remaining boundary |
| --- | --- |
| Inactive import → export → reopen | [Passed on native Windows](implementation/native-windows/import-export-follow-up/README.md): ten imported/exported payloads match and all 31 post-export files remain exact after restart. A separate keyboard-entered export path also passes with four exact payloads and all 20 originals unchanged. Export was invoked from profile actions, not the delete confirmation; export-before-delete integration remains unobserved. |
| Four startup-error variants | [Native Windows cases](implementation/native-windows/startup-variants/README.md) observed unset APPDATA, mismatched token, multiple markers and an exclusive-file-lock read denial. Each showed the expected OS diagnostic, copied its complete text and exited normally without a main window or WebView2 process. Marker preservation and original settings are checked per case. This does not transfer to Linux or installers. |
| Sounds → Mods → Files | [Both browser sizes pass](implementation/pane-scroll-follow-up/README.md) after fixing a real Files internal-scroll reset. Separate pane/editor positions, 2,470 draft bytes, selection and resize visibility are preserved. Active native workspace behavior remains separate. |
| Composed text contrast | [27 actual rendered pairs pass](implementation/contrast-follow-up/README.md), minimum 5.4247:1, including placeholders, HUD credits, import warnings, preference errors and translucent banners. Unmeasured states, image-backed text and full native accessibility remain outside this sample. |
| Native preference failure → Retry | [Passed](implementation/native-windows/zoom-follow-up/README.md), including unchanged failed bytes and restart persistence. A later 7D3 case separately verifies the corrected error context and Retry. It does not repeat the earlier zoom/restart scope. |
| Actual scheduling | [Partial runtime observation](implementation/native-windows/import-export-follow-up/metadata/export-path-7d3/process-priority-observation.json): Normal app process, 46 Normal-priority threads. WebView2 child priority, background comparison and paired TF2/PresentMon measurements remain unobserved; causation stays unclassified. |

The [bounded Linux native retry](implementation/linux-native/retry-35763403785.md) additionally passes launch, inactive navigation, keyboard zoom/reset, preference saving/restart and fixture preservation. Physical pointer input at 200% remains unqualified because the observed WebDriver path delivered events at the wrong coordinates. No original requirement is deleted or replaced, and no release is authorized.

## Initial proposed queue at 03b406e

1. **Native inactive import → export → reopen.** Extend the previous native review/Cancel case to an actual v0.1.8 multi-HUD import with an explicit owner, export the new inactive profile through the native Save dialog, and reopen. Compare payloads, owner/reset metadata, empty imported preloader selection, all pre-existing files and active id. This adds native evidence to RND-215/251/208; exporting from the delete confirmation also checks RND-213's export-before-delete integration. Root owns UI; the profile-management agent is preparing helpers/validation. This is proposed work, not a pass.
2. **Remaining native startup-error variants.** Use separate private cases for unset APPDATA, mismatched token, multiple markers and a marker held with `FileShare.None`. Preserve every marker, record the full native diagnostic/version/path and dismissal, and verify no main window or console. This fills RND-290 branches absent from the existing corrupt-marker demonstration; repeat neither the old case nor the whole unit suite.
3. **The exact RND-291 navigation sequence.** In the disposable browser preview, test long Sounds → Mods → Files at both 1200×800 and 960×640, using keyboard navigation and a retained Files draft. Record first-visit top, each revisit's scroll offset, active-navigation visibility after resize, and unchanged draft text/selection. Existing Comfig 196 → Launch 0 → Comfig 196 proves a different important case, not this named sequence.
4. **Real composed contrast measurements.** Collect computed foreground/background/opacity for helper rules, empty/error text, source-credit links and placeholders, including selected/hover/overlay states. Composite translucent backgrounds through their actual ancestors; image-backed text needs its actual backing/scrim assessed. Record ratios and focused screenshots, then fix only demonstrated failures. The existing solid-token calculations do not cover this acceptance detail.
5. **Native App settings write-failure → Retry.** After a successful read in a new rootless case, hold only its private `settings.json` with `FileShare.None`, change one preference, and observe the error and truthful persisted selection. Release the handle, use Retry, and verify that only the intended preference changes and survives reopen. This adds native failure/notification evidence without activating a profile. Failed global preferences revert their displayed value while retaining a retry attempt; do not assume Files-style close-dialog semantics.
6. **Record actual scheduling without launching TF2.** During one already-authorized isolated native session, read the app and WebView2 process/thread priority and identity. This fills the runtime-priority part of RND-325. It is not a frame-time measurement or evidence that execs is ruled out as a stall contributor.

## Detailed acceptance audit at 03b406e

### RND-246 — authoritative update checks

- **Original requirements:** newest authoritative check reconciles offer/dismissal/feedback; old concurrent responses cannot revive offers; cover offer→none/newer/failure/dismissed/out-of-order launch/manual checks; preserve signed Rust-side installation.
- **Strongest evidence:** [App settings QA](implementation/app-settings/design-qa.md) records 11 updater-hook and 7 bridge tests within its 32 shared tests, including the delayed resource-close identity race and native-close readiness. E7BC native manual check reaches the actual current-version result. Source installation remains click-only and signature-verified.
- **Specifically missing:** a production native offered-update transition and actual signed install/failure/stalled-payload lifecycle. The local 0.2.0 app checking public 0.1.8 cannot produce the missing offer→none scenario naturally. These are also RND-251 gates; the focused reconciliation regressions are already covered.
- **Next safe action:** retain those existing regressions and prepare/execute the separate private signed-updater qualification when its candidate exists. Another identical manual current-version check adds no evidence. Do not weaken production feed/signature checks to manufacture an offer.

### RND-290 — startup errors before the webview

- **Original requirements:** OS-native error, full diagnostic version/state path and protective/copy/report wording; markers preserved and writes fail closed; absent environment, corrupt/mismatched/multiple markers, access denial and normal startup covered in isolated directories.
- **Strongest evidence:** 15 startup/content fixtures plus E7BC actual native corrupt-marker dialog, copied full diagnostic, no console, unchanged marker and successful rootless startup. [Native report](implementation/native-windows/README.md).
- **Specifically missing:** native observation of the four other failure variants, especially read denial; Linux-native and packaged-startup results remain separate.
- **Next safe action:** queue item 2. Mirror the existing exclusive-open test at [`lib.rs:890`](../../../apps/desktop/src-tauri/src/lib.rs), which denies access with a held file handle and avoids changing any real ACL. Unset APPDATA only in the isolated child environment; `settings.rs` intentionally refuses it instead of choosing a fallback data directory.

### RND-291 — predictable pane scrolling

- **Original requirements:** first visit at heading; consistent subsequent restore/reset without draft loss; active navigation remains visible on tab/resize; exact long Sounds→Mods→Files, keyboard and drafts at both supported sizes.
- **Strongest evidence:** six layout tests cover snapshot-before-clamping, asynchronous restoration, input cancellation and identity reset. [Interaction completion](implementation/interaction-completion/design-qa.md) records actual Comfig/Launch restoration and profile-change reset. Final six-profile menu reflow is separately verified, including a bounded native menu spot check.
- **Specifically missing:** recorded actual-browser results for the named three-pane sequence at both sizes; corresponding native workspace behavior remains unobserved.
- **Next safe action:** queue item 3. Navigate while a Files draft exists and return through the long panes; compare draft bytes and scroll offsets rather than merely taking three screenshots. Native repetition requires a safely isolated active workspace, not activation of the present local inactive fixture.

### RND-292 — meaningful text contrast

- **Original requirements:** meaningful small text at least 4.5:1 on real backgrounds; cover helper/empty/error/credit/placeholder text, preserve intentional disabled/decorative exceptions, central tokens, computed pairs, keyboard focus and Unreleased note.
- **Strongest evidence:** [Foundry contract](foundry-system.md) records solid-surface minima: ink 12.13, muted 7.06, faint 5.42; destructive-button text 4.82. Shared colors and accepted screenshots were reviewed, and focus has scoped interaction evidence.
- **Specifically missing:** a recorded inventory of actual computed pairs for translucent/composed backgrounds and placeholders; token math alone does not prove those states. No complete accessibility certification is implied.
- **Next safe action:** queue item 4, starting with HUD source/coverage and picture captions, Files placeholder/problem text, import warning/details, App settings failure and running/deferred banners. Record actual exceptions explicitly instead of lightening every disabled label.

### RND-294 — truthful player documentation

- **Original requirements:** remove unsafe SmartScreen/download promises; accurately state source/publisher/hash checks and managed-device limits, Windows compilation/Linux prebuilt capability, cfg surfaces and bounded Casual/Restore behavior; distinguish public media from unreleased capabilities; keep Authenticode separate; add Unreleased correction.
- **Strongest evidence:** corrected README/release wording and promo are integrated; the public baseline is v0.1.8 and earlier media is labeled. The recorded promo render and inspection are scoped documentation evidence, not a live-game claim.
- **Specifically missing:** no additional implementation or native action is identified for this issue's present wording requirements. Authenticode and replacing public screenshots after an eventual release are separate work.
- **Next safe action:** none needed now. Retain the corrected claims while other acceptance is measured; revise them only if new verified behavior changes what they should say. Do not invent a release prerequisite to repeat this finished documentation review.

### RND-325 — periodic frame-stall investigation

- **Original requirements:** inventory all timers/process/window queries, reduce unnecessary frequent polling, maintain normal/background priority and unblocked UI/transactions; reproducible paired PresentMon on/off captures with TF2 foreground and both displays; preserve independent flip and classify cause/contribution/ruled-out from evidence.
- **Strongest evidence:** [polling audit](research/rnd-325-polling-audit.md) enumerates intervals and worker boundaries, reduces lifecycle presentation polling and helper metadata reads, preserves native lock sampling, and records 22 frontend plus 7 helper tests. It provides the paired-capture protocol.
- **Specifically missing:** actual scheduling observation, paired raw captures, periodicity analysis and causal classification. Existing off captures already showed stalls; source cleanup does not establish causation or a fix.
- **Next safe action:** queue item 6 for the scheduling requirement. Actual TF2 on/off measurement still needs the existing protected live-test conditions and three comparable capture pairs; no browser test can replace it. Leave the outcome unclassified until those captures exist.

### RND-251 — cumulative release matrix

- **Original requirements still open by row:** NSIS previous-public upgrade/restart plus signed updater success/failure/stall; AppImage first launch/update and .deb first install/no self-update; TF2/Steam lock races and quit/absorb; every pane's writes, debounce/in-flight navigation/retry/offline/profile isolation; old export/native import, case-only paths/unreadable/Keep/Restore/recovery; actual Cloud acknowledgement/offline/reconnect/accounts; real crosshair/audio/viewmodels; preloader Casual/Restore/update/interruption with exact DATA and unchanged directory VPK; native pending-settings/Files close and integrated feedback. Its linked regression requirements and exact final candidate identity remain part of the original acceptance.
- **Strongest evidence:** old-head Windows/Linux CI and pinned HUD corpus pass; four actual v0.1.8 export/current-import core cases preserve 32 payloads; [package-smoke](implementation/package-smoke/README.md) adds realistic tagged payloads, 11 behavioral harness tests and 24 old/current core comparisons. Current bounded native startup/settings/inactive deletion/chooser/import-Cancel and local follow-up tests are individually attributed in the ledger.
- **Specifically missing:** the unrun rows above, not the already-completed full unit suite. No actual installer run or usable packaged prior-profile round trip is claimed. Existing native evidence covers the inactive/rootless flows, not active pane mutations or live-game effects.
- **Next safe action:** native queue items 1 and 5 add real round-trip and failure/feedback results now. Follow with a separate changed-source-after-review refusal case, using a disposable copy of the ZIP, to exercise the native exact-byte review boundary. Keep Windows active-workspace/dirty-close checks behind independent Steam/Cloud isolation; Linux-native work is already assigned and should not be duplicated.

### RND-213 — safe deletion

- **Original requirements:** named themed confirmation/effects/export, inactive-only deletion with shared-reference preservation, explicit active switch-first or keep-installed/untrack and safe last-profile handling, running/recovery/write guards, interruption safety; active/inactive/last/cancel/missing/corrupt/shared/restart cases.
- **Strongest evidence:** [profile verification](implementation/profile-management/verification.md) records nine core deletion tests and frontend choice/focus/failure coverage. E7BC native inactive deletion removed exactly four target files; only index bytes changed and all 15 other files matched, including live data and retained shared content. F6/7D qualified later inactive navigation separately.
- **Specifically missing:** native export-before-delete, active switch-first/keep-installed, last-profile and failure/restart UI. Existing inactive success/Cancel needs no repetition.
- **Next safe action:** use the newly imported inactive profile's confirmation **Export profile** button for queue item 1, then Cancel deletion; assert the named target and native output match. A last-inactive-profile case needs a separate first-run transition safety trace before execution. Active cases belong in an independently Steam-free environment.

### RND-214 — global App settings

- **Original requirements:** pre-profile global entry; startup-check default/manual access; System/Reduce honoring OS; existing location/Confirm/copy/update/diagnostics/support/credits; atomic additive global preferences, click-only install and excluded tuning/telemetry/cleanup; keyboard/focus/Escape/restart/missing-settings/both OS/game-running checks and spec.
- **Strongest evidence:** 13 core settings fixtures and 32 shared frontend tests; browser OS-motion and running-state checks; E7BC native rootless preferences, keyboard focus, copy, picker Cancel, restart persistence and manual check. [Settings QA](implementation/app-settings/design-qa.md) and [native report](implementation/native-windows/README.md).
- **Specifically missing:** real native preference failure/retry, complete support/copy/credits interactions and Linux-native behavior. Actual OS scaling/reduction is distinct from browser emulation. Native game-running behavior needs controlled process conditions, not a retail launch merely to fill a checkbox.
- **Next safe action:** queue item 5; while that rootless case is open, verify Copy diagnostics and credits disclosure with keyboard, without sending a report or changing the confirmed installation. Record actual clipboard contents and focus, not just enabled buttons.

### RND-202 — profile-owned preloader switching

- **Original requirements:** one recoverable profile-aware transaction across cleanup entry points; migration before destructive cleanup; preserve source choices; preflight targets; command-level source removal/external removal/migration/failure/return/crash cases; owner's exact two-profile case both directions, restart, empty/imported/exported profiles.
- **Strongest evidence:** five native command-orchestration tests and 78 preloader fixtures, including projection bytes, legacy migration, refusal and interruption. Source removed the old global clear/reconcile route; current CI includes the fixture suite.
- **Specifically missing:** the owner's exact Low/Flat ↔ Ultra Ultimate TF2 Fix Pack selection/content pair through actual native UI and restart. Synthetic local-PCF fixtures do not establish that real-content case. Actual Casual behavior remains RND-251/324 work.
- **Next safe action:** inventory that exact pair's selected addon/particle IDs and content hashes read-only, then prepare a disposable scenario using copies before any activation. Native import/export may verify portable selection metadata while inactive; it cannot qualify installed projection switching. Do not launch the present fixture with an active id on a Steam-discoverable host.

### RND-274 — local-only particles without default cache

- **Original requirements:** Apply/switch/recovery share the actual-selected-source library predicate; local-only switch/reapply/export-import works without cache; default selections retain strict hashes; missing cache refuses before touching prior profile.
- **Strongest evidence:** [`library_tests.rs:220`](../../../apps/desktop/src-tauri/src/commands/library_tests.rs) runs switch both ways, same-profile reapply, disk reread/restart, export/import and selected DATA restoration, asserts unchanged directory VPK and absent default ZIP. The default-library refusal test preserves previous DATA/state/active id/choices. Core fixtures also cover the predicate/recovery.
- **Specifically missing:** real native GUI/network-offline traversal of those already-proven command paths, including displayed selection and actionable refusal. No additional source defect is inferred from the lack of GUI evidence.
- **Next safe action:** reuse that exact local-PCF fixture in an independently Steam-free native worker, with the default ZIP absent and network unavailable. Observe successful local-only selection/switch and then a default-selection refusal with source bytes unchanged. Do not repeat the command test as a new runtime result or download the default cache to make the local-only case pass.

### RND-215 — single-HUD ownership

- **Original requirements:** consistent catalog/update/archive/folder/Mods/profile-import/switch/absorb ownership, only chosen HUD mounted and old generated options removed, explicit legacy/multiple-HUD review with preserved originals, transaction/case/collision safety; A→B→absorb→away/back, same-HUD update, mixed imports/failure/restart/running refusal on both platforms.
- **Strongest evidence:** 69 frontend tests; exact-byte ownership/recovery fixtures in both recorded platform CI runs; six pinned HUD checks on each OS including actual three-package install/update and Windows long paths; four old-export cases. F6 native import review/Cancel verified the real picker and choice surface without confirmation.
- **Specifically missing:** native import confirmation/result/export and pending reset; active native catalog/folder/Mods/replacement/absorb/restart paths. Browser installation and corpus library mutation are different evidence from desktop entry-point execution.
- **Next safe action:** queue item 1 with changed-owner selection. Assert all original cfg/HUD payloads survive and `hudReviewPending` remains true; do not activate or clear it to make the report look complete. A second keep-owner case can verify the contrasting metadata without repeating all prior core corpus tests.

### RND-324 — startup-safe preload hook

- **Original requirements:** supported exec hook and active selections, no avoidable missing-itemtest warning or implicit map/disconnect/clear cycle, once after initialization without re-entry, clear failure without temporary-server residue, clean-launch/PresentMon and no independent-flip regression.
- **Strongest evidence:** 19 generated-viewmodel/preload tests; removed console clearing and post-disconnect server script call, normalized duplicate exec spellings, and disclosed actual offline behavior. [Engine-source follow-up](research/rnd-324-preload-startup.md) identifies why dummy map cfg, simple alias guards and first-spawn hooks do not establish the full requirement.
- **Specifically missing:** the no-map behavior, verified initialization/re-entry boundary, failure cleanup and actual presentation evidence. These are missing behavior/proof, not a visual QA gap. The optional owner question has not changed acceptance.
- **Next safe action:** no native menu exercise can close this issue. Resolve whether the existing offline workflow is acceptable or identify a supportable engine mechanism before further implementation. Until then preserve the exact unresolved criteria and avoid adding cosmetic success text or an unproven cfg guard. A retail test requires the separate player-state/Cloud safety conditions.

### RND-208 — complete selected Foundry work and qualification

- **Original requirements:** whole-pane/state audit/provenance, three comparable image directions and systems/motion, selection before implementation, shared Foundry with distinct pane jobs and no invented functionality, preserved drafts/guards/transactions, actual contrast/focus/names/announcements/resize/zoom/motion/performance, Windows/Linux native candidates; RND-251 and compatibility gates. Historical release steps are explicitly outside current authorization.
- **Strongest evidence:** five Foundry boards selected; all production panes implemented; 85-capture/15-flow review gallery plus scoped reports and resolved follow-up reflow findings. Actual Windows startup/rootless/inactive flows and final positioned menu have precise binary/case/hash records. Browser motion and keyboard checks exist; static concepts are not animation proof.
- **Specifically missing:** actual native zoom/OS scaling and screen-reader announcements, composed contrast inventory, active native pane/dirty-close/media matrix, Linux-native qualification, updater/package/Cloud/engine gates. The 7D menu spot check does not transfer E7/F6 results to its binary.
- **Next safe action:** root's current native zoom check plus queue items 1–5. For accessible speech, inspect actual announced names/status in a bounded rootless or inactive flow; semantic DOM/UIA names alone do not prove narration. Publication, version bump, tag and broad completion claims remain excluded.

## Safety trace for the proposed inactive round trip

The existing [inactive-library safety proof](implementation/native-windows/reproduction/inactive-library-safety.md) covered review/Cancel and deletion only. The following source trace supports planning a new confirmation/export case; it does not retroactively expand the old native pass.

| Boundary | Current source behavior and required invariant |
| --- | --- |
| Native confirm | [`commands/library.rs:339`](../../../apps/desktop/src-tauri/src/commands/library.rs) consumes the backend-owned token, validates the selected HUD and root context under WriteGate, then imports the reviewed ZIP. No renderer-supplied trust payload replaces the review. |
| Exact bytes and library-only publication | [`zip.rs:237`](../../../apps/desktop/src-tauri/core/src/zip.rs) rechecks the ZIP hash/payload/choice and passes `false` for `activate_if_none` into `create_populated_profile_to`; only the new private profile, shared blobs and atomic library index are published. The imported `launchSyncPending` flag does not execute launch reconciliation while inactive. |
| Renderer after import | [`useProfileLibrary.ts:329`](../../../apps/desktop/src/hooks/useProfileLibrary.ts) sets the returned library and import result; it does not switch. [`settings-ui.ts:47`](../../../apps/desktop/src/lib/settings-ui.ts) requires a non-null active profile before mounting profile settings. |
| Boot/absorb | [`absorb.rs:221`](../../../apps/desktop/src-tauri/core/src/absorb.rs) returns for a null active id before repair, drift or Cloud/live writes. Steam discovery can still occur read-only; redirected APPDATA alone is not a Steam/account sandbox. |
| Export | [`commands/library.rs:188`](../../../apps/desktop/src-tauri/src/commands/library.rs) uses the native Save picker then reacquires gate/root identity. [`zip.rs:185`](../../../apps/desktop/src-tauri/core/src/zip.rs) reads the requested library profile and read-only selection state, validates exact source hashes and writes only the chosen output ZIP. Pick a new private output outside the library. |

Use a fresh isolated case, synthetic confirmed root, at least two existing saved profiles, **active id null**, and no maintenance/pending-switch/interrupted-profile/mutation/preloader journal, orphan creation or preloader state. Keep an immutable original archive and mutate only a separate case copy if testing stale review. Never press Switch, Save current, New profile, Launch, install Confirm or update installation in this local case.

For success, allow exactly one new UUID/index entry, its expected manifest/payload/shared additions and the selected exported ZIP. Compare all pre-existing manifests, payloads, shared blobs, synthetic live files, settings and source ZIP hashes; active id remains null. Inspect the export's payloads independently of the fixture generator, including owner/pending-reset metadata and imported empty preloader choices. Reopen and compare again; require no temporary transaction remnants. Export-before-delete can be exercised and then canceled without deleting another existing fixture profile.

The actual tag-export archives and their source revision are retained in [compatibility-v018](implementation/profile-management/compatibility-v018/README.md). Root owns app launch and UI. The profile-management agent owns the new fixture/validator preparation. No active-profile safety is inferred from this inactive path; that requires its own source trace and an environment where Steam Cloud/account discovery cannot reach player state.
