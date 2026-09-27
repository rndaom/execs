# Foundry Mods — implementation QA

final result: passed

This result covers the scoped Mods frontend comparison and interactions. It is not release qualification or completion of RND-324; its engine and native trace gaps remain open in [the startup investigation](../../research/rnd-324-preload-startup.md).

## Comparison target and provenance

- Visual truth: [Foundry Workspaces board](../../options/01-foundry/03-workspaces.png), top-left Browse and top-right Casual setup, reconciled through [concept review](../../concept-review.md). The board is 1672×941 and contains four independently scaled panels; it is not a 1672×941 application viewport. Its small generated type, made-up catalog metadata, toggleable installed packs and generic particle modes are not implementation contracts.
- Implementation: `http://localhost:1420/?preview=settings-mods`, browser preview fixtures, shared Foundry branch. Captures are browser-rendered 1280×720 CSS/PNG pixels at 1×, plus the shipped 1200×800 default and 960×640 minimum. No image enlargement or asset synthesis used for comparison.
- The source board and implementation captures were opened together in the same comparison input before both final judgments. Full-view composition was compared by corresponding pane regions, not pixel subtraction across differently sized panels. Card text/actions, task strip and Casual rows are readable at captured resolution; the scrolled Casual capture supplies the focused source/action view.
- Latest visual evidence: [Browse](20-browse-dense-final-1280.png), [rocket search](21-browse-rocket-final.png), [minimum Browse](22-browse-dense-minimum-960.png), [Casual header/repair](19-casual-final-1280.png), [Casual sources](25-casual-sources-final-type.png), [remove review](23-remove-final.png), [Import mod](26-import-cancel-focus-final.png).
- Preview data is visibly labeled. The existing fixture's orange-circle thumbnail and absent previews do not represent verified mod artwork. Production cards retain returned source images, handle missing/broken art honestly and do not use generated concept game art. Native GameBanana downloads and TF2 appearance were not exercised here.

## Findings and iteration history

| Severity | Earlier evidence and impact | Fix and post-fix evidence |
| --- | --- | --- |
| P2, fixed | [First Browse pass](01-browse-first-pass.png): duplicated headings and expanded filter/scope chrome pushed useful results down. | Compact PaneHeader, one primary toolbar, content-filter disclosure, inline result metadata/pager, and expandable safety scope. [Default-size capture](15-browse-default-1200.png), then [final Browse](20-browse-dense-final-1280.png). |
| P2, fixed | Initial browser render omitted category chips because the StrictMode effect replay stranded an invalidated request in loading state. | Track the active category request and restart an orphaned load. Categories visibly return in [final Browse](20-browse-dense-final-1280.png); StrictMode regression passes. |
| P2, fixed | Separate card footers created roughly 300px cards, materially reducing the board's catalog density. [Before](18-browse-final-1280.png). | Named install/retry button moves into the image corner; the title links to details. Real metadata remains. [After](20-browse-dense-final-1280.png). First result install controls remain visible at [960×640](22-browse-dense-minimum-960.png). |
| P2, fixed | Earlier Casual layout spent excessive space on repeated section headings and an always-expanded addon list. [Before](09-casual.png). | Direct switches, collapsed Addons disclosure, expanded particle choices, source summary and explicit Apply/Restore alongside selections. [After](19-casual-final-1280.png), [source region](25-casual-sources-final-type.png). All library/profile sources and skipped reasons remain available. |
| P2, fixed | Existing skipped-file report used the source editor's monospace treatment outside Files. [Before](24-casual-sources-final.png). | Inter metadata, readable wrapping and normal row rhythm. [After](25-casual-sources-final-type.png). |
| P2, fixed | Small-pack removal was immediate, and cached hidden task modals could retain focus. | All removals get named review, Cancel initially focused, current lock/protected-source checks repeated, hidden task closes its modal. [Review evidence](23-remove-final.png) and targeted tests. Import likewise focuses Cancel through the shared Modal API. [Import evidence](26-import-cancel-focus-final.png). |

No actionable P0/P1/P2 visual mismatch remains in this scoped frontend pass. The source board omits actual source groups, cache/recovery/repair requirements and fixture disclosures; those are retained as intentional production constraints.

## Required fidelity surfaces

