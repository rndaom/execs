# Changelog

User-facing changes only. The release workflow publishes the matching
`## [X.Y.Z]` section as the GitHub release body. Process: `docs/RELEASE.md`.

## [Unreleased]

### Added

- Maps from GameBanana install in one click, ready to play offline or on a server you host
  (console: `map` and the map's name). Bot navigation files and MvM missions that come with a map
  are put where TF2 looks for them, and archives with several maps let you pick.
- TF2's own crosshairs (including each weapon's default) can be used per weapon alongside custom
  ones.
- The crosshair designer adds rotation, smooth edges, square and triangle shapes, a gap that turns
  a square into corner brackets, a square centre dot, and share codes you can copy and paste.
- Import several PNG images and VTF crosshairs, each kept under its own name. Large PNGs are
  fitted into the 64 × 64 sprite on request.
- Quick colour swatches and a size reset in the Crosshair pane.

### Changed

- GUI mods from GameBanana, such as menus, icons, fonts and loading screens, install in one click
  like other mods. Only HUDs still go to the HUD pane.
- Error notices fade on their own after you have had time to read them (hover over one to keep it)
  and have a proper Dismiss button. A GameBanana mod that failed to install keeps the reason on its
  card.
- The Crosshair pane is rebuilt around one picture gallery: TF2's own crosshairs, execs shapes and
  your designs and imports sit together, with no In-game / Custom switch. TF2's own crosshairs
  apply as soon as you pick them; anything else, or a different crosshair for some weapons, shows
  one Build crosshair pack button. Switching back to a TF2 crosshair is one button too, and your
  custom crosshairs stay saved.
- The crosshair preview is true to size. It reads your TF2 resolution (or launch options, or one
  you set) and offers Actual size, which shows the crosshair at exactly the pixels it covers on
  your screen, Whole screen and a 4× pixel zoom, on dark, bright or split backgrounds. It also
  shows how TF2 resamples the crosshair at sizes other than 32. Earlier versions assumed
  1280 × 720, so the crosshair looked bigger in execs than in game at higher resolutions.
- Per-weapon crosshairs use class tabs, each class's weapons, and the chosen weapon's crosshairs as
  pictures beside them. No drop-down menus.
- execs' own shapes are now the ones players commonly use: dot, cross, gap cross, gap cross with a
  dot, circle, circle with a dot, X and an outlined cross. Each can be opened in the designer and
  adjusted. Profiles using an earlier execs shape keep it.

### Fixed

- RAR mods saved with WinRAR's default settings install instead of failing with "uses Quick Open
  header caching".
- Mods with large single-colour textures, such as crosshair packs, install instead of failing with
  "decompresses more than 200x". Profiles that contain them export and import again.
- ZIP files made with Windows' built-in compression for large files (Deflate64) and 7z files packed
  at 7-Zip's highest settings install.
- One leftover or unreadable VPK in a mod archive no longer fails the whole import: that option is
  greyed out with the reason and the others still install. Intro-video mods (`media` folder) are
  recognised.
- A GameBanana mod whose files sit inside extra folders installs under the mod's own name instead of
  a folder name such as "team fortress 2/tf".
- Crosshair weapon overrides for "PDA" on every class save again. The Red-Tape Recorder entry
  pointed at a weapon script TF2 does not have; it uses the Sapper's. The Flying Guillotine is now
  listed for Scout.
- 7z errors read as plain sentences instead of internal names such as `Other("...")`.
- After Build crosshair pack succeeded, the Crosshair pane could keep saying the changes were not
  in TF2 yet, however many times it was built.

## [0.2.1] - 2026-09-28

### Added

- Mod archives with several choices, such as colour variants or "with and without sounds",
  install from execs: a chooser lists each VPK and content folder with its size, shows the
  author's included instructions, and installs the packs you pick. Cancel changes nothing, and a
  mod with a single pack still installs in one click.
