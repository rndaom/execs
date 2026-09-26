# Changelog

User-facing changes only. The release workflow publishes the matching
`## [X.Y.Z]` section as the GitHub release body. Process: `docs/RELEASE.md`.

## [Unreleased]

### Improved

- The Sounds library now chooses for one slot at a time. Browse from the hit or kill sound, then
  preview and use a sound from a simpler list.
- Viewmodels can show all, hide all, or hide everything except melee across every class at once.
  You see exactly what changes first, can undo it, and nothing is written until you build.
- Viewmodels is now the one place for viewmodel FOV, Draw viewmodel, Min viewmodels,
  left-handed and transparent viewmodels, above the per-weapon choices. Gameplay links there.
- Gameplay has Medigun auto-heal, damage numbers, combined damage numbers and healing numbers,
  grouped with auto reload and fast switch under Weapons and Combat feedback. Your current values
  are kept, and changes made in TF2's own options are picked up after the game closes.
- Gameplay has mouse sensitivity and zoomed sensitivity fields that keep exact decimals. A value
  changed in TF2's own options is picked up after the game closes instead of being reset.
- Return to TF2's stock HUD from the HUD pane. The HUD and its options leave the profile; its
  folder is kept in a backup, and your other mods and settings stay the same.
- Duplicate any saved profile from its menu to experiment on a copy. The copy is not switched in
  and TF2 is not touched.
- Rename a profile from its menu in the profile list. Only the name changes; its files and
  settings stay exactly as they were.
- Binds has a cleaner layout: every action on one page grouped by task, a search that also finds
  actions by the key bound to them, and readable key caps such as Mouse 4 and Num 1. New actions
  cover common voice commands (Thanks, Help, Incoming, Spy, Sentry ahead, Activate charge,
  Battle cry) and Screenshot.
- The GameBanana file chooser shows when each author file was uploaded and picks the only
  installable file for you. Split downloads (PART 1, PART 2…) are explained instead of installed
  half-finished, and a file GameBanana no longer has says so plainly.
- Switching to or from a profile with Casual setup choices is about twice as fast. Its particle
  patches and preloader pack are prepared once, before any files change, instead of being
  rebuilt during the switch.
- Launch TF2: flag a profile whose launch options are not in Steam yet, and write them before
  launching. When Steam is open, execs asks before restarting it to apply them.
- Launch options say whether they are only saved to the profile or also in Steam, based on
  Steam's saved copy rather than the last save. Write to Steam retries from the Launch pane, and
  copying the options never counts as updating Steam.
- Files keeps saved password and remote-console cfg commands through local saves, imports and
  exports. Export review names possible credential locations, lists the included custom packs,
  and flags Crosshair scripts and Viewmodels VPKs before creating a ZIP, without displaying
  credential values. The review expires if the profile changes. Help now focuses on searchable command details; production hides
  offline catalog gaps, and startup warnings link to the affected cfg line.
- Launch offers 21 documented TF2-relevant options through search and eight-item pages while
  retaining direct editing of the full launch string.
- Gameplay's viewmodel FOV slider now selects whole numbers while preserving existing fractional
  cfg values until the slider is changed.
- Binds and Gameplay save changes quietly in the background. A short notice still explains when
  TF2 keeps a draft pending, and a failed save remains visible for retry.
- Refresh every pane with the overhaul: subtly warmed dark surfaces, TF2 orange selection, clearer type,
  less redundant copy, compact navigation, consistent dialogs and restrained motion. Profile menus,
  pane navigation and Binds categories now ease into place. Each pane
  keeps a layout suited to its task, and the app follows system reduced motion or your own Reduce
  preference.
- Comfig and the setup wizard now offer mastercomfig's current presets without an expanded list of
  retired choices. Existing profiles still show a legacy preset until you choose a current one.
- Keep separate scroll positions for visited panes and App settings. Profile changes reset
  profile-specific positions.
- Enlarge or reduce the interface with Ctrl + Plus / Minus, and restore its original size with
  Ctrl + 0. The layout reflows while keeping keyboard access to controls.
- Crosshair: keep the designer beside its preview, retain unfinished designs, and distinguish
  saving a design to the library from building the installed pack. Weapon pickers stay in view.
