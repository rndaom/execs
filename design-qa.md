# design-qa log

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