- Mods and HUDs install from RAR archives as well as ZIP and 7z, including solid archives, through
  Import mod, Import HUD, GameBanana and HUD download links. Encrypted and split archives explain
  how to import an extracted folder instead.
- Custom packs can be turned off and on without losing their files, copied to another profile,
  and checked for newer versions on GameBanana.
- Custom packs say what each pack can do on Valve's Casual servers, which packs share a file and
  which one TF2 uses, and when a model's parts come from different packs. No pack is described as
  working on Casual before a real match confirms it.
- Copy binds, Gameplay settings (including mouse sensitivity) or hit and kill sounds to your other
  profiles from the Binds, Gameplay and Sounds panes, with a list of which profiles would change.
- Binds can bind custom commands such as `say gg`, Engineer build and destroy, Spy disguises and
  the rest of the voice commands, with the same key-conflict review as other actions.
- Sounds accepts MP3 and Ogg Vorbis clips as well as WAV, up to 30 seconds, and notes when a clip
  is longer than a second.
- New profile has a Create button that adds the profile without switching TF2 to it.
- execs reopens at the same window size and position, and on the pane you last used.
- When TF2 closes after pack changes, you choose what happens to each new or missing pack, and the
  prompt names the profile and says how each choice affects switching.
- App settings → Storage lists older HUD backups, which you can recover to a folder or delete.
- Copy diagnostics includes a short Health summary and execs' most recent actions and errors, so
  a bug report shows what happened. The log keeps no file contents and hides passwords.
- After this update, execs tidies up once what earlier versions left behind: sound caches for
  packs that are gone, HUD backups in TF2's custom folder (duplicates are deleted, the rest move
  to execs data and stay in Storage), Valve's own cfgs saved into profiles, the old Casual preload
  hook, the cheat-only tracer line, bind keys with names TF2 rejects, and unused downloads from
  retired features. Packs, your own files and hand edits are not touched. One quiet notice says
  what changed, with Details, and Storage offers Tidy up again.

### Fixed