- Crosshair Shapes can start an editable design, and a separate sprite detail view keeps thin
  segments visible while the in-game size reference stays at 1280×720.
- HUD: sort by sourced TF2 HUDs listing activity and popularity, show uncredited creators without
  inventing names, and refresh older catalog and statistics caches for accurate metadata.
- Viewmodels: import, replace or remove a compatible VPK, with saved packs from earlier builds
  still available through profile switching and export/import.
- Viewmodels: choose Shown, Hidden or Hands only for each weapon, organized by class into
  Primary, Secondary, Melee and Inspect with readable weapon names from your TF2 files. Inspect
  animations have their own choices, and bread reskins such as Mutated Milk share their base
  weapon's choice. Build pack creates the viewmodel pack from your own TF2 files, and profile
  exports carry the recipe so the recipient's copy is rebuilt from their install. execs reads
  these weapons in the background when it opens, so the pane is ready without waiting.
- Show a turning cog wherever execs is loading, checking or saving. It stays still when reduced
  motion is on.
- Keep the full-window header and library status when no profile is active yet, instead of an
  inset card.
- Sounds: keep hit and kill slots together above the searchable, paged library, with advanced
  controls and clearer source retry feedback.
- Files: keep Find controls, new-file choices and full destination paths readable at the minimum
  window size.
- Reduce background lifecycle polling while execs is hidden or unfocused, refresh on return,
  and back off failed reads while keeping launch and maintenance state guarded.

### Changed

- Temporarily pause Viewmodels Build and generated previews while replacing the CompVMInstaller
  dependency with a builder based on the player's installed TF2 files. Existing profile-owned VPKs
  and choices remain intact; equivalent class/group and Full/Weapon controls are required before
  0.2.0 ships.
- Retire new Venom Crosshairs, TF2Hitsounds and comfig hosted-sound catalog downloads. Existing
  profile-owned VTFs and WAVs remain usable; a saved remote WAV needs a new source to change its
  baked boost.
- Retire new cueki mod-library downloads and selections. Four direct-author Casual addons remain
  available. Saved library choices can still apply with their original verified cache; if the cache
  is missing, an explicit review can remove only those choices from an inactive profile before
  switching. Cancel preserves them.
- Replace packaged preset and promotional game captures with text and browser preview media.

### Added

- Delete profiles from their menu with an explicit review. Active profiles can switch first or
  keep the installed setup and stop tracking it; deleting the last profile keeps TF2 files intact.
- App settings for startup update checks, reduced motion, install location, data location,
  diagnostics and support, available before creating a profile.
- Gameplay controls for automatic reload and fast weapon switching, preserving existing
  alternative fast-switch values until you choose to change them.
- Binds: include primary attack, secondary attack and reload in a dedicated Combat group.

### Fixed

- Profiles now stop a switch that would carry over a kept external pack or replace its bytes,
  and offer to capture the pack first. After deleting an active profile while keeping its
  installed setup, Save current as… captures that setup before switching elsewhere.
- Accepted external custom packs appear under Mods → Custom packs with a removable record that
  survives profile switches and export/import. Externally changed crosshair, viewmodel and
  sound files show a source warning until repaired or replaced.
- Creating a profile from Current setup includes recent live `config.cfg` edits. Imported
  profile feature records must have the matching verified crosshair, viewmodel or sound files.
- Binds preserves unrelated lines in its managed cfg and shows every key assigned to an
  action. Binds, Gameplay, Crosshair and Sounds identify saved class and Launch overrides.
- Crosshair retains unrecognized external selections, refuses incomplete weapon-script
  builds and conflicting mod scripts, and warns when Valve source scripts change.
  HUD overlays, custom stock art and competing hitsound paths are identified as possible
  in-game sources.
- Sounds applies settings and sound files together so a failed install keeps the prior
  values. Viewmodel VPK imports reject unrelated content before installing anything.
- HUD options distinguish overlays from stock crosshairs, show unsupported controls as
  unavailable, and refresh showcase pictures. Supported e.v.e Plus options are enabled.
- Mods Browse includes GameBanana GUI results and asks which author file to install when
  a download has variants. HUD results route to HUD import, and other GUIs explain how
  to import the author's intended files.
