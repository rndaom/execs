# Focused interaction completion audit

September 22, 2026. Follow-up to the [integrated review](../../design-qa.md), on the shared Foundry shell. This pass found and corrected one P2 profile-menu reflow defect. It also added actual-browser evidence for pane scroll retention and profile reset. It does not supersede the original reports or extend their native qualification.

## Why these checks

The existing scoped evidence already establishes Binds key recording/cancel and Gameplay keyboard changes ([core](../core/design-qa.md)); screenshot-viewer keyboard and focus restoration ([HUD](../hud/design-qa.md)); Files navigation drafts and transition protection ([shell/Files](../shell-files/design-qa.md)); safe profile review focus and choices ([profiles](../profile-management/verification.md)); and both the app Reduce preference and OS reduced-motion override through computed styles ([App settings](../app-settings/design-qa.md)). These adequate checks were not repeated.

Empty/recovery and unavailable-source coverage is documented by the existing onboarding, Inventory, HUD and customization reports and their component tests. Those records distinguish captured fixtures from failures established only by tests. This pass does not turn test-only evidence into visual evidence.

Two useful browser gaps remained: enlarged-interface reflow, and actual pane scroll retention/reset. The review gallery's Fit/100% control only changes image presentation and is not application zoom evidence. RND-291 had meaningful component coverage but no explicit browser transition/reset record.

## P2 resolved: profile actions clipped at narrow reflow

At 480×320 CSS pixels, the previous menu extended from x102.91 to x532.91 and from y55.50 to y332.97. New profile, profile actions and Save extended beyond the right edge. [Before correction](03-profile-menu-reflow-clipped-480x320.png) shows the clipping.

The panel now uses a viewport inset below 560px and bounds its height at every width. At 480×320 it spans x16–446 and y56–304. Its 246px client height scrolls 275px of content. All right-side actions fit; vertical scrolling exposes the footer actions. Tabbing to Change install scrolls the panel to 21px and places the button at y255.78–295.47, including a complete visible focus outline. Escape closes the panel and returns focus to the summary. No destructive or native action was invoked.

At 1200×800, the panel retained its original anchored placement, approximately x110.91–540.91 and y56.30–333.77. A separate 600×400 CSS viewport also retained reachable actions. The source change is limited to the profile-panel class and shared positioning/scroll CSS. An Unreleased note records the user-facing correction.

The original [Foundry profiles board](../../options/01-foundry/04-profiles.png) and corrected captures were inspected together. The menu retains the selected direction's warm overlay, compact list, hairlines, copper primary action and real labels. The concept does not specify this narrow reflow state; the viewport inset is a functional adaptation, not a claim of pixel identity. Existing profile export remains in each profile's actions rather than copying generated functionality.

## Pane scroll result

At 1200×800, the browser observed Comfig at scrollTop **196**, Launch at **0**, and Comfig again at **196**. This covers the shorter-pane clamping case. A second profile, Scroll review, was created using Save current as in the disposable preview only. Switching to it changed the active identity and reset the customization scroll to **0** after progress completed. No scroll implementation change was needed.

All actions used `http://localhost:1420/?preview=settings-comfig` and its in-memory preview bridge. There were no real profile, installation, Steam or TF2 writes.

## Accepted captures

| Capture | Actual CSS size, DPR 1 | Evidence |
| --- | --- | --- |
| [01 Comfig reflow](01-comfig-reflow-600x400.png) | 600×400 | Shell and main content under reduced available width/height. |
| [02 profile menu](02-profile-menu-reflow-600x400.png) | 600×400 | Original menu fits this larger reflow case. |
| [03 clipped profile menu](03-profile-menu-reflow-clipped-480x320.png) | 480×320 | Pre-fix failure, retained as evidence; not an accepted final state. |
| [04 contained profile menu](04-profile-menu-reflow-fixed-480x320.png) | 480×320 | Post-fix horizontal containment and vertical scroll. |
| [05 keyboard-reached footer](05-profile-menu-keyboard-480x320.png) | 480×320 | Post-fix Change install focus and full action visibility. |
| [06 restored Comfig position](06-comfig-scroll-restored-1200.png) | 1200×800 | Main profile restored to scrollTop 196 after Launch. |
| [07 profile identity reset](07-profile-scroll-reset-1200.png) | 1200×800 | Scroll review active, Comfig reset to top. |

The 600×400 and 480×320 viewports are the effective CSS space corresponding to 200% enlargement of 1200×800 and 960×640 respectively. They are **reflow tests, not direct native zoom tests**. A browser zoom shortcut did not change the observed 1200×800/DPR 1/visualViewport scale 1 metrics, so it was not accepted as zoom evidence. Native zoom and OS text scaling remain unverified.

