# RND-288: bounded updater downloads

The metadata check keeps its 15-second deadline. The returned updater payload
now receives a separate ten-minute total request deadline, matching the app's
bulk-download allowance. Timeout errors explain how to retry. Download and
signature verification must finish before the installer is called; the update
lease releases on failure and stays held through a successful installer handoff.

## Source check

The pinned [updater 2.10.1 implementation](https://github.com/tauri-apps/plugins-workspace/blob/d6a3898001a4bcc659e045f9501498751b77dbe6/plugins/updater/src/updater.rs)
constructs a returned Update with no timeout and builds a fresh payload client.
Its public timeout field configures that client's total request deadline.
[Reqwest's timeout contract](https://docs.rs/reqwest/latest/reqwest/struct.ClientBuilder.html#method.timeout)
covers the response body. The locally locked 0.13.4 source was also inspected.

## Verification

- The release probe uses the production updater with a mock Tauri runtime and
  a loopback server. Metadata succeeds; an incomplete payload stalls and returns
  the timeout error, releasing its lease. A second attempt verifies a first-party
  signed text fixture and reaches the handoff boundary with the lease still held.
- A third response changes one byte and fails signature verification. A stale
  lease cannot release a newer operation. The fixture is never installed.
- The actual useAppUpdate hook test confirms timeout clears progress, preserves
  the offered version, reports the error and permits a second install attempt.
- Focused Windows lifecycle tests and the download probe pass in an isolated
  Cargo target. The frontend hook test passes.

The probe is gated by release-probes and runs with the existing Windows/Linux
updater smoke. This harness supplies the Windows Common Controls v6 manifest
required by Tauri's test runtime; a plain unit-test executable lacks that manifest
and fails before main when it imports TaskDialogIndirect. Ordinary app builds
already have the required manifest. No production signing keys, user profiles,
game files or real installers are used by the loopback test.

Full integrated CI and signed candidate upgrades are recorded in
`docs/release-0.1.5.md` after they finish.

## Windows candidate fixture correction

The [first private candidate](https://github.com/rndaom/execs/actions/runs/34910750976)
passed Linux's signed installer/upgrade and startup
smoke. Its Windows download probe exposed a loopback-fixture portability bug:
an accepted socket inherited the listener's nonblocking mode and read before
request bytes arrived. The worker now explicitly restores blocking mode before
applying its existing two-second read deadline. This follows Microsoft's
[accepted-socket contract](https://learn.microsoft.com/en-us/windows/win32/api/winsock2/nf-winsock2-accept)
and Rust's [stream mode API](https://doc.rust-lang.org/std/net/struct.TcpStream.html#method.set_nonblocking).
The change is confined to the `release-probes` fixture; ordinary app builds do
not include that module. Independent review confirmed the feature guard and
unchanged timeout/signature/lease assertions. The corrected Windows probe build
and all discovery/download smoke assertions pass locally, including four
concurrent runs. The [corrected candidate](https://github.com/rndaom/execs/actions/runs/34912770058)
passes both platforms' discovery/download probes and actual signed 0.1.4 → 0.1.5
installer upgrades, startup, notices, app-data preservation and no repeat offer.
