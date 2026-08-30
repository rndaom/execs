# design-qa log

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
