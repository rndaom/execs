# App settings — Foundry implementation QA

22 September 2026. Scope: App settings, its global preferences, update-check reconciliation, and the shared HUD ownership review. This is a scoped implementation check, not completion of the whole overhaul or a native release qualification.

## Comparison and iterations

The visual target is the bottom-right App settings panel of `options/01-foundry/04-profiles.png` (full board 1672 × 941). It is a generated multi-panel concept, not a precise 1280 × 720 specification. The reference and actual render were opened together for comparison. Text size, content density and section proportions were judged at actual application size rather than treating generated small text as product requirements.

- Initial evidence: `01-app-settings-initial.png`, 1280 × 720. The extra standalone Back row and loose section rhythm pushed the support section too far down. These were P2 differences from the compact reference.
- Parent integration moved Back beside the version in the header. Section spacing was reduced, App data path/copy became one row, and sections use the reference's warm two-column surfaces with a quiet vertical divider.
- Post-fix evidence: `07-app-settings-final-1280.png`, 1280 × 720, default preferences and credits closed. The reference and this revised capture were opened together again. Five distinct sections and the primary support actions are visible in the first viewport; explanatory credits remain a disclosure.
- Minimum-window evidence: `09-app-settings-minimum-960.png`, actual browser viewport 960 × 640 with device scale factor 1; document scroll width is 960. The earlier `08-app-settings-minimum-960.png` is rejected because tab-scoped device emulation left a scaled, letterboxed capture. The replacement uses the browser viewport capability, verifies the App settings heading/state, and restores the default viewport afterward.

## Required fidelity surfaces

| Surface | Result |
|---|---|
| Typography | Shared Inter, strong pane title, section headings, readable secondary copy. No monospace UI. Header version stays secondary. |
| Layout and rhythm | Reference-like section surfaces and label/control columns; controls wrap at the supported minimum width; app data path remains copyable and long install paths wrap instead of creating horizontal overflow. Support credits use normal page scrolling. |
| Colors and tokens | Shared Foundry warm background/surfaces/ink and restrained selected-control emphasis; no per-pane color overrides, light theme, or separate palette. |
| Imagery and icons | App settings requires no game imagery. Standard Phosphor icons are reused for paths, copy, support links and version context. No fake game art or custom illustration has been introduced. |
| Copy and behavior | Reconciled generated Theme controls to the accepted Follow system / Reduce motion choices. App preferences are clearly global. Current install and app-data paths are real backend values. No invented cleanup, uninstall, telemetry, release channel or Restore action. |

## Interaction evidence

- Browser checks covered first-run access, Find TF2 returning to the existing confirmation flow, Escape returning to the previous pane with focus on the App settings navigation entry, disclosure expansion, manual update checks, and preferences while the TF2-running fixture keeps Change install disabled.
- A P1 keyboard defect was found during the first pass: temporarily disabling a preference during persistence could drop radio focus. The preference hook now gives immediate feedback, serializes/coalesces rapid edits, and keeps preference controls enabled. The repeated browser check retained focus on `app-motion-reduce` after the write; ArrowLeft moved back to Follow system.
- App Reduce produced `data-motion="reduce"` and computed switch transitions `0s` while OS reduction was false. Follow system removed the override; emulated OS reduction still produced `0s`. The temporary media override was cleared. With OS reduction false and Follow system selected, the switch used the shared 150 ms transitions.
- A full reload after hook changes produced no new browser console errors or warnings. Earlier Fast Refresh hook-order errors occurred while the custom hook signature changed in development; they did not reproduce after reload.
- `03-support-open.png`, `04-app-settings-game-running.png`, and `05-app-settings-before-profile.png` document supplemental states before the final section-surface adjustment.

## Functional verification

