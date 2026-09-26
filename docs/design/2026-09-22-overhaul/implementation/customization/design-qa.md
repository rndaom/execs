# Foundry customization implementation QA

Reviewed against `options/01-foundry/02-customization.png` and `concept-review.md` on 2026-09-22. The reference board and rendered captures were inspected together. These are production pane changes exercised with browser fixtures, not a separate mock application.

## Result

Crosshair, Viewmodels, and Sounds use the Foundry surfaces, Inter typography, Phosphor icons, selected rings, and restrained orange actions. The panes retain different task layouts: designer and scene, class groups and scene, and two sound slots above a searchable library. No horizontal overflow was observed at 1200 × 800 or 960 × 640; every recorded capture includes a measured viewport.

No unresolved P0/P1/P2 visual issue was found in the captured states. Longer control collections use the pane's normal vertical scroll. Native compilation, OS file pickers, and audio audition require the desktop app and are not certified by these browser captures.

## Accepted captures

All paths below are relative to this directory.

| Surface / state | Standard window | Minimum window |
| --- | --- | --- |
| Crosshair designer, live scene and Save to library | `crosshair-designer-1200-final.png` | `crosshair-designer-960-final.png` |
| Stock crosshair and color | `crosshair-color-1200-final.png` (custom color picker expanded, scrolled) | `crosshair-stock-960-final.png` |
| Custom source shapes and Build pack | — | `crosshair-custom-960-final.png` |
| Weapon override popup | — | `crosshair-overrides-960-final.png`, `crosshair-overrides-pda-960-final.png` |
| Scout groups and preview | `viewmodels-scout-1200.png` | `viewmodels-scout-960-final.png` |
| Soldier visibility | `viewmodels-soldier-hide-weapon-1200.png` | `viewmodels-soldier-hidden-960-final.png` |
| Sound slots and library | `sounds-default-1200-final.png` | `sounds-default-960-final.png` |
| Sound search, assignment and advanced controls | `sounds-filtered-assigned-1200.png`, `sounds-advanced-1200.png` | — |

Other PNGs in this directory are iteration evidence. In particular, `sounds-1200-refined.png` caught a live integration refresh returning to Crosshair and is not accepted Sounds evidence.

## Refinements found through visual checks

- Moved crosshair mode choices into the pane header and compacted designer slider rows. The scene remains adjacent to the editing controls.
- Moved Save to library beside the scene so the next action is visible at 960 × 640. The card changes to Build pack only after the design has been saved into the draft library.
- Styled the previously unstyled `.input` fields through the shared UI owner. Hex input uses Inter, matching the application.
- Fixed the weapon override picker clipping below the footer. Its portalled grid fits the viewport, opens above low rows, follows scrolling/resizing, supports arrow/Home/End/Escape keys, and closes when the pane is hidden. The PDA capture measured its bounds at y=255.6–427.5 inside a 640 px window.
- Kept sound slots readable when off, reduced unnecessary library spacing, and put pitch/repeat controls before the catalog so they remain discoverable.
- Added recovery for failed sound-source reads without throwing away usable cached entries.
- Cancelled PNG decoding and released object URLs when import controls unmount or Crosshair is hidden.

## Deliberate differences from the generated board

- In-game and Custom are real modes. Shapes, My designs, Community, and Import PNG retain their existing source behavior. Design geometry and names are local drafts; Save to library and Build pack remain separate actions. Color/display size retain their existing autosave behavior.
- The designer retains all ten styles and all geometry controls. Stock crosshair controls and per-weapon overrides remain available; no options were removed to match the limited generated example.
- Viewmodels retains all nine classes and all 64 existing groups. Show, Hide weapon, and Hide all change the selected class membership while the existing hide mode applies to all hidden groups in the pack; the UI discloses that rule. Secondary, melee and PDA groups remain accessible through disclosures.
- Show and Hide all retain genuine pinned CompVMInstaller screenshots and native caching. Hide weapon explains that the built pack hides the weapon and keeps the hands visible; it shows no image because upstream has no accurate hands-only capture.
- The sound library has one Hit/Kill assignment pair per row. Boost options remain visible for stock effects but are disabled with an explanation; custom files support 0/+6/+12 dB. Existing pitch, repeat delay, own WAV, source filters, sort options, and removal remain intact. Browser-only audition and native pickers are truthfully unavailable.

## Behavior and validation

- Browser fixture flow: edited a design name and length, saved it to the library, observed the unapplied draft/launch guard, then explicitly built the pack and observed `Crosshair saved` and the cleared guard. Navigation preserves unfinished designer values.
- Browser fixture flow: changed Soldier from Show to Hide weapon and Hide all, verified the corresponding truthful preview captions and enabled explicit build action, and retained the draft after navigation.
- Browser fixture flow: searched `quack`, assigned the result to Kill, observed the selected slot and automatic save, then used Browse to focus the search field. Advanced pitch/repeat controls remained reachable.
- Targeted regression coverage totals 90 passing tests across 16 suites (the 89-test consolidated customization batch plus PNG cleanup). The final picker/PNG follow-up run passed all 3 affected tests.
- `pnpm exec tsc --noEmit` passed after shared integration settled. Biome passed for all 24 owned files; the final picker/PNG follow-up passed formatting and lint.
- The final cold-reload browser pass produced no new runtime error. Earlier captured errors were live Vite integration/HMR refreshes; they were not accepted as final-state evidence. The temporary viewport override was reset and the dedicated test tab was closed.

## Files and release note suggestions

The implementation is in `CrosshairPane.tsx`, `StockCrosshairSettings.tsx`, `ViewmodelPane.tsx`, `SoundsPane.tsx`, their tests, `crosshair/*`, and the viewmodel UI/preview helpers. Shared draft registration uses `useExplicitDraft` from the Mods/UI coordination work. No native write target, IPC API, or release version was changed by this slice.

Suggested user-facing notes for the integration owner:

- Redesign Crosshair, Viewmodels, and Sounds with Foundry workspaces, adjacent previews/actions, and a clearer searchable sound library.
- Keep unfinished crosshair designs and viewmodel selections available for review before leaving or launching TF2; pack builds remain explicit.
- Keep weapon crosshair pickers within the window and improve their keyboard navigation; cancel hidden PNG imports and allow failed sound sources to retry.