| Surface | Assessment |
| --- | --- |
| Fonts and typography | Uses shared Inter hierarchy. Pane title, compact rows and metadata remain distinct. Full installed names wrap; source/skipped text does not rely on truncation. The board's tiny generated text is replaced with real-size readable type. |
| Spacing and layout | Underlined task strip, compact discovery tools, image-led grid and optional installed summary follow Foundry. Three columns at desktop; two and wrapped toolbar at 960px; summary collapses below XL while Installed stays one task away. Natural pane scroll handles long source lists and 640px height without horizontal overflow. |
| Colors and tokens | Shared near-black/warm surfaces, cream ink, thin borders and restrained orange action/selection markers. Existing semantic repair warning remains differentiated. No new palette, gradient or custom drawn icon introduced. |
| Images and icons | Real returned catalog thumbnails keep a 2:1 crop; unknown/broken sources show a Phosphor image icon and No preview. No made-up rocket artwork, review score, installed thumbnail or enabled toggle copied from the concept. Existing fixture-only art is explicitly labeled Preview data. |
| Copy and content | Browse/Installed/Casual setup and explicit Import, Apply, Restore and Remove actions preserved. Added and updated dates remain distinct; unavailable facts are absent rather than zero. Offline preload behavior is disclosed, and no generated wording implies a proven no-map startup. |

## Interaction and correctness evidence

- Browser: search, source/category chips, filter disclosure, fixture install → installed count/card/summary update, Installed task, named removal review/cancel, Import choice/cancel, Casual source selection → explicit draft guard → Apply → cleared draft, and numbered request paging above/below results.
- Browser DOM confirmed Cancel receives initial focus in removal and import; pagination focuses the results heading, while search retains its input focus. Hidden retained panes do not keep their local dialogs open.
- Current fixture search is global but All-category totals remain estimated; the safety explanation is available under About these results. Search/filter/sort remain usable while writes are locked.
- Fresh browser reload and the final interaction pass reported no warning/error console entries. Earlier HMR failures during parallel incomplete edits were cleared by reload and are not used as product evidence.
- 59 scoped Vitest checks pass across ModsPane, ModList, GameBananaBrowser, browser hook and pure UI logic. They cover cache/paging/StrictMode, failed-install retry, all-size removal/lock changes, current-profile source containment, repair lifecycle, local-only library gating, ordered source precedence, explicit draft registration and HUD review routing.
- An additional integration pass covers the real SettingsHost, Mods pane, cards, toast and native-close guard with only IPC substituted. All 23 Host/exit-guard checks pass; the focused run including existing browser/pane/selection regressions is 62/62. It caught and fixed two recovery defects: a handled HUD download also showed a misleading card Retry, and a delayed HUD import refusal could appear after another profile loaded. Distinct handled-review/superseded outcomes now clear card state without success feedback. All three HUD error codes retain profile identity, archive/folder imports offer one actionable Review in HUD alert, and a new attempt clears prior guidance. These are renderer integration tests, not native import evidence.
- Explicit Mods/Crosshair drafts offer Open pane, Discard and Cancel, with Cancel initially focused and no unusable Save and continue action. Native close does not partially flush unlocked settings when a heavy draft needs review. Mixed Files/settings drafts retain exact bytes on Cancel; after the explicit draft resolves, saves finish before close. Discard remains blocked during a registered native write.
- TypeScript `tsc --noEmit` and scoped Biome checks pass. Core integration run by the HUD agent confirmed all 19 viewmodel fixture tests pass, including the cfg observability and launch-token regressions. That run's remaining failures belonged to concurrent HUD expectations, subsequently addressed by that owner; it is not reported here as a passing full release suite.
- Source-order draft identity now matches the backend's later-source precedence. Toggling a selected source off/on can no longer erase a priority-only unapplied change.

## Remaining qualification outside this pass

- SettingsHost routing and its real rendered recovery actions pass the IPC-boundary integration regressions. The native archive/folder/VPK handoff, including actual HUD detection and author payloads, remains a qualification case.
- Actual install/import/remove, Steam verification, crash recovery and real game-running refusal need the cumulative native matrix. Browser fixture actions do not write player files.
- RND-324 remains open: no verified no-map preload replacement, no retail-TF2 initialization/re-entry/failure trace, and no PresentMon exclusive-fullscreen/D3D9Ex independent-flip capture.
- Motion uses shared finite transitions and immediate focus changes. No new repeating animation was added; an integrated reduced-motion/native idle-performance trace remains owned by the application-wide gate.

Follow-up polish: authentic catalog-thumbnail composition should be reviewed with current network data during native qualification; do not replace missing art with concept imagery to make fixture screenshots look richer.