- 32 targeted frontend tests passed across AppSettingsPane (7), useAppPreferences (5), useAppUpdate (11), bridge-updater (7) and AppFooter (2). Coverage includes failed reads/writes, precise Retry, combined rapid edits, remount persistence, pre-profile use, guarded install changes, native-close readiness, exact Windows/Linux path copying, offer→none, newer/dismissed offers, failure retention, out-of-order checks, Strict Mode, and install refusal during a check.
- Integration review reproduced an updater race with a deferred resource close: the adapter could publish a newer install identity before its check returned, while a subsequent failed request left the interface showing the prior offer. The bridge now publishes the generation-bound identity after resource cleanup. The new regression test passes. An independent ref also prevents a parent render before the first install progress callback from permitting another install/check.
- All 13 core settings tests passed on Windows using disposable directories. Legacy/missing settings defaults, pre-install persistence, malformed/unsupported settings refusal, root/preferences preservation, concurrent root confirmation, bounded reads and legacy path migration are covered.
- `cargo check --manifest-path apps/desktop/src-tauri/Cargo.toml -p execs --lib --locked` and frontend TypeScript checking passed at this verification point.
- Real user settings were not changed, TF2 was not launched, and no update was installed. Native Linux execution and the full desktop exit/update qualification remain part of the parent release matrix.

## HUD ownership review

- The shared dialog uses the Foundry modal, standard option tiles, Inter and Phosphor folder/info icons. It focuses Cancel and requires an explicit choice even when the review has one candidate. Source, exact folder and file count stay visible; the current selection is descriptive, not a preselected confirmation.
- `10-hud-ownership-unselected-1280.png` shows the initial review. `11-hud-ownership-selected-1280.png` shows the live ToonHUD selection with the recovery explanation expanded. `12-hud-ownership-minimum-960.png` records the same expanded state at actual 960 × 640, DPR 1, without page overflow or dialog clipping; the viewport was reset immediately. `13-hud-ownership-applied-1280.png` shows the fixture after successful selection and parent refresh.
- The browser check verified native radio ArrowLeft/ArrowRight behavior and stable focus, the disabled confirmation before selection, the enabled confirmation after choosing, and the visible ToonHUD installed state after confirmation. No new console error occurred during this fixture pass; prior development import/Fast Refresh failures predate the fresh navigation.
- The explanation says other HUDs move out of the active setup and stay in recovery copies. It does not promise a Restore button or claim those folders remain selectable in the profile. When the native review identifies old generated option files, a visible notice names the files and startup-line reset before confirmation, including a sole-candidate pending import cleanup.
- `14-hud-ownership-option-reset-1280.png` shows the additional reset notice. At the minimum window, this longer expanded review initially clipped the bottom of the action row (`16-hud-ownership-option-reset-960.png`, P2). The dialog now keeps its title and actions fixed while long review details scroll. `17-hud-ownership-final-960.png` verifies the fix at actual 960 × 640, DPR 1: the confirmation spans y559–599 inside the dialog ending at y624. `15-hud-ownership-option-reset-960.png` is rejected as a transient scaled/letterboxed screenshot; a settled viewport capture was used for the finding and its fix. Temporary viewport changes were reset.
- 16 HUD UI tests passed: hook (7) and dialog (9). They cover exact profile/fingerprint binding, old read responses, wrong-profile reads, explicit choice, duplicate prevention, running/busy guards, fresh review after stale failure, unreadable review refusal, Cancel focus/Escape, parent busy handoff, failed post-commit refresh without repeating the write, zero candidates, and both managed-option reset cases.
- Parent integration includes HUD selection in the native-close busy guard and retained pane external-busy guard, refreshes the profile after selection, and clears the review when changing installs. The UI's native payload writes and byte-preservation guarantees are qualified in the HUD agent's disposable core fixtures, not by the browser preview.

## Remaining scope and polish

No unresolved P0/P1/P2 visual findings in this App settings scope. The concept's exact generated rows are intentionally replaced by supported product behaviors. Verify the whole application and native close guard separately before declaring the overhaul complete.

final result: passed
