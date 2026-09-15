# 0.1.5 mutation results and retained drafts

Implemented RND-270, RND-279, RND-280 and RND-285 from maintenance baseline
`fae34cf5f6bcb248e6144dadc20ca8ba3fd90692` on
`codex/0.1.5-mutation-drafts`.

## Changes

- **RND-279:** `CrosshairPane.onApply` explicitly returns `Promise<boolean>`.
  Only `true` acknowledges the submitted draft and releases its PNG/library
  bytes. A changed profile suppresses a late acknowledgement; newer asset
  edits continue to use the existing submitted-draft comparison.
- **RND-280:** Sounds draft ownership is the stable profile/sounds key. The
  installed record remains seed content rather than becoming a new draft
  identity after every boost. `useSeededDraft` preserves later edits and the
  existing autosave token acknowledges only the submitted version.
- **RND-285:** Comfig no longer presents an optimistic preset, module or addon
  as saved. Controls and preview use the host's complete persisted snapshot.
  The host returns the real boolean result; failed choices remain selectable
  for retry after navigation or unchanged settings reloads. Failed modules
  and addons cannot become inputs to an unrelated later selection.
- **RND-270:** `runWrite` accepts the explicit `null` cancellation sentinel,
  releases the busy queue and skips reload/completion. Picker commands do not
  start the Saving timer while awaiting the native dialog. HUD archive/folder,
  mod archive/folder, viewmodel VPK and comfig-custom imports all preserve that
  result. The latter two native commands and their bridge declarations now
  return `Option<ProfileDetail>` / `ProfileDetail | null`; cancellation returns
  before taking the write gate. Preview signatures match the bridge.

The Comfig/custom and viewmodel source/context validation and successful write
guards remain intact. There are no profile schema, write-surface or version
changes in this patch.

## Verification

`MutationDrafts.test.tsx` runs real SettingsHost, panes, draft hooks, autosave,
write queue and ToastProvider against an in-memory IPC implementation. Its 12
tests cover:

- Crosshair failure before and after a simulated write; a host refusal before
  the native command; exact PNG and generated-library bytes on retry; newer
  assets during successful build; profile isolation.
- A later volume, pitch, boost or source edit during an earlier boost save,
  including the follow-up native payload; failure/unlock retry; profile reset.
- Comfig failure with an unchanged reload, leaving/returning and selecting the
  same preset again; saved screenshot identity; failed module/addon isolation.

`ImportOutcomes.test.tsx` uses the real host and ToastProvider with pane callback
probes. All six picker paths stay quiet past the Saving deadline, cancel with
`false`, release busy state without extra settings reads, then survive a failed
retry and report the next successful import by name.

Commands completed on Windows:

| Check | Result |
| --- | --- |
| `pnpm install --frozen-lockfile` | Passed; lockfile unchanged |
| Focused mutation/import/host/crosshair suites | 42 tests passed |
| `pnpm test` | 105 cfglint and 431 desktop tests passed; 21 script tests passed, 3 platform-specific tests skipped |
| `pnpm check` | Passed |
| `pnpm --filter @execs/desktop build` | Passed, including TypeScript; existing large-bundle advisory remains |
| `cargo fmt --all --manifest-path apps/desktop/src-tauri/Cargo.toml --check` | Passed |
| `git diff --check` | Passed |

## Research and limits

The distinction between draft ownership and saved content follows React's
[state identity guidance](https://react.dev/learn/preserving-and-resetting-state).
Async handlers retain the state snapshot that created them, so acknowledgement
must account for later input; see [React state snapshots](https://react.dev/learn/state-as-a-snapshot).

The PNG decoder boundary supplies deterministic pixels in the lifecycle tests;
these tests do not claim PNG codec coverage. IPC failures and partial completion
are controlled simulations, not live filesystem fault injection. No real game,
player profile, native picker or live TF2 files were opened or modified.

The native commands still combine picking and import in one IPC call. The
frontend therefore defers Saving until a non-cancelled result is known; it does
not invent native selection/progress events. Completion and errors retain their
existing messages.

Full native compilation/tests and Windows/Linux CI belong to the integrating
release task. Its feedback changes own attributed toast/error accounting; merge
the picker runner's optional third argument and cancellation branch with that
source-aware runner. The small baseline `ToastApi.cancelSave` addition is
superseded by that task's source-aware implementation.
