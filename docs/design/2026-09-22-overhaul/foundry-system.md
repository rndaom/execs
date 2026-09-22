# Foundry implementation contract

The selected target is `options/01-foundry/01-core.png` through `05-states.png`. Product behavior remains authoritative over generated labels, as recorded in [concept-review.md](G:/Projects/execs/docs/design/2026-09-22-overhaul/concept-review.md). This document describes the shared implementation in progress; integrated browser verification remains required.

## Shared tokens

All color, type, radius and motion tokens live in [index.css](G:/Projects/execs/apps/desktop/src/index.css).

| Token | Value / use |
|---|---|
| `bg`, `panel`, `panel-raised` | `#151310`, `#211e19`, `#2c2821` |
| `ink`, `ink-muted`, `ink-faint` | `#f0e9db`, `#bcb3a3`, `#a79c8b`; faint remains readable body metadata |
| `brand`, `brand-hover` | `#d98449`, `#e69a61`; action and selection |
| `ok`, `warn`, `error` | `#9fbd7d`, `#e3bb78`, `#ec9185`; actual semantic state only |
| `danger`, `danger-hover` | `#a9453c`, `#943f36`; destructive button fills with warm ink, distinct from readable error text |
| Borders | Warm ink at 10% / 20%; control focus uses a solid brand outline |
| Corners | 4px controls; 6px media/tiles/overlays; true circular controls remain round |
| Typography | Existing Inter; pane 30/700, section 16/600, row 14/600, body 14px, metadata 13px, eyebrow 11px |
| Layout | Sidebar 180px; content max 1160px including 24px side padding; section gap 28px; hero preview 360px |
| Motion | Opacity/color 150ms; local movement 220ms; no repeating decoration |

The sidebar stays vertical at the native 1200×800 and minimum 960×640 sizes. Below 760px it becomes an icon rail with accessible labels and titles. Navigation scrolls separately from the utility slot; no horizontal tab strip appears at 1024px. Two-column helpers stack below 900px viewport width. The main scroll surface deliberately has no CSS size containment, because that would change fixed dialog positioning.

Computed foreground contrast across the three solid surfaces is at least 12.13:1 for ink, 7.06:1 for muted, and 5.42:1 for faint. The destructive button has 4.82:1 text contrast, increasing on hover. These token calculations do not certify every composed, disabled, image-overlay or native state.

## Layout hooks

| Class / component | Contract |
|---|---|
| `PaneHeader` / `.pane-header` | Title and optional concise lede; wrapping right-side actions; 24px following space, or 12px with `compact` |
| `PaneSection` / `.section` | Flat section, hairline, 28px separation and 20px inner top space |
| `.hero-row`, `.hero-preview` | Main decision + 360px source-owned preview; remains side by side at 960px |
| `.pane-split` | Two equal flexible columns, 24px gap |
| `.pane-workspace` | Flexible main column + 240–300px inspector, 24px gap |
| `.pane-toolbar` | Wrapping discovery/control row, 12px gap and vertical space |
| `.pane-actions` | Wrapping button group, 8px gap; does not determine save semantics |
| `.pane-note` | Quiet explanation with a left hairline; no decorative card |
| `.action-panel` | Real preview/build/action surface; neutral panel, 12px padding |
| `ApplyBar` / `.apply-bar` | Sticky explicit-action row in normal flow; no extra 64px spacer; status and actions wrap |
| `.surface`, `.overlay`, `.field`, `.tile`, `.thumb` | Existing shared names retain their behavior and receive Foundry surfaces/corners |
| `.input` | Standard field with 36px minimum height and 6px/10px padding; does not force width |
| `.btn-primary`, `.btn-ghost`, `.btn-quiet`, `.btn-danger` | 36px minimum action targets, clear semantic styling |
| `ClassTabs` | Existing API and keyboard navigation; orange underline for selected tab; real space before count metadata |
| `Segmented`, `OptionTile`, `Switch` | Existing real radio/checkbox/switch semantics; selected rings and finite thumb movement |
| `Modal` | Existing trap, stack and restore behavior; optional `initialFocusRef` designates a contained, enabled safe initial action |

Files keeps a full-width `.settings-content[data-pane="files"]` with 16px outer padding. Its bounded editor and source font remain separate pane concerns. These helpers do not impose a uniform card layout on different tasks. Keep original labels, source attribution, numeric ranges, autosave versus explicit actions, and honest unavailable-art states.

