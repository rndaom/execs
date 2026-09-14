# HUD loading and refresh recovery

Date: 2026-09-14. Baseline: `fae34cf5f6bcb248e6144dadc20ca8ba3fd90692` (0.1.5 planning on the public 0.1.4 maintenance line). Worktree: `G:/Projects/execs-015-hud`; branch: `codex/0.1.5-hud-loading`.

Scope: [RND-239](https://linear.app/rndaom/issue/RND-239), [RND-243](https://linear.app/rndaom/issue/RND-243), and [RND-289](https://linear.app/rndaom/issue/RND-289). No Linear changes, publication, real profile edits, or live game writes were performed.

## Reproduced baseline failures

A detached worktree at `fae34cf` mounted the real `SettingsHost` with controlled IPC and child panes exposing their props. Two assertions fail on that unchanged host; the original 16 snapshot tests pass:

1. Reject `getHudCatalog` with a cold offline cache. `getHudState` is never called.
2. Load HUD A's schema, return installed HUD B, then reject B's schema read. The resulting props contain installed B with `{ author: "A", sections: [] }` instead of a cleared schema.

The [baseline run output](hud-baseline-reproduction.txt) records both actual failures. The final integration tests reproduce these inputs against the real host **and** real HUD pane, rather than only checking an extracted queue helper.

The pre-change statistics failure is established by the audited production path: `load_or_fetch_stats` returned `Ok(cache.stats)` after both source reads failed; one-source failures and `Walk.complete == false` disappeared at the IPC boundary. The new backend fixtures execute the production refresh-result functions with deterministic source outcomes and isolated temporary cache directories. They do not assert that either public endpoint is currently down.

## Resulting behavior

- `get_hud_state` reads the local manifest and catalog cache only. Catalog/stats work cannot delay the installed HUD or its available local actions. Missing/stale/partial catalog data leaves update status explicitly unavailable.
- Schema reads name their expected profile and HUD. The frontend removes controls as soon as a local/schema reload starts, ignores superseded results, and reports local-read and schema errors separately. An options retry preserves the last valid seed and unsaved draft for that same HUD. Another HUD/profile resets the draft identity.
- A schema fetch is independent of a committed import/install result. A failed schema read shows its retry action without changing a successful local import into “Could not import”.
- Queued options saves also carry their initiating profile/HUD identity. The native command refuses a save queued behind replacement of that HUD before fetching or writing its options.
- Catalog results disclose incomplete metadata reads. Failed documents keep cached entries only if their IDs still exist in the new tree; removed IDs are not revived. A partial cache keeps its warning and short TTL until a complete refresh succeeds.
- Statistics results identify failed or incomplete dates (`comfig.app`) and counts (`tf2huds.dev`) separately. Both-source failure with cache preserves the values and original cache age; without cache it rejects. Partial refreshes keep unaffected fields and retain their warning through cache reads. Complete recovery clears the warning.

### IPC contracts

| Command | Result / input change |
| --- | --- |
| `get_hud_catalog` | `{ entries, warning }` |
| `get_hud_stats` | `{ stats, warning }` |
| `get_hud_state` | Existing flat state plus `profileId`; no network fetch |
| `get_hud_schema` | Requires `expectedProfileId` and `expectedHudId` |
| `apply_hud_options` | Requires `expectedProfileId` and `expectedHudId` |

The typed preview adapter implements the same contracts. Existing profile manifests/exports and cache file locations remain readable; the only new persisted field is optional warning data in the statistics cache. Catalog and stats cache requests retain their independent serialized queues. Local state/schema reads use separate request generations so an old source request cannot block the next local identity.

## Verification

| Check | Result |
| --- | --- |
| `pnpm test` | Passed: 105 cfglint tests, 422 desktop tests, 21 Node release/package tests; 3 platform-specific Node tests skipped on Windows. This complete run preceded the final added identity regressions. |
| Final `pnpm --filter @execs/desktop test -- SettingsHost HudPane` | Passed: 33 tests, including 11 real host/pane loading cases and the retained-HUD callback regression. [Output](hud-frontend-tests.txt). |
| `pnpm check` | Passed. |
| `pnpm --filter @execs/desktop build` | Passed TypeScript and production Vite build. Existing large-chunk advisory remains. |
| Final `tsc --noEmit` | Passed after the command identity arguments were added. |
| `cargo fmt --check` | Passed. |
| `cargo clippy --workspace --all-targets --locked -- -D warnings` | Passed using the isolated HUD target directory. |
| `cargo test --lib hud_ --locked` | Passed: 29 tests, 1 existing live-network test ignored. Includes native command identity, catalog worker/partial-cache, both-source failure/no-cache, each one-source failure, truncated walk, cache age, and recovery. |

Rust commands use `--manifest-path apps/desktop/src-tauri/Cargo.toml --target-dir G:/Projects/execs-015-evidence/target-hud`; the final results do not rely on another worktree's Cargo fingerprints. The [earlier Rust output](hud-rust-test.txt) records 28 passing HUD tests before the added queued-save identity guard; the final command adds that passing guard regression (29 total).

### Browser result boundaries

The [browser harness](hud-loading-browser.html) imports the real `SettingsHost`, `HudPane`, toast, and preview adapter. Its small overrides return deterministic offline/partial/schema failures. Banner text identifies fixture data; native IPC is never invoked. Catalog images are omitted to avoid making a screenshot test depend on image hosts.

Run `pnpm --filter @execs/desktop exec vite --port 1428 --host 127.0.0.1` and open the worktree's `/@fs/` URL for this HTML with `?case=cold`, `?case=schema`, or `?case=partial`. The **Restore fixture sources** button makes the next product retry succeed. Reload the fixture after source edits; its custom HTML uses the documented React development preamble.

Verified in the in-app Chromium browser at its normal 1280-pixel viewport:

- Cold catalog failure: installed rayshud, expandable options, and enabled Import HUD. [Screenshot](hud-offline.png).
- Schema failure: installed identity retained, option controls absent, Retry loading options visible. Restoring the source and retrying brings back rayshud's schema. [Screenshot](hud-schema-unavailable.png).
- Partial catalog/count results: both catalog entries and cached statistics remain visible with specific warnings. [Screenshot](hud-partial-refresh.png).
- Recovery: Refresh removes both source warnings and retains the catalog/options. [Screenshot](hud-refresh-recovered.png).
- A fresh final browser session restored the fixture sources, refreshed, and toggled Minmode. The real autosave flow displayed **Saved**, retained the checked option, and produced no browser console errors.

## Sources and dependency checks

No dependency was updated. Installed lockfile versions checked locally: React/React DOM `19.2.8`, Vite `7.3.6`, Vitest `3.2.7`; the native check compiled Tauri `2.11.5` and the app's Reqwest `0.12.28`.

- [React useEffect reference](https://react.dev/reference/react/useEffect): cleanup invalidates old asynchronous work, including responses that arrive out of order. The new generation guards apply that contract to local identity and source queues.
- [Tauri command documentation](https://v2.tauri.app/develop/calling-rust/): command arguments and serialized results cross the frontend/native boundary. The bridge, native command payloads, and preview twin changed together.
- [GitHub Git Trees API](https://docs.github.com/en/rest/git/trees#get-a-tree): a truncated tree is incomplete. The existing fail-closed tree check remains; a metadata-document minority failure now reaches the caller as a partial result instead of silent omission.
- [Vite backend integration](https://vite.dev/guide/backend-integration): the custom audit HTML installs the React development preamble before importing the real app modules.

## Combined release integration

Integrated onto release worktree baseline `11338b9` after the cfg, mutation-result,
feedback, close/draft-registry and pack changes. The merged host retains the
source-owned write wrapper, picker `null` outcomes, layer-aware cfg completeness
guard, `SettingsDraftBoundary`, and manual-draft registration. The native HUD
installer keeps the fallible manifest-content cfg-layer lookup.

The HUD loading tests now use the real `ToastProvider`. Delayed App save doubles
forward both expected identity arguments, and existing IPC fixtures use the new
catalog/statistics payloads. These changes preserve the real integration boundary
instead of bypassing the source feedback or native identity contract.

- Full `pnpm test`: cfglint **130 passed**; desktop **508 passed** across **67 files**;
  release/package scripts **21 passed**, **3 platform skips**. The run includes
  retained HUD/Sounds failures, picker cancellation, native-close pending saves,
  manual crosshair draft handling, cfg completeness, and all HUD loading tests.
  [Captured output](hud-integrated-frontend-tests.txt).
- `pnpm --filter @execs/desktop exec tsc --noEmit`: passed.
- `pnpm check`: passed, **239 files**.
- `git diff --check`: passed. No native runtime or live-data actions were performed
  during this integration; the parent retains the combined native/release checks.

## Limits

The browser run validates rendered controls and UI result handling with controlled IPC; it is not a packaged Tauri end-to-end network or native file-picker test. Windows Rust tests validate the actual backend result/cache code using temporary directories. Linux runtime, live upstream outages, and game behavior are not claimed by this work. The parent 0.1.5 release matrix owns combined-worktree and packaged-platform checks.

Git used the repository identity `Random` and `.githooks`; no Cloud Agent co-author hook was present in this Windows checkout. No co-author trailer is added.
