# Foundry onboarding — implementation review

final result: passed

Scope: `OnboardingFrame`, `FinderPanel`, `FirstRunExisting`, and `SetupWizard`. This is a scoped production-UI review; parent-owned integrated application checks remain separate. No native profile operation or TF2 launch is used in this review.

## Reference and composition

The bottom-left view of [Foundry profiles and setup](../../options/01-foundry/04-profiles.png) is the visual target. Its three real setup phases lead into one bounded surface containing location, detected customization, profile name, and the save action. The reference is a 1672 × 941 four-view presentation board rather than a specified CSS viewport. Screenshot comparisons use actual 1200 × 800 and 960 × 640 browser viewports; they do not treat the board's frame or synthetic labels as production requirements.

- Existing setup follows the reference's centered heading, static setup status, and grouped location/reasons/name surface. The full confirmed path is visible. Save remains beside the name, with no install/import alternative on this screen.
- Finder uses the same frame and an explicit location-confirmation surface. Selecting a detected path only selects it; Confirm install remains a distinct action. Browse is available when discovery finds no installation.
- The unused-install wizard puts the heading and setup status side by side, followed by the name/action row and a preset/addon workspace. This keeps the four core presets visible at the minimum native window size while preserving every expanded choice.
- Create-new retains the existing Current setup / Fresh TF2 decision, supplied only when the application has a valid active profile. It does not introduce a new sequence of wizard pages or imply that a new profile already exists.

## Geometry and corrections

An initial wizard layout left the selected preset below the 960 × 640 fold. The compact heading/status arrangement and a single selected-preset performance/fidelity summary corrected this without removing a preset or addon. At the measured minimum-window pass, the four core presets were fully visible, with the selected Medium tile spanning approximately y510–581. The existing-setup form spanned y300–552 and its save action y470–508. Final original-pixel captures confirm both compositions; no horizontal page overflow was observed. Longer addon and expanded-preset lists use the outer page scroll.

Intentional differences from the generated board: the save button has a stable, concrete label instead of repeating an arbitrarily long draft name; real profile/cfg semantics replace invented text; completed steps use quiet neutral styling while the current step has the selected ring. Progress is a static account of confirmed navigation state, never fabricated operation progress.

## Behavior and validation

- Added five component interaction tests covering separate select/confirm actions, Browse after an empty scan, busy/scanning guards, existing-setup capture only, valid-name/write-lock submission guards, all eight real presets and eight addons, and the conditional Current/Fresh choice.
- Wizard controls still accept drafts while TF2 runs; creation/application stays locked. Existing-setup capture and its name field remain locked while TF2 runs. Busy operations disable mutation/navigation controls.
- Button copy now names the real native effect: Create and apply for an unused installation; Create and switch when creating alongside an existing profile. Both underlying native routes already create and switch; no backend contract changed.
- Four targeted suites passed 26 tests: onboarding, first-run/finder helpers, and the 12-test `MutationDrafts` regression suite. The Comfig regression only lost its obsolete disclosure-opening action; its failed module/addon write preservation assertions remain intact.
- After the final layout refinement, all 14 onboarding/helper tests passed again. TypeScript, scoped Biome, and whitespace checks passed.

No App, bridge, native, changelog, or version file was changed for onboarding. All colors and control styling use the shared Foundry system. Motion is inherited from shared finite transitions and their reduced-motion override; the step display adds no animated progress or persistent work.

## Five fidelity surfaces

| Surface | Result |
| --- | --- |
| Typography | Shared Inter pane/section/row/body sizes, concise headings and ledes, readable full paths and rule descriptions. |
| Layout rhythm | The reference's grouped setup surface is retained. A compact heading/status variant accommodates the longer real preset/addon workflow. Actions stay adjacent to the entered name. |
| Color/tokens | Shared warm Foundry surfaces, hairlines, selected rings and primary actions; no local color literals or decorative scene art. |
| Assets | Native icons and real installation/profile data. No generated in-game artwork or fabricated catalog data is used. |
| Content | Confirmed-path, existing-only capture, Current/Fresh identity, all presets/addons and real write-lock behavior remain intact. |

No unresolved P0/P1/P2 issue was found in this scoped pass. The original source board, existing-setup screenshot, and desktop/minimum wizard captures were inspected together at original pixels. The additional selected/scrolled/locked states were inspected separately. A separately enlarged crop was unnecessary because labels, switches, fields and focus rings were readable at their captured pixel size.

## Final evidence

All screenshots are browser fixtures under `http://localhost:1420/?preview=…`; no Save, Create, or Confirm action was executed against a native installation. Device pixel ratio was 1. Selected/scrolled captures intentionally show the viewport after the browser brought a selected control into view.

| Fixture and state | Evidence |
| --- | --- |
| `first-existing`, named Main, 1200 × 800 | [01-existing-1200.png](01-existing-1200.png) |
| `first-existing`, named Main, 960 × 640 | [02-existing-960.png](02-existing-960.png) |
| `first-unused`, Medium, 1200 × 800 | [03-unused-1200.png](03-unused-1200.png) |
| `first-unused`, Medium, 960 × 640 | [04-unused-960.png](04-unused-960.png) |
| `first-unused`, all eight presets, Medium high and No tutorial selected, scrolled, 1200 × 800 | [05-unused-expanded-1200.png](05-unused-expanded-1200.png) |
| `first-unused`, remaining addon details and credit, scrolled, 1200 × 800 | [06-unused-details-1200.png](06-unused-details-1200.png) |
| `create`, Current setup, named Practice, 1200 × 800 | [07-create-current-1200.png](07-create-current-1200.png) |
| `create`, Fresh TF2, named Practice retained, scrolled, 960 × 640 | [08-create-fresh-960.png](08-create-fresh-960.png) |
| `many`, no installation selected, 1200 × 800 | [09-finder-many-1200.png](09-finder-many-1200.png) |
| `many`, second installation selected but unconfirmed, scrolled, 960 × 640 | [10-finder-many-960.png](10-finder-many-960.png) |
| `empty`, Browse recovery, 960 × 640 | [11-finder-empty-960.png](11-finder-empty-960.png) |
| `first-unused-locked`, No tutorial draft selected, scrolled, 960 × 640 | [12-unused-locked-960.png](12-unused-locked-960.png) |

CUA also verified Cancel returns to the existing Main profile, and verified directly from the locked form that its name field stays enabled while application stays disabled. The fresh final capture batch recorded no console errors or warnings. During earlier parallel development, an App hook-signature HMR change temporarily blanked the preview and shared Chrome viewport changes distorted intermediate screenshots. Reloading and serializing viewport ownership resolved those development-only interruptions; affected images were replaced. The temporary viewport override was reset before handoff.

The changes and evidence are ready for parent integration. No commit or release was made. Parent retains the integrated application, changelog and release-readiness gates.