## Shell integration

`SettingsLayout` retains `tab`, `onTab`, and `children`, and adds three optional props:

```tsx
<SettingsLayout
  tab={settingsTab}
  onTab={setSettingsTab}
  scrollIdentity={confirmedInstallAndActiveProfileIdentity}
  utility={appSettingsAction}
  page={showAppSettings ? "app" : null}
>
  <SettingsHost visible={!showAppSettings} ... />
  {showAppSettings ? <AppSettingsPane ... /> : null}
</SettingsLayout>
```

Pass a stable compound confirmed-install/profile identity from App. Changing it resets customization-pane positions. Inventory remains account-owned and App settings remains global; both are excluded from profile-scroll resets. Navigation saves each pane's outer scroll before React hides that pane, so a shorter destination cannot erase the old position. Returning restores it without remounting children or changing drafts. A delayed layout may complete a pending restoration, but deliberate pointer/wheel/touch/key input cancels that restoration. Files' internal editor scroll remains Files-owned.

`utility` accepts parent-owned App settings controls beneath the scrollable navigation. Use `.settings-nav-item`, an icon, and `.settings-nav-label` for the same compact treatment. SettingsLayout does not own app preference persistence or profile state. Stable DOM hooks are `.settings-shell`, `.settings-sidebar`, `.settings-nav`, `.settings-scroll`, `.settings-content`, and `.settings-pane`; `data-testid` pane/tab names remain intact.

`page="app"` gives the global page its own scroll position and removes selection from profile-pane navigation. Parent-owned routing preserves the hidden SettingsHost and its drafts. App settings' utility control supplies its own active state.

## Inventory workspace

The development-only Inventory uses a compact account identity row, then a slot grid beside a sticky 240px item-detail surface. It keeps all 50 slots per page; the grid has seven columns at full desktop width and five below 1150px. One sticky page control stays reachable while browsing. A displayed page change instantly reveals the first new slot beneath that control; same-page sorting, initial reads, visibility and background refreshes leave the position alone. There is no inner grid scroll box. The account snapshot, selection, sort, quality filter, stale/error behavior and artwork batching remain unchanged.

Item names have two readable lines plus their full accessible name/title and selected detail. Supplied native artwork is shown as-is; absent art has an honest unavailable state. Installed pattern swatches explicitly disclaim a weapon/wear/effect preview. The pane exposes no inventory mutations and remains outside a release assignment.

## Motion and accessibility

`.enter-fade` is a finite 150ms opacity entrance. `.menu-enter` adds at most 4px over 220ms; `.overlay-enter` adds at most 6px. No scale/bounce, permanent compositor promotion, list staggering or progress loop is added. Radio/selected values and focus update immediately; motion never acknowledges a write. The full [motion specification](G:/Projects/execs/docs/design/2026-09-22-overhaul/research/motion-spec.md) remains the acceptance guide.

Both OS `prefers-reduced-motion: reduce` and a root `data-motion="reduce"` disable all CSS animations/transitions and smooth scrolling, including pane utility classes. Parent-owned App settings applies/removes the data attribute. No scripted animation API bypasses this override. Existing keyboard behavior, dialog guards, focus restore, and enabled/disabled semantics stay intact.

## Validation ownership

Shared behavior checks cover pane scroll retention, short-pane clamping, profile/install reset, account-owned inventory position, delayed layout restoration and retained children. Existing Modal/Toast/draft lifecycle tests guard shared behavior. CSS changes are verified through the integrated desktop/minimum-window browser passes rather than tests that merely repeat CSS literals. Integrated visual QA is parent-owned; this contract alone is not a claim of pixel fidelity or release readiness.

Completed checks: 30 targeted tests across SettingsLayout, Modal, Toast, retained-pane interactions, InventoryPane and inventory-ui; TypeScript; targeted Biome; whitespace checks. Directly reviewed shared styling in saved HUD catalog, installed-options and replacement-dialog captures at 1280×720; core Comfig/Gameplay, Mods and App settings at 960×640. Inventory's actual 1200×800 and 960×640 captures passed its [scoped visual QA](G:/Projects/execs/docs/design/2026-09-22-overhaul/implementation/inventory/design-qa.md), including selection, expanded details, sticky paging and empty search. Parent-owned integrated application/native verification remains separate.
