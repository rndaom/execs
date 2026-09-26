# Foundry Launch qualification

Reviewed on 2026-09-22 against the lower-right Launch workspace in `options/01-foundry/03-workspaces.png`. The reference and final rendered screenshots were inspected together. This review covers the production `LaunchPane.tsx` and `lib/launch-ui.ts`, not an alternate implementation.

## Result and evidence

The Foundry token surface, editable launch string, copy action, Steam result row, and Steam instructions retain the selected layout. At 960 × 640 the tokens wrap and the instructions continue in the normal pane scroll. Long quoted options wrap within their chip; no horizontal overflow was observed.

Accepted screenshots in this directory:

| Capture | Verified pixel and CSS viewport | State |
| --- | --- | --- |
| `launch-default-1200-final.png` | 1200 × 800 | Initial token/launch-string workspace |
| `launch-add-1200-final.png` | 1200 × 800 | Unsubmitted quoted option; protected draft and disabled Steam retry |
| `launch-saved-steam-open-1200-final.png` | 1200 × 800 | Quoted option grouped together; backend fixture reports Steam open |
| `launch-default-960-final.png` | 960 × 640 | Token wrapping, raw editor, copy and retry |
| `launch-long-token-960-final.png` | 960 × 640 | Long quoted path remains inside its chip and raw editor |
| `launch-raw-sequence-960-final.png` | 960 × 640 | Ambiguous command sequence uses raw editing |
| `launch-game-running-960-final.png` | 960 × 640 | Editable draft, disabled write action and shared deferred notice |

The initial `launch-initial-1200.png` is rejected evidence: Chrome returned a 1200 × 556 compositor frame during concurrent viewport work. The final captures were taken with exclusive viewport coordination and their PNG dimensions were checked. Chrome was reset and the dedicated test tab closed afterward.

No unresolved P0/P1/P2 visual or interaction issue was found in these states.

## Findings fixed

- Quoted option-looking values could be split into independent removal chips. Ambiguous quoted flags/values, command sequences, and wrapper prefixes now remain in the exact-string editor rather than receiving guessed removal boundaries. Ordinary quoted filenames and negative numeric arguments stay with their option.
- Appending an option trimmed the existing source string. The append helper now preserves its existing spelling, quotes, and whitespace. Removal retains the untouched option bytes and removes the selected group's separator whitespace.
- Removing a focused chip dropped keyboard focus. Focus now moves to the next chip or Add option. The composer focuses its field, supports Enter to add and Escape to cancel, and restores focus to Add option.
- The new composer held unsubmitted text outside the session draft registry. It now uses the existing explicit-draft registration and profile-keyed state: navigation retains it, Add transfers it to the existing autosaved launch string, and Cancel/Discard clears it. Steam retry waits until an unfinished addition is added or cancelled.
- Retry only handled rejected promises, while `SettingsHost` normally resolves `false` on failure. Retry now awaits the existing boolean outcome, blocks duplicate requests, and replaces stale success status with an unconfirmed-result message on failure. The host retains ownership of the detailed error toast.
- Long token chips now wrap instead of overflowing. Warning detection now agrees with native normalization for escaped quote fragments and quoted `%command%` fragments.

## Backend contract and deliberate reference differences

`SettingsHost` remains the only persistence route: both autosave and explicit Steam retry call its same `onSave`, serialized through `runWrite`. This review added no direct bridge call, alternate persistence mechanism, Steam liveness polling, or native mutation.

The native `set_profile_launch_options` command takes the write gate. `core/src/launch.rs` refuses TF2-running writes, sanitizes and commits the profile string, then reports a separate Steam result. Production Steam writes sample the live process table before preparing, backing up, and replacing `localconfig.vdf`. A profile save can therefore succeed with `steam_open`, `no_account`, or `write_failed`; the pane must not equate a saved profile with a Steam write.

The board's green live Steam indicator is intentionally not reproduced: this pane receives the last write result, not a live Steam process signal. An explicit retry remains available after a Steam-open result so the backend can check again. The existing profile selector in the application header is also not duplicated inside Launch. The raw field remains editable and multiline because chip grouping cannot safely represent every launch string.

No new backend contract is required. The browser fixture's `setProfileLaunchOptions` echoes its input and reports `steam_open`; it does not reproduce native sanitization. Native forbidden-option behavior was reviewed in source and its UI recognition has unit coverage, rather than being claimed from the fixture save. No real Steam file was written or TF2 launched during this qualification.

## Validation

- `LaunchPane.test.tsx`: 6 passing component tests cover grouped removal/focus, retained composer drafts, Escape/profile reset, TF2-running deferral and unlock, awaited retry/false outcomes/no duplicates, and exact clipboard/raw fallback behavior.
- `lib/launch-ui.test.ts`: 13 passing helper tests, including quoted source grouping, conservative fallback, exact append behavior, stale-range refusal and forbidden-token recognition.
- `pnpm exec tsc --noEmit` passed after the final explicit boolean type correction.
- Biome passed for the four owned Launch files.
- Browser verification: Enter added a quoted option; Enter removed that complete group without altering its neighbors; Escape cancelled the composer and restored focus; Copy produced the exact raw string; retry reported the fixture's Steam-open outcome; game-running edits retained the shared deferred status. The final browser log contained no errors.

Suggested release-note wording: “Edit launch options as removable tokens or an exact string, with keyboard-friendly additions and a clear Steam write retry. Unfinished additions stay protected with the profile's other drafts.”