- Sounds: keep the 0/6/12 dB Boost controls visible and explain that stock effects need a custom
  sound before they can be boosted.
- Files no longer warns about dormant quit, disconnect or retry aliases as though they run at
  startup, or treats a dormant self-reloading alias as an active exec cycle. Uneven quotes remain
  advisory, and startup diagnostics suggest a known command for a close spelling mistake.
- Files separates actionable findings from offline command catalog gaps, expands searchable command
  help, and points startup-setting failures to the first cfg path and line. UTF-8 BOMs and malformed
  individual binds no longer create unrelated findings or hide later known settings.
- Refresh packaged credits and dependency licenses to match the current application.
- Bind native download connections and proxy tunnels to checked public addresses while
  preserving HTTPS certificate checks and configured proxy access. Debian packages now
  declare the OpenSSL and zlib libraries required by the transport.
- Offer a clear Choose profile action when saved profiles exist but none is active.
  Import review now describes the unchanged TF2 setup without assuming an active profile.
- Keep profile actions visible in inactive libraries and enlarged interfaces, with scrolling
  for short windows and longer profile lists.
- Keep menus, pending-review actions and keyboard focus reachable when the interface is enlarged.
- Files: restore the editor's scroll and focus when returning from another pane, alongside its
  draft, selection and undo history.
- Keep complete cfg paths readable in the unsaved-changes dialog without horizontal scrolling.
- Pending-change review moves keyboard focus to the selected pane; close requests also wait
  for settings writes that start before the busy indicator renders.
- App settings errors identify the failed settings read without blaming the profile library;
  Retry preserves the requested preference and existing installation choice.
- Clear an obsolete update offer after a successful newer check reports no update, and prevent
  out-of-order checks or repeated install clicks from changing the intended update.
- Show an actionable native error when startup recovery checks fail, including the app version,
  state location and copyable report details, while preserving maintenance markers and TF2 files.
- Protect unfinished pack/designer drafts during profile, install, update and close transitions;
  direct you to the pane that needs an explicit apply action, with discard and cancel available.
- Review competing HUDs before activation, preserve excluded originals, and require a visible
  choice for profile ZIPs containing several HUDs. Generic mod imports route detected HUD content
  to HUD review instead of installing a second active HUD.
- Preserve imported cfg bytes during HUD choice; managed HUD-option cleanup receives a separate
  review with original files retained for recovery.
- Switch local-only particle profiles without downloading the default mod library, and keep
  legacy preloader cleanup from undoing profile-owned selections.
- Keep Casual preload console history, remove an invalid post-disconnect script call, and avoid
  duplicate managed launch hooks. The supported offline preload step remains explicit.
- Correct installer, platform and Casual compatibility descriptions in the README and promo.
- Profiles: retain saved particle selections when repairing custom folder names,
  including profiles that are not active.
- Profiles: switch shared preloader selections with the target profile.

## [0.1.8] - 2026-09-20

### Added

- Mods: open on GameBanana browsing and organize Browse, Installed and Casual setup as separate
  tasks. Results expose clearer source details, honest paging, refresh and retry controls, and one
  import flow for archives, VPKs or extracted folders.

### Fixed

- Mods: preserve GameBanana's global search and ranking order, distinguish added and updated dates,
  report unavailable metrics without inventing zeroes, and recover from hidden or failed category
  loads without stale results taking over the current request.
- Mods: refuse direct or absorbed removal of an active profile's selected particle-source mod until
  its selection is changed, without modifying the profile, preload state, snapshots or VPK directory.
- Releases: compare profile compatibility against the actual public 0.1.7 Hotfix 2 core instead of
  the older 0.1.6 baseline.

## [0.1.7+2] - 2026-09-20

0.1.7 Hotfix 2. Installs through the normal updater and keeps the displayed
product version at 0.1.7. Existing profiles and exports remain supported.

### Fixed

- Files: replace the stacked disclosure page with a quiet editor workspace: a persistent file list,
  one stable editor, one Save action, and Problems, Help and file details available on demand. File
  paths stay out of the way, and New cfg now asks only when the file should run before showing
  class or helper choices. Problems use compact issue rows, while Help keeps one command summary
  above a stable Details, Guides and Snippets switcher. Find now uses the app's visual language and
  closes from the same button, editor focus no longer draws a stray divider, and secondary file and
  editor actions live in right-click menus instead of a separate File info panel.
