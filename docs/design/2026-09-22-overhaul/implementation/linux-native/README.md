# Linux native runtime smoke

Status, September 22, 2026: **harness implemented and locally tested; first Linux runtime run pending**. No Linux screenshot or runtime pass is claimed by this document. The local host is Windows, and the native runner deliberately refuses it. Nothing has been pushed, dispatched, packaged or released by this scoped implementation task.

## What the workflow will establish

The [development-only workflow](../../../../../.github/workflows/linux-native-smoke.yml) builds the normal production frontend and Linux release binary with `tauri build --ci --no-bundle -- --locked`. It drives that ELF executable through external `tauri-driver` 2.0.6 and the runner's `WebKitWebDriver` under Xvfb and a fresh D-Bus session. It does not start Vite or use `?preview=`, a mock bridge, injected native results, an embedded testing plugin, or a test-only production branch.

The bounded native sequence is:

1. Launch with a confirmed synthetic installation and six inactive owned profiles. Require the real Tauri runtime, bundled content origin and the rendered Choose a profile state. Capture 1200×800 content.
2. Resize the native window to 960×640 content and use Choose profile. Require six rows, a viewport-contained overlay and hit testing that proves its final action is unobstructed. Escape must restore focus to the profile summary.
3. Send five genuine WebDriver Ctrl+= key sequences. Each must reduce the observed CSS content width; the resulting width must be consistent with substantial enlargement. Open the menu, focus its name input, then Tab to Import and Change install. Require the final action to be visible and unobstructed. Escape and Ctrl+0 must restore focus and the original content dimensions. The harness does not infer working zoom from the configuration file.
4. Open App settings. Require its native-reported data location to equal this run's isolated directory. Click the visible Reduce radio label. Observe the real `settings.json` change, the root motion preference, and preservation of the profile library and synthetic install.
5. Close the native session and its owned process group, launch a new native process, and require the Reduce preference to reload and appear selected. Recheck all fixture identities, payload hashes and synthetic live bytes after process exit.

The menu keyboard steps never invoke profile switching, Import, Save, Change install or game launch. Only the app-wide motion preference is changed after fixture seeding. A failure records the last available native screenshot and returns a failing exit status; unsupported native operations are not silently skipped.

## Isolation and fixture provenance

[Fixture construction](../../../../../scripts/linux-native-fixture.mjs) creates a new `execs-linux-native-*` direct child of `RUNNER_TEMP`. The app and driver receive isolated `HOME`, `XDG_DATA_HOME`, `XDG_CONFIG_HOME`, `XDG_CACHE_HOME`, `XDG_RUNTIME_DIR` and `TMPDIR`. The runtime directory is created with mode 0700. Only PATH, X display authorization, this test's D-Bus address, language and time zone are inherited. Runner credentials, proxies and WebKit sandbox-disable variables are excluded. The harness does not modify its parent's HOME.

The runner must identify as GitHub-hosted Linux. Existing execs, Steam or TF2 processes and discoverable native/Flatpak/Snap Steam directories cause refusal before launch. The synthetic root has an app-440 `steam.inf`, cfg and owned test packs; it has no game executable. Startup update checks are disabled in the seeded app preference, through the normal settings format. There is no release token or secret dependency. Cleanup targets only the process group spawned for this run; fixture files remain for runner disposal and evidence upload.

Profile payloads come from the repository's [owned v0.1.8 export fixture](../../../../../scripts/fixtures/README.md), with every payload hash checked. Six IDs/names, the inactive index, confirmed settings and synthetic install are authored for this test. This is **current native runtime evidence**, not an additional old-version upgrade test. The preservation check shares the existing package smoke's strict comparison and narrowly documented additive metadata allowances. It requires the active profile to remain null and permits only the requested motion preference change.

## Why this architecture is supported

Tauri documents direct `tauri-driver` use for custom harnesses and identifies `WebKitWebDriver` as Linux's native driver. This avoids adding a driver service or testing plugin to the shipped application. [Official manual setup](https://v2.tauri.app/develop/tests/webdriver/manual-setup/).

