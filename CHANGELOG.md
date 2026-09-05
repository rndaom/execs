# Changelog

User-facing changes only. The release workflow publishes the matching
`## [X.Y.Z]` section as the GitHub release body. Process: `docs/RELEASE.md`.

## [Unreleased]

## [0.1.2] - 2026-09-05

### Fixed

- Settings: pause edits during profile switches until the target settings load.

- Settings: keep deferred and in-flight drafts when navigating, retry refused
  saves after TF2 closes, and preserve newer edits when earlier saves finish.
- Files: retain unsaved text per profile and file; Save and switch waits for
  success and keeps edits visible if saving fails.
- Settings: refuse incomplete or mixed-profile cfg loads, and merge Gameplay,
  Crosshair and Sounds changes without overwriting each other's settings.
- Binds and Gameplay: update managed cfg and autoexec entries together while
  preserving the latest unrelated commands.
- Application: keep writes disabled after a TF2 lock subscription failure,
  even if an older status response arrives later.
- HUD: discard obsolete or ambiguous cached statistics instead of ranking
  unrelated download counts.

- HUD: accept small, highly compressible assets such as budhud textures while
  retaining file, archive and large-expansion limits.
- HUD: follow Dropbox download redirects, find uniquely nested HUD imports,
  and validate UI version 3 metadata before replacing the installed HUD.
- HUD: rank verified statistics, explain missing data, and show six previews
  per page with numbered navigation and a single Import HUD entry.

## [0.1.1] - 2026-09-05

A maintenance update focused on keeping profiles intact and recovering safely
when a file operation is interrupted. Existing 0.1.0 profiles and exports remain
supported.

### Fixed

- Profiles: preserve saved files when a live file is temporarily unreadable or
  only its capitalization changes. Switching no longer loses removed packs,
  forgets kept packs, or leaves files from the previous profile behind.
- Profiles: recover interrupted switches and file changes, keep Steam Cloud
  config updates pending until they succeed, and handle read-only files safely.
- HUD: preserve secondary HUDs, accept folder names with different capitalization,
  repair partial catalogs, and time out stalled update checks.
- Mods: install standalone GameBanana VPKs and exclude unsupported categories
  from browse, search, and direct installation.
- Casual preload: preserve stock snapshots through damaged state files and
  interrupted changes, and retain them after restoring stock files.
- Sounds: support extensible WAV files, remove unwanted loop/cue markers,
  and reject invalid sample rates without crashing.
- Crosshair: an unreadable weapon script no longer blocks all crosshairs.
- Viewmodels: building a pack no longer opens a console window for every class
  on Windows.
- Interface: keep content clear of sticky Apply bars, align Comfig preset tiles,
  remember disclosure state per profile, and show update-check results in the footer.
- Application: a second launch focuses the existing window instead of opening
  another instance that could interfere with profile writes.

### Changed

- Existing profiles load without manual migration. Compatible recovery metadata
  records unfinished profile, launch-option, and Cloud updates so they can retry.
- Installers include full third-party license notices alongside the application.

### Security

- Serialize profile writes, game launch, Steam file verification, and app-update
  installation so these operations cannot overlap through the app.
- Validate download sizes, archive paths, cfgs, VPKs, audio, particles, and imported
  folders before replacing installed content; malformed inputs fail safely.
- Contain filesystem writes and recover interrupted profile and preloader
  transactions without trusting redirected paths or partial state.

## [0.1.0] - 2026-09-03

First public release.

### Added

- Profiles for the whole TF2 setup. Switch is exact replace, never while
  the game is running. In-game changes absorb back when it quits.
- Comfig: mastercomfig presets, modules, and official addons.
- Binds: click an action, press a key.
- Gameplay: FOV, viewmodels, tracers, flip.
- HUD: hud-db catalog, one-click install, options, or import your own.
- Crosshair: stock preview, Venom pack, or a per-weapon design.
- Viewmodels: hide weapon groups per class.
- Sounds: hit and kill sounds from a library, or your own WAV.
- Mods: your packs, GameBanana browse, casual preload with restore.
- Files: cfg editor with a linter that knows the engine.
- Launch options on the profile.
- In-app updates from GitHub Releases. No telemetry.