- Files: add Save as new cfg for editable and provided read-only files, with Ctrl+Shift+S and safe
  destinations inside the active TF2 cfg layer. New helper cfgs now separate file name from location,
  show the resolved path, and identify existing files before opening them. File rows disambiguate
  duplicate names, support arrow-key navigation, and Find uses rounded neutral match highlights.

## [0.1.7] - 2026-09-20

### Added

- Files: Focus returns to the current editor selection, and completion keeps spoken
  source details concise while preserving full provenance in Reference.
- Files: create unsaved user cfgs in the verified profile layer, retain multiple
  drafts while navigating or playing, and review changed sources before an explicit
  save. Problems navigate to exact source locations and analysis runs in a bounded worker.
- Files: add a syntax-colored editor with per-file undo history, find/replace,
  line navigation and offline TF2 completion that preserves normal Tab navigation.
- Files: add offline command help, searchable cfg guides and reviewable draft snippets;
  explain source links and classify ownership by complete paths and recorded HUD identity.

### Fixed

- Profiles: accepting external mod removal clears its installed record so exports
  import successfully again; partial pack changes refresh file and byte counts.
  Accepted HUD removal also clears its installed record. Keep and Restore preserve
  the saved customization.
- Files: show incoming cfg references at their caller and identify deferred bind/alias
  payloads; opening a reference keeps the current drafts intact.
- Files: keep provided read-only sources reachable by keyboard for selection,
  search and reference without allowing edits or saves.
- Files: recognize TF2 voice commands, button actions and sourced comfig aliases offline;
  explain numeric mistakes, exact finding locations and incomplete analysis without
  treating routine personal mouse settings or menu-restoring binds as hostile configs.
- Files: refuse stale saves after profile, install, loader or source changes, and
  create new user cfg files through the existing recoverable profile transaction.

## [0.1.6] - 2026-09-18

### Fixed

- HUD: correct the pinned rayshud Streamer Mode instruction so both scoreboard
  player lists hide and restore together.
- HUD: allow rayshud's Alternate Player Model option to use its direct resource
  edits without requiring a nonexistent legacy customization file.
- HUDs: skip backup files and regenerable caches consistently when importing
  ZIPs, 7z archives or folders, fixing kinhud and m0re Rockz installs.
- HUDs: install packs with deeply nested filenames on Windows without requiring
  the system's long-path setting, including HypnotizeHUD.
- Profiles: import creator cfg/custom ZIPs instead of rejecting entries such as
  cfg/user.scr. Review included files and cfg findings before importing; unsupported
  files are left in the source ZIP and the current profile stays active.
- Profiles: preserve TF2 Advanced Options customizations in cfg/user.scr through
  import, Save current, in-game changes, switching and export.
- Sounds: audition the current profile's installed bytes after switching profiles,
  replacing, boosting or reinstalling a sound; stop obsolete playback.
- Sounds: match assigned comfig sounds by source hash, so different sounds with
  the same name remain selectable.
- Sounds: identify clips, sources and hit/kill slots in accessible control names.
- HUD: preserve legacy resource bytes, comments and formatting when saving
  options, and edit included resources inside their logical panel header.
- HUD: apply and reverse folder-based choices, evaluate cross-control font
  expressions, and switch HypnotizeHUD checkbox includes without losing other
  resources. Invalid or incompatible instructions leave all options unchanged.
- HUD: preserve rayshud options despite duplicate upstream control names, and
  separate kbnhud's two low-ammo blink colors while retaining older saved values.
- HUD: restore HypnotizeHUD options and keep kbnhud crosshair and hitmarker sizes
  independent. Identify unavailable m0rehud Classic and log-based controls
  instead of reporting ineffective saves.

## [0.1.5] - 2026-09-14

### Fixed

- Updates: stop stalled installer downloads, release the update lock and allow
  retrying without restarting execs.
- Crosshair: keep imported PNG and design bytes available when Build pack fails
  or is refused, so retrying builds the complete draft.
- Sounds: preserve newer volume, pitch, boost and sound selections while an
  earlier boost save finishes.
