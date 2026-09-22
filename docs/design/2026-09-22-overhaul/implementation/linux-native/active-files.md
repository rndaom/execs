# Active native Files and close workflow

Status, September 22, 2026: implementation and independent review are complete; **hosted native execution is pending**. Local tests validate the harness and preservation assertions, not Linux Files behavior. This result remains separate from the accepted inactive-menu/preference smoke.

The [active runner](../../../../../scripts/linux-native-active.mjs) launches the normal bundled Linux release executable through the existing external Tauri/WebKitGTK driver. It uses a new, disposable HOME and XDG environment and two wholly authored Vanilla profiles: A is active with exact matching live files, and B is an unchanged control. Neither profile contains imported player data, credentials, packs or launch options. The synthetic installation has no game executable, and all eight native/Flatpak/Snap Steam discovery candidates must remain absent. The [fixture implementation](../../../../../scripts/linux-native-active-fixture.mjs) and its [negative tests](../../../../../scripts/linux-native-active-fixture.test.mjs) define the exact accepted mutations.

## Native sequence and expectations

1. Open Files and the owned `tf/cfg/native-fixture.cfg` helper at 1200×800. Use real Ctrl+A/C and the disposable X server clipboard to verify its full original bytes. The protected installation, library and settings must still match the seed exactly.
2. Enter a harmless comment through the standard WebDriver input command. Copy its entire draft through native keys. No protected disk byte may change before Save.
3. Select the unique marker on line 80 with keyboard input after scrolling both editor axes. Visit Binds and return to Files. Require the same selected document, selection text, displayed line/column and both scroll positions, then copy the complete draft again. The draft must remain memory-only.
4. Click Files Save. Require exact matching live/library helper bytes, the corresponding manifest hash and the active profile's native-format update time. No unrelated manifest/index field, second profile, config, setting or file may change.
5. Make another draft and issue a real native close request. Require the Files decision dialog, the helper path, all three available actions and initial focus on Cancel. Click Cancel; require the same native process and complete draft, with the last saved checkpoint unchanged.
6. Issue a second close request and choose Discard and continue. Require native process exit before any cleanup. The checkpoint must stay byte-exact. Restart the native app and require the last explicit Save, without the discarded draft.
7. Enter the distinct close-save comment, issue another native close request and choose Save and continue. Require the second exact helper commit and native process exit before cleanup. Restart and copy the committed bytes from Files. A final clean close must also exit without cleanup being responsible.

The first planned execution captures nine states: initial Files, selected draft before navigation, restored draft, explicit Save, Cancel dialog, Discard dialog, restart after Discard, Save-on-close dialog and restart after close Save. A failed run also attempts a failure capture. None becomes accepted visual evidence until the actual PNG is inspected.

## Native input, close and evidence boundaries

All application interactions use genuine WebDriver keyboard/pointer input. DOM scripts read rendered state and install/remove a passive copy observer. They never click or focus DOM elements, invoke Tauri IPC directly, access CodeMirror's internal model, inject command results or add a production testing hook. The trusted copy event must contain the expected complete text before the independent X clipboard read can pass; a stale clipboard value alone is insufficient.

The active-only [close helper](../../../../../scripts/linux-native-active-close.mjs) verifies the native PID, exact executable, owned driver process group and process start identity. It then requires exactly one owned X11 window advertising `WM_DELETE_WINDOW`, checks its title, and sends the `WM_PROTOCOLS` close request to that observed window. The X.Org protocol permits the client to ask for confirmation and decline the request. [ICCCM window deletion](https://xorg.freedesktop.org/archive/X11R7.7/doc/xorg-docs/icccm/icccm.html#window_deletion).

`xdotool windowclose` is unsuitable because its implementation destroys the window. Its graceful `windowquit` path instead relies on an EWMH window manager, which this bounded Xvfb harness does not introduce. [Upstream xdotool implementation](https://github.com/jordansissel/xdotool/blob/master/xdo.c).

Native process disappearance is recorded **before** WebDriver/session/process-group cleanup. The external driver owns that child, so its exit status is not observed: records explicitly retain `nativeExitCode: null`. A passing run can establish the displayed decision, subsequent process disappearance, exact disk outcome and restart behavior; it does not establish a zero native exit code or distinguish every possible shutdown failure.

Capture waits require loaded fonts and settled finite animations. Only the known infinite CodeMirror cursor-layer blink is exempted; unknown infinite motion still blocks. Three identical screenshots and stable rendered native state remain mandatory. Visible headings exclude retained hidden panes. These are webview-content images, not screenshots of external OS dialogs or window decorations.

## Reproduction and verification

The root-owned development workflow adds `xclip` and checks Python3/libX11, then runs the active case after the existing inactive smoke using the same built binary:

```sh
xvfb-run -a -s '-screen 0 1600x1200x24' dbus-run-session -- node scripts/linux-native-active.mjs
```

The runner refuses non-Linux, non-CI, self-hosted and existing execs/Steam/TF2 contexts. Run it only on the disposable GitHub-hosted worker. Driver requests, X11 inspection, copy reads, readiness and process-exit checks are bounded. There is no installer, uploadable executable, tag, release, Steam launch or game launch.

Local verification on Windows:

- Combined active harness, active fixture, inactive harness and package fixture suite: **44 tests, 43 passed, 0 failed, 1 platform skip**. The skipped Python helper syntax check runs on Linux.
- Active-only portion: **20 tests, 19 passed, 1 platform skip**.
- Scoped Biome: passed for the new runner/helpers/tests.
- The embedded Python sender also passed a separate syntax-only compile with the bundled Windows Python. No X11/native code was executed by that local check.
- Independent read-only review repeated the combined tests and cleared the implementation for its first hosted execution.

The exact checkpoint validator also refuses added/deleted files, links, unknown directories, partial publication, unexpected timestamp changes, extra pending metadata, Steam discovery paths and recovery remnants. After Save it permits only the exact empty ordinary mutation container that the current transaction cleanup can retain; contents or children are refused.

This batch does not qualify profile switching, imports, exports, installer/updater behavior, real game locks, source-conflict saves, all settings panes, physical mouse zoom, Wayland, hardware rendering or a screen reader. Those require their own evidence. The first hosted run must retain its exact tested merge, binary SHA-256, action/close traces, checkpoints, actual PNGs and any failure without reclassifying an unexecuted or failed step as passed.
