# Changelog

User-facing changes only. The release workflow publishes the matching
`## [X.Y.Z]` section as the GitHub release body. Process: `docs/RELEASE.md`.

## [Unreleased]

### Fixed

- Mods and Viewmodels: sticky Apply bar no longer covers the last lines
  of the pane.
- Comfig: preset tiles stretch to the same height in each grid row.
- Profiles: a switch no longer deletes packs from the profile you are
  leaving, and no longer forgets which packs you chose to keep. A switch
  that failed part-way finishes cleanly when you re-apply a profile.
- Profiles: a second HUD on a profile stays enabled after the game quits
  instead of both HUDs ending up disabled.
- Profiles: every file the app writes is written atomically, so a crash
  or antivirus scan mid-write can no longer leave a truncated profile
  library, settings, config.cfg, or HUD file.
- Profiles: files with the read-only attribute no longer stop a switch.
- Mods: GameBanana mods uploaded as a single .vpk now install.
- Mods: casual preload snapshots survive a damaged state file, and
  Restore stock files never deletes them.
- Sounds: hit sounds saved in the extensible WAV format play in game;
  files with loop or cue markers no longer repeat; a WAV with a bogus
  sample rate is refused instead of crashing the app.
- Crosshair: one unreadable weapon script no longer blocks every
  crosshair.
- HUD: a HUD folder whose name differs in case from its catalog id works
  with Apply options and updates cleanly; Refresh repairs a partially
  loaded catalog; "Check for updates" times out instead of hanging.
- HUD and Mods: a malformed info.vdf or archive can no longer crash the
  app.
- Downloads and imports are checked against size limits before they are
  read, and the write lock is checked before a download starts.
- Only one copy of the app runs at a time; a second launch focuses the
  open window.

### Changed

- Disclosure sections remember open/closed state per profile.

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
