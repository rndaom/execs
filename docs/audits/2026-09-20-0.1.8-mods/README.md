# Mods and GameBanana audit — 0.1.8

## Scope and baseline

The owner assigns Linear RND-248, RND-286 and RND-326–332 to the compatible 0.1.8 patch.
Implementation starts from the latest public maintenance baseline, immutable `v0.1.7+2` at
`15086ea569178402d927bf4990828dc436c8ec40`. Steam inventory work, GameBanana file-variant choice,
particle-conflict review and the 0.2.0 profile-owned preloader schema remain out of scope.

The work must not add write targets, weaken the TF2 process lock, change profile/export readability,
discard recovery snapshots, or write a VPK directory. Maintenance and forward-port qualification are
separate because the maintenance line stores particle selections globally while main owns them per
profile.

## Before audit

The public baseline was exercised in the browser fixture at 1200×800 before implementation.

1. **Open Mods — unhealthy.** Casual preload setup occupies the entry screen; browsing and installed
   mods require scrolling.
2. **Open Browse GameBanana — poor.** Browsing is disclosure-gated below installed mods. Dense controls
   precede a card grid with generic actions and only bottom paging.
3. **Change page — poor.** Page navigation leaves focus at the bottom control and the result cards do
   not establish the active ranking or honest count scope.
4. **Open the default library — poor.** Casual configuration, installed content and discovery remain
   one long document, while an idle `Up to date` bar competes with unrelated browsing actions.

The screenshots establish visible hierarchy only. They do not establish native WebView behavior,
screen-reader output, packaged compatibility or successful mod installation.

## API research

