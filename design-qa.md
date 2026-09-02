# design-qa log

## 2026-09-02 — second visual pass, Sounds pane, real previews everywhere
Method: four parallel research agents (hit sound sources and engine rules, the Venom list's preview situation, CompVMInstaller's "visual image guide", the hud-db host inventory + Imgur/GameBanana APIs) and one diagnosis agent on the user's console flood, then implementation, then a walk of the changed `?preview=` states in the in-app browser at 1280×800 (Vite on port 1427) reading each page's console. Brief (verbal): keep the two-tone dark + orange theme but modernise it; fewer cards, dropdowns, scrollbars and check marks; options still there for people who want them, behind disclosure; update the animations; add hit/kill sounds with a selection and upload; show community crosshairs as pictures; every HUD one-click and albums in-app; replace the viewmodel PNG-on-a-background with CompVMInstaller's preview.

### Shipped
- **Controls, not cards.** `Segmented` (one pill, sliding highlight — hide mode, designer style), `.thumb` grids (every crosshair is drawn: library chips, the stock file picker replacing its `<select>`, the community picker, and a `CrosshairChoice` popover replacing 60-odd weapon `<select>`s), `.range` (one slider look, ink thumb; the RGB sliders keep team-coloured thumbs), `.play-button`. Checkboxes are gone from Mods (switch rows) and the designer (switches). `OptionTile`'s check icon became an 8px dot plus a 6% accent wash. The HUD catalog no longer scrolls inside a box; the page scrolls.
- **Motion.** `--motion-move` 220ms with `--ease-out`; `.enter-fade` on arriving pictures and opened disclosures, `.overlay-enter` + a `.scrim` on modals (corner prompts opt out), a 0.985 press on buttons and a scale on slider thumbs. All still cancelled under `prefers-reduced-motion`.
- **Sounds pane (new, Look group).** Hit sound and kill sound side by side: on/off, the chosen sound with a play button and source line, volume; pitch-by-damage and repeat delay under Advanced. A picker sheet lists your own WAV (dialog → prepared → stashed by token), TF2's nine built-in effects (previewed from the user's own `tf2_sound_misc_dir.vpk`) and the pinned community pack (32 of WishingStardust's 33 — `levelup` is 32 728 Hz and unplayable). Files land in `tf/custom/execs-hitsounds/sound/ui/{hitsound,killsound}.wav`; cvars ride `execs_gameplay.cfg`. Non-engine PCM (48 kHz, 24-bit, float, >2 channels) converts to 16-bit 44.1 kHz; ADPCM passes through; MP3/Ogg/FLAC are refused by name. `sound.cache` is removed after a same-name replace.
- **Viewmodels.** The CompVMInstaller layout: one big first-person screenshot, hover a group to see the weapon, click to hide it (the stage swaps to the class's empty view), tabs reset the stage. 73 JPEGs fetched on demand from the pinned commit as raw bytes (`tauri::ipc::Response`), cached by commit. Groups are eye-toggle rows under Primary/Secondary/Melee/PDA eyebrows with the weapons each covers; hide mode is a segmented control; pack/preload folded under a disclosure.
- **Crosshair.** The community picker fetches all 173 VTFs (~1.7 MiB, 8 workers, cached) on open and shows a tinted 48px grid; weapon overrides live behind a disclosure with a count badge.
- **HUD.** 294 of 304 catalog entries install with one click: GitHub codeload as before, Dropbox `?dl=1` 7z (all 26), GameBanana via `apiv11/Mod/{id}/DownloadPage` (newest zip/7z), teamfortress.tv threads by scraping the last Dropbox archive link. Archives are sniffed by magic (`extract_hud_archive`: zip, 7z via `sevenz-rust`; RAR named in the error). The remaining 10 (ToonHUD's theme builder, Steam groups, a broken GameBanana id, dead thread links) show "Author's page". The lightbox appends the author's album in-app: Imgur `/a/`, `/gallery/` and single images through `api.imgur.com/3/album/{id}/images` with imgur's own web client id, and GitHub `showcase.md` pages through raw markdown image extraction. Catalog cache bumped to v3.
- **Mods.** Diagnosis of the `C_OP_RenderSprites::RenderUnsorted … unimplemented sprite renderer` flood: the engine prints it for `orientation_type 0` when a system's material failed to load (not a bad orientation value). The named systems were Square_Series patches from an install whose tracking was lost in the 2026-09-01 baseline reset — 61 modified entries with no snapshot, referencing materials the current selection no longer ships. Our shrink/dedup/rebuild output is byte-identical to the mod's. The pane now warns about untracked modified particle files and points at Steam's verify; restore keeps per-entry judgement on a resized VPK instead of discarding every snapshot, and snapshots record whether they were pristine.

### Verification
`tsc --noEmit`, desktop 28 files / 199 tests, cfglint 100, `pnpm check` (biome), `pnpm build`, `cargo fmt --check`, `cargo clippy --workspace --all-targets -D warnings`, core 276 + app 27 tests — all clean. Walked `settings-sounds` (pane + picker sheet), `settings-viewmodels` (hover swaps the stage, caption and weapons line), `settings-crosshair` (stock grid, thumb chips, overrides popover), `settings-hud-installed`, `settings-mods`; no page console errors.

### Open items
- Native-only checks still pending: auditioning WAVs through the webview audio element (blob: URLs), the 73 JPEG fetches, Dropbox/GameBanana/thread installs against live hosts, Imgur album reads, and the sound pack in game. The browser preview cannot reach any of them.
- The RAR-hosted GameBanana HUDs (7) still fall to the author's page at extraction time — the row says Install because GameBanana lists a file; the error names RAR.
- The 26 vendored wiki renders now serve only the browser preview; they could go once a preview fixture for the JPEGs exists.

## 2026-09-01 — visual pass (RND-188)
Method: before/after headless captures at 1200×800 of every `?preview=` state against a Vite server in the worktree (port 1431), then a full 27-state walk reading each page's console. Screenshots live in `.artifacts/design-2026-09-01/{before,after}/` (gitignored) and are mirrored into the repo root's `.artifacts/`. Brief: the UI read as generic; the ask was a calm, seamless surface with few visible options and the best defaults already chosen — Apple-like restraint, for TF2, without going TF2-themed.

### The system

| Layer | Decision |
| --- | --- |
| Surfaces | `--color-bg` `#121212` → `--color-panel` `#181818` → `--color-panel-raised` `#1F1F1F`. Three steps, no more. |
| Hairlines | `--color-edge` = ink at 8%, `--color-edge-strong` = 14%. Expressed as ink alpha so one value reads correctly on all three surfaces. |
| Ink | `--color-ink` `#ECE7DA`, `--color-ink-muted` `#A49C8E`, `--color-ink-faint` `#6F695C`. |
| Accent | `--color-brand` `#CF6A32`, spent on exactly four things: the primary button, the selected option ring, the active nav marker, the wordmark dot. Nothing else. |
| Semantics | `--color-ok` / `--color-warn` / `--color-error` — meaning only, never decoration. Team colours survive only where they name a TF2 team (the RGB crosshair sliders). |
| Type | Inter only. `.t-pane` 28/600 (-0.01em) · `.t-section` 17/600 · `.t-row` 15/500 · body 14/400 (1.55) · `.t-meta` 12.5/400 muted · `.eyebrow` 11/500 uppercase 0.12em — the only uppercase. `.tnum` on every numeric readout. |
| Spacing | 4px base. 880px content column, 40px gutters, 48px between hairline-divided sections, 44px minimum row with 12px padding. |
| Boxes | `.surface` previews/editors/media · `.overlay` popovers/prompts/modals · `.tile` selectable options. Rows are never boxed. |
| Tiles | Flat, hairline body. Selected = 1.5px accent ring + a small check. No fill. |
| Badges | Sentence case, 12px, hairline ring, no fill unless semantic (`.badge-ok` / `.badge-warn` / `.badge-error`). |
| Motion | 150ms ease on colour, opacity and ring only; everything disabled under `prefers-reduced-motion`. |

### Per screen
- **Shell** — sidebar grouped Setup / Look / More behind eyebrows at 224px; active item is a 2px accent bar plus ink text. The shell no longer owns per-tab titles: each pane renders its own `PaneHeader`. Header collapses the install path to its folder name (full path in `title` and on the copy button) and the profile switcher drops its accent name for ink.
- **Lock state** — one indicator. The top banner stays; the "Read-only while TF2 is running" pane pill, the sidebar box and the profile popover's read-only line are gone. Disabled controls carry the rest.
- **Onboarding** — `OnboardingFrame` (wordmark, eyebrow, balanced title, ≤62ch lede, 640px column / 880px for the wizard) is now shared by FinderPanel, FirstRunExisting and SetupWizard, so the three read as one family. The wizard loses its card-in-card `.surface` shell. The "many installs" screen gains the frame it was missing (audit gap).
- **Comfig** — the preset screenshot no longer grows to a 1200px banner: 2×2 tiles left, a fixed 360px 16:9 `object-fit: cover` preview right, stacking under the tiles below 1100px. Modules move behind a closed "Fine-tune modules" disclosure. Addons become `OptionTile`s.
- **Gameplay** — opens with the two FOV sliders plus Draw viewmodel and Min viewmodels; left-handed, transparent viewmodels and both tracer toggles fold under Advanced.
- **Crosshair** — file, scale and colour become the hero with the live preview at 360px beside them; the custom-crosshair builder follows as one section with its own preview.
- **HUD** — active-HUD hero (name, state, its own catalog art, Update/Match) then the catalog; schema options fold under the hero. Raw 0–255 opacity line dropped; the percentage stays.
- **Viewmodels** — class tabs, preview and slot picker left, checkbox list right; the hide-mode buttons stop being a filled primary pair and become ring-selected.
- **Mods** — status hero: the three facts in a `.surface` on the right, Enable bypass / Restore stock files on the left, library below.
- **Binds / Files / Launch** — structure kept, system applied. Files' lint tiers move onto the semantic badge variants.

### Verification
`tsc --noEmit`, desktop tests 28 files / 197 passing, `pnpm check`, `pnpm build` — all clean. All 27 `?preview=` states walked in a fresh headless tab each: zero page console errors or warnings (only Vite's connect line and React's DevTools notice).

### Open items
- The disclosure state lives in `localStorage` per pane, so it does not follow a profile or sync between machines. That is deliberate for now.
- `Modal`'s HUD lightbox still uses `border-brand` for the selected thumbnail. It is a selected-option marker, so it is inside the accent budget, but it is the one place the ring is a border rather than an inset ring.
- The window still has no `minWidth`/`minHeight` (audit gap, Rust-side — out of scope for this pass). Below roughly 900px the hero rows stack correctly, but the shell has never been tested at a genuinely small size.
- Preset tiles are content-height, so a 2×2 grid with uneven descriptions leaves a ragged bottom edge. Equalising them would mean a fixed min-height that hurts the longer strings.

## 2026-08-31 — viewmodel diagnosis + "keep hands" hide mode
Method: in-game isolation on the user's real install (they drove the game; I read `console.log` passively after learning the hard way not to inject keystrokes), plus offline model forensics against stock TF2 models.

Diagnosis — two faults were masking each other, and my first attribution was wrong:
- **Addon pack, not the viewmodel pack, made weapons invisible.** `Material .../c_scattergun does not support vertex format used by the mesh ... mesh will not be rendered` means the engine refuses to draw the weapon at all, so weapons the user never selected vanished too — which read as "the program ignores my hide/show choices". Reproduced with the viewmodel pack removed and the preloader pack mounted. My earlier "0 errors, viewmodel pack is the culprit" reading was invalid: I grepped the log without ever spawning as Scout, so the weapon was never drawn. Root cause of the material failure is still open; our delivery is byte-faithful (packed VMTs identical to the upstream mod, every referenced texture present in the game), so the difference is likely in cueki steps we skipped (mdl material-path relocation, generated missing VMTs, the VGUI preload warm-up).
- **The viewmodel pack itself is sound.** Compiled models match stock bone-for-bone (58 scout / 54 medic bones, same order, flags, parents; 103 anims / 91 seqs; studiomdl exits clean with no warnings; only checksum and length differ, as any recompile would). Hiding is surgical — each hidden SMD maps to exactly one `$sequence`, so the user's selection hid 19/103 scout and 4/62 medic animations with melee, medigun and knife untouched. Also verified our bone-count formula is correct where CompVMInstaller's is off by one (`skeleton - nodes - 2` vs their `- 3`, which silently drops the last pinky bone).

Shipped — **hide modes** (`ViewmodelHideMode`): the pane now offers "Weapon and hands" (default, unchanged CompVMInstaller behavior) and "Weapon only, keep hands". The latter exploits the skeleton layout: every class parents `weapon_bone*` / `vm_weapon_bone*` to `bip_hand_L`/`bip_hand_R` (verified across all nine), so rewriting only those rows parks the weapon in hand-local space while arm animation and every frame survive. Choice persists in `options.mode` and re-seeds the pane; legacy packs read as `full`. The pane now also states plainly that hidden weapons stay hidden in third person (one shared c_ model), which the old copy implied otherwise.

Verification: core 180 tests (incl. weapon-mode hiding leaves hand frames intact, full-mode still flattens, missing weapon bones error, mode round-trip), desktop 24 files / 136 tests, tsc, biome, cargo check. Real-pipeline probe compiled a weapon-mode pack for scout+medic in 1.26s whose headers match stock exactly (flags/bones/anims/seqs/poseparams). Browser QA at `?preview=settings-viewmodels`: mode buttons render in the design system, selecting one updates the explanation and re-arms Rebuild.

## 2026-08-31 — field incident: pure-server rejection + dead binds (both fixed, verified in-game)
Method: live diagnosis on the user's real install after an in-game report (every model ERROR, every material magenta on Valve Casual), then a supervised repair and two real TF2 launches with `-condebug` console-log analysis, SendKeys console probes, and desktop screenshots.

Root cause 1 — **my CRC "improvement" broke sv_pure**: the preloader updated each patched entry's CRC in `tf2_misc_dir.vpk`. Valve's directory carries a tree MD5 + signature, and the pure check reads the directory's stock CRCs; rewriting them (a) invalidated the tree checksum (verified: stored `5c96…` vs actual `9b4b…`) and (b) advertised modded hashes — the engine rejected the entire archive on the pure server. cueki's data-only patching (stale stock CRC over modded bytes) is the load-bearing trick, not sloppiness. Fixes: `patch_vpk_entry` now writes DATA only into sibling archives and refuses dir-resident entries; the user's directory was repaired in place from the snapshots (all 7 original CRCs restored; tree MD5 now matches Valve's stored checksum — cryptographic proof of pristine); synthetic fixtures moved to a real split-VPK layout (dir + `_000` sibling — the untested sibling path is where this class of bug hid) and tests assert the `_dir.vpk` stays byte-identical through patch and revert. Read-only verification of the data writes: all 7 patched entries land exactly at their offsets, 8/8 sampled neighbors intact.

Root cause 2 — **comfig-layer binds never executed**: `ensureAutoexecExecLine` wrote bare `exec execs_binds` into `overrides/autoexec.cfg`, but the engine resolves exec targets from tf/cfg, so the game logged `'execs_binds' not present; not executing.` — "keybinds didn't save." Worse, cfglint's `resolveExec` suffix-matched any path ending in the stem, so the app's own Files/Binds views showed the chain as healthy. Fixes: exec lines are now layer-addressed (`exec overrides/execs_binds` on comfig), old bare managed lines migrate in place, and cfglint resolves like the engine (`/cfg/<target>` endings only). The user's live autoexec was corrected (the profile absorbs the drift on next app open).

Verification fallout (my fault, fixed): the two diagnostic launches used `-windowed -noborder -w 1600 -h 900`, and Source persists the mode it ran with into `HKCU\Software\Valve\Source\tf\Settings` — so the user's game reopened at 1600×900 borderless. Not in any cfg or the Steam cloud copy; the video mode lives only in that registry key. Exported a backup (`tf-video-settings-backup.reg`) and restored `ScreenWidth=1920`, `ScreenHeight=1080`, `ScreenWindowed=0`, `ScreenNoBorder=0` (primary display is 1920×1080); every quality key (8× MSAA, aniso 16, DXLevel 90, picmip) was left exactly as the user had it. `-console` also persisted `con_enable "1"` into config.cfg, which the app then absorbed into the profile — left alone since it may predate the session and is one checkbox in Advanced Options. Rule added to AGENTS.md: verification launches never pass video-mode flags.

Follow-up (same day): the app prompted "Custom files changed — Added: execs-preloader.vpk / Update or Keep profile?". Answered **Keep** (verified in code: `PackChoice::Keep` is a pure no-op, and `remove_unmodified_live` only deletes *manifest-owned* files, so an unowned pack survives switches). **Update would have been harmful**: the 102 MB pack becomes profile-owned, and the next switch to another profile deletes it while the global particle patches inside tf2_misc remain — patched particles referencing materials that no longer exist, i.e. magenta effects again; a later switch could also resurrect mods after a revert. Root fix: `GLOBAL_CUSTOM_FILES` in surface.rs keeps the pack out of the profile surface entirely (absorb stops prompting; switches can't touch it), with tests proving profile-owned packs like `execs-viewmodels.vpk` are still collected and a drift guard tying the exclusion to `preloader::PRELOADER_VPK`. Anyone who already clicked Update self-heals: the stale claim lands in `owned_missing` and `remove_manifest_files_to` drops the manifest entry and the app-data copy without touching the live file.

Also ruled out in the field: Steam launch options were correct all along (a sloppy first grep misread a neighboring app's `-console`; a proper VDF walk shows the full string incl. `+exec overrides/execs_preload` at the canonical path). Added anyway: the Mods pane now warns when Steam's stored options lack the preload exec (`preloadLaunchInSteam` in the status payload) — a real trap whenever options get saved while Steam is open.

In-game verification (two launches on the real install): console.log shows `sv_pure set to -1` → itemtest loads → auto-disconnect (full preload cycle), zero corrupt/CRC/missing-asset errors, the healthy menu with deliHUD Neue screenshotted; after the autoexec fix the `not present` failures are gone and a console probe screenshot shows `"mouse4" = "+use"` / `"e" = "voicemenu 0 0"` live in game; clean `quit` persisted them into config.cfg (`bind "MOUSE4" "+use"`). Suites after all fixes: core 175 + 2 corpus, desktop 135, cfglint 71, tsc, biome, cargo check — all green.

## 2026-08-31 — full casual preloader (safety rules revoked by user decision)
Method: clean-room reimplementation of cueki/casual-pre-loader's mechanism from its source (read for behavior, no code copied — GPL), validated empirically against the user's real install read-only: a reference corpus generated by running cueki's own python pipeline over the entire default mod library plus this machine's actual `tf2_misc_dir.vpk`; Vite fixture at `http://localhost:1425/?preview=settings-mods` in the in-app browser.

Shipped:
- **Policy change recorded in AGENTS.md**: the user explicitly revoked the gameinfo/official-VPK prohibitions for the preloader. Bounds: reversible `type multiplayer_only` comment toggle with pristine backup; in-place size-preserving particle patches with snapshot-first originals, CRC updates, full one-click revert, and TF2-update drift invalidation; never while the game runs; steam.inf and cfg/user stay untouchable.
- **`pcf.rs` — clean-room DMX-binary2/PCF engine**: decode/encode, the three shrink passes (engine-default attribute removal with python-equality semantics, structural dedup of array-referenced elements, string-dictionary minimization), disguise material-swap merge, parent-collision rule, root-system analysis, and duplicate-carrier extraction. Cross-validated against cueki's own pipeline output: **166/172 default-library files byte-for-byte identical**; the 6 divergences are a genuine CPython `hash()` collision in cueki (four near-identical operators merge wrongly there, −1.0 vs −2.0 speed vectors) that our structural key refuses to reproduce. All 112 vanilla files' derived root lists match cueki's analyzer byte-for-byte.
- **Runtime-derived rebuild lists**: item_fx/halloween/bigboom/dirty_explode keep-lists are computed from the user's own vanilla files (sole-home rule reproduces cueki's shipped map exactly at its generation version) instead of shipping their stale JSON — which currently would delete `spell_fireball_small_red_old` and lose `spell_teleport_black_red` to a find-by-name bug we also fixed (system definitions now win over same-named child records).
- **`preloader.rs` + VPK in-place patching**: entry mapping (v1/v2, sibling archives, preload-bytes guard — the real VPK has 0 preloaded pcf entries across archives 000/018), pad-with-spaces, dir-CRC rewrite, snapshot store + state.json with owner tracking, blood_trail→npc_fx rename, `_dx80` twins, restore-before-reapply, game-update fingerprint reset.
- **Default mod library**: cueki's `mods.zip` v1.7.1 pinned + sha256-verified (81.5 MB, explicit download button), 7 addons packed into a global `tf/custom/execs-preloader.vpk` with `$ignorez` scrubbing and sound-script exclusion, 9 particle mods patched in place. Known genuine skips surfaced per-file (Ghytd soldierbuff +223 B, Toon rocketbackblast +1786 B — cueki skips these too).
- **Preload cfg upgraded to cueki parity** on both serializers: `sv_pure -1; sv_allow_point_servercommand always; map itemtest; wait 10; disconnect; wait 1; clear; playmenumusic`. Installing mods auto-ensures the preload for the active profile (no viewmodel pack required anymore); full revert removes it unless a viewmodel pack still wants it.
- **Mods pane** in the settings nav (Package icon): status stats (bypass/patched/addon pack), bypass toggle + one-click Restore stock files, stale-after-update notice, download-once library card, two-column addon/particle checklists with kind badges, sizes, and pcf previews, last-install report with skip reasons, cueki credit + repo link, sticky dirty-aware Apply.

Verified in-browser: pane renders in the system (no card soup, hairline lists, mono metadata), checkbox toggle flips the footer to "Selection differs from what's installed" and lights Apply.

Adversarial review (subagent) findings, all fixed:
- **Interrupted-apply chains could permanently clobber the pristine snapshots** (state saved with `patched={}` before the final save; overwriting snapshot writes; mtime-based "game update" reset deleting originals after a half-failed restore). Now: snapshots are never overwritten while the right size, orphaned snapshots from crashed runs are adopted back into tracking, state persists incrementally before every patch write, restores keep failed entries tracked for retry, and only a *resized* VPK (not mtime drift) resets the baseline. Two regression tests cover the crash-retry and mtime-drift chains end-to-end against pristine-equality.
- Revert now sweeps the shared preload cfg off every profile the mods install touched (tracked in state), not just the currently-active one.
- The pane refetches status even when an apply fails (the backend has already restored by then); the apply report reads the real gameinfo state instead of assuming; the 81 MB library download got connect/total timeouts so a stalled link can't pin the busy state.
- Reviewed clean: pcf.rs bounds/panic-safety on malformed input, VPK offset/CRC math (byte-identical revert test), gameinfo round-trip, zip path traversal, React reseed/busy logic, and the dead `blood_trail` DX8 twin entry (deliberate parity — cueki's own pipeline has the identical dead branch).

Verification: core 175 tests + 2 corpus suites against the real machine (all passing), desktop 24 files / 134 tests, cfglint 71, tsc, biome (one pre-existing warning), cargo check, production build. Real-file writes deliberately not exercised from this session — apply/revert byte-accuracy is proven on synthetic VPK fixtures end-to-end (patch → CRC → restore → pristine-equality).

## 2026-08-31 — originals pass: Yttrium viewmodels, Venom crosshairs, designer, real-sprite previews
Method: source-level reverse engineering of the three referenced originals (cueki/casual-pre-loader, Yttrium-tYcLief/CompVMInstaller, hbivnm/Venom-Crosshairs — all cloned and read), Vite fixtures at `http://localhost:1425/?preview=` in the in-app browser, plus real-machine pipeline probes against `D:\steam\...\Team Fortress 2`.

Shipped:
- **Viewmodels rebuilt as Yttrium-only** (user decision; every Horsey-editor concept deleted): per-class checkbox groups (64, generated from the installer's own VB source with the Wrangler and dragons_fury_inspect_end upstream bugs fixed), hidden-count badges per class tab, hide/show-all per class, forced-Original note, Build & install with dirty tracking. Backend fetches `animations.zip` pinned+sha256-verified from Yttrium's repo, rewrites the chosen SMDs off-screen (frame counts preserved), compiles per class with the install's OWN `studiomdl.exe` in an isolated staging root, packs with our VPK writer, installs through the existing import machinery. **Probed for real on this machine**: medic compile 0.48s, soldier+scout+demo 2.1s, valid IDST models under TF2's true paths, live tree untouched. Yttrium credited in-pane.
- **Preload validated against cueki**: the itemtest cache trick is exactly what animation packs need on Casual; cueki's gameinfo/VPK patching is for other content types and stays off-limits. `wait 5`→`wait 10` for heavier packs.
- **Community crosshairs (Venom pack)**: 173 static entries pinned to the List repo commit, searchable in-app picker, download-on-demand with local cache, decoded preview (new spec-conformant VTF reader in Rust: BGRA/ABGR/RGBA/DXT1/DXT5, 7.0–7.5, mip/frame aware — verified pixel-perfect against live seeker/wings downloads), bytes written into the pack VERBATIM with their own dimensions patched into weapon scripts. Named library entries persist in the pack; re-apply recovers bytes; remove chips clean up assignments.
- **Crosshair designer**: style (cross/circle/dot/t/x), length/radius, thickness, gap, center dot + size, black outline, drop shadow, opacity — rendered to the same real 64×64 RGBA the VTF pipeline bakes, tinted by the pane color, saved as the "designed" library entry with parameters persisted for re-editing. Verified in-browser: designed circle+dot+shadow renders in the pane preview after save.
- **Stock preview now uses Valve's real sprites** decoded from the user's own `tf2_textures_dir.vpk` (probe rendered crosshair1–7 correctly from the live install), tinted with the engine's RGB rule; extracted-geometry SVG stays as the browser-preview fallback.
- **VTF encoder header fix**: our writer put every field from bumpmapScale onward 4 bytes early vs known-good files (empirically diffed against the Venom pack); now spec-correct and round-trip-verified against the new reader. Baked shapes/designs/PNGs should now render reliably in game.

Verification: Rust core 161 tests (incl. verbatim-VTF passthrough with non-64 dims, pack-recovery re-apply, name sanitization, SMD hide, QC model-name, soldier forced-files, group table); desktop 23 files / 130 tests; tsc, biome (one pre-existing warning), `cargo check`, production build all pass.

Open native checks: an in-game session with a built pack (preload → Casual), a community crosshair and a designed crosshair applied (VTF header fix makes this the first honest in-game check), and the community download over a cold cache.
final result: pass for fixtures + real-machine pipeline probes; in-game walkthrough pending.

## 2026-08-30 — user-feedback pass: de-TF2 typography, de-carding, real imagery, functional fixes
Method: Vite dev at `http://localhost:1425/?preview=` fixtures in the in-app browser at 1280×720 plus component/lib tests. Native Tauri behaviors (opener, embedded windows, clipboard in WebView2) not exercised in this pass.

Driving feedback (verbal walkthrough of the running app): profile switching visually instant; copy buttons silent; "official packages installed" noise; Preset guide dead; AI preview images; extras opening externally; transparent viewmodels missing from Gameplay; HUD catalog one giant scroll with no screenshots; stock crosshair preview static; custom crosshairs mislabeled/colorless/no all-class; Viewmodels page overwhelming with an AI render; Files blocked by TF2-provided configs; TF2 font + card-everywhere design.

Verified per pane:
- Chrome: Inter everywhere (Big Shoulders removed), lowercase wordmark with brand mark, flat header/nav (`bg-panel`, 2px active bar), no radial gradient. Install-path copy flashes a green check + "Copied" (`install-path-copy`).
- Switch progress (`?preview=switch`): overlay card with step-driven fill bar (no percent text, no role=progressbar), green check marks on completed stages, current stage in brand. Presenter now queues real backend stages and reveals each for ≥`SWITCH_STEP_MIN_MS` (550ms); completion still command-driven; errors reset instantly.
- Comfig: status pill only for problem states — "Official packages installed" is gone. Preset cards sit beside the real koth_sawmill in-game screenshot for the selected preset (7 vendored MIT images incl. very-low→destitute mapping); "none" gets a text state. Preset guide and Open extras call `openEmbeddedPage` (in-app windows); credit/donate links via `openExternal`. Module matrix flattened to hairline rows; only non-default module choices render in brand.
- Gameplay: flat sections, summary stat strip, and the new `gameplay-transparent-viewmodels` instant-apply addon toggle with honest constraints (HUD support + DX9, forces post-processing/AA off; disabled with pointer to Comfig when packages are missing).
- HUD: paginated catalog helpers wired (Prev/Next appear past `HUD_CATALOG_PAGE_SIZE`=20, page clamps on search), and the screenshot lightbox opens from banner or "Screenshots (N)" with arrows, thumbnails, Esc/arrow keys, and optional external album link — verified against live hud-db rayshud imagery.
- Crosshair: stock live preview now renders the actual selected sprite geometry (extracted frame-0 shapes; verified crosshair3 ring vs crosshair7 plus switch), scale follows ×scale/32, alpha slider carries an engine-honesty note. Builder retitled "Custom crosshairs" with a baked RGB color picker (+reset) tinting the canvas, an "All classes" per-slot tab (mixed-state aware) and per-class copy-to-all.
- Viewmodels: page rebuilt around what works — pack import/replace/remove, Casual preload, compile-unavailable note — with all compiler-only controls hidden, not shown-disabled. First-person reference browser shows real wiki renders per class/slot (26 vendored WebPs, spy has no secondary) with weapon captions and Valve/wiki credit. AI render deleted.
- Files: origin badges (TF2/HUD/pack/managed/comfig), provided files read-only with origin copy, advisory findings collapsed under "Advisory — provided files" and excluded from the Blocked gate (cfglint `advisoryPaths`); user files still block (fixture `danger.cfg` verified).
- Binds/Launch/wizard/first-run: flat rows and `.btn` styles; Launch Copy shows Copied feedback.

Verification: desktop 22 files / 119 tests; workspace incl. cfglint 69 tests; Rust core 151 tests; `cargo check` and `pnpm build` pass; biome clean on changed files (one pre-existing warning untouched).

Adversarial review pass (multi-agent, findings verified then fixed): Tauri v2 invoke-key casing bug — `custom_rgba` was silently dropped (custom PNGs never reached the backend natively; now `customRgba`); cfglint advisory demotion now follows alias *authorship* (a HUD-defined alias invoked from a user file no longer blocks saves; user-authored payloads still do); imported crosshair PNGs are recovered from the pack's own `custom.vtf` on re-apply (backend decode + UI note) instead of erroring after a reload; crosshair draft reseeds by record content so unrelated writes don't wipe un-applied work; all-classes fanout clears overrides when the base shape is picked (fallback preserved) and copy-class-to-all leaves the source class untouched; paced-reveal timer keyed to the revealed step so slow real switches can't freeze the checklist; first-unused wizard's Change disabled during apply; cancelling the viewmodel VPK picker is a no-op instead of an error; preload preference selectable before the first import; lint finding rows keyed by col/via. Two pre-existing issues (HUD install O(N²) manifest writes; export zip extension edge) were spun off as separate tasks.
final tallies: desktop 22 files / 121 tests; cfglint 71; Rust core 151; tsc, biome (one pre-existing warning), `cargo check`, and production build all pass.

Open native checks: packaged Windows run for opener links, the two embedded comfig windows, WebView2 clipboard, tinted VTF render in game, HUD screenshot fetch over the v2 cache, and the paced progress feel during a real switch.
final result: pass for preview fixtures; native walkthrough pending.

## 2026-08-30 — Option 1 desktop redesign final pass
Source truth: `C:/Users/Anthony/.codex/generated_images/01a053ba-af37-76b3-88a2-ba1bf8fd1f58/exec-6269f357-be66-4396-a419-272fb76a6742.png` (selected direction 1, 1487×1058).

Implementation: `.artifacts/design-qa-2026-08-30/implementation-comfig-1280x720.png`, captured from `http://127.0.0.1:1421/?preview=settings-comfig` in the in-app browser at 1280×720, DPR 1. State: Main profile active, game closed, Medium preset selected, Graphics modules active.

Density normalization: the full source was scaled proportionally to 720 px tall and placed beside the unchanged 1280×720 implementation in `.artifacts/design-qa-2026-08-30/comparison-full-normalized-final.png`. A top-focused source crop was normalized to 1280×720 and placed beside the implementation in `.artifacts/design-qa-2026-08-30/comparison-focused-top-final.png`. Both are actual combined comparison images, not separate visual reads.

Full-view evidence:
- The 64 px product header, dark navigation rail, TF2 tan/orange palette, display type, selected preset hierarchy, real industrial preview art, compact module categories, and two-column setting matrix align with the selected direction.
- The app preserves its desktop product semantics: profile and install context stay in the global header, settings auto-save where already designed, and the footer carries update/disclaimer status instead of copying the concept's synthetic Apply bar.

Focused comparison findings and iteration history:
- Pass 1: Comfig repeated explanatory copy and a stacked credit/status row, pushing preset and module controls below the intended first-screen hierarchy.
- Pass 2: the title, mastercomfig credit, package status, preset cards, preview, and module tabs were compacted into the same visual order and density as the source.
- Final audit: fixed first-run flex centering that hid the required profile name; same-path Files draft leakage between profiles; duplicate bind tab stops; broken file-path wrapping; unavailable viewmodel edits; a stale selected weapon after record changes; the occluding viewmodel action bar; duplicate extras launching; incomplete ARIA tab selection/keyboard behavior; and missing alert-dialog focus for post-game pack drift.
- No unresolved P0, P1, or P2 visual/interaction findings remain in the tested preview states.

Interaction evidence:
- Profile menu opens and closes; active profile state remains visible.
- Comfig module tabs move with Left/Right/Home/End and transfer focus; search and segmented module choices remain operable.
- Duck bind Record accepts Shift and immediately displays `shift`; only one focusable recorder remains for the row.
- Gameplay contains no duplicate stock-crosshair controls; Crosshair contains stock controls first, then the per-weapon builder. Class tabs move with arrow keys and transfer focus.
- HUD search for `toon` returns one ToonHUD card; Refresh leaves settings navigation enabled and retains cached results.
- Viewmodel class/weapon preview remains visible; compiler-only controls are disabled when compilation is unavailable, Casual preload and prebuilt VPK import remain available, and the action area no longer overlays the preview.
- Files uses a single-line, titled path label and a three-column editor/lint workspace; Launch Copy remains available.
- `?preview=first-unused` starts at scrollTop 0 with the required profile name visible. `?preview=absorb` focuses an `alertdialog` with explicit label and description.
- Browser runtime log: zero error-level entries from the final `:1421` server during the final interaction pass.

Verification: desktop 21 test files / 105 tests passed; workspace 29 files / 218 tests passed; Rust core 149 tests passed; desktop production build and Tauri `cargo check` passed. The only build warning is the existing Vite chunk-size advisory; Tauri reports two existing dead-code warnings.

Open native check: packaged Windows testing against a real TF2/Steam install is still required for live HUD downloads, studiomdl compilation, Steam Cloud/localconfig writes, process locking, and updater signing/install behavior.
final result: passed

## 2026-08-30 — pre-redesign stabilization pass
Method: Vite preview at `http://127.0.0.1:1420/?preview=` with the in-app browser at 1440×1024, plus component and integration tests. Native Tauri writes were not invoked during visual QA.

Verified:
- `?preview=settings-binds`: Duck records Shift and immediately displays `shift`; managed bindings retain precedence over stale `config.cfg` values.
- `?preview=settings-crosshair`: default TF2 file/color/scale controls now lead the Crosshair pane, followed by the per-weapon builder. Gameplay no longer duplicates these controls.
- `?preview=settings-viewmodels`: Casual preload is visible near the action area. The incomplete compiler is clearly unavailable, while prebuilt VPK import remains available.
- `?preview=switch`: newest real backend stage is shown immediately in a six-step checklist. There is no synthetic percent or delayed stage replay; the completed summary remains for five seconds without retaining the write lock.
- HUD loading and failure states are local to the catalog, expose status/error copy, keep cached entries usable, and do not gray out the rest of Settings.
- Current captures: `.artifacts/audit-2026-08-30/current/10-crosshair-relocated.png`, `12-viewmodels-preload-safe.png`, and `13-progress-honest.png`.

Open items: the broad settings/setup redesign is awaiting selection from three generated visual directions. Native HUD network behavior, Steam launch-option persistence, and live TF2 write locking still need a packaged Windows walkthrough.
final result: pass for the functional stabilization states; visual hierarchy remains intentionally pending redesign.

## 2026-08-30 — truthful profile progress presenter
Method: `?preview=switch` static fixture plus server-rendered progress-state checks. Native Tauri operations were not invoked in this pass.

Verified:
- The fixed progress card remains visible above the ready/settings chrome without changing page layout.
- The newest backend stage is shown immediately in the six-step checklist; late or out-of-order events cannot move the UI backwards.
- No synthetic percentage or delayed replay is shown. The final completed checklist remains readable for five seconds while the write lock is released as soon as the command completes.
- Completed, current, and pending stages remain distinguishable using the existing TF2 tan/orange palette. Settings and profile mutations share the operation lock during exact replace.

Open items: event timing against native profile creation/switching still needs a packaged Tauri walkthrough with a real TF2 install.
final result: pass for the desktop preview fixture.

## 2026-08-30 — in-app updater chrome (RND-159)
Method: Vite preview at `http://127.0.0.1:4173/?preview=` fixtures + browser walkthrough. No native Tauri window (GTK/WebKit missing). Tokens: bg `#121212`, ink `#EBE2CA`, accent `#CF6A32`, pill buttons, Big Shoulders Display.

Verified:
- `?preview=update-available`: ready chrome with Settings, brand-tinted banner `Update available — execs 0.2.0`, Install + Later. Footer shows `execs 0.1.0` and Check for updates. Comfig pane still has Update packages (mastercomfig, not the app).
- `?preview=update-installing`: same banner, progress reads Downloading, Install/Later hidden.
- `?preview=settings-comfig` / `?preview=settings-locked`: no app-update banner. Write-lock strip still shows on locked. Footer version + Check stay visible.
- Later is session-only (no settings.json field).

Open items: native `check()` / signed install need a published GitHub Release, `TAURI_SIGNING_PRIVATE_KEY`, and a previous NSIS/AppImage build. Not available on this VM.
final result: pass for updater chrome (preview fixtures).

## 2026-08-30 — later studios (RND-163 / RND-164)
Method: Vite preview at `http://127.0.0.1:4173/?preview=` fixtures + browser walkthrough. No native Tauri window (GTK/WebKit missing). Tokens: bg `#121212`, ink `#EBE2CA`, accent `#CF6A32`, pill tabs, Big Shoulders Display.

Verified:
- `?preview=settings-crosshair`: Settings tabs include Crosshair (active) and Viewmodels. 64×64 canvas, first-party shape radios (dot / cross / plus-gap / circle / t), Import PNG, class pills, per-weapon dropdowns. Preview record seeds Scattergun to `dot`. Apply reads Update crosshairs. Casual copy: replay/thumbnails + Gameplay stock file Default/None.
- `?preview=settings-viewmodels`: Class pills, origin/rotate fields, Hide, Remove left arm, Keep visible, Static, weapon extras (medigun beam, flames, knife backstab set, shells, tracers), Casual preload on. Compile is Windows-only and disabled on Linux. Import prebuilt VPK enabled. Copy: compiled animations need first-party preload for Valve Casual.
- `?preview=settings-locked`: write-lock banner, Crosshair Apply reads Close TF2 to apply and stays off; shape radios, PNG, and weapon dropdowns disabled. Viewmodels knobs, extras, preload, Import, and Compile disabled (Close TF2 to compile).
- Tab regression: Comfig and Files still render from the same chrome.

Open items: native Ice decrypt against a live `tf2_misc_dir.vpk`, studiomdl compile, and Crowbar decompile need a Windows TF2 tree; not available on this VM.
final result: pass for later-studio chrome (preview fixtures).

## 2026-08-30 — HUD pane (RND-162)
Method: Vite preview at `http://127.0.0.1:4173/?preview=` fixtures. No native Tauri window (GTK/WebKit missing). Tokens: bg `#121212`, ink `#EBE2CA`, accent `#CF6A32`, pill tabs, Big Shoulders Display.

Verified:
- `?preview=settings-hud`: Settings tabs include HUD. Catalog search, Refresh catalog, rayshud Install enabled, ToonHUD Install disabled + “not a pinned GitHub zip”. Casual disclaimer (layout/scheme vs materials). Credit hud-db / comfig.app / TF2HUD.Editor MIT, first-party apply.
- `?preview=settings-hud-installed`: Installed rayshud, Update HUD, Active badge. Options: Buff color + opacity, Minmode checkbox, Scoreboard combo, Ubercharge number. Apply enables when dirty and disables after save.
- `?preview=settings-locked`: write-lock banner, HUD tab still reachable, Install reads Close TF2 to install (GitHub rows) and stays off. Non-GitHub Install stays labeled Install and disabled.
- Tab regression: Comfig and Files still render from the same chrome.

Open items: native hud-db fetch, pinned zip extract, live one-HUD replace, and schema apply need a Tauri window; not available on this VM.
final result: pass for HUD chrome (preview fixtures).

## 2026-08-30 — settings panes (RND-154–158)
Method: Vite preview at `http://127.0.0.1:4173/?preview=` fixtures. No native Tauri window (GTK/WebKit missing). Tokens: bg `#121212`, ink `#EBE2CA`, accent `#CF6A32`, pill tabs, Big Shoulders Display.

Verified:
- `?preview=settings-comfig`: two-column ready chrome, Profiles left, Settings right. Tabs Comfig · Binds · Gameplay · Files · Launch. Comfig preset radios (Medium default), module groups, official addon checkboxes, Update packages, comfig.app credit + extras/import. Not branded official mastercomfig.
- `?preview=settings-binds`: click-to-record rows for movement, jump/duck, medic, use, voice, loadout A–D. No alias studio.
- `?preview=settings-gameplay`: FOV slider, viewmodels, tracers, flip + “does not apply while connected”, stock crosshair.
- `?preview=settings-files`: cfg list + textarea. Live lint shows warn `host_writeconfig` and block `unbindall` (`danger.cfg`). Save stays off while block-tier findings exist; commands are not stripped.
- `?preview=settings-launch`: launch options box, Copy + Save. Preview Save reports Steam open (copy remains the path).
- `?preview=settings-locked`: write-lock banner, Settings read-only copy, pane controls disabled.
- First-run regressions: `?preview=first-existing` save-only (no settings tabs); `?preview=first-unused` unused wizard; `?preview=create` create-new wizard. Inherit-binds stays on ready chrome.

Open items: native owned-file apply, GitHub VPK fetch, `localconfig.vdf` write, and absorb bind-sync need a Tauri window; not available on this VM.
final result: pass for settings chrome (preview fixtures).

## 2026-08-30 — create-new + inherit-binds chrome (RND-153)
Method: Vite preview at `http://127.0.0.1:4173/?preview=` fixtures + browser walkthrough. No native Tauri window (GTK/WebKit missing).

Verified:
- `?preview=create`: New profile wizard, inherit checkbox visible and off, primary **Create**, Cancel. Name `Alt` → ready `2 profiles`, Alt Active, inherit still off, Create new visible.
- `?preview=saved`: `1 profile` Main Active, inherit checkbox off on ready chrome, Create new. Open wizard then Cancel returns to the same library.
- `?preview=first-existing`: save-only. No inherit checkbox, no Create new, no Import, no wizard.
- `?preview=first-unused`: Unused install wizard, Apply (not Create), no inherit checkbox.
- Finder regressions: `?preview=empty` Confirm disabled; `?preview=one` Confirm → first-run existing (not Create new).

Open items: native `create_fresh_profile` (GitHub VPK download + switch absorb) needs a Tauri window; not available on this VM.
final result: pass for create-new chrome (preview fixtures).

## 2026-08-30 — first-run split chrome (RND-152)
Method: Vite preview at `http://127.0.0.1:4173/?preview=` fixtures + browser walkthrough. No native Tauri window (GTK/WebKit missing).

Verified:
- `?preview=first-existing`: save-only first hour. Copy about existing customization, reasons (`Found autoexec.cfg`, `Found packs in custom`), `Save current as…`. No Import, no Create new, no wizard. Save `Main` → ready Profiles `1 profile` with Active + Export + Import.
- `?preview=first-unused`: setup wizard (`Unused install`), Medium preset default, official addon checkboxes, comfig.app credit. Apply disabled until a name. Name `Fresh`, check No tutorial, Apply → `1 profile` Fresh Active.
- `?preview=first-unused-locked`: write-lock banner, wizard visible, Apply reads `Close TF2 to apply` and stays disabled after a name.
- Finder regressions: `?preview=empty` Confirm disabled; `?preview=one` Confirm → first-run existing (not the wizard); `?preview=confirmed` / `library` are save-only first-run, not Save+Import.

Open items: native classify against a live TF2 tree, GitHub VPK download, and wizard apply+switch need a Tauri window; not available on this VM.
final result: pass for first-run chrome (preview fixtures).

## 2026-08-29 — profile zip export/import chrome (RND-151)
Method: Vite preview at `http://127.0.0.1:4173/?preview=` fixtures. No native Tauri window (GTK/WebKit missing).

Verified:
- `?preview=import`: ready screen, Profiles `2 profiles`, `Main` with Active badge + Export, `Imported` with Export only. Import pill next to `Save current as…`. Active stays on Main.
- `?preview=saved`: `1 profile`, Main Active + Export, Import next to Save.
- `?preview=library`: `No profiles yet`, no Export rows, Import next to Save (enabled without a name).
- `?preview=locked`: write-lock banner, no Import/Save form, copy `Read-only while TF2 is running. Export is still available.`
- Finder regressions: `?preview=empty` Confirm disabled; `?preview=confirmed` empty Profiles + Save + Import, no banner.

Open items: native zip save/open dialogs and live `tf_linux64` poll need a Tauri window; not available on this VM.
final result: pass for export/import chrome (preview fixtures).

## 2026-08-29 — profile switch progress (RND-149)
Method: Vite preview at `http://127.0.0.1:4173/?preview=` fixtures + browser walkthrough. No native Tauri window (GTK/WebKit missing).

Verified:
- `?preview=switch`: ready screen, Profiles `2 profiles`, `Main` Active, `Alt` shows Switch, progress panel at Write (Game closed / Pack current / Remove live packs done, Write current, Cloud / Done pending).
- Click `Alt`: Active moves to Alt, progress marks all steps Done. Locked / running hides switch actions.

Open items: native switch against a live TF2 tree needs a Tauri window; not available on this VM.
final result: pass for switch progress chrome (preview fixtures).

## 2026-08-29 — absorb pack prompt (RND-150)
Method: Vite preview at `http://127.0.0.1:4173/?preview=` fixtures + browser walkthrough. No native Tauri window (GTK/WebKit missing).

Verified:
- `?preview=absorb`: ready screen, Profiles `1 profile`, `Main` with Active badge, pack prompt “TF2 changed packs in custom. Update the active profile?”, Added `toonhud`, Removed `oldpack`, primary Update and secondary Keep.
- Keep / Update dismiss the prompt in preview (no live tree). Save current as… still available.
- `?preview=saved` / `library` / `locked`: no pack prompt. Locked stays read-only.

Open items: native absorb after `tf_linux64` quit and Cloud dual-write need a Tauri window; not available on this VM.
final result: pass for absorb pack-prompt chrome (preview fixtures).

## 2026-08-29 — save current as… (RND-148)
Method: Vite preview at `http://127.0.0.1:4173/?preview=` fixtures + browser walkthrough. No native Tauri window (GTK/WebKit missing).

Verified:
- `?preview=saved`: ready screen, Profiles `1 profile`, `Main` with Active badge, primary CTA `Save current as…` (not Create).
- `?preview=library`: `No profiles yet`, Save current as… disabled until a name is typed. Save `Main` then `Alt`: status `1 profile` → `2 profiles`, first stays Active, field clears. Not a switcher.
- `?preview=locked`: write-lock banner, Profiles read-only (`Read-only while TF2 is running.`), no save form.
- Finder / confirmed regressions: `?preview=empty` Confirm disabled; `?preview=confirmed` empty Profiles + Save current as… form, no banner.

Open items: native library ingest, folder picker, and live `tf_linux64` poll need a Tauri window; not available on this VM.
final result: pass for save-current chrome (preview fixtures).

## 2026-08-29 — profile library chrome (RND-147)
Method: Vite preview at `http://127.0.0.1:4173/?preview=` fixtures + browser walkthrough. No native Tauri window (GTK/WebKit missing).

Verified:
- `?preview=library`: ready screen, `TF2 INSTALL` path, Profiles panel `No profiles yet`, Create disabled until a name is typed.
- Create `Main` then `Alt`: status `1 profile` → `2 profiles`, names listed, field clears. Not a switcher.
- `?preview=locked`: write-lock banner, Profiles read-only (`Read-only while TF2 is running.`), no Create form. Change returns to finder with the banner still up.
- Finder regressions: `?preview=empty` Confirm disabled; `?preview=one` Confirm → ready with empty Profiles + Create form, no banner.

Open items: native library writes, folder picker, and live `tf_linux64` poll need a Tauri window; not available on this VM.
final result: pass for profile-library chrome (preview fixtures).

## 2026-08-29 — TF2 finder + write-lock chrome (RND-145 / RND-146)
Method: Vite preview at `http://127.0.0.1:4173/?preview=` fixtures + Playwright computed styles + browser walkthrough. No native Tauri window (GTK/WebKit missing).

Verified:
- Finder empty: `FIND TF2`, no-install copy, Browse enabled, Confirm disabled, Valve/Steam disclaimer.
- One candidate + Browse demo path → Confirm → remembered root (`execs` wordmark, `TF2 INSTALL`, Change).
- Multiple installs: two cards, Confirm disabled until a card is selected (`data-selected`).
- Write-lock banner: `TF2 is running — execs is read-only until the game quits.` Change returns to finder with the banner still up; Browse and Confirm stay enabled.
- Tokens: body bg `rgb(18, 18, 18)`, ink `rgb(235, 226, 202)`, brand `rgb(207, 106, 50)`, `Big Shoulders Display` on the heading, Inter on body.

Open items: native folder picker and live `tf_linux64` poll need a Tauri window; not available on this VM.
final result: pass for finder + write-lock chrome (preview fixtures).

## 2026-08-28 — desktop empty chrome (RND-144)
Method: Vite preview at `http://localhost:4173/` + Playwright computed styles + browser walkthrough.

Verified:
- Empty window chrome: uppercase `execs` wordmark, not-affiliated Valve/Steam disclaimer, no profile UI.
- Tokens: body bg `rgb(18, 18, 18)` (`#121212`), ink `rgb(235, 226, 202)` (`#EBE2CA`), brand `rgb(207, 106, 50)` (`#CF6A32`), muted disclaimer `rgb(168, 159, 140)`.
- Fonts: `Big Shoulders Display` 600 loaded on the wordmark; Inter 400 on body.

Open items: TF2 finder and write-lock chrome (RND-145 / RND-146); no native Tauri window in this Linux VM (GTK/WebKit missing).
final result: pass for desktop scaffold chrome.

## 2026-08-13 — v1 build pass (all increments)
Method: DOM/computed-style inspection + curl (screenshot tooling unavailable in this environment); Playwright e2e for interaction flows.

Verified:
- Design tokens render: bg #121212, ink #EBE2CA, brand #CF6A32 pill CTAs, Big Shoulders display headings, Inter body (computed styles, home + detail).
- Home: hero, search form, category/class/sort chips, card grid, empty states (hit + miss).
- Detail: badges, install/download CTAs, safety report, what-this-changes with defaults, tabbed cfg viewer with tokenizer highlighting, preview panel (text fallback pre-capture), report button.
- Playwright (7 tests): smoke on home/footer-attribution/upload-gate/legal/guide/mod-404 + full direct-install and uninstall flows against real Chromium FS handles (OPFS-stubbed picker).
- Live smoke on workers.dev: SSR 200, empty-state browse, Steam auth redirect to real steamcommunity.com.

Open items (P2): mobile viewport pass not yet done; dark-only design (no light theme by choice); class chips are text (icon set undecided — licensing).
final result: pass for v1 scaffold-to-deploy; visual QA of the preview slider blocked on the capture session.