## Validation

- Targeted Biome: `ProfileMenu.tsx` and `index.css` passed.
- Desktop TypeScript: `pnpm --filter @execs/desktop exec tsc --noEmit` passed.
- The completed browser session returned no warning or error console entries.
- No CSS-literal unit test was added; the regression is verified through actual geometry, screenshots and keyboard interaction. Existing scroll behavior tests were not redundantly rerun because scroll code did not change.
- Temporary viewport override was reset and the dedicated test tab closed.

**Final result: passed for this bounded browser scope.** One P2 was corrected; no additional P0/P1/P2 issue was found in these checks. Native release, engine and platform qualification remains separately owned and unchanged.

## Follow-up: inactive-library clipping, resolved

The parent review identified that the first correction assumed the active workspace's header offset. A second bounded browser pass reproduced a P2 in the inactive library. This section and captures 09–13 describe the **final positioning implementation**; captures 04–05 remain historical evidence for the first correction and should not represent the final narrow-menu geometry.

The disposable `inactive-library` preview was extended through its UI to six saved profiles, with no active profile. At 960×640 the menu ran from y111.50 to y546.97, while its `overflow: hidden` ReadyPanel ancestor ended at y450. This clipped Save and hid Import/Change install even though the whole menu fit the viewport. At 600×400 the former height calculation also let the panel extend to y439.50 below the viewport. [Capture 08](08-inactive-six-profiles-clipped-960.png) records the pre-fix failure.

`ProfileMenu` now measures its summary and positions the overlay against the viewport at every width. It clamps horizontal position to a 16px inset, preserves the 10px anchor gap when space allows, and calculates the scrolling height from the measured top with a 16px bottom inset. A very low anchor moves up enough to retain a usable scrolling region. Measurement runs on opening, component renders, resize and captured scroll events. Fixed positioning escapes the inactive shell's clipping ancestor. The existing explicit Choose profile request, initial profile focus, outside dismissal and Escape restoration remain intact.

| Final check | Observed geometry / result | Evidence |
| --- | --- | --- |
| Six inactive profiles, 960×640 | Panel x150.91–580.91, y111.50–546.97; Save, Import and Change install are now visibly unobstructed. | [10 minimum-size menu](10-inactive-six-profiles-fixed-960.png) |
| Six inactive profiles, 600×400 | Panel y111.50–384; keyboard-reached Change install y328.28–367.97, complete focus outline. | [09 short-window keyboard](09-inactive-keyboard-fixed-600.png) |
| Six inactive profiles, 480×320 | Panel x34–464, y111.50–304; keyboard-reached Change install y252.28–291.97. Escape closes the panel and focuses `SUMMARY`. | [11 final narrow keyboard](11-inactive-keyboard-fixed-480.png) |
| Same library after activating Main, 1200×800 | Anchor bottom y46.30; panel top y56.30 and left x110.91, retaining normal active-header alignment after the layout transition. | [12 active menu](12-active-six-profiles-fixed-1200.png) |
| TF2-running fixture banner, 960×640 | Anchor bottom y84.98; settled panel top y94.98. Placement follows the actual banner offset. | [13 banner offset](13-banner-offset-fixed-960.png) |

All images use actual requested CSS viewport dimensions with DPR 1. Captures 10 and 11 were inspected alongside the unchanged Foundry profiles board. The correction preserves its compact warm overlay and hierarchy; the generated board does not define an inactive six-profile layout or narrow reflow. Use **capture 11** for the final 480px gallery supplement, and **capture 10** for the inactive minimum-size case.

The existing ReadyPanel component suite passed **10 tests**, including the explicit library-opening/focus behavior. Targeted Biome and desktop TypeScript passed again. Actual browser geometry and keyboard checks establish the layout regression; no test that merely repeats CSS was added. The settled browser console returned no warnings or errors. No production build or native UI action was run in this follow-up.

The only follow-up product edits are measured sizing/positioning in `ProfileMenu.tsx` and its shared CSS. The inactive-library CTA and other profile-management behavior were preserved. Fixture changes were browser-memory only: profiles were created through Save current as, a temporary active fixture profile was removed with the keep-installed choice, and the resulting six-profile inactive library was inspected. Navigation discarded that temporary state; the viewport override was reset and the dedicated tab closed. No player library, installation, Steam or TF2 file was read or changed by these UI actions. Native zoom/text scaling and packaged validation remain outside this browser result.
