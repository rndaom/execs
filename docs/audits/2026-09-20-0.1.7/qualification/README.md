# Files native qualification — RND-323

Status: preparation; no 0.1.7 native acceptance result yet. This record must not
be used to mark RND-323 or its parent Done until the integrated product passes.

The owner authorized implementation and private release readiness on September
19, 2026. Publication, tagging, real-game launches and real-profile writes are
outside this qualification. The original planning-only language in the Linear
issue describes its creation date, not this later authorization.

## Environment and reusable evidence

- Windows host: AMD Ryzen 7 9800X3D. Exact OS, WebView2, NVDA and candidate source
  versions will be captured with the run, rather than copied from 0.1.6.
- Existing portable NVDA and .NET 10/WebView2 harness from 0.1.6 are available
  locally. Use a new NVDA configuration and WebView2 user-data directory.
- WSL is not installed; no SSH host aliases were found. Native Linux needs the
  private GitHub Actions runner used for 0.1.6 (Ubuntu 22.04, WebKitGTK 4.1,
  Xvfb, AT-SPI, Orca, Speech Dispatcher). Do not install WSL as a workaround.
- Windows currently has only `en-US` / `0409:00000409` installed. No real
  Windows IME claim is possible from that keyboard; synthetic composition
  coverage remains distinct. Linux CI provisions ibus-anthy in its disposable
  desktop and checks physical roman-key input commits `日本語` through the IME.
- Prior passing harness source: commit
  `e2e9ef07727ec19aede558707c928c5faef827da`. Prior sound-label acceptance is not
  evidence that Files editor interaction works.

The .NET 10 Windows harness builds with zero errors and warnings. Its initial
local `Start-Process` launch was rejected by automatic policy review with only
`blocked by policy` as the reason. No launch retry or alternate local automation
was attempted. Windows native acceptance is consequently still pending.

The dedicated `qualify-files.yml` workflow has read-only repository permissions,
does not build a product release, does not publish or tag, and retains native
test artifacts. Its Windows job currently validates the host build only; its
Linux job attempts real WebKitGTK keyboard, Orca logging and Japanese IME.
The Windows CI job now attempts actual physical keyboard events, completion,
Tab exit, WebView2 screenshots and NVDA generated speech in the disposable runner.
It fails if editor-name speech is absent. No successful run is claimed yet.
Workflow configuration is preparation, not evidence of a passing run.

## Evidence boundaries

`scripts/qualification/files/windows` and `scripts/qualification/files/webkit.py`
host the real React frontend through its isolated preview adapter. They expose
no Tauri IPC and use fresh/ephemeral WebView data. Preview operations remain
in memory. Native engine, keyboard and actual generated screen-reader speech can
be measured here. Native save/close/Cloud guarantees require the core/IPC
regressions and isolated packaged application checks separately.

The hosts take explicit viewport dimensions and zoom. Record the measured CSS
viewport; host-window borders and OS display scaling must not be counted as
editor area. Navigation duration is host navigation only, not application-ready
startup or key-to-paint latency. Do not report it as such.

## Required run matrix

| Area | Required evidence |
| --- | --- |
| Native layout | Windows/WebView2 and Linux/WebKitGTK at 960×640, 1200×800, 1280×800 and 200% zoom; Save visible, usable line count, filename distinction, editor focus mode |
| Native keyboard | Novice create → reference → completion → diagnostic → save; experienced cross-file/alias/exec navigation and retained drafts; Tab exits without a completion, Escape dismisses completion, Ctrl+Space/Ctrl+S/Ctrl+F/Ctrl+H/Ctrl+G |
| Screen readers | Actual NVDA and Orca speech for editor name, line/document context, completion options, problem navigation, read-only state and save result; retain scoped speech excerpts |
| IME and display | Real composition without premature completion/save; non-ASCII round trip; reduced motion; contrast ratios and non-color problem cues |
| Performance | Named CPU/OS/engine; bundle bytes, ready-startup, peak process-tree memory, p95 input-to-next-paint, completion and analysis duration; 10k-line, 1MiB, 8MiB and 256-file cases |
| Package | Production worker and local reference under actual Tauri CSP; offline operation; no remote executable code or weakened CSP; separate Windows/Linux installers and updater smoke |
| Integrity | Focused native tests for profile/root/source mismatch, save edits, managed/absorb changes, game lock, creation collisions, interrupted transaction and Cloud failure; prior-public export/import hashes |

Synthetic composition events can test handler behavior but cannot establish
operating-system IME acceptance. DOM accessible names and screenshots cannot
establish screen-reader speech. Fixture save success cannot establish disk or
Cloud persistence. A preview worker cannot establish packaged CSP acceptance.

The dedicated Vite qualification configuration builds with production transforms
and the ordinary application modules, replacing only the entry adapter with the
in-memory fixture. A loopback static server sends the exact product CSP from
`tauri.conf.json` as a response header. This checks the bundled worker and editor
in each native engine under that policy, without weakening the policy or shipping
preview code in the product. It remains a fixture with equivalent CSP, not an
actual packaged Tauri origin/IPC test. Product package smoke remains separate.

## Source references

- [RND-323 acceptance](https://linear.app/rndaom/issue/RND-323/qualify-the-rebuilt-files-workflow-on-windows-and-linux-before-017)
- [Files audit and plan](https://linear.app/rndaom/document/files-workspace-deep-audit-research-and-017-rework-plan-73e3e612b655)
- [Prior Windows speech qualification](../../2026-09-18-0.1.6/native-a11y/windows.md)
- [Prior Linux speech qualification](../../2026-09-18-0.1.6/native-a11y/linux.md)
- [Orca debugging](https://orca.gnome.org/debugging): logs include generated speech and accessibility events.
- [NVDA User Guide](https://download.nvaccess.org/documentation/en/userGuide.html): speech viewer and application keyboard interaction.
- [Tauri CSP](https://v2.tauri.app/security/csp/): packaged resource restrictions require direct verification.

These documentation pages were read on September 20, 2026 UTC. The CodeMirror
Tab documentation fetch timed out; no fetched content from that attempt is
claimed as evidence.