Read-only probes on September 20, 2026 used GameBanana's official
[`Mod/ListFilterConfig`](https://gamebanana.com/apiv11/Mod/ListFilterConfig), production list-filter
component and live TF2 responses. The supported contract is:

- `Mod/Index` for both browsing and name search.
- `_aFilters[Generic_Name]=contains,<term>` for a case-insensitive name search; a bare name is invalid.
- `_aFilters[Generic_Game]=297`, one optional `Generic_Category`, and
  `Generic_ContentRatings=-` while mature results are hidden.
- `Generic_Newest`, `Generic_LatestUpdated`, `Generic_MostDownloaded`, `Generic_MostLiked` and
  `Generic_MostViewed` for the five offered orders.
- `_nRecordCount` describes the complete server filter. It is exact for one selected installable
  category and only an estimate for All because excluded root categories still require stable
  page-local filtering.
- `_bIsComplete` remains authoritative even when page-local safety filtering removes every row.
- List and category responses advertise a ten-minute cache lifetime. No useful validator was
  available, so an explicit refresh performs a normal cache-bypassing GET.

The production client encodes the full `contains,<term>` value as one query value. GameBanana exposes
no comma-escape syntax, so execs refuses comma-bearing terms instead of silently broadening them and
applies a local 128-Unicode-scalar bound. Most-downloaded responses order globally but omit download
counts; the UI retains that order and leaves the count unknown instead of issuing per-card requests.

## Implementation plan

1. Move all search, category, maturity and sort composition to the canonical native listing request;
   retain only stable safety filters and preserve upstream order.
2. Make metrics and dates nullable, model total provenance explicitly, and drive Next from completion.
3. Add bounded ten-minute native and renderer caches, request-bound state, real refresh/retry, stale
   labeling, and category hide/reopen recovery.
4. Restructure Mods into Browse, Installed and Casual setup tasks while preserving retained state,
   recovery warnings and the existing immediate-versus-draft write model.
5. Give each card explicit source, author, category, relevant metric/date, details, install progress,
   success and retry states. Put truthful pagination above and below the grid.
6. Refuse selected particle-source removal before direct or Absorb mutations on the 0.1.x global
   state path; preserve lock precedence, other sources, inactive profiles, snapshots and `_dir.vpk`.
7. Rebase the public-profile compatibility probe from stale v0.1.6 fixtures to immutable v0.1.7+2,
   then run the full local gate and a separate forward-port qualification.

## Evidence rules

- Deterministic fixtures and component tests establish request, state, focus and failure behavior.
- The bounded live smoke establishes only the current read-only API contract.
- Synthetic core fixtures establish file/profile invariants without touching a player's install or
  Steam Cloud.
- Browser screenshots establish hierarchy and reflow, not native accessibility or packaging.
- Windows/Linux screen readers, Linux WebKitGTK, signed installers and updater behavior remain release
  workflow/manual gates unless their exact environments are run and recorded.

## After audit

The completed browser fixture was inspected at 1200×800, 960×640 and 600×400 (the 200% zoom
equivalent for a 1200×800 window). Browser screenshots were reviewed during the audit; the structural
claims below are also covered by deterministic component tests and accessibility-tree inspection.

1. **Open Mods — healthy.** Browse is the default task. The compact status summary and recovery
   warning retain their priority without forcing Casual setup ahead of discovery.
2. **Browse and page — healthy.** Search, server sort, mature filter, reset and refresh stay together;
   the result scope is explicit, pagination appears above and below the cards, the top count uses a
   polite live region, and paging moves focus to the results heading. Search and refresh do not steal
   input focus.
3. **Inspect and install — healthy.** Cards identify GameBanana and the author, distinguish category,
   date and available metric facts, expose mod-specific View/Install labels, fall back cleanly when an
   image is absent or broken, and retain a failed install as a local retry state.
4. **Manage installed mods — healthy.** Installed content is a separate task with specific Remove and
   source actions. One Import mod dialog explains and offers archive/VPK or extracted-folder paths.
5. **Configure Casual — healthy.** Preload behavior, the default library, profile particle sources,
   skipped files, credits and stock restoration share one task; Apply appears only for a real draft.
6. **Reflow and zoom — healthy.** At both 960×640 and 600×400 the document and body client/scroll
   widths match exactly. Content remains vertically reachable with no document-level horizontal
   clipping. The existing compact shell navigation remains independently scrollable.
7. **Removal integrity — healthy in synthetic core fixtures.** Selected-source direct removal and
   Absorb Update refuse before profile, ignore-list, preload, snapshot or live-pack mutation. Lock
   precedence, unrelated sources, inactive profiles and the `_dir.vpk` invariant remain covered.
8. **Public-profile compatibility — healthy in the bounded probe.** An actual `v0.1.7+2` export imports,
   re-exports byte-for-byte and re-imports through the candidate core. Twelve files, four independent
   mod records, HUD metadata, nested cfg, ignored packs, shared blobs, hashes and the existing active
   profile are preserved; both synthetic TF2 roots and the source library remain unchanged.

## Verification record

| Gate | Result |
| --- | --- |
| `pnpm test` | Passed: cfglint 160, desktop 691, release scripts 23 passed / 3 skipped |
| Focused Mods browser/component tests | Passed: 26 |
| `pnpm check` | Passed across 341 files |
| Desktop production build | Passed; only the existing Vite chunk-size advisory remains |
| Rust format and clippy, all targets / locked | Passed |
| `cargo test --workspace --locked` | Passed: native 111 / 4 ignored, core 659 / 6 ignored, plus integration suites |
| Live GameBanana smoke | Passed against the canonical TF2 listing and name-search contract |
| Pinned real-HUD fixtures | Passed: 6, including install/update/payload preservation |
| Public `v0.1.7+2` compatibility probe | Passed with identical export ZIP and unchanged source/install trees |

## Explicit qualification gaps

- The browser fixture does not replace Windows WebView2 or Linux WebKitGTK interaction testing.
- NVDA, Narrator, Orca and keyboard-only packaged-app passes have not been run in their native
  environments.
- A signed Windows installer, Linux packages, updater path and an approved disposable real TF2
  install have not been exercised. Release workflow gates remain authoritative for those surfaces.
