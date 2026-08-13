# design-qa log

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