- Comfig: show saved preset, module and addon selections after a failed change,
  with the failed choice available to retry.
- Imports: cancelling HUD, mod, viewmodel or comfig-custom pickers no longer
  reports a successful import or displays Saving while choosing files.
- Save feedback: identify the originating pane after navigation, keep each
  operation's failure until it succeeds or is dismissed, and give every save
  completion its full display time.
- Draft feedback: remove obsolete waiting notices when edits are reverted,
  discarded or saved, and keep other panes' pending drafts visible.
- Draft feedback: show the waiting notice again after reverting and re-editing
  settings while TF2 remains open, including after switching panes.
- Errors: keep export failures visible through background settings reloads,
  with a consistent dismissal control that preserves draft and recovery guards.
- HUD: save FlawHUD options with animation comment toggles and literal-backslash
  labels, apply checkbox choices inside the correct resource header, and retain
  each file's encoding and platform-specific values.
- HUD: identify the option and relative file when an option save fails, while
  keeping malformed or unsupported edits out of the profile and live HUD.
- Settings: preserve startup values when other cfg files or uninvoked binds and
  aliases change the same controls; reflect executed bind removals correctly.
- Files: bound repeated cfg and payload execution to keep analysis responsive,
  and prevent incomplete startup results from being saved as settings.
- Gameplay: retain viewmodel FOV values from 0.1 to 179.9, including decimals,
  when another control changes.
- Settings: await pending and in-flight autosaves before closing execs, and keep
  locked or failed drafts until you retry, cancel closing, or explicitly discard them.
- Launch: explain which pending settings prevent TF2 from starting, with actions
  to review the drafts, return to their pane, retry saving, or discard them.
- Preview: keep settings available with correctly rooted managed cfg paths.
- Profiles: preserve distinct dashed and undashed custom packs during capture,
  absorb, export and removal, including independent Keep and Restore choices.
- Settings: detect the executable mastercomfig loader before using overrides;
  standalone addons and leftover overrides use vanilla cfgs, and snapshots
  retain safe nested user cfgs in either setup.
- HUD: keep the installed HUD and available local options accessible offline,
  clear obsolete option schemas, and preserve unsaved options when retrying.
- HUD: report failed and partial catalog or statistics refreshes while keeping
  available cached entries and values visible.
- Profiles: prevent imported mods and HUDs from using folder names that stop TF2
  from starting, and offer a reviewed repair for affected saved profiles.
- Profiles: refuse exports containing saved credentials inside VPK cfg files,
  preserving the existing export when validation fails.
- Profiles: retain cfg files inside nested folders named `user`, `app`, or
  `overrides` when saving, exporting and switching setups.
- Settings: follow mounted custom cfg precedence and block saves when a pack
  overrides the managed startup files or preserved HUD copies make the active
  cfg sources uncertain.

## [0.1.4] - 2026-09-09

### Added

- Crosshair: choose In-game or Custom mode, with saved custom packs and weapon
  assignments retained when switching back to in-game crosshairs.
- Crosshair: adjust custom display size, choose colors with a themed picker and
  precise hex entry, and preview the result against a game scene at a labeled
  reference resolution.
- Crosshair: browse Built-in, My designs, Community and Import PNG separately;
  save named designs, search the library, and use chevron, diamond, ring-cross,
  split-cross and adjustable-arm designs.

### Fixed

- Linux: prevent AppImage startup crashes and blank windows caused by bundled
  Wayland libraries conflicting with newer graphics drivers.

- Crosshair: restore saved previews when discarding designs, keep preview caches
  scoped to each profile, and give dot designs a working radius control.
- Crosshair: preserve the preview sprite's aspect ratio in the scene layout.
- Crosshair: label Weapon default correctly, recover sprite previews after
  interrupted loading, and preserve unbuilt designs through color and size saves.
- Crosshair: build custom packs explicitly, retain imported assets and remove
  deleted library entries reliably when rebuilding.
- Settings: remove the flickering pending-save banner while preserving autosave
  feedback and the guards that protect profile changes and game launch.

## [0.1.3+1] - 2026-09-07

0.1.3 Hotfix 1. Installs through the normal updater and keeps the displayed
product version at 0.1.3. Existing profiles and exports remain supported.

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
