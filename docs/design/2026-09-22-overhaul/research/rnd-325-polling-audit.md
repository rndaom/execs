# RND-325 — Windows companion polling audit

September 22, 2026. Source baseline: integrated `rndaom/foundry-overhaul` at `e1fecdaaf4de2c7257eb2dbe875ac45f22ee4dcc`, followed by the scoped working changes below. [Issue and exact acceptance](https://linear.app/rndaom/issue/RND-325/audit-execs-windows-polling-for-periodic-tf2-frame-stalls).

**Result: unnecessary renderer polling and development-helper metadata reads reduced; actual TF2 frame-stall contribution remains unclassified pending paired native captures.** This is not a claim that execs caused, or that this change fixes, the reported periodic stalls. The issue's earlier off capture still showed stalls with execs stopped.

## Changes and safety

- `useLifecycleStatus.ts` originally invoked the native lifecycle command every second, regardless of visibility/focus, and published a new object every time. It now reads immediately at startup, samples visible/focused idle state every five seconds, retains one-second active-lease checks, and suspends periodic presentation reads while hidden/unfocused. Failed reads stay fail-closed and back off through 5/10/20/30 seconds. Explicit refresh is immediate.
- Returning to the app and imperative post-operation refresh mark availability unknown before awaiting the authoritative read. An active lease remains represented while waiting. Requests never overlap within a monitor session; refreshes arriving behind an older read coalesce into one required follow-up, and that old result cannot briefly publish an unlocked state. Removed/API-replaced sessions ignore late responses. Equal successful snapshots do not trigger a new App state publication.
- The native write gate and the one-second process-name lock monitor are unchanged. Background presentation suspension cannot grant write permission; native operations continue to recheck process/maintenance locks. Renderer write-lock events continue even when the app is unfocused.
- `tools/inventory-probe/src/native.rs` refreshed default per-process metadata every 100ms during a bounded development Inventory connection, despite using only process names. It now uses `ProcessRefreshKind::nothing()`, matching the existing core helper. Its 100ms TF2 abort checks, 30-second deadline, account checks and allowed messages remain unchanged. Inventory is development-only and refuses an active game; it is not the public background companion loop.

## Timer and query inventory

Search covered production/development renderer sources, Tauri commands/core and `tools/inventory-probe`; test-only sleeps are excluded. A cache TTL or request deadline is listed separately from a recurring poll.

| Path and purpose | Cadence / bounds | While TF2 runs / thread and disposition |
| --- | --- | --- |
| `src-tauri/src/lib.rs::spawn_lock_poller` | Name-only process enumeration every 1s; emit initial/change only; stops and reports after 10 consecutive panics. | Dedicated `std::thread`; continues during game for authoritative lock/quit detection. Preserved. |
| `core/src/process_lock.rs::live_process_names` | Fresh `System`; `refresh_processes_specifics(All, true, nothing())`; names only. | Shared by the background monitor and write-boundary checks. No cached sample replaces a transaction's fresh safety check. |
| `lib.rs::spawn_launch_monitor` | Every 5s only while a durable launch token remains current; ends on TF2 detection/obsolete token. | Background thread. Preserved; it does not loop forever after launch completion. |
| `commands/launch.rs::launch_tf2` | Up to 120 process checks, 500ms apart (about 60s), then hands off to the 5s monitor. | `blocking` worker; normal loop ends once TF2 is observed. The launch lease blocks competing writes. |
| `commands/launch.rs::cancel_tf2_launch` | Two process samples separated by 2s. | Explicit recovery worker, not idle polling. Requires closed Steam/TF2. |
| `hooks/useWriteLock.ts` and `lib/write-lock-ui.ts` | One boot sample after subscriptions plus native running/health events. | Already event-driven. Failed subscription remains locked; no renderer polling added. |
| `hooks/useLifecycleStatus.ts` | New: startup immediately; 5s idle / 1s active lease; failed reads 5→30s; no hidden/unfocused periodic reads; immediate resume/manual refresh. | Native `get_lifecycle_status` reads in-memory gate flags, not process lists. Stops avoidable background IPC/App render work. |
| `ModsPane.tsx` / `lib/mods-ui.ts` repair status | 5s while waiting; 30s after 20-minute timeout; no timer when idle/confirming/done. | Explicit Steam-maintenance workflow retains its gate. A repair/lease can outlast visible presentation and must not be inferred complete from elapsed time. |
| `commands/preloader.rs::repair_is_quiescent` | Two surface/status checks separated by 10s; cancellation samples separated by 2s. | Explicit worker operation; rechecks TF2, Steam and actual bytes. Preserved. |
| `hooks/useInventorySnapshot.ts` | First focused visible use; every 120s active; 30s minimum reconnection; failure backoff to 300s; due after TF2 quit. | Already single-flight and paused while hidden/unfocused/inactive/busy/running. Unchanged; four lifecycle regressions pass. |
| `commands/inventory.rs::read_snapshot` | Child completion `try_wait` every 50ms, max 40s; stdout separately read with 8MiB cap. | Development-only bounded worker/child; serialized and refuses TF2. No production Inventory command. |
| `tools/inventory-probe/src/native.rs` | Steam callbacks/TF2 refusal every 100ms, max 30s; ClientHello every 5s until welcomed; each message drain max 64. | Development child. Name-only process refresh now avoids unrelated cmdline/environment/IO metadata. Aborts on TF2/account change. |
| `core/src/viewmodel_build.rs` | Child `try_wait` and log-size guard every 50ms; max 120s per compiler job. | Explicit Windows build worker; CREATE_NO_WINDOW; game-running write guards remain. Not an idle companion poll. |
| `core/src/hash.rs` | Atomic replacement retries use 50ms multiplied backoff. | Bounded write-retry path. Not an idle poll; do not remove correctness retries to improve a synthetic idle number. |
| `useAutosave` | 700ms one-shot debounce after editing, coalesced; deferred while game lock active. | No recurring idle timer. Deferred draft wakeup comes from lock state changes. |
| Files analysis | 180ms edit debounce; one worker per settled snapshot; 10s deadline/termination. | Only an active Files workspace; pending analysis cancels on identity/change/hide. No perpetual idle work. |
| GameBanana search | 400ms query debounce. | One-shot on changed text; result work follows active request, not periodic background fetching. |
| Binds capture | 0ms arming turn; unsupported-key notice clears after 2s. | Event-driven input; hidden-pane recording is released. |
| Shared feedback | Copy 1.8s; Saving after 400ms; successful toast 1.6s; switch real-step presentation min 550ms and completion hold 5s. | Finite presentation timers tied to actual actions. Errors/drafts/locks are not released by timer dismissal. |
| Focus/selection RAF | Files, ClassTabs and ContextMenu request a frame for focus/selection positioning. | One-shot callbacks, no application RAF rendering loop found. Current Foundry CSS animations are finite and reduced-motion aware; native compositor cost remains a measurement question. |
| Network/cache timing | Connect/request/download deadlines; DNS 5m, HUD/catalog about 24h or partial-cache 1h, GameBanana 10m cache freshness. | These gate requested work/cache reuse, not periodic refresh timers. Test-server sleeps are excluded. |

Process queries are centralized in the core names helper except the bounded development probe. No product `EnumWindows`, `GetForegroundWindow`, `timeBeginPeriod`, or request to raise process/thread priority was found. `document.hasFocus()` and visibility events serve renderer presentation. Native polling runs on background worker threads at inherited/default scheduling priority; explicit child creation uses CREATE_NO_WINDOW, not a high-priority flag. Actual candidate process/thread priority must still be recorded in runtime evidence, especially if a launcher externally changes it.

Some explicit native operations inspect files, hashes or Steam process names at multiple safety boundaries. Those are intentional transaction checks, not evidence of idle monitoring overhead. The in-memory lifecycle command does not wait for the asynchronous write mutex. No game process/window/presentation setting is changed by this work.

## Verification performed

- `pnpm --filter @execs/desktop test -- src/hooks/useLifecycleStatus.test.tsx src/hooks/useInventorySnapshot.test.tsx src/lib/write-lock-ui.test.ts`: **22 tests passed** (10 lifecycle, 4 Inventory, 8 write-lock).
- New lifecycle tests cover immediate hidden startup, initial fail-closed state, idle backoff/no repeated equal publication, each of the three active lease kinds, hidden/unfocused suspension, fresh focus return, coalesced post-operation reads, failure backoff/manual retry, API replacement and cleanup.
- Targeted Biome check passed; `git diff --check` passed.
- `cargo test --manifest-path tools/inventory-probe/Cargo.toml --locked`: **7 tests passed**.
- Probe `cargo fmt --check` and Clippy for all targets with warnings denied passed after formatting.

These checks establish source/fixture behavior. They do not measure frame time, actual WebView2 scheduling, OS thread priority, both-display presentation or retail TF2 compatibility. No real game launch, player-state write, display change or PresentMon capture was performed by this agent.

## Reproducible native on/off benchmark

Use a private optimized candidate build with devtools/HMR closed. Record its commit, binary hash, OS/driver, CPU/GPU, PresentMon version/help output, monitor count/refresh rates, active TF2 config/profile and presentation mode. Both displays remain enabled and unchanged throughout. Use the same warmed-up map/demo/camera workload and frame cap; do not use game video launch flags or change fullscreen/D3D settings as part of this comparison.

Use at least three 30-second pairs, alternating **execs closed / execs running unfocused behind foreground TF2**, with a warmup between runs. End execs normally only after pending writes/drafts are resolved. In the enabled condition, record that the candidate is idle with no update, build, repair or Inventory request. A separate active-operation test should be labeled separately, not mixed into idle comparisons. Do not stop another user's monitoring process or replace an existing PresentMon session.

Example console invocation, using the installed console binary and a unique output filename:

```powershell
$presentMonPath = 'C:\Path\To\PresentMon-x64.exe'
& $presentMonPath --process_name tf_win64.exe --delay 5 --timed 30 --terminate_after_timed --no_console_stats --output_file 'G:\Projects\execs\docs\design\2026-09-22-overhaul\research\execs-off-01.csv'
```

Repeat with unique `execs-on-01.csv` through `-03.csv` filenames, following the paired order above. The delay lets the operator return TF2 to foreground before recording. Preserve raw CSV files and the exact command/tool version. The documented flags select the process, delay recording, capture a fixed duration and write CSV; leave display tracking enabled so PresentMode remains available. [PresentMon console documentation](https://github.com/GameTechDev/PresentMon/blob/main/README-ConsoleApplication.md).

For each run report: sample count/duration, frame-interval p50/p95/p99, intervals above 20ms, dropped frames, available CPU busy/wait metrics, and PresentMode distribution. Use the actual CSV headers emitted by that pinned version; do not silently map a frame interval to a CPU stall. Inspect the timestamps of long intervals for repeated spacing, and compare paired distributions rather than one favorable run. Preserve fullscreen/D3D9Ex independent-flip behavior across conditions. Any foreground loss or presentation-mode change invalidates that pair for attributing a polling effect.

If enabled runs reproducibly add spikes, collect a scoped ETW trace with companion/native poll timing to separate CPU execution, waiting and presentation effects. Classify the result as **root cause**, **contributing factor** or **ruled out for this measured workload**, with limits. Inconclusive/noisy results stay **unclassified**. A code cleanup or an average FPS improvement alone does not meet this issue's final evidence gate.

## Outstanding native result

| Acceptance | Current evidence |
| --- | --- |
| Timer/process/window inventory | Source audit above. |
| Practical unnecessary polling reduction | Lifecycle change and development name-only refresh; tests pass. |
| Background/normal priority and no UI/transaction blocking | Worker/in-memory source paths inspected; no priority elevation found. Actual candidate scheduling/latency remains to measure. |
| Reproducible paired capture | Protocol prepared; raw on/off CSVs not collected. |
| No new periodic stalls or independent-flip regression | **Not established yet.** |
| Causal classification | **Unclassified** pending actual native evidence. |

Keep RND-325 In Progress, not Done. RND-324's preload startup sequence and its separate clean-launch capture remain distinct work.
