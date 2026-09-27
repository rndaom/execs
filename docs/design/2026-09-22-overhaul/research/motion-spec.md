# execs motion specification

22 September 2026 · Proposal for the selected overhaul direction. No prototype or application code is authorized by this document alone. Applies to all three visual options; product behavior remains governed by [AGENTS.md](../../../../AGENTS.md).

## Timing and ownership

| Token | Value | Use |
|---|---|---|
| Feedback | 150 ms | Color and opacity |
| Movement | 220 ms | Local translation, selection backing and disclosure reveal |
| Entry easing | `cubic-bezier(0.2, 0, 0, 1)` | A surface entering or content appearing |
| Reversible easing | `cubic-bezier(0.4, 0, 0.2, 1)` | Position changes within an existing control |
| Reduced motion | 0 ms | Every nonessential animation, including opacity |

Motion illustrates state; it never commits values, acknowledges a save, releases a guard or determines focus. Update selected values, accessible state, numeric readouts, keyboard focus and directly manipulated previews in the activation/input event. Autosave retains its existing 700 ms debounce. A changing value must not wait for a visual transition.

One interaction starts one finite transition group. Run its effects together, with no serial entrance delays or repeated list staggering. New input cancels or retargets the current transition from its displayed position; never queue effects. Completion and cancellation both release transient layers and animation handles. Avoid permanent compositor promotion, blanket transitions and continuously scheduled frames.

## State orchestration

| State change | Visual behavior | State/focus requirement |
|---|---|---|
| Pane navigation | Shell stays still; incoming work area fades for 150 ms. Small nav marker may travel for 220 ms | Route and selected state update immediately; retain each pane's draft and appropriate scroll. No exit-animation wait |
| Switch / segmented choice | Color changes for 150 ms; thumb or backing moves for 220 ms | Value, label and semantic selection update immediately. Hit target stays fixed |
| Numeric, slider or crosshair edit | Preview and readout track input directly | No interpolated intermediate values or delayed preview. Existing save/build contract remains |
| Menu open / close | At most 4 px local translation for 220 ms with a concurrent 150 ms fade | Move/restore focus immediately. A closing surface becomes noninteractive immediately |
| Dialog open / close | Scrim fades for 150 ms; surface moves at most 6 px for 220 ms | Background becomes inert and focus enters immediately. Restore focus on close; do not wait for opacity. Preserve supported cancellation rules |
| Disclosure | Reveal the local content region for 220 ms; sibling layout follows once | Keep focused content visible. No decorative page scrolling or bounce |
| Catalog page / filter | Toolbar and pagination stay still; results fade for 150 ms when ready | Keep truthful loading/error/coverage state. Do not show old results as the new page |
| Preview image change | Image fades for 150 ms within a fixed aspect-ratio slot | Image identity, caption and source change together. No zoom or parallax |
| Binds recording / sound audition | One finite local state change | Recording/playback label follows actual state. No pulsing keycap or decorative audio meter; hidden pane releases capture/playback |
| Save feedback | Toast uses a fixed position and 150 ms fade | Saving appears only after 400 ms; confirmed completion receives a fresh 1600 ms. Source-owned failure persists under existing rules |
| Profile switch / build / import / install | Real phase label changes; optional finite 150 ms emphasis | Backend events drive steps/counts. No invented percentages. Existing minimum display time does not create extra work |
| Failure / conflict / deferred draft | Static message after an optional 150 ms appearance | Preserve draft and recovery reason. No shaking, alarm flash or repeated attention effects; dismissal does not release guards |

## TF2, visibility and reduced motion

While TF2 is active, the companion must perform **no perpetual decorative GPU work**: no ambient animation, shimmer, pulsing status, looping canvas, animated background or continuous preview rendering. Use static progress text and event-driven updates. Finite feedback for a deliberate user interaction remains allowed; a running game never needs an animated lock indicator.

When the app is hidden or unfocused, or a pane becomes inactive, finish or cancel presentation-only effects, stop preview frame loops and release transient layers. Resume on meaningful input/state changes, without replaying entrances. Preserve drafts, operation guards and actual work; visibility cleanup cannot cancel a disk operation by implication.

Honor `prefers-reduced-motion` in both styles and scripted effects. Switching it on during an effect immediately settles to the current state. Remove every decorative transition, including fades, smooth scrolling and selection travel. Keep labels, focus, progress and control feedback immediate. User-requested audio playback remains functional; no information may require motion to be understood.

## Acceptance checks after a direction is selected

- Rapid navigation/toggling leaves the latest state and correct focus, with no queued effects or ghost hit targets.
- A keyboard-only pass covers menus, dialogs, recording and Files tools; focus never depends on animation completion.
- Reduced motion shows the same states with no nonessential interpolation.
- With TF2 active and the app idle, a performance trace shows no repeating animation frames, animation-driven paints or decorative GPU activity. Repeat with the app hidden/unfocused.
- A failed save, deferred draft and real multi-step operation remain understandable with motion disabled; completion appears only after the actual result.

Source basis: [Fluent motion](https://fluent2.microsoft.design/motion) informs purposeful local transitions; [W3C animation guidance](https://www.w3.org/WAI/WCAG21/Understanding/animation-from-interactions) informs reduced motion. Exact timings and orchestration above are execs proposals constrained by the current repository rules. Broader context: [design research](design-research.md).
