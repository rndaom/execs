# Shared integration and Files QA

September 22, 2026. Foundry development working tree based on `e1fecdaaf4de2c7257eb2dbe875ac45f22ee4dcc`; no release. Browser inputs are named preview fixtures, not player configuration.

## Result

Passed for the implemented browser interactions and visual scope below. Native file dialogs, Steam writes, update installation and the Windows/Linux packaged matrix are separate qualification gates.

Files retains the workbench already established in this branch: persistent file list, one source editor, explicit Save/Discard, and contextual Problems/Help beneath it. Its title now matches the shared pane hierarchy. The source font and bounded editor scroll remain deliberate Files-only exceptions to the general Foundry settings layout. Reference: `options/01-foundry/03-workspaces.png`, lower-left; operational states: `05-states.png`.

## Actions verified

- At 1200×800, Files, Problems and Guides share the Foundry hierarchy, warm surfaces and hairlines. Clicking a real warning focuses its source token in the editor.
- Creating a helper opens an unsaved session draft. Typed content survives App settings and back navigation. Changing the install with that draft opens Save/Discard/Cancel with Cancel focused; Cancel preserves the draft. Explicit Save clears the dirty state and shows actual preview completion.
- At 960×640, manual review found clipped Find actions and a clipped new-helper destination. Find now uses three compact rows at narrow widths, exposes focus on its search options, and all controls stay within the editor. The helper choices fit and long destinations wrap. Fresh Chrome captures and measured control bounds verify the correction.
- Closing Find through its own close button now also clears the toolbar's pressed state. The regression is covered in the real CodeMirror interaction test.
- App preferences remain a separate global surface while visited profile panes retain session state. Preference editing waits for native close protection; in-flight preference writes block close transitions.
- HUD review gates background pane operations, resets with install identity, and refreshes the current profile on committed success. Mods review routing cancels transient Saving feedback, distinguishes handled review from an install failure, and suppresses late feedback from a prior profile.
- Explicit pack/designer drafts offer a route to the responsible pane, Discard and Cancel. They do not offer a Save-and-continue action that cannot perform the required build/apply operation.

## Evidence

| File | Meaning |
| --- | --- |
| `01-files-default-1200.png` | Accepted default workbench. |
| `02-files-problems-1200.png` | Accepted real fixture warning. |
| `03-files-guides-1200.png` | Accepted expanded guide catalog. |
| `04-files-new-helper-1200.png` | **Pre-fix evidence**: helper path/choice clipping; superseded by the Chrome correction below. |
| `05-dirty-files-install-guard-1200.png` | Accepted draft-protection dialog over App settings. |
| `06-files-find-dirty-960.png` | **Pre-fix evidence**: clipped Find controls. |
| `07-files-find-corrected-960.png` | **Rejected**: IAB retained the old rendered search grid despite source updates; not correction evidence. |
| `../files-diagnostic/01-find-chrome-960.png` | Accepted correction: fresh 960×640 Chrome, every Find action measured inside the editor. |
| `../files-diagnostic/02-helper-path-chrome-960.png` | Accepted correction: complete helper destination wraps and action remains reachable. |

The IAB discrepancy is not attributed to a confirmed product defect; fresh Chrome verified the current source and production TypeScript/build checks passed. No new console error was observed during the final Files actions; historic hook-order errors came from concurrent development HMR and are excluded from cold-load qualification.

Tests: 34 Files/editor/pending-settings tests passed after the fixes; 62 Host/Mods/exit-guard tests passed after integration routing fixes. These overlap the final integrated suite and must not be added to its count.
