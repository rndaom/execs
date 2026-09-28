# Mouse 4 / Mouse 5 recording

The recorder already mapped DOM buttons 3 and 4 to Source `mouse4` and `mouse5`. The missing work was event delivery and the lifetime of browser-default suppression.

## Evidence and implementation

- The old recorder handled only `mousedown`, then removed its listeners when the bind entered the draft. Chromium's [back/forward mouse-button browser tests](https://chromium.googlesource.com/chromium/src/+/e4cdf6e6774c8b79cd8701676ac584a0d78acb84/content/browser/web_contents/web_contents_impl_browsertest.cc) demonstrate that `mouseup` cancellation prevents history navigation. The recorder now retains a guard for the recorded gesture's release, click, auxiliary click and context menu after React closes recording. Side-button releases have a fallback capture path. Ordinary later gestures remain available.
- [WebKitGTK 2.48's event conversion](https://github.com/WebKit/WebKit/blob/webkitgtk-2.48.0/Source/WebKit/Shared/gtk/WebEventFactory.cpp) maps native buttons 1–3 but omits buttons 8/9. A Linux-only adapter on the main webview converts those native side buttons to DOM 3/4 before WebKit handles them. Extra buttons become an unsupported value, preserving the existing visible explanation instead of silently recording Mouse 1.
- The GTK adapter uses [Tauri's platform webview access](https://docs.rs/tauri/2.11.5/tauri/webview/struct.Webview.html#method.with_webview) and GTK widget button signals. It is enabled only during recording. Ordinary buttons and side buttons outside capture pass through. A captured press owns one matching release, which still reaches the renderer after recording stops so the renderer can retire its guard.
- Main-window-only IPC uses increasing sequence numbers to reject stale enable/disable calls. Hiding the pane, changing profile, losing focus or unmounting cancels capture. Native focus loss also resets capture and held buttons. No global mouse hook, disk writes or new game-write path is introduced.
- Existing keyboard, wheel, conflict review, unsupported-input feedback and autosave paths remain in use. The existing app styles and action notices are retained.

## Checks completed

- `pnpm --filter @execs/desktop test src/BindsPane.mouse-native.test.ts src/BindsPane.test.ts src/lib/binds-ui.test.ts src/hooks/retained-pane-interaction.test.ts`: 70 tests passed.
- `cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml -p execs --lib bind_mouse`: three tests passed on Windows. These cover native button mapping, release ownership after disable, duplicate presses and stale command ordering.
- `pnpm --filter @execs/desktop exec tsc --noEmit`: passed after the final test additions.
- Focused Biome checks and Rust formatting completed. Full repository checks belong to the combined change verification.
- Independent review found that the first native implementation withheld a consumed release after capture was disabled. It now always forwards that matching release; the regression is covered by the native state test and frontend post-render release tests.

## Remaining native verification

These tests exercise event handling and state transitions; they are not physical-device acceptance. Linux compilation must pass hosted CI because this Windows environment has no usable Linux runner. Neither a physical side-button press in the installed Windows WebView2 app nor Linux WebKitGTK hardware input was exercised here.

Before describing both platforms as manually verified: record each side button in the native app, confirm one correct key cap and cfg line, check that releasing it does not navigate, repeat through conflict review, and confirm that blur, pane/profile changes and cancellation leave ordinary input available. Check a device with unsupported extra buttons for the visible refusal. Use an isolated profile/install fixture; no live player files were changed for this work.
