# Everyday-use fixes and post-update tidy-up, part 3

This development work follows the [part 3 issue list](https://linear.app/rndaom/document/021-part-3-issue-list-5017f7572887)
on top of the part 1 and part 2 fixes in `rndaom/0.2.1-fixes`. It keeps product version 0.2.0
and does not publish a release, tag, updater or installer.

## Scope and decisions

| Item | Result |
| --- | --- |
| 1 | Binds records TF2's key names from `inputsystem.dll`'s table (`semicolon`, `'`, `,`, `.`, `/`, `\`, `-`, `=`, `rshift`, `rctrl`, `ralt`, `pause`, `scrolllock`, `numlock`, `lwin`, `rwin`, `app`). Punctuation keys are quoted like `config.cfg`. Older spellings (`semicolin`, `comma`, …) are read as the intended key, and `managed_upgrade.rs` rewrites them in saved files. Every standard keyboard code is tested against the table. |
| 2 | `profile_move.rs` offers Move profiles here when the recorded TF2 folder no longer holds TF2. Manifests are rewritten before the index. The active profile stays active only when the new folder holds its files. The move refuses while TF2 runs, the old install still exists or a recovery record from it is pending. Export while mismatched is not needed because the move is offered. |
| 3 | Everything through the first `%command%` is kept exactly; only the TF2 arguments after it are checked. `gamemoderun` is now allowed as a wrapper (the architecture rule is updated). |
| 4 | A review with one available choice installs directly. Preparing and installing are two settings writes with the chooser between them. Rows use pack names, sizes use KB/MB, and `install` counts as an instruction file name. |
| 5 | RAR is accepted by Import HUD, single-file GameBanana HUD pages, and Dropbox/teamfortress.tv links. A lone split RAR part is refused. |
| 6 | The preload hook is replaced only when its whole text is a hook execs shipped (0.1.x and two development versions). This happens before switching to an inactive profile and in the tidy-up. |
| 7 | Inventory reads when opened (after a 30-second gap), after TF2 closes and on the new Refresh button, never on a timer. Launch TF2 already waits behind a read through the write gate. A Web API read path was not pursued: operations still need the game coordinator. |
| 8 | `settings_copy.rs` copies Binds, Gameplay or Sounds from the active profile to chosen inactive profiles with a per-profile review. |
| 9 | A saved TF2 folder that no longer holds TF2 is named on the finder with Retry. |
| 10 | Resolution, display-mode and `-console` options say TF2 keeps their effect after removal. |
| 11 | `disk_space.rs` checks the target volume before switches and profile writes of 16 MB or more (64 MB headroom). Full-disk OS errors become one plain `DiskFull` message. |
| 12 | Gameplay never writes the cheat-only `r_drawtracers`; the All tracers switch is removed because TF2 refuses the cvar from every startup cfg. Saved lines are removed by the next save and the tidy-up. |
| 13 | Oversized mods name their size, the 512 MB limit and the manual route through `tf/custom`. |
| 14 | Network failures read as short sentences naming the site; the URL and status go to the activity log. |
| 15 | Window size, position and maximized state are saved in `settings.json` and restored when the monitor still exists. The installed app reopens the last pane. |
| 16 | `logs/activity.log` records command errors, finished operations and network failures (no file contents, masked secrets). Copy diagnostics adds a Health summary and the last 30 lines. |
| 17 | While Steam is open, the Launch pane offers Check Steam again instead of an impossible write. |
| 18 | New profile has Create, which leaves the profile inactive. |
| 19 | MP3 and Ogg Vorbis clips decode through Symphonia (MPL-2.0, unmodified, credited) into the existing WAV preparation, up to 30 seconds. Clips over a second get a note. Ogg Opus is refused with a clear message. |
| 20 | `scripts/pinned-sources.mjs` reports whether comfig.app's hit sound list or TF2HUD.Editor's schemas changed after their pins; it is a ship checklist step. Both pins were current on September 28. |
| 21 | `tidy_up.rs` runs once per version after startup recovery with TF2 closed. It removes orphan sound caches, deletes HUD backups only when every file is owned by a profile, moves the rest out of TF2's folder into execs data, drops captured Valve cfgs, upgrades managed files and removes retired downloads. One notice with Details reports it; Storage offers Tidy up again. |

## Review

A high-effort review of the combined branch found eight issues, all fixed in their own commits:
unit tests writing to the real activity log (the stray test lines were removed from this
machine's data folder), Inventory not reading again when reopened, skipped tidy-up steps not
retried, a half-finished HUD backup move that could never finish, a first maximized close saving
the maximized size, one unreadable profile blocking the whole copy review, free-space checks
enumerating every volume, and a duplicate WAV writer.

## Verification

- `pnpm test`: 1,365 desktop tests, 172 cfglint tests and 124 script tests passed; five script
  tests skipped on this platform.
- `cargo test --workspace --locked`: 1,161 tests passed with TF2 closed; optional fixture and
  live tests stay ignored.
- Clippy (`--workspace --all-targets -D warnings`), `cargo fmt --check`, `pnpm check`,
  `pnpm build`, `node scripts/third-party-notices.mjs --check` and `git diff --check` passed.
- Browser previews checked the missing-folder finder, the moved-library screen, the chooser,
  Inventory Refresh, Copy to profiles, Launch notes, Create, and the tidy-up notice and Details.
- The tidy-up ran on a copy of a real 0.2.0 data folder and TF2 `tf/custom`/`tf/cfg`. It removed
  29 orphan sound caches, deleted 2 duplicate HUD backups, moved 6 (112 MB) out of TF2's folder,
  kept 3 library backups, dropped captured Valve cfgs from 4 profiles, upgraded 4 managed files,
  removed the unused cueki download and retired caches (220 MB freed), and skipped nothing.
  A file-by-file diff showed no other change; every pack and profile file stayed. A second run
  changed nothing. The real folders were not modified.
- MP3 decoding is tested with a synthetic tone fixture. No Ogg Vorbis encoder was available
  locally; Vorbis decoding relies on Symphonia and the ignored local-sample test.

Not covered locally: Linux builds of the new `statvfs` path (hosted CI covers it), physical
keyboards for every key, Steam's exact status while Inventory reads, and retail TF2 in-game checks.
