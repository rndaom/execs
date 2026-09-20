# 0.1.7 Hotfix 2 release

Published [0.1.7 Hotfix 2](https://github.com/rndaom/execs/releases/tag/v0.1.7%2B2)
on September 20, 2026 at 19:44:49 UTC after the owner's explicit hotfix request.
The ordinary product UI continues to display 0.1.7; diagnostics, updater identity
and release notes retain the complete `0.1.7+2` revision.

## Identity and publication

- PR [#56](https://github.com/rndaom/execs/pull/56) merged the Files usability
  rebuild into `rndaom/release-0.1`.
- PR [#57](https://github.com/rndaom/execs/pull/57) fixed the release-only
  WebView2 packaged-worker URL probe without changing the approved product work.
- Immutable `v0.1.7+2` points to merge
  `15086ea569178402d927bf4990828dc436c8ec40`.
- Tagged workflow
  [35531372830](https://github.com/rndaom/execs/actions/runs/35531372830)
  passed validation, signed Windows/Linux builds, updater discovery, installer
  upgrades from public 0.1.7, startup/notices/data-preservation checks, packaged
  analysis workers, combined asset/feed verification and publication.
- Anonymous GitHub endpoints report `v0.1.7+2` as the latest stable release.
  `latest.json` reports `0.1.7+2` for Linux AppImage/deb and Windows NSIS/updater
  keys, and `release-commit.json` binds the public assets to the commit and run
  above.

The private `v0.1.7+1` candidate twice upgraded and passed its no-repeat updater
check, then failed before verification when its WebView2 worker probe constructed
an asset URL from a page `location.href` that was not ready. It was never public,
never latest and never changed the public updater feed. Hotfix 2 resolves the
asset URL from the already-inspected Tauri debugger target and covers both
`http://tauri.localhost/` and `tauri://localhost/` origins.

## User-facing scope

- Replace the stacked Files settings page with a compact editor workspace that
  keeps the file list, selected cfg and Save action clear.
- Present Problems and Help as scannable integrated tools, polish Find and move
  secondary actions into keyboard-accessible file/editor context menus.
- Add collision-safe Save as new cfg for editable and provided files inside the
  active cfg layer, plus explicit helper filename/location selection and resolved
  destination feedback.
- Improve duplicate-name labels, arrow-key file navigation and rounded neutral
  search highlighting.

Existing profiles, exports, cfg ownership, draft/session behavior, analysis,
write-lock rules and safe write roots remain compatible and unchanged.

## Verification summary

- 160 cfglint tests, 676 desktop tests and 22 release/script tests passed locally;
  three platform-specific script cases remain intentionally skipped outside CI.
- Biome, TypeScript and the production Vite build passed. The existing large
  chunk warning is unchanged.
- Rust format and Clippy passed. The complete native workspace suite passed before
  TF2 was launched locally; later local write-lock fixtures correctly refused the
  running retail game. Both clean-host GitHub Windows/Linux matrices passed the
  full native, public-profile and pinned-HUD gates.
- The release workflow installed/upgraded the actual signed Windows and Linux
  packages from public 0.1.7, preserved app data, started packaged builds, verified
  notices and confirmed that 0.1.7+2 is not offered again after installation.
- The Files visual audit and before/after captures are in
  `docs/audits/2026-09-20-files-hotfix/`.

No real player files were mutated for qualification, and no retail-game launch
was performed as part of the release workflow.
