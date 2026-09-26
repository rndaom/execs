# Foundry core panes — implementation review

final result: passed

Scope: Comfig, Binds and Gameplay. This is a scoped visual/interaction review, not the whole-application or release gate. Parent-owned integrated checks remain necessary.

## Visual truth and evidence

Source: [Foundry core board](../../options/01-foundry/01-core.png), 1672 × 941 pixels. The board contains four framed app views; its Comfig, Binds and Gameplay views establish composition, palette and hierarchy. The reference does not specify a CSS viewport or pixel density. Implementation captures are actual browser viewports at 1200 × 800 and 960 × 640 CSS pixels, devicePixelRatio 1. The source's presentation frame and four-up scale are excluded from pixel-perfect claims. The source and final three desktop images were inspected together in one comparison input at original pixels.

| State | Desktop evidence | Minimum-window evidence |
| --- | --- | --- |
| Comfig, Medium, Graphics | [01-comfig-1200.png](01-comfig-1200.png) | [08-comfig-960.png](08-comfig-960.png) |
| Comfig, Networking, scrolled | [09-comfig-networking-1200.png](09-comfig-networking-1200.png) | Category/options parity also checked by component tests |
| Binds, Movement | [02-binds-1200.png](02-binds-1200.png) | [06-binds-960.png](06-binds-960.png) |
| Binds, Jump recording | [03-binds-recording-1200.png](03-binds-recording-1200.png) | Same responsive two-column layout retained |
| Binds, Combat | All three commands covered by component/pure tests | [07-binds-combat-960.png](07-binds-combat-960.png) |
| Gameplay, World 90 / Viewmodel 70 | [04-gameplay-1200.png](04-gameplay-1200.png) | [05-gameplay-960.png](05-gameplay-960.png) |

Browser fixture URLs: `http://localhost:1420/?preview=settings-comfig`, `settings-binds`, and `settings-gameplay`. Every UI action in this pass used preview fixtures. No TF2 launch or real profile write occurred.

## Findings and corrections

- Resolved P2: Comfig's preview began under the page header. It now starts alongside the header, matching the reference's dominant composition. Its measured width is 360px at both target viewports.
- Resolved P2: long preset copy pushed module discovery below the minimum-window fold. The four featured summaries now state their tradeoff concisely. Module category tabs and the addon heading are visible at 960 × 640; the page continues through normal outer scrolling.
- Resolved P2: the initial Gameplay implementation put Advanced below the main options. Advanced now occupies the right column beside viewmodel/weapon controls, as in the reference. Compact FOV label/value rows and a single reference-image caption recover vertical space. At 960px, the hero spans 722px and Advanced begins around y455.
- Resolved P2: the previous bind recorder used an expanding page-wide announcement. Help is now local to the action. Captured DOM rectangles for all six Movement rows were identical in recording and idle states.
- No remaining actionable P0/P1/P2 issue was found in this scoped final pass. Original-pixel captures were readable enough to inspect key cells, selected rings, toggle descriptions and module segments; a separately enlarged raster crop was unnecessary.

## Five fidelity surfaces

| Surface | Result |
| --- | --- |
| Typography | Existing Inter, shared Foundry pane/section/body steps. Concise ledes and readable warm metadata. Long addon/rule descriptions wrap instead of clipping. |
| Layout rhythm | Narrow persistent sidebar; decision/360px preview hero; flat lower workspaces. Modules/addons and main gameplay/Advanced remain side by side at960. No horizontal page overflow observed. |
| Color/tokens | Shared Foundry tokens only. Warm dark surfaces, quiet hairlines, orange selected states and action emphasis. No pane-local color literals. |
| Images | Existing credited mastercomfig koth_sawmill images at natural16:9. Gameplay explicitly says it is a reference, not a live FOV preview. No generated or mathematically uncalibrated game rendering is shipped. |
| Copy/content | All real presets, module levels, addons and existing gameplay controls remain reachable. Combat has a separate category. No Restore defaults or false Apply action is invented. Full cfg-path context is retained as a quiet note. |

Intentional departures: two featured preset columns preserve readable text at native minimum size; the board's synthetic addon names are replaced by all eight real official addons; segment controls preserve the existing non-select pattern; Combat adds a truthful fourth bind category. Gameplay uses genuine art with honest semantics instead of the generated image's FOV geometry.

## Interaction and source verification

- CUA: bind category selection, Jump recording and Escape cancel, Networking module discovery/scroll, World FOV keyboard input (90 →89 →90), and screenshot comparison at both target sizes.
- Focused frontend tests: 68 passed across pane interaction and pure bind/gameplay/comfig helper suites. They cover category reachability, navigation cancelling capture instead of binding mouse1, local unbindable feedback, deferred saves while TF2 runs, failed Comfig selection retaining the committed preview, addon lock behavior, exact fractional viewmodel FOV retention, and gameplay-only acknowledgement of the new weapon controls.
- Native managed-cfg tests: five passed. New coverage proves Auto reload/Fast weapon switch share Gameplay scope without overwriting Crosshair/Sounds or personal bind bytes.
- An App hook-signature HMR update during parallel development produced a transient React hook-order error. Reload restored the current app. No fresh console warnings/errors were recorded in the final checkpoint. This was not a native launch verification.

The additions are grounded in the repository's pinned cvar corpus and Valve's pinned source revision `b8cfb12c0e083a2ef5b2f9f9b50f3902fa034474`:

- [c_tf_player.cpp](https://github.com/ValveSoftware/source-sdk-2013/blob/b8cfb12c0e083a2ef5b2f9f9b50f3902fa034474/src/game/client/tf/c_tf_player.cpp): `cl_autoreload`, default1, reload clip weapons while not firing.
- [weapon_selection.cpp](https://github.com/ValveSoftware/source-sdk-2013/blob/b8cfb12c0e083a2ef5b2f9f9b50f3902fa034474/src/game/client/weapon_selection.cpp) and [weapon_selection.h](https://github.com/ValveSoftware/source-sdk-2013/blob/b8cfb12c0e083a2ef5b2f9f9b50f3902fa034474/src/game/client/weapon_selection.h): `hud_fastswitch`, including alternate modes. Numeric source values survive unrelated saves; an explicit off/on interaction chooses0/1.
- Repository `packages/cfglint/src/cvars.gen.ts`: primary attack, secondary attack and reload command identities, alongside existing use/medic/voice actions.

Implementation checklist: scoped changes and tests complete; no commit made; parent to complete integrated app verification and changelog/spec updates. Remaining P3 opportunity: more authentic gameplay reference scenes, if separately sourced and licensed, could illustrate the distinction between world and weapon perspective without claiming calibrated live rendering.