- Binds records `;` `'` `,` `.` `/` `\` `-` and `=` with the key names TF2 uses. Binds recorded on
  these keys by earlier versions never worked in game; they are now read as the intended key.
  Right Shift, Right Ctrl and Right Alt no longer rebind the left keys, and Pause, Scroll Lock,
  Num Lock, the Windows keys and the Menu key can be bound.
- Binds records Mouse 4 and Mouse 5 without the side buttons navigating the app, and explains
  mouse buttons TF2 cannot bind.
- Binds you record in execs are no longer replaced by older keys from TF2's `config.cfg`. After a
  game, only keys you rebound in TF2's own options follow `config.cfg`.
- Settings load again after TF2 closes for a profile where you never saved binds in execs. Every
  settings pane used to stop with "The Binds source identity is unavailable".
- Settings panes no longer stop with "Cannot derive startup settings" when TF2 writes a newer
  setting, such as `tf_armory_page_skip`, into `config.cfg`.
- Changes made in TF2's own Viewmodels, Sounds and Crosshair options survive the next launch when
  execs manages those settings.
- World FOV shows TF2's real 75–90 range. Older lower values stay as they are until you change
  that control.
- Gameplay no longer writes the cheat-only `r_drawtracers`, which TF2 refused and reported as an
  error on every launch. The "All tracers" switch is removed because TF2 never applied it;
  First-person tracers stays.
- Viewmodels and custom Crosshair choices that are not built yet show as unsaved changes, are kept
  when you change panes, and must be built or discarded before closing execs, switching profiles
  or launching TF2.
- Profiles no longer save or delete Valve's own cfgs, such as `server_casual.cfg`, including files
  older versions captured.
- Steam launch options you change in Steam are no longer overwritten. When Steam and the profile
  differ, execs asks whether to launch with Steam's options, adopt them into the profile, or
  replace them with the profile's.
- Linux launch wrappers such as `gamemoderun %command%`, `mangohud %command%`,
  `gamescope -- %command%` and `LD_PRELOAD="" %command%` are kept exactly as written. execs used
  to drop `%command%`, which broke the launch and could write the broken string into Steam.
- While Steam is open, the Launch pane offers "Check Steam again" instead of a "Write to Steam"
  button that could only fail.
- The Launch pane says when resolution, display-mode or console options stay in effect after you
  remove them or switch profiles, because TF2 saves them in its own settings.
- The write lock also recognises the 32-bit `tf.exe`. A launch that never starts can be released
  while Steam is open, and stops waiting on its own after ten minutes.
- After Steam moves TF2 to another drive or library, execs offers to move your profiles to the new
  folder instead of hiding them. Profile files and TF2 are left alone.
- If the saved TF2 folder is missing at startup, for example because its drive is not connected,
  execs names the folder and offers Retry instead of starting over as a first run.
- Switches, imports and large installs check free space first and stop before changing anything,
  naming the drive, the space needed and the space free. A full disk during another write says
  the drive is full instead of showing a system error.
- Download failures read as plain sentences with a next step, such as "GitHub is limiting requests
  from your network. Try again in about an hour."
- Mods over the 512 MB limit say how large they are and explain how to install them by hand.
- Inventory no longer re-reads your backpack every two minutes, which kept making Steam show you
  as playing TF2. It reads when you open it, after TF2 closes and when you press Refresh.
- Switching to a profile saved by an older version installs the current Casual preload hook, which
  keeps TF2's console and engine errors instead of clearing them. Edited hooks stay as you left
  them.
- Casual setup shows which particle files cannot work on Casual before you select a pack, and
  Apply refuses them before changing game files.
- Casual setup remembers that you turned on Material bypass and tells you when a TF2 update turns
  it off, with a way to turn it back on.
- Comfig no longer offers to install mastercomfig packages on a profile without mastercomfig,
  which would have stopped your own autoexec and class cfgs from running. Comfig shows the
  installed mastercomfig version and whether an update exists, and new addons come from the same
  release as the base package.
- Replacing a HUD no longer makes a second copy in TF2's folder when the profile already has
  every file.
- Removing a VPK pack also removes the sound cache TF2 made for it, and Crosshair and Viewmodels
  saves no longer fail on the `sound.cache` file TF2 writes into custom folders.
- Starting execs and closing TF2 are faster with large custom folders, and a folder too large to
  scan is named in the message.
- Dialogs opened from a pane cover the whole window, so tall ones such as the mod chooser are no
  longer cut off under the header.

## [0.2.0] - 2026-09-27

### Added

- Inventory: a TF2-style ten-by-five backpack with direct drag/drop, Ctrl/Shift selection, cross-page dragging, Undo/Redo and compact item inspection. Sorting by name, quality or type rearranges actual draft slots for reviewed Steam Apply, with protected items kept in place. Hold a dragged item or group over either page arrow to keep turning pages, then drop on the chosen page. Search, quality and sort sit in one toolbar row; dragging previews exactly where items land, and page turns, sorts and moves animate into place. With a public Steam inventory, items show TF2's own renders, so painted weapons, war paints and killstreak kits look as they do in game, and Inspect reads like TF2's item panel with Valve's description lines. Renamed items keep their original name in view and description tags show on hover and in Inspect. It supports reviewed Steam moves, metal crafting in batches (such as fifteen scrap into five reclaimed), random hat crafting from three refined metal with a reveal of the hat Steam picked, and single-item deletion, with native checks and recovery for unconfirmed outcomes. Protected favorites and saved layouts remain account-owned.
- A refreshed look across every pane: warm dark surfaces, TF2 orange for selections, clearer
  type, less repeated text, consistent dialogs and restrained motion. Loading shows a flat TF2
  emblem, and Viewmodels and Crosshair class tabs show TF2's class emblems read from your own game
  files. execs follows your system's reduced-motion setting, or your own Reduce preference in App
  settings.
- Opening execs no longer shows a blank window and screens popping in piece by piece. A startup
  screen with the spinning TF2 emblem says what execs is loading, waits until the first page is
  ready, then hands its wordmark to the header as the page arrives: header, sidebar, then each
  section in turn. Switching panes and profiles brings sections in the same way. On first run,
  confirming your TF2 install now shows "Install confirmed" and the filled setup steps for a moment
  before setup continues.
- A quiet dot field sits behind every page: the TF2 emblem in orange dots, anchored in the bottom
  right corner. It clears away around text and controls so nothing is read over dots, and the dots
  near your pointer shift aside and settle back as it moves.
- The orange execs dot now means "a change": it breathes while a change saves and pops when it is
  saved, and marks any pane whose changes are still waiting, such as Files edits you have not
  saved. The sidebar highlight, tab underlines and choice buttons glide to your selection, and
  folds open smoothly.
- The comfig.app hit and kill sound library is back in Sounds, with favorites, a source filter
  (All, Favorites, Built into TF2, comfig.app) and a Suggested sort that lists sounds made for the
  slot you are choosing first. comfig.app sounds can be boosted again.
- Sounds has a preview volume at the bottom of the page, in reach wherever you scroll, with mute
  and Stop. It starts at 50%, is remembered, and only changes previews in execs, not what TF2
  plays.
- Consistent controls: every dropdown, fold and HUD option list uses the same caret, more-actions
  buttons look alike, and Inventory items and profiles open their actions on right-click. Repeated
  and decorative notes were trimmed across Crosshair, Sounds, Viewmodels, App settings and first run.
- Calmer panes: Comfig leads with presets and addons and folds module fine-tuning away with a
  count of what you changed; notes about class cfgs and launch options that can change a pane's
  values fold below its controls.
- Saving shows as a quiet line in the header instead of a pop-up, and a failed save stays as a
  strip under the header until it is fixed or dismissed. The footer moved into App settings, and
  the profile menu uses the same rows as the rest of the app.
- App settings, available before you create a profile: startup update checks, motion, install
  and data locations, diagnostics, support and credits.
- App settings shows how much space execs uses for profiles, restore points, downloads, logs and
  recovery data. Clear downloads removes files execs can fetch again and leftovers from retired
  features; profiles, recovery data and sounds you added are always kept.
- App settings has a Health section: whether TF2 and the config loader were found, anything
  interrupted, saved profiles with missing files, the local Steam Cloud copy, and what works
  offline. It only reads; nothing is changed.
- Uninstall execs from App settings. Your TF2 setup stays as it is. Restore stock files undoes
  Casual setup's changes to TF2's own files, and deleting profiles and other execs data is a
  separate choice. Windows opens the uninstaller, an AppImage deletes itself, and a deb install
  shows the package manager command.
- Profiles: rename, duplicate or delete a profile from its menu. Rename changes only the name;
  a duplicate is not switched in; deleting reviews what happens first, and deleting the active
  or last profile can keep your installed setup.
- Profiles: Compare with current… shows what switching would change first: HUD, sounds, launch
  options, settings and binds, custom files, config files and Casual setup. Saved passwords are
  hidden, and nothing changes until you choose Switch.
- Profiles: restore points. Save a copy of a profile from its menu, compare the profile with it
  later, and restore it as a new profile to switch to when you are ready. execs keeps the newest
  3, 5 or 10 per profile on this computer, and restoring never changes TF2 until you switch.
- Gameplay, Viewmodels, Crosshair and Sounds show where each value comes from: the cfg file and
  line that set it, whether execs saved it, and which class cfgs set it again. A warning names any
  later startup line that would undo a change made in the pane, with a link to open it in Files.
- Gameplay: exact mouse and zoomed sensitivity, automatic reload, fast weapon switch, Medigun
  auto-heal, damage numbers, combined damage numbers and healing numbers. Your current values
  are kept, and changes made in TF2's own options are picked up after the game closes.
- Viewmodels: choose Shown, Hidden or Hands only for each weapon, organized by class into
  Primary, Secondary, Melee and Inspect with readable weapon names from your TF2 files. Show all,
  hide all or hide everything except melee across every class at once, with an exact review
  first. Build pack creates the pack from your own TF2 files, and profile exports carry the recipe
  so the recipient's copy is rebuilt from their install.
- Viewmodels is the one place for viewmodel FOV, Draw viewmodel, Min viewmodels, left-handed and
  transparent viewmodels. It can also import, replace or remove a compatible VPK.
- HUD: sort the catalog by TF2 HUDs listing activity and popularity. Creators without credit stay
  uncredited instead of getting invented names.
- HUD: Return to TF2's stock HUD. The HUD and its options leave the profile; its folder is kept in
  a backup, and your other mods and settings stay the same.
- HUD: while a HUD installs or updates, its card shows the current step (downloading, checking the files, saving it), and the header says "Installing HUD…" instead of "Saving…". The installed HUD's card now carries a clear Installed label.
- Crosshair: the designer sits beside its preview and keeps unfinished designs. Saving a design to
  the library is separate from building the installed pack, and Shapes can start an editable
  design with a detail view that keeps thin segments visible.
- Casual setup shows which particle mod wins each file two of your mods both change, before you
  apply, and lets you pick the other one. Skipped files explain what you can do.
- Launch: flag a profile whose launch options are not in Steam yet, and write them before Launch
  TF2. When Steam is open, execs asks before restarting it. The Launch pane says whether options
  are only saved to the profile or also in Steam, and offers 21 documented TF2 options through
  search while keeping the full launch string editable.
- Binds: remove any key, including one set in `config.cfg`, without an older binding coming back.
  Every action is on one page, grouped by task, with a search that also finds actions by their
  key and readable key caps such as Mouse 4 and Num 1. New actions cover primary attack,
  secondary attack, reload, common voice commands and Screenshot.
- Enlarge or reduce the interface with Ctrl + Plus / Minus, and restore it with Ctrl + 0.

### Fixed

- Binds, Gameplay, Crosshair and Sounds read your settings again when Comfig uses a preset other
  than the default, including Custom. The preset line mastercomfig reads first no longer stops
  them with "Cannot derive startup settings".
- Profiles stop a switch that would carry over a kept external pack or replace its bytes, and
  offer to capture the pack first. After deleting an active profile while keeping its installed
  setup, Save current as… captures that setup before switching elsewhere.
- Profiles switch shared preloader selections with the target profile, keep saved particle
  selections when repairing custom folder names, and switch local-only particle profiles without
  downloading the default mod library.
- Accepted external custom packs appear under Mods → Custom packs with a removable record that
  survives profile switches and export/import. Externally changed crosshair, viewmodel and sound
  files show a source warning until repaired or replaced.
- Creating a profile from Current setup includes recent live `config.cfg` edits. Imported profile
  records must have their matching verified crosshair, viewmodel or sound files.
- Review competing HUDs before activation, keep excluded originals, and require a visible choice
  for profile ZIPs with several HUDs. Generic mod imports send detected HUD content to HUD review
  instead of installing a second active HUD. Imported cfg bytes stay unchanged during that choice.
- Binds keeps unrelated lines in its managed cfg and shows every key assigned to an action.
- Crosshair keeps unrecognized external selections, refuses incomplete weapon-script builds and
  conflicting mod scripts, and warns when Valve's source scripts change. HUD overlays, custom stock
  art and competing hit sound paths are named as possible in-game sources.
- Sounds applies settings and sound files together, so a failed install keeps the earlier values.
  The 0/6/12 dB Boost controls stay visible and explain when a custom sound is needed.
- Viewmodel VPK imports reject unrelated content before installing anything, and the FOV slider
  keeps an existing fractional value until you move it.
- HUD options distinguish overlays from stock crosshairs, show unsupported controls as
  unavailable, and refresh showcase pictures. Supported e.v.e Plus options are enabled.
- Mods Browse includes GameBanana GUI results. The file chooser shows upload dates, picks the only
  installable file for you, explains split downloads instead of installing half of one, and says
  plainly when GameBanana no longer has a file.
- Files keeps saved password and remote-console commands through saves, imports and exports.
  Export review names possible credential locations and lists the included custom packs without
  showing credential values, and expires if the profile changes.
- Files no longer warns about dormant quit, disconnect or retry aliases as though they run at
  startup. Startup failures point to the first cfg path and line and suggest a known command for a
  close misspelling. UTF-8 BOMs and one malformed bind no longer hide later settings.
- Files keeps Find controls, new-file choices and full paths readable at the minimum window size,
  and restores the editor's scroll and focus when you come back to it.
- Keep menus, profile actions, pending-review actions and keyboard focus reachable when the
  interface is enlarged or the window is short.
- The unsaved-changes dialog keeps complete cfg paths readable and moves focus to the pane you
  choose. Closing also waits for settings writes that have just started.
- Unfinished pack and designer drafts are protected during profile, install, update and close
  changes, with discard and cancel available.
- An update offer disappears after a later check finds no update, and repeated install clicks
  cannot change which update installs.
- A failed startup recovery check shows a clear error with the app version, state location and
  copyable details, and keeps maintenance markers and TF2 files unchanged.
- App settings errors name the failed settings read, and Retry keeps your choice.
- Offer Choose profile, and keep the full header and library status, when saved profiles exist
  but none is active.
- Casual preload keeps console history, drops an invalid post-disconnect call and avoids duplicate
  managed launch hooks.
- Downloads connect only to checked public addresses while keeping HTTPS certificate checks and
  configured proxies. Debian packages declare the OpenSSL and zlib libraries they need.
- Less background polling while execs is hidden or unfocused.
- Installer, platform and Casual compatibility descriptions in the README are corrected, and the
  packaged credits and dependency licenses are up to date.

### Changed

- Viewmodels per weapon is much shorter: each class has one Shown / Hidden / Hands only choice for Primary, Secondary, Melee (and PDA for Engineer) plus one Inspect choice for every inspect animation. Setting a single weapon differently, such as keeping the Shortstop visible, is under Customize weapons, and Build review summarizes each class in one line.
- Comfig modules no longer repeat the selected level as small text beside each module name.
- Mods: GameBanana cards match the HUD catalog: a labelled Install button, an orange Installed label and outline, Manage for installed mods, and an overlay on the card while its files load or it installs. The header says "Installing mod…", "Importing mod…", "Removing mod…" or "Applying mods…" instead of "Saving…". The file chooser uses the app's selection tiles, and the import and remove dialogs open centred.
- Viewmodels builds from your own installed TF2 files instead of downloaded CompVMInstaller
  animations, and generated previews are gone. Packs built by earlier versions keep working.
- New Venom Crosshairs and TF2Hitsounds downloads are retired. Crosshairs and sounds already in
  your profiles keep working; a saved TF2Hitsounds sound needs a new source to change its baked
  Boost.
- New cueki mod-library downloads and choices are retired. Four direct-author Casual addons remain.
  Saved library choices still apply with their original verified cache; without it, a review can
  remove only those choices from an inactive profile before switching.
- Comfig and the setup wizard offer mastercomfig's current presets only. Existing profiles keep
  showing a retired preset until you choose a current one.
- Switching to or from a profile with Casual setup choices is about twice as fast.
- Binds and Gameplay save quietly in the background. A short notice explains when TF2 keeps a
  draft pending, and a failed save stays visible for retry.
- Sounds chooses for one slot at a time: Browse from the hit or kill sound, then preview and use a
  sound from a simpler list.
- Each pane and App settings keeps its own scroll position; changing profiles resets the
  profile-specific ones.
- The TF2 emblem spinner shows wherever execs is loading, checking or saving, and stays still with
  reduced motion.
- Promotional game captures are replaced with captures of execs itself.

### Security

- Updated the updater's TLS dependency to reject handshake messages sent across incorrect encryption boundaries.

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
