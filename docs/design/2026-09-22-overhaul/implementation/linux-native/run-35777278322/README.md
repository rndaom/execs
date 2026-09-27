# Native Files viewport and explicit Save

[Run 35777278322](https://github.com/rndaom/execs/actions/runs/35777278322) proves the targeted keyboard-focus correction and explicit Files Save on Linux WebKitGTK. The overall run failed later, before any close request, because its X11 helper found three close-capable windows. Cancel, Discard, Save-on-close and restart remain unexecuted.

The candidate was `d80fe576f90fc0ca8a4e5c37ea8decb8274c4475`; the tested merge was `30624b62b2af65d6fd48ecae1d62618ad2cbc1fa`. The normal optimized native binary has SHA-256 `e0eff8183241835bb3d7bab989730b91d2c0b37add4ab651e57be5968bb11791`. This is the production frontend in a disposable Ubuntu 22.04 X11/WebKitGTK environment with authored profiles and no Steam or game executable, not an installed package or a player's library.

## Observed sequence

1. **Initial Files — passed.** Native Ctrl+A/C returned all 4,848 original bytes. The initial protected fixture remained unchanged.
2. **Draft and navigation — passed.** Native input produced exactly 4,881 bytes. Before navigation, this run measured `top 1210 / left 2162`, selection `SELECTION-A`, and `Ln 80, Col 363`. Those exact values survived Binds → Files, the first rendered frame, settled paint, every Tab destination and focus inside CodeMirror. The existing equality assertion passed without changing its expected value or tolerance. The complete draft was copied again and remained memory-only.
3. **Explicit Save — passed.** The real Files Save action committed exactly 4,881 bytes, SHA-256 `43bb261b456decc6d3f732b54b2454685e23bc67598e932ff862e9f0e28f776c`, to the library and live helper. Manifest hash and the allowed native update-time metadata passed the existing checkpoint validator. Unrelated files, the second profile and settings remained exact.
4. **Close-candidate draft — retained, close unexecuted.** A distinct 4,927-byte draft stayed in memory. The helper then refused `Expected a single owned close-capable X11 window: 3 !== 1` before sending `WM_DELETE_WINDOW`. It did not retain the three candidates' map states, so this run cannot identify their purpose. Cleanup preserved every byte and metadata field in the explicit-Save checkpoint.

The earlier diagnostic run measured its own horizontal baseline of `2234` and reset both axes to zero on Tab entry. The current baseline of `2162` is measured from the current run, not a changed hard-coded expectation. The before/after equality and exact-byte checks remain the acceptance criteria.

## Inspected visual evidence

All five active PNGs were individually opened by the parent and compared in one review input, together with the previous native failure image. Each shows the correct nonblank 1200×800 Files surface. Before/after navigation has the same document, visible line range, horizontal offset, selection, controls and Foundry styling. The long authored line intentionally requires horizontal scrolling; shorter lines are outside that viewport. The Save state removes the dirty indicators and shows Saved. The final image is the unsaved close candidate, not a close dialog.

| Step | Accepted image | Visual result |
| --- | --- | --- |
| Initial read | [Initial Files](linux-native-smoke-30624b62b2af65d6fd48ecae1d62618ad2cbc1fa/execs-linux-native-active-1s5KjY/evidence/01-native-active-files.png) | Correct helper and original content |
| Draft baseline | [Before navigation](linux-native-smoke-30624b62b2af65d6fd48ecae1d62618ad2cbc1fa/execs-linux-native-active-1s5KjY/evidence/02-native-draft-before-navigation.png) | Dirty state, both axes scrolled, line-80 selection |
| Restored draft | [After navigation](linux-native-smoke-30624b62b2af65d6fd48ecae1d62618ad2cbc1fa/execs-linux-native-active-1s5KjY/evidence/03-native-draft-after-navigation.png) | Same viewport and selection |
| Saved helper | [Explicit Save](linux-native-smoke-30624b62b2af65d6fd48ecae1d62618ad2cbc1fa/execs-linux-native-active-1s5KjY/evidence/04-native-explicit-save.png) | Saved feedback and clean document |
| Safe harness stop | [Close candidate](linux-native-smoke-30624b62b2af65d6fd48ecae1d62618ad2cbc1fa/execs-linux-native-active-1s5KjY/evidence/failure.png) | Further draft remains visibly dirty; no dialog was reached |

[Exact active results](linux-native-smoke-30624b62b2af65d6fd48ecae1d62618ad2cbc1fa/execs-linux-native-active-1s5KjY/evidence/results.gen.json) have SHA-256 `662d0b65557a703f99ae853644586891067969162a273179466f75902a8b06b2`. All four archived JSON files were renamed to `.gen.json` without changing their bytes and hash-checked against the downloaded artifact. The five inactive smoke images are retained alongside their passing machine results; they are not counted as new visual review in this checkpoint.

The next harness correction must retain all close-window candidates and target only a uniquely proven mapped main window, repeating ownership checks before sending the real native request. No dialog action, process-exit, restart, package, updater, Cloud, retail TF2, media or screen-reader pass is inferred here. All original selected acceptance remains open and release remains unauthorized.
