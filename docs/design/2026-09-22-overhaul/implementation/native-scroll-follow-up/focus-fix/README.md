# Keyboard-entry viewport correction

The [native diagnostic](../README.md#diagnostic-execution-focus-entry-causes-the-reset) establishes that pane restoration succeeds and both editor axes reset only when Tab enters CodeMirror. The correction observes an unmodified Tab or Shift+Tab without preventing it or deciding its destination. If focus actually enters this editor, a bounded measurement synchronizes CodeMirror's DOM selection through its public `focus()` API before restoring the captured viewport. Pointer, wheel, another key, a prevented Tab, a different focus destination, changed document/selection, or a replaced/destroyed view invalidates the pending repair.

No native assertion or expected byte changed. The browser already passed this route before the correction; its post-change pass is regression evidence, not proof that WebKitGTK is fixed.

## Verification

- Both modeled forward/reverse Tab regressions failed before the source correction (`0` instead of expected top `1210`) and pass afterward. All **18 FilesEditor tests** pass, including cancellation through actual events, read-only entry, document/profile replacement, selection and Undo preservation. Independent review repeated the 18 tests with no actionable finding. FilesPane and SettingsHost integration suites also pass all **27 tests**.
- Full local `pnpm test` passes **890 desktop + 160 cfglint + 94 tooling = 1,144 tests**, with four platform skips and zero failures. TypeScript and the production frontend build pass, retaining the existing Vite chunk-size advisory.
- The in-app browser at 1200×800 retains `top 1255 / left 1938`, `SELECTION-A`, and `Ln 80, Col 363` before navigation, after Binds → Files → Tab, and after Tab exits to Problems then Shift+Tab returns. Final Ctrl+A/C returns all **4,881 bytes** exactly, SHA-256 `43bb261b456decc6d3f732b54b2454685e23bc67598e932ff862e9f0e28f776c`. Save was never clicked. [Observations](browser-observations.json).
- All three saved images were individually opened and compared together: [before navigation](01-browser-before-navigation.jpg), [after forward Tab](02-browser-after-tab.jpg), and [after reverse Tab](03-browser-after-reverse-tab.jpg). Same viewport, draft, profile and file; no visible composition, type, color, asset or content drift appeared in this focused Files comparison.

[Native run 35777278322](../../linux-native/run-35777278322/README.md) now verifies this correction: the current run's exact `top 1210 / left 2162`, selection and position survive navigation and Tab entry. Explicit native Save also commits all 4,881 bytes with the expected live/library/manifest hashes. Five active native images were individually inspected, including the before/after pair and Saved feedback.

The overall run failed afterward because the close helper found three candidate windows and safely sent no request. Real close decisions and restart remain unexecuted. Existing native failures retain their original attribution. This batch does not qualify broader package, updater, Cloud, game, media or accessibility requirements.
