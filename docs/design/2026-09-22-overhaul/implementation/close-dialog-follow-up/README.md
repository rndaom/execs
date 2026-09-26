# Pending-change dialog follow-up

2026-09-22. Browser fixture review against the selected [Foundry states board](../../options/01-foundry/05-states.png), lower-left dialog. Captured from the real frontend at `http://127.0.0.1:1422/?preview=settings-files` in the Codex in-app browser. No native file was created or saved by this browser case.

## Long paths

**Fixed:** a valid helper filename made the dialog horizontally scroll and hid its suffix. At both 1200×800 and 960×640, the dialog's 606px content width had a 725px scroll width. The complete path now wraps, with a small gap separating the draft list from the explanation. Save, Discard and Cancel retain their existing behavior.

| Step | Evidence | Outcome |
| --- | --- | --- |
| 1. New cfg → Helper → enter the long name → Start editing → App settings → Change install | [Before, 1200×800](01-long-path-before-1200.png), [before, 960×640](02-long-path-before-960.png) | Reproduced clipped path and horizontal scrollbar. |
| 2. Apply the wrapping correction with the same draft and dialog open | [After, 960×640](03-long-path-after-960.png) | Complete 109-character path is visible over two lines; client and scroll widths both 606px. |
| 3. Review the effective space available at 200% of the minimum window size | [After, 480×320](04-long-path-after-480.png) | Dialog width and scroll width both 446px; height and scroll height both 239px. All three actions remain visible. This is a browser viewport test, not native zoom evidence. |
| 4. Tab from Cancel through Save, Discard and back to Cancel | [After, 1200×800 with keyboard focus](05-long-path-after-1200.png) | Focus stays within the dialog and the focused action is visible. |

The exact path is `tf/cfg/overrides/competitive_soldier_rocketjump_practice_crosshair_viewmodel_and_audio_preferences_backup.cfg`. [Rendered measurements](geometry.json) retain the path, dimensions, action bounds and observed focus cycle. The first screenshot immediately after the 960px resize showed a stale scaled frame; it was rejected and is not included. The accepted recapture matches the fresh 960×640 DOM geometry. The five `.png` files preserve the browser tool's original JPEG bytes without conversion; their actual pixel sizes match their filename labels.

## Foundry comparison

The source board and the revised 1200px screenshot were inspected together in the same comparison input. The board is 1672×941 containing four conceptual screens; the implementation is a 1200×800, density-1 viewport. This is a comparison of the dialog composition and controls, not a pixel-level comparison of the surrounding pages: the concept is over Files, while this deliberate install-change trigger is over App settings.

- **Typography:** the existing Inter hierarchy, semibold title, secondary explanation and legible full path are retained. Long names wrap instead of being scaled down or truncated.
- **Layout:** the compact raised dialog, separated explanation/content/actions and right-aligned action group follow the reference. Actions wrap at 480px without leaving the viewport.
- **Colors:** existing Foundry surface, ink, copper primary-action and keyboard-focus tokens remain unchanged.
- **Images:** the dialog uses no artwork; no concept image or fabricated preview is shipped.
- **Copy:** the real Save / Discard / Cancel contract is retained. The concept's per-file "Ready to save" and Retry claims are not added without corresponding application state. This case has one newly authored draft, not the concept's two existing files or failed save.

Final result for the long-path correction: **passed**. Cancel additionally restored focus to Change install, and Back to Files showed the same unsaved long-path document. Native close behavior, failed saves and OS accessibility are qualified separately; this browser case does not establish them.

## Returning to a pending pane

The independent [close review](../active-close-review.md) reproduced a destination-focus defect in the actual hook/App tests and a separate close/write timing race. Both received failing-then-passing regressions. Browser verification below exercises the real explicit-pack route without a fabricated save failure or native close.

| Step | Evidence | Outcome |
| --- | --- | --- |
| 5. Open `?preview=settings-crosshair`, change the custom shape from Cross to Dot, then App settings → Change install | [Pending review, 1280×720](06-review-crosshair-1280.png) | The dialog identifies Crosshair as requiring an explicit apply action. Tab from Cancel reaches Open Crosshair. |
| 6. Press Enter on Open Crosshair | [Focused destination, 1280×720](07-crosshair-heading-focused-1280.png) | The dialog closes and the visible Crosshair h1 receives focus. Dot stays selected and the pack remains unapplied. The next Tab reaches the selected Custom mode control. |
| 7. At 960×640, use Review changes → Open Crosshair again | [Focused destination, 960×640](08-crosshair-heading-focused-960.png) | Same-pane review also focuses the visible heading. No draft is applied or discarded. |
| 8. Open Review changes once more and choose Cancel | [Focus measurements](review-focus.json) | Cancel returns focus to the Review changes button; no dialog remains. |

The additional three captures also preserve original JPEG bytes under their `.png` names. The locked-game preview was inspected first but does not expose this review trigger while TF2 is running; no result from that state is claimed here. The browser route above uses the unlocked explicit draft instead.

Final result for browser pane-review focus: **passed**. The separate race regression uses the real synchronous settings-write queue before its next React render; its passing unit test is not relabeled as a native timing experiment. The integrated local run passes 882 desktop tests, 160 cfglint tests and 65 tooling tests, with four platform skips. TypeScript and the production frontend build pass; Vite retains its existing chunk-size advisory.
