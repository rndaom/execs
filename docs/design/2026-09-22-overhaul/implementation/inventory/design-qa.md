# Foundry Inventory implementation QA

Final result: **passed**

This is the scoped browser-fixture visual handoff for the development-only Inventory pane and shared shell. It does not certify native Steam access, installed artwork, production release eligibility, or the full application.

## Evidence and comparison scope

Source visual truth: [Foundry states board](../../options/01-foundry/05-states.png), top-left Inventory panel. The entire source is 1672×941 raster pixels and contains four illustrative screens; it has no authoritative CSS viewport or device density. The implemented desktop and minimum captures are actual 1200×800 and 960×640 CSS viewports, respectively, at DPR 1. Their PNG dimensions match those sizes. No source pixels were stretched to claim a pixel-identical application frame.

Implementation: `http://localhost:1420/?preview=settings-launch`, then the real Inventory navigation action. This route supplies the existing browser fixture: five items, 300 slots, Preview player, and explicit Preview data copy. Native inventory mutations remain unavailable. The generated board's item names, artwork and 24-item count are illustrative; the implementation retains the authoritative 50-slot page model and real metadata policy.

The source and final desktop/minimum screenshots were opened together in one comparison input at original image detail. The top-left source panel and full implementation were compared for composition and the selected item, pager, item labels and navigation were examined within those readable originals. A separate crop was unnecessary: the source panel and the full-size implementation controls were readable in that combined input. This is an art-direction and responsive comparison, not a numeric pixel-diff claim.

| Capture | Size | Actual state |
|---|---|---|
| [01 initial density](01-inventory-1200.png) | 1200×800 | Initial ten-column grid, unselected; rejected density |
| [02 revised density](02-inventory-1200-revised.png) | 1200×800 | Seven-column grid, unselected; same viewport/state after fix |
| [03 selected paint](03-selected-paint-1200.png) | 1200×800 | Selected war paint, account row and toolbar visible |
| [04 selected minimum](04-selected-paint-960.png) | 960×640 | Five-column grid, selected detail beside the items |
| [05 expanded detail](05-expanded-item-960.png) | 960×640 | Item metadata disclosed and reachable while scrolling |
| [06 sticky controls](06-scrolled-grid-960.png) | 960×640 | Lower page-one slots with pager and selected detail retained |
| [07 corrected pagination](07-page-change-960.png) | 960×640 | Page two begins with slot 51 beneath the sticky pager; previous selection remains |
| [08 empty search](08-empty-search-960.png) | 960×640 | No matching items, focused search, disabled single pager, retained item detail |

## Findings and iteration history

1. **Resolved P2 — short item names clipped at desktop width.** In capture 01, ten grid columns beside a 240px inspector left cards about 63px wide and clipped even Scattergun. The source panel gives item previews materially more width. The grid now uses seven columns, then five below 1150px; item labels are 12px with two lines and safe long-word wrapping. Capture 02 repeats the original unselected state at the same 1200×800 viewport and confirms short names fit. Captures 03–04 confirm longer names remain discoverable through the full selected detail, accessible name and native title. Deliberate truncation of long card labels remains acceptable.
2. **Resolved P2 — paging from lower slots initially hid the new page's first slots.** The single sticky pager made the prior retained-scroll behavior easy to encounter. The parent approved revealing the first new slot when the displayed page actually changes. The pane now scrolls instantly to the grid with a 64px margin for the sticky pager, preserving keyboard focus and selection. Same-page sorting, initial reads, pane visibility and background refreshes do not move the view. Capture 07 confirms slot 51 is visible on page two, and the selected war paint remains in the inspector. The new behavior test also checks these exceptions.

No actionable P0/P1/P2 differences remain in the verified scope. The minimum-size sidebar scrolls independently, while App settings and the footer remain reachable. The pane has no horizontal overflow at either tested width. Inventory's main grid uses the shared outer scroll surface rather than an inner scrolling box.

## Required fidelity surfaces

| Surface | Assessment |
|---|---|
| Fonts and typography | The specified existing Inter family is retained. A 30px pane title, 16px detail heading, 14px body, 13px metadata and 12px dense item labels preserve readable hierarchy. Card truncation is intentional only for long labels; the selected detail wraps the full name. The generated source's exact font metrics cannot be established from its raster board. |
| Spacing and layout rhythm | The 180px sidebar, 24px content spacing, seven/five-column grid, hairlines and 4–6px corners carry Foundry's compact composition. The 240px detail surface stays beside the grid at both native sizes. The account identity row is an intentional product requirement absent from the board's pane because the board instead invented a global Steam identity. |
| Colors and visual tokens | Warm near-black surfaces, cream text and restrained orange selection match the selected direction. The selected item uses a ring, wash and dot. Preview warnings use the semantic warning token. Shared foreground contrast calculations are in [foundry-system.md](../../foundry-system.md); these are token calculations, not a whole-window accessibility certification. |
| Image quality and asset fidelity | Existing Phosphor navigation icons remain crisp. Browser fixtures cannot fetch the user's installed item art, so the UI correctly says Artwork unavailable and Pattern preview unavailable. Generated weapon/paint imagery is not copied into the application. Native artwork and genuine pattern swatches keep their original source; swatches explicitly cannot preview weapon geometry, wear or effects. |
| Copy and content | Actual item names, account identity, source attribution, 50-slot paging and read-only rules take priority over invented board content. Development preview and Preview data are explicit. There are no equip, trade, rearrange or item-edit controls. Empty search explains the result without discarding the current selected detail. |

## Interaction and implementation checks

- Actual UI actions: selected a paint, expanded its item metadata, scrolled the main region, paged from lower slots to page two, and entered a query with no matching item. The single pager, selected detail and native-sized frame were visually inspected.
- Read-only DOM checks confirmed DPR 1, the requested CSS sizes and document width equal to the viewport. Capture 05's expanded detail remained within the visible minimum frame after scrolling.
- The final settled preview console returned no warnings or errors. Earlier React hook-order errors occurred during shared App hot edits and cleared after reload; those interrupted attempts are not evidence of the final state.
- Three InventoryPane tests cover stale-snapshot retention, selected unplaced artwork and refresh/paging continuity, and page-change scrolling with same-page/visibility/background-read exceptions. Inventory pure-logic tests and shared shell behavior tests remain part of the targeted verification set.
- Browser viewport overrides were reset after the pass, and the dedicated test tab was closed.

## Remaining evidence limits

The existing preview bridge has no explicit stale/error Inventory state. Stale-snapshot retention is tested with a rejected API response; no screenshot here claims a real disconnected-Steam state. Native automatic reads, account changes, real avatar/art decoding, very large backpacks and OS-specific webview rendering remain native verification work. Inventory remains development-only and account-owned, with no new release assignment.

Implementation checklist: keep the authentic asset and account boundaries; retain the tested instant page-change behavior; include this scoped evidence in the parent integration review. No additional visual change is required for this handoff.

final result: passed
