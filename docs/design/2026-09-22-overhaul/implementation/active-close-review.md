# Active close and pending-change review

Source/test review on September 22, 2026, starting at `5bda798115b936d5d6f796d42614a0955f6748bf`. Scope: `useFilesExitGuard`, `useNativeCloseGuard`, both draft stores, their settings boundaries, and the existing App/Modal tests. This review found and fixed two bounded defects. Native Linux close evidence and the root operator's browser screenshots are separate; no native application was launched for this review.

## 1. Review changed panes without moving keyboard focus

When the pending-changes dialog's **Open Sounds** action replaced a visible HUD pane, navigation updated the selected pane but supplied no destination focus. The modal could not restore its original HUD control after that control became hidden, leaving focus on `BODY`. If the opener remained visible, such as a header action, focus returned there instead of entering the requested review pane.

An in-memory React/JSDOM probe used the actual guard and Modal with two registered pending panes: focus a HUD control, request the transition, then choose Open Sounds. It recorded `soundsVisible: true`, `draftCount: 2`, `modalClosed: true`, and `afterOpenPaneTag: BODY`. No repository file or fixture data was modified by that probe.

The [App regression](../../../../apps/desktop/src/App.pending-settings.test.tsx) uses the actual App with preview API calls that reject HUD and Sounds saves. It explicitly opens HUD's Installed tab, edits both visible controls, and returns to the HUD control before the mocked native close. Cancel must restore that control. A second close followed by Open Sounds must focus the visible Sounds heading while retaining both drafts; a later ordinary navigation click must retain its own focus. The destination-focus assertion failed before the fix and passes afterward.

The fix gives [pane headings](../../../../apps/desktop/src/components/ui/PaneHeader.tsx) a programmatic focus target and adds a review-only [App callback](../../../../apps/desktop/src/App.tsx). Its effect runs after modal layout cleanup, chooses the visible profile-pane heading, and does not override another remaining modal. Ordinary navigation and Cancel do not invoke this focus route.

A supported browser check is `?preview=settings-crosshair` → Custom → App settings → Change install → Open Crosshair. The guard should disappear, the profile workspace should return, and the Crosshair heading should receive visible focus. The root operator owns that browser verification. The locked preview has no Review changes action while TF2 is running, so it is not a valid browser reproduction for that trigger.

## 2. A newly started write could bypass the close prompt

`SettingsBusyQueue.run()` increments its synchronous pending count before React publishes the busy state. The native close listener correctly consults `settings.isWriting()` and intercepts a close in that interval. However, the continuation passed to `useFilesExitGuard.request()` previously checked a render-captured `operationBusy`. With no drafts and an older `false` value, it immediately invoked destruction despite the live queue being active.

The source-level sequence is: render a clean guard; start a queue operation; receive native close before the queued React busy render; observe the native listener prevent default, followed by the guard incorrectly calling its continuation. The initial actual-hook probe recorded `writeActive: true`, `continued: true`, and `dialogOpened: false`. The added [behavioral regression](../../../../apps/desktop/src/hooks/useFilesExitGuard.test.ts) failed on that continuation assertion before the fix. Its final version uses the real `SettingsBusyQueue` and a deferred operation, then checks that Continue stays disabled until the operation releases.

The [request fast path](../../../../apps/desktop/src/hooks/useFilesExitGuard.tsx) now consults the live write guard and latest external busy/running references. Native autosave flushing still joins pending saves through their existing awaited `flush()` calls; it does not discard an in-flight write. The existing actual-App in-flight autosave test still passes, including waiting for queue release before destruction. No store format, write target or native command changed.

## Validation and limits

The initial nine existing suites passed 77 tests. With the two regressions, all nine pass 79 tests:

```powershell
pnpm --filter @execs/desktop exec vitest run src/hooks/useFilesExitGuard.test.ts src/hooks/useNativeCloseGuard.test.ts src/hooks/settings-close.test.tsx src/hooks/draft-lifecycle.test.ts src/lib/files-drafts.test.ts src/lib/files-exit.test.ts src/App.files-exit.test.ts src/App.pending-settings.test.tsx src/components/ui/Modal.test.ts
```

These cover newer edits arriving during saves, partial and rejected saves, changed-profile refusal, retained explicit drafts, busy writes, Cancel/Discard, modal stacking, and failed-close retry. The reviewed settings store continues to refuse transitions after an owner disappears or new pending entries remain; Files acknowledges submitted bytes without clearing newer edits. No additional defect in those paths was demonstrated in this bounded review.

`pnpm --filter @execs/desktop exec tsc --noEmit` passed. Scoped Biome checked the five changed source/test files without changes. The root-owned long-path wrapping change in the same guard is separate and was preserved. Visual/native behavior beyond these source and React tests requires the root operator's evidence; these checks do not claim OS close events, screen-reader speech or installer qualification.
