# Windows sound-control speech acceptance

Date: 2026-09-18. Result: PASS for RND-293 accessible names, keyboard assignment, and announced assignment feedback.

## Environment and isolation

- Windows 11 25H2 (10.0.26200.9457), AMD64.
- NVDA 2026.2 AMD64, official portable distribution; Authenticode signature Valid, signer NV Access Limited. Installer SHA256 F3F8D29974A88D687B3C4809BE192219EC579C5BDABCDA5AAF53635288BCA824.
- Microsoft Edge WebView2 153.0.4234.32, hosted in a temporary .NET 10 WPF window using Microsoft.Web.WebView2 1.0.4191.47.
- Unchanged execs React source from maintenance HEAD 0650085a4c25169e6ca3ee6268e0ea4654d8ea05; no frontend/package differences from signed candidate c001e96. Vite development fixture URL `http://127.0.0.1:1426/?preview=settings-sounds`.
- Host exposes no Tauri IPC. All profile changes were in the fixture adapter in memory. NVDA configuration and WebView2 user data were isolated under this evidence folder. No real execs profile, Steam configuration or game files were used or changed. Portable NVDA used --no-sr-flag and --disable-addons. No system installation or security-policy changes.
- NVDA and temporary host were stopped after the test. The user's existing execs process was untouched.

## Exercised acceptance

1. Filtered library to Quack; Tab moved through Source and Sort to the kill assignment. NVDA spoke `Assign Quack (Community pack) as kill sound`, `toggle button`, `not pressed`.
2. Pressed Enter. Fixture kill slot changed to Quack. NVDA announced `unavailable`, `pressed`, followed by `Sounds saved`.
3. Filtered to Banana; Tab navigation separately announced `Assign Banana (Community pack) as hit sound` and `Assign Banana (Community pack) as kill sound`, both as toggle buttons, not pressed. Names distinguish clip, source, and destination slot.
4. NVDA browse-mode previous-button navigation announced library `Play Banana (Community pack)` and installed `Play Quack (kill sound, Community pack)` / `Play Quack (hit sound, Community pack · installed)`.
5. Actual generated speech is recorded in [windows-speech.txt](windows-speech.txt) and visible in [windows-nvda.png](windows-nvda.png). This evidence comes from NVDA speech output, not just the browser DOM/accessibility tree.

## Scope limits

Fixture previews correctly remain unavailable (`Needs the desktop app.`). This test validates their native WebView2/NVDA names, not audio playback or playing/stop announcements. It does not validate Tauri IPC, real sound files, or a full screen-reader usability journey; those are outside this label-regression acceptance. Existing functional tests cover source/slot identities and installed-audio lifecycle.

Raw NVDA logs and raw accessibility captures can include incidental desktop names and must stay local. Only this report, [windows-speech.txt](windows-speech.txt) and the scoped Speech Viewer screenshot are suitable for the public release evidence.

## Sources

- https://www.nvaccess.org/download/
- https://download.nvaccess.org/documentation/en/userGuide.html
- https://raw.githubusercontent.com/nvaccess/nvda/release-2026.2/source/config/configSpec.py
