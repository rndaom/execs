# design-qa log

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
