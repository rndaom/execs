# 0.1.5 feedback verification

Scope: RND-266 (frontend attribution), RND-269, RND-271 and RND-272.
Baseline: `fae34cf`, based on the public 0.1.4 maintenance line.

## Changes

- Each settings write captures its originating profile, pane and operation.
  Retained HUD options therefore report **Could not save HUD options** even
  when Sounds is visible. Backend control/path/reason text is retained.
- Toast failures are retained by source. An unrelated save does not replace
  them; resolving or dismissing one failure reveals any other failure.
  A new completion always receives its own 1600 ms display interval. Timer
  callbacks and user dismissals capture the displayed notification so they
  cannot hide newer feedback.
- Deferred feedback tracks each autosave instance. Reverting, resolving or
  removing one draft leaves other deferred owners intact. Unlock ends that
  owner's wait-for-TF2 message; an unsuccessful retry remains a pending draft
  and its error remains visible independently.
- Application errors have source identities too. Settings/catalog reads can
  clear only their own failed read. Export failures survive background reloads,
  cancelled exports and an in-flight retry, and clear after a successful export
  or explicit dismissal. Install, setup, update and lifecycle operations use
  their own identities. Dismiss buttons and Escape only change feedback.

## Regression evidence

`src/components/ui/Toast.test.ts` runs the actual provider with fake timers:

- Identical and different success messages completed 1500 ms apart remain for
  the full 1600 ms after the second completion.
- An old timer does not hide a persistent failure.
- Other sources' saves, retries and dismissals preserve outstanding failures.
- Cancelled/refused work does not consume another source's active write count.

`src/SettingsFeedback.test.tsx` runs the real SettingsHost, HUD, Sounds,
Gameplay, useAutosave, ToastProvider, ReadyPanel, profile-library hook and
operation-error store. Only the IPC boundary is an in-memory preview adapter:

- A HUD save is delayed, the user navigates to Sounds, and the HUD failure is
  returned with a relative path. A successful Sounds save cannot hide it. A
  subsequent HUD retry clears it and releases pending state.
- A locked Gameplay edit is reverted. No write occurs on revert or unlock, and
  the deferred message disappears.
- Two retained panes become dirty; reverting one does not clear the other's
  deferred message or pending state.
- Unlocking a deferred HUD edit can fail; dismissing that failure does not
  resurrect an obsolete wait-for-TF2 message or release the pending guard.
- An externally changed profile cannot have its successful save clear the
  previous profile's failure; the original source identity remains attached.
- A rejected export survives busy release, a successful settings read, picker
  cancellation and an in-flight retry. Successful export resolves its error.
- Dismiss/Escape leaves interrupted-switch recovery and pending draft guards
  in place.

## Commands and results

- `pnpm test`: 105 cfglint tests and 428 desktop tests passed; release-script
  tests: 21 passed, 3 platform skips, 0 failures.
- `pnpm build`: TypeScript and Vite production build passed. Vite reports the
  existing large-chunk advisory.
- `pnpm check`: Biome check passed.

The implementation changes frontend state and feedback only. No live TF2
configuration, profile library, Steam state, native window or Linear record was
modified. Native packaged-app verification and the backend HUD control/path
implementation are separate parts of the integrated release verification.

## Integration points

- The RND-268/RND-273 settings-draft boundary explicitly discards a pane by
  clearing `${profile}:${tab}:save` through `toast.clearSource`. Hook cleanup
  resolves that instance's deferred ID. Dismissal alone does neither.
- The import outcome runner keeps its nullable-work cancellation contract and
  forwards the picker option through the per-pane `write` wrapper. It calls
  source-aware toast methods and passes whether a write counter was started to
  `failSave`, so cancelling a picker cannot hide another pane's write.

Integration on top of `ff23ffe` preserves all six import cancellation paths and
the Comfig callbacks' boolean outcomes. Focused verification passed: 31 tests
across `ImportOutcomes`, `MutationDrafts`, `SettingsFeedback`, `Toast` and
`useAppUpdate`. Each import also retains its earlier failure when a retry picker
is cancelled. The updater regression verifies that failure clears staged
release notes and a successful retry stages them again while resolving only
the `update:install` error source.

Repository-local hooks use `.githooks`, the configured identity is Random, and
no Cloud Agent co-author hook exists in the checked native Windows Codex hook
locations. No co-author trailer is included.
