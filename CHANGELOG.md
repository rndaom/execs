# Changelog

User-facing changes only. The release workflow publishes the matching
`## [X.Y.Z]` section as the GitHub release body. Process: `docs/RELEASE.md`.

## [Unreleased]

### Fixed

- HUD: keep replaced and legacy disabled HUDs out of TF2's active search paths,
  preserve their files as backups, and stop reporting those backups as external
  profile changes.
- Mods: stop carrying another profile's particle-mod selections and patches
  through profile switches, and recover stale source references.
- Crosshair and settings: stop reloads from moving clean sliders back and
  triggering repeated autosaves; keep newer edits during an in-flight save.
- Files: keep the save-drafts dialog visible and clickable, and let an active
  operation finish without asking to save nonexistent Files drafts.
- Profiles: check external changes once per game session or profile switch,
  and stop offering an old profile's pack choices on the new profile.
- Application: deliver these fixes as 0.1.3 Hotfix 1 through the existing
  in-app updater, keeping the displayed product version at 0.1.3.

## [0.1.3] - 2026-09-07

### Added

- Application: show a themed, dismissible release-notes sheet after an update,
  with a link to the matching GitHub release.

### Fixed

- Mods: install GameBanana downloads served through its numbered file-cache
  hosts, and refuse archives with ambiguous VPK or loose-folder choices instead
  of installing every variant or silently dropping alternatives.
- HUD: allow imported HUD cfg files that set the normal, server-controlled
  `sv_cheats` cvar.
- HUD and Files: allow top-level `unbindall` bind-reset configs while continuing
  to flag the command when hidden inside a bind or alias payload.
- Binds: record right and middle mouse buttons with the correct TF2 names,
  preserve bind drafts while TF2 is running, and honor tracked binds removed
  through the in-game settings after TF2 closes.
- Profiles: stop absorb restore and repair work before another live-file change
  if TF2 starts during the operation.
- HUD: keep options editable after matching an imported HUD whose folder name
  differs from its catalog identity.
- Profiles: exported profiles with small, highly compressible assets import
  again without weakening archive size and expansion limits.

## [0.1.2] - 2026-09-06

A maintenance update focused on protecting unsaved edits and fixing HUD
installation and browsing. Existing 0.1.1 profiles and exports remain supported.

### Fixed

- Files: protect unsaved drafts when closing execs, switching profiles or installs,
  creating a profile, and installing updates. Save must finish successfully before
  continuing; Cancel keeps every draft.
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
