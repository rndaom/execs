# design-qa log

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
