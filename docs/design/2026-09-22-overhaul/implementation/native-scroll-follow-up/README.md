# Files scroll retention: native failure and browser comparison

September 22, 2026. **Native retention remains failed; the reset is now isolated to keyboard focus entering the restored editor.** The corrected newline input passed in [Linux run 35772324501](https://github.com/rndaom/execs/actions/runs/35772324501), but returning from Binds to Files reset the visible editor viewport. The diagnostic follow-up below proves render restoration succeeds before Tab enters CodeMirror. Explicit Save, native close decisions and restart were not reached.

## Observed native result

The run tested PR merge `c89f1396abddb67b2bb7fed4f0775beb6a325add`, from head `28c0f0ed1ed5dcba61fab5414eca732b35fb1368`. Its optimized executable SHA-256 is `05c6b4e14f204dc4c2d48e285616e4b456358079e06f2608965ee82a461be4b4`, identical to the preceding product build. [Original results](../linux-native/run-35772324501/linux-native-smoke-c89f1396abddb67b2bb7fed4f0775beb6a325add/execs-linux-native-active-7zhZ6O/evidence/results.gen.json) retain the failed outcome and all five preservation checkpoints. The `.gen.json` suffix exempts raw evidence from formatting; its bytes are unchanged.

1. **Initial Files — passed within scope.** Native Ctrl+A/C returned the exact 4,848-byte authored helper. The [initial image](../linux-native/run-35772324501/linux-native-smoke-c89f1396abddb67b2bb7fed4f0775beb6a325add/execs-linux-native-active-7zhZ6O/evidence/01-native-active-files.png) shows the correct Files workspace at 1200×800.
2. **Edited draft — passed before navigation.** Explicit Enter input retained the trailing LF. A trusted copy event and independent native clipboard read matched all 4,881 bytes, SHA-256 `43bb261b456decc6d3f732b54b2454685e23bc67598e932ff862e9f0e28f776c`. Keyboard selection reached `SELECTION-A` at `Ln 80, Col 363`, with both axes scrolled. The [before image](../linux-native/run-35772324501/linux-native-smoke-c89f1396abddb67b2bb7fed4f0775beb6a325add/execs-linux-native-active-7zhZ6O/evidence/02-native-draft-before-navigation.png) begins around line 58 and shows the marker near the lower right.
3. **Binds → Files → keyboard focus — failed.** Document identity, focus, position and selected text passed their assertions; vertical scroll retention failed. The [failure image](../linux-native/run-35772324501/linux-native-smoke-c89f1396abddb67b2bb7fed4f0775beb6a325add/execs-linux-native-active-7zhZ6O/evidence/failure.png) shows line 1 at the top left while the status still says `Ln 80, Col 363`. The complete draft was not recopied after this failed assertion. The original harness did not retain numerical before/after geometry on failure, so no exact native scroll delta is inferred.

All three native PNGs were individually opened, then the before/failure images and browser after-focus image were viewed together in one comparison input. This is a behavior comparison, not a pixel-fidelity pass: both viewports are 1200×800, but the native authored profile/helper and browser fixture use different profile names, file lists and platform font rendering. The browser also exposes the development-only Inventory entry. The actionable P2 finding is loss of the editor viewport despite retained selection; it interrupts returning to an unfinished edit.

All 12 protected files remained exact before launch, after the initial read, after draft input, while away in Binds and after process cleanup. No Save or close decision was exercised. The independent inactive native scenario passed its assertions; its five newly archived images have not been accepted as a new visual review.

## Matching browser route

The in-app browser used the same authored 4,881-byte draft in its fixture-only `autoexec.cfg`, without Save. The native-like key sequence was Ctrl+Home, 79 Down keys, End, and 11 Shift+Left keys on the focused editor. An earlier locator-driven setup reached a different line and was rejected before this comparison.

| Captured step | Observed result |
| --- | --- |
| [Before pane navigation](01-browser-before-navigation.png) | `SELECTION-A`, `Ln 80, Col 363`, top 1255, left 1938. |
| [Files rendered before editor focus](02-browser-restored-before-focus.png) | Same document position and both scroll values; Files navigation button has focus. |
| [Editor reached through Tab](03-browser-after-tab-focus.png) | All 13 observed focus destinations preserve top 1255 / left 1938; final editor selection is `SELECTION-A`. |

Each saved browser image was individually inspected. [Exact DOM observations and focus trace](browser-comparison.json) also record the final complete-draft copy: 4,881 bytes with the same SHA-256 as the native pre-navigation draft. This browser pass does not qualify WebKitGTK retention or native Save/close behavior.

## Next diagnostic run

The harness now persists the before-navigation state, first render and settled render before editor focus, every genuine Tab destination, and bounded retention polling even when the assertion fails. It records active-element geometry, editor/pane/window scroll and the nested assertion cause. Expected bytes, selection and the two-pixel retention tolerance stay unchanged. DOM scripts only observe; they do not repair focus or scroll.

The existing `EditorSessionBoundary` and CodeMirror scroll snapshot are already present in this failed binary. Another fix for the previously corrected passive-cleanup issue would not explain this result. The next trace must establish whether WebKitGTK loses the viewport before focus or while entering it; then a targeted product regression and corrected native run can support a fix.

Local verification of the diagnostic changes: the complete existing tooling suite passes **70 tests**, with four platform skips and zero failures. The three added tests cover focus-induced geometry changes, retained failed observations and bounded nested error causes. Installer, updater, Steam Cloud, retail game and accessibility acceptance remain separate.

## Diagnostic execution: focus entry causes the reset

[Run 35775130580](https://github.com/rndaom/execs/actions/runs/35775130580) tested diagnostic head `c40e2743a88e0d5c29c137ba4ee5e4b2c868cb8e` through merge `6a738eebb77de9594219de389667397c509380f0`. The product ELF remains SHA-256 `05c6b4e14f204dc4c2d48e285616e4b456358079e06f2608965ee82a461be4b4`. Build and inactive native assertions passed. The active sequence failed retention again.

[Exact trace](../linux-native/run-35775130580/linux-native-smoke-6a738eebb77de9594219de389667397c509380f0/execs-linux-native-active-ggs17m/evidence/results.gen.json) establishes:

| Observation | Editor top / left | Selection and position |
| --- | --- | --- |
| Before capture and immediately before navigation | 1210 / 2234 | `SELECTION-A`; `Ln 80, Col 363` |
| First render and settled paint after returning to Files | 1210 / 2234 | The stored line/column remains 80 / 363; editor is unfocused. |
| Tab destinations 0–10, ending at Wrap lines | 1210 / 2234 | Editor remains unfocused. |
| Tab 11 enters `.cm-content` | **0 / 0** | Editor focused; `SELECTION-A` and line/column unchanged. |
| 96 retention polls, final 20 retained | **0 / 0** | The reset persists. |

The pane and window scroll remain zero throughout. Thus the existing before-hide capture and initial render restoration work in this run; the observed reset happens on keyboard entry into CodeMirror. The trace does not distinguish WebKit's default focus behavior from CodeMirror's subsequent DOM-selection synchronization. A focused product correction is required, without replacing the saved viewport with a generic “scroll to caret.”

All three current PNGs were individually inspected together: [initial native Files](../linux-native/run-35775130580/linux-native-smoke-6a738eebb77de9594219de389667397c509380f0/execs-linux-native-active-ggs17m/evidence/01-native-active-files.png), [selected draft before navigation](../linux-native/run-35775130580/linux-native-smoke-6a738eebb77de9594219de389667397c509380f0/execs-linux-native-active-ggs17m/evidence/02-native-draft-before-navigation.png), and [failed return](../linux-native/run-35775130580/linux-native-smoke-6a738eebb77de9594219de389667397c509380f0/execs-linux-native-active-ggs17m/evidence/failure.png). They show the same bounded Files composition and failed viewport transition as the preceding run, with no blank/loading capture accepted.

Both full-byte copy checks pass before navigation, including the exact 4,881-byte draft. Every protected file remains byte-exact through final cleanup. No Save, close decision or restart is claimed. Raw JSON suffix changes preserve bytes; the active results hash is `22cf110a53173a0681f3678b857f4093d5f623361de8c1da860efda47423d039`.