Tauri's CI guide uses the WebKitGTK development libraries, `webkit2gtk-driver` and Xvfb to execute desktop UI tests on Linux. Its driver version is independent of the app's Tauri version. This workflow pins the external driver to 2.0.6 and records the installed WebKitGTK/driver package versions in the job log. [Official CI guide](https://v2.tauri.app/develop/tests/webdriver/ci/).

The pinned driver [sets `TAURI_WEBVIEW_AUTOMATION` for the native child](https://github.com/tauri-apps/tauri/blob/tauri-driver-v2.0.6/crates/tauri-driver/src/webdriver.rs) and [maps the application capability to WebKitGTK's native binary option](https://github.com/tauri-apps/tauri/blob/tauri-driver-v2.0.6/crates/tauri-driver/src/server.rs). The locally resolved `tauri-runtime-wry` 2.11.4 source reads that environment flag without a debug-only gate, and `wry` 0.55.1 registers the first web context for automation. Therefore a normal release binary is the intended test target; successful execution still requires the first CI run. WebKitGTK itself requires explicit automation enablement and allows only one enabled context. [WebKitGTK API documentation](https://webkitgtk.org/reference/webkit2gtk/stable/method.WebContext.set_automation_allowed.html).

## How to run after integration review

The workflow has no push, tag, release or schedule event. A same-repository pull request changing one of its listed harness, settings, profile-menu or native-configuration paths runs it on the next PR synchronization. The workflow file itself matches those paths, so the current draft PR can qualify it before a default-branch merge. Fork pull requests are excluded by the job condition.

For later manual dispatch, the workflow must first exist on the repository's default branch; selecting another ref does not remove that GitHub prerequisite. [GitHub's manual workflow requirements](https://docs.github.com/en/actions/how-tos/manage-workflow-runs/manually-run-a-workflow). Once registered, the command is:

```sh
gh workflow run linux-native-smoke.yml --ref rndaom/foundry-overhaul
```

Do not substitute `release.yml`. The job grants only `contents: read`, checks out without persisted credentials, and uploads fixture-only evidence for seven days. It builds no installer and uploads no executable. “Development only” describes its non-publishing purpose; it does not make GitHub Actions logs private if the repository's visibility exposes them.

The job installs its prerequisites on `ubuntu-22.04`: Node 24, the repository's pnpm version, stable Rust, WebKitGTK 4.1 development/runtime libraries, appindicator/librsvg/patchelf, `webkit2gtk-driver`, Xvfb, xauth and dbus-x11. No additional npm package is required by the harness. Parent-owned main-window zoom configuration and the main-only zoom permission must be included in the tested commit.

The native command executed by the workflow is:

```sh
xvfb-run -a -s '-screen 0 1600x1200x24' dbus-run-session -- node scripts/linux-native-smoke.mjs
```

Run it through the disposable workflow, not against a player account or by weakening its hosted-runner guards. The build job has a 45-minute ceiling and the native step six minutes. Individual driver requests and readiness/geometry checks are bounded.

## Evidence and acceptance

The artifact `linux-native-smoke-<workflow SHA>` contains `results.json`, `fixture-baseline.json`, driver logs and native PNGs. The report retains the exact checked-out revision, binary SHA-256, fixture provenance, capabilities, actual CSS/pixel dimensions, zoom steps, menu geometry/hit tests and preservation results. PR runs usually test a merge revision; the report's revision identifies the binary's actual source.

Expected success captures are `01-native-inactive-1200.png`, `02-native-menu-960.png`, `03-native-keyboard-zoom-menu.png`, `04-native-preferences-saved.png` and `05-native-preferences-after-restart.png`. These are future outputs, not existing evidence. After a successful run, inspect the PNGs and attach the exact workflow URL plus the report before marking this bounded Linux runtime gap complete.

Local verification completed on Windows:

- `node --test scripts/linux-native-smoke.test.mjs scripts/package-smoke-fixture.test.mjs`: **22 passed, 0 failed, 0 skipped** (11 new harness checks plus 11 existing fixture checks).
- Targeted Biome for the four new scripts and root package wiring: passed.
- Workflow YAML parsed successfully with the installed `yaml` parser; events, read-only permission and job shape were inspected. This is syntax validation, not GitHub execution.

The new tests cover isolated fixture creation, exact preference allowance, preservation refusal, link refusal, environment filtering, non-CI refusal, bundled-origin checks, real-geometry acceptance rules, standard W3C command construction/error propagation and bounded polling. Their local HTTP server tests the client protocol only and is explicitly not native runtime evidence.

Even after this smoke passes, its scope is Ubuntu 22.04, X11/Xvfb, software rendering and the installed WebKitGTK build. It does not qualify Wayland, distribution-specific window managers, hardware rendering, OS text scaling, installers, updater installation, profile switching/exports, Steam, TF2, sound playback, assets downloaded at runtime or every application pane. Those remain governed by their separate acceptance evidence. No Rust, product UI, native config, capability, release version or release workflow change is part of this harness implementation.
