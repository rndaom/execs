# Pending settings close and launch recovery — 2026-09-14

Scope: Linear RND-273 and RND-268, from the 0.1.5 maintenance baseline
`fae34cf`. Worktree: `G:/Projects/execs-015-close`. No real profile, install,
TF2 file, game process or Steam launch was used for these checks.

## Implementation

- `settings-drafts.ts` keeps session controls for each pending pane: profile,
  owner, saving/failed/locked status and an awaited flush. It never writes draft
  bytes or replaces the native write gate. A changed owner/profile invalidates
  a transition already awaiting that pane.
- `SettingsDraftBoundary` registers each retained pane and resets that pane
  only after explicit discard. It marks the old autosave context discarded
  before remounting, preventing a queued or unmount flush. Launch options also
  reset their host-owned draft to the saved seed.
- `useAutosave.flush()` awaits active and coalesced saves, reports failures and
  refuses a transition if newer edits arrived. Failed drafts remain pending.
- Native close observes both Files and settings drafts synchronously. Unlocked
  autosaves flush before window destruction. Locked, failed and manual-apply
  drafts have a usable Save / Discard / Cancel dialog and links to their panes.
  Close joins an in-flight autosave and awaits it. Other live work opens the
  wait dialog; no write can be discarded mid-operation.
  Settings editing waits for the close listener to register.
- The existing Files decision remains explicit. A mixed decision saves settings
  and then each file; any remaining/newer draft, save refusal, changed owner or
  live operation stops continuation. The queue's live `active` value avoids
  both bypassing writes and treating a stale React busy render as unfinished work.
- Launch retains its actual disabled control with an accessible description
  and an enabled Review changes action. It identifies failed/pending panes,
  exposes their saved-state reset or retry path, and releases pending state
  when resolved. Active writes, ordinary/interrupted switches, known preloader
  recovery, Steam verification and update work have distinct reasons. Known
  preloader recovery offers Open Mods; its native guard remains authoritative
  even before the Mods status has been loaded.

## Regression evidence

`hooks/settings-close.test.tsx` exercises the real native close hook, autosave,
per-pane boundary and Files guard together:

- Two debounced dirty panes: no write before close, both writes awaited.
- TF2 locked: no write, Cancel retains exact drafts, Discard resets both, no
  deferred write after unlock.
- Failed save: window remains, repeated failure retains the draft, retry
  success completes close.
- Mixed settings and Files drafts retain the explicit Files decision.
- Newer edit during save remains pending and stops destruction.
- Existing in-flight save is awaited; discard refuses an active save.
- Source profile replacement during save stops the old transition.
- Other active work cannot be bypassed by discarding settings.

`App.pending-settings.test.tsx` uses the real App/SettingsHost with an in-memory
preview API and mocked native window:

- Failing HUD save, navigate to Sounds, named accessible launch reason, return
  to HUD, repeated failed retry, successful retry, then launch callback.
- Multiple failed panes: reverting one does not release the other; explicit
  discard restores persisted controls and introduces no later write.
- Actual settings queue write blocks launch and discard until completion.
- Discard releases a later profile switch.
- Steam verification has its own reason and Open Mods action.
- Native close from the App flushes HUD before the debounce expires.
- Native close joins a live HUD autosave and awaits the actual queue release.
- Two retained failed panes save successfully through the host's native queue.
- Manual crosshair mode changes do not build implicitly on close; the user
  explicitly chooses whether to discard them.

## Checks and limits

| Check | Result |
| --- | --- |
| Full desktop Vitest suite with feedback integration, two workers | 446 tests in 61 files pass |
| Focused App/native close/Files guard integration | 22 tests in 3 files pass |
| `tsc --noEmit` | Pass |
| `pnpm check` with feedback integration | Pass, 222 files |
| `pnpm build` with feedback integration | Pass; existing large main-chunk advisory remains (907.43 kB) |

Tauri's current official [window API documentation](https://tauri.app/reference/javascript/api/namespacewindow/)
confirms `onCloseRequested`, synchronous `preventDefault` and explicit listener
cleanup. The implementation keeps the existing `destroy()` path after the
guarded decision. The tests mock that native bridge; they do not prove actual
window-manager delivery or packaged Linux Steam URI dispatch.

The packaged Linux `steam://rungameid/440` handoff, launch-wait cancellation and
native process detection require the root release-verification environment.
No installer or Linux runtime claim is made here. No Rust/native write behavior
changes in this branch.

Feedback integration includes RND-266/269/271/272 commit `23bac1e` (locally
resolved as `67b2ac4`). The merged hook retains per-draft deferred-ID cleanup,
including unlock, and the boundary clears `${profile}:${tab}:save` only on
explicit discard. An App regression discards a failed HUD draft while retaining
another pane's unrelated failure until explicit dismissal. Routine unmount
does not clear unrelated failures.
