# execs overhaul: visual and motion research

Research date: 22 September 2026. Status: **proposal, not a selected design or an implementation**.

This report combines primary-source research with original art-direction proposals for the whole execs application. It does not report observed defects in the current interface: those belong to the screenshot audit. Product behavior below comes from the repository's [AGENTS.md](../../../../AGENTS.md), not from visual inspection. All three directions are dark, following the owner's clarification.

The design goal is a professional desktop tool with the confidence and finish of a major game studio. Team Fortress 2 should be felt through color, composition and clarity. Its literal menus, characters and visual jokes should not become application chrome. These options are complete systems to apply across settings, content catalogs, editing tools, menus and exceptional states.

## What the primary sources establish

**TF2's identity is built around readability.** Valve's 2007 paper connects its commercial-illustration influences to clear character silhouettes, selective detail and readable forms. Its world uses largely subdued colors with small saturated areas. RED and BLU environments differ in temperature, material and geometry, while remaining in one visual world. The paper also explains why excessive geometric and texture detail competes with deliberate composition. These are useful principles for a desktop tool; the game's rendering techniques themselves are not UI prescriptions. [Valve: Illustrative Rendering in Team Fortress 2, especially sections 3–4](https://cdn.fastly.steamstatic.com/apps/valve/2007/NPAR07_IllustrativeRenderingInTeamFortress2.pdf).

**Hierarchy can be designed as a sequence of recognition.** Valve's 2008 talk identifies team through color, class through silhouette, and the selected weapon through concentrated contrast. The useful lesson for execs is to decide what a person must recognize first, second and third. The UI translation below is an inference, not a claim made by Valve. [Valve: Stylization With a Purpose, slide 8](https://cdn.fastly.steamstatic.com/apps/valve/2008/GDC2008_StylizationWithAPurpose_TF2.pdf#page=8).

**Coherence does not require one layout.** Fluent's layout guidance ties proximity to meaning and allows different grid models for different content. Its spacing system provides a shared rhythm while leaving room for optical adjustments. A catalog, form and editor can therefore belong to one product without having identical composition. [Microsoft Fluent 2: Layout](https://fluent2.microsoft.design/layout).

**Desktop navigation should serve repeat work.** GNOME recommends sidebars where many destinations or frequent switches make them useful. Its broader principles favor concise writing, nearby frequent actions and disclosure of less important material. For execs, that supports stable pane navigation and local control groups, while preserving the application's explicit write and trust decisions. [GNOME: Sidebars](https://developer.gnome.org/hig/patterns/nav/sidebars.html), [GNOME: Design principles](https://developer.gnome.org/hig/principles.html).

**Motion communicates relationships.** Fluent describes purposeful, consistent transitions and recommends quick fades for top-level navigation because sliding large pages can imply an unintended hierarchy. Movement should remain near the element being used, with short durations and accessible alternatives. Windows guidance likewise emphasizes connected state changes and consistent behavior for surfaces with the same entry point. The exact timings proposed later are execs design decisions. [Fluent 2: Motion](https://fluent2.microsoft.design/motion), [Microsoft: Motion in Windows](https://learn.microsoft.com/en-us/windows/apps/design/motion/).

**Finish includes measurable accessibility.** Use at least 4.5:1 contrast for normal text and 3:1 for large text; essential control/state graphics need 3:1 against adjacent colors. A thin decorative divider is different from a boundary required to recognize a control. [W3C: Text contrast](https://www.w3.org/WAI/WCAG22/Understanding/contrast-minimum.html), [W3C: Non-text contrast](https://www.w3.org/WAI/WCAG22/Understanding/non-text-contrast.html).

For pointer targets, 24×24 CSS pixels is the WCAG 2.2 AA floor with specified exceptions; this proposal uses larger practical desktop targets. For a stronger keyboard-focus goal, WCAG's AAA criterion describes an indicator area equivalent to a 2-pixel perimeter and a 3:1 focused/unfocused difference. These are design targets, not a claim that mockups or the app conform. [W3C: Target size](https://www.w3.org/WAI/WCAG22/Understanding/target-size-minimum.html), [W3C: Focus appearance](https://www.w3.org/WAI/WCAG22/Understanding/focus-appearance.html).

## Translation into an execs design brief

The following is original design interpretation informed by those sources.

1. **Read the workspace, then the decision, then the detail.** Profile identity and current pane establish context. The local selection or task receives the next strongest emphasis. Metadata and explanations support it without competing.
2. **Make distinctive shapes out of useful content.** A crosshair canvas, HUD gallery, sound audition list and cfg editor should each have an immediately recognizable composition. Their spacing, controls and shell still share a vocabulary.
3. **Keep the frame quiet so actual TF2 content carries personality.** Real HUD captures, installed crosshair previews and credited viewmodel imagery are the connection to the game. Do not generate fake in-game preview assets or use decorative Valve sprites in the product.
4. **Spend contrast deliberately.** One dominant action or selected object should be easy to find. Normal text must remain readable; hierarchy comes from grouping, weight and spacing as well as luminance.
5. **Communicate state with words and shape.** Active profile, selection, keyboard focus, recording, stale content, failure and game-running state cannot rely on hue alone.
6. **Use materials as a suggestion.** Warm graphite, cool painted metal and muted stone can be expressed in flat color and restrained edge light. Rust, bolts, paper tears, fake terminal glyphs, hazard stripes and scratched textures would reduce clarity.

## Product contracts every option must preserve

These are repository requirements, not proposed new functionality.

- Profiles own customization. Steam inventory belongs to the account, stays read-only and development-only, and is not implicitly assigned to the combined release.
- The app must make the active profile and any pending decision understandable. A new shell must preserve profile-scoped drafts and existing transition guards.
- The top banner remains the single game write-lock indicator. Settings controls remain usable while TF2 runs; heavy actions still explain what they do and honor existing guards.
- Small settings autosave. Files requires explicit Save. Build pack, Apply mods, HUD installation and destructive actions keep their deliberate actions.
- Success follows a confirmed result. Failures remain actionable and persistent according to their owner. Dismissing feedback never releases a guard or discards a draft.
- Import review presents the actual counts, notes and trust decision. Import does not activate a profile. Profile switching shows real steps and never invented progress.
- Files retains a stable editor, persistent file list, explicit Save, session drafts and integrated tools. Its source font and bounded editor scroll remain justified exceptions.
- Existing source credits, preview-data labels, incomplete-source states and platform limitations remain visible where they help the user decide.
- No community hub, profile upload service, new account system or live backpack rearrangement is introduced by a visual concept.

The current Inter typography, token file, selection treatment, motion policy and pane rules remain authoritative until an option is selected and a revised system is explicitly documented. Palettes and layout changes below are concept targets. They have not been applied to application code.

## Three complete dark directions

These working names identify visual options, not new product branding. Candidate colors require contrast verification when translated to actual components. Keep Inter for interface text and the existing source-font exception for Files; font novelty is not needed to distinguish the options.

| Dimension | A — Foundry | B — Signal | C — Afterhours |
|---|---|---|---|
| Overall character | Warm, editorial, assured | Cool, precise, technical | Quiet, tactile, curated |
| Base / surface / raised | `#151310` / `#211E19` / `#2C2821` | `#10161C` / `#19232C` / `#25323C` | `#151915` / `#202720` / `#2E362C` |
| Main / secondary ink | `#F0E9DB` / `#BCB3A3` | `#E6EDF1` / `#ABB9C2` | `#ECEADE` / `#B6BAAC` |
| Candidate accent | Kiln orange `#D98449` | Mineral blue `#80B8D2` | Aged brass `#C4AE70` |
| Composition | Broad editorial columns and strong section titles | Aligned workbench zones and measured density | Generous galleries, quieter titles and vertical rhythm |
| Shape language | Mostly square with softly eased corners | Crisp rectangular regions and compact controls | Soft rectangles, slightly fuller controls, minimal borders |
| TF2 connection | Warm industrial palette and confident graphic masses | BLU's cool industrial organization | Muted environmental colors and material restraint |
| Signature | An attractive, readable page at a glance | Exact control of a complex setup | A personal collection worth browsing |
| Main risk | Becoming brown and nostalgic | Looking like a generic developer dashboard | Excess whitespace or an overly lifestyle-like mood |

### A — Foundry

Use a warm near-black shell, parchment-colored typography and restrained orange. The application should feel like a modern studio publication about a working setup. Large titles and asymmetrical content give important choices room, while setting groups stay compact and aligned. Image surfaces are broad and simple, with one clean edge rather than multiple nested frames.

The sidebar is solid and architectural; the active pane uses a short mark and clear text weight. The profile selector reads as a workspace title. Menus use dense, orderly typography against a distinctly raised warm surface. Selection combines a ring, a restrained wash and the existing dot language.

**Image-generation direction:** polished dark desktop application; warm graphite and ivory; sparse ember accents; editorial alignment; broad calm surfaces; real controls and legible data; authentic TF2 imagery only in functional preview areas; no retro damage, faction logos, fake 3D hardware or marketing hero copy.

### B — Signal

Use blue-black foundations, cooler raised surfaces and a mineral-blue selection accent. The feel is a high-end audio or graphics workbench: deliberate divisions, precise alignment, clear numeric fields and smaller page headings. Keep the window from becoming a wall of tiny instruments; one work area should still dominate each pane.

The sidebar is slightly narrower and the header forms a measured baseline with local actions. Long setting groups use aligned rows and concise labels. The design distinguishes a live preview, editable values and source metadata through spatial structure. Data density is earned by genuine tasks, never decorative statistics.

**Image-generation direction:** refined blue-black desktop workbench; calm professional tool; crisp grids; restrained mineral-blue accents; precise readable values; generous primary working canvas; quiet surfaces; no neon glow, sci-fi HUD, invented performance meters or faux system telemetry.

### C — Afterhours

Use almost-black olive, stone-colored ink and a small amount of dull brass. The application feels like a carefully maintained studio library. Larger content crops, softer corners and measured spacing distinguish it from the other options. Real content is curated visually, while status and safety remain plain and direct.

The sidebar is low contrast as a surface, with strongly readable text. Headings are modest and comfortably spaced. Catalogs receive more visual room; settings use calm bands of related controls. The Files workspace remains compact enough for serious editing rather than inheriting gallery proportions.

**Image-generation direction:** premium dark studio application; olive-black and muted stone; sparse brass accents; restrained material temperature; softly shaped surfaces; elegant functional galleries; warm readable typography; no leather, woodgrain, military costume, luxury-product photography or decorative collectibles.

## How each direction extends across the whole application

This is a proposed composition matrix. It does not claim the current pane has these visual features. Keep the same state and content across the three concepts so the user compares design rather than different functionality. In every option, Mods retains the shipped 0.1.8 Browse / Installed / Casual task organization.

| Surface | A — Foundry | B — Signal | C — Afterhours |
|---|---|---|---|
| Profiles and profile menu | Spacious profile rows with clear current identity; anchored compact actions | Compact workspace list with aligned metadata and a distinct current marker | Library-style rows with strong names and quiet metadata; no invented profile artwork |
| First run / new profile | Strong title, clear choice and one supporting illustration-free panel | Short linear steps with exact input groups | Calm centered choices with roomy naming step |
| Comfig | Preset choice paired with a broad comparison preview; modules as editorial sections | Preset controls above a precise preview/control split; modules as aligned groups | Preset tiles with more breathing room; deeper modules disclosed below |
| Binds | Strong action-group headings and generous keycap rows | Compact action/key columns, efficient scan rhythm | Soft keycaps in calm groups; one clearly isolated recording row |
| Gameplay | Scene preview anchors the decision; controls form a secondary column | Preview and numeric controls create one instrument-like work area | Larger scene crop, then grouped controls with restrained separators |
| HUD | Six image-led entries, strong names, plain pagination | Six evenly measured entries with aligned source/stat labels | Six spacious gallery entries with quiet captions and unchanged coverage disclosure |
| HUD detail / options | Large primary image with an orderly options column | Stable preview/options split with compact schema groups | Preview-led detail with soft groups; same source and compatibility facts |
| Crosshair | Large clear design canvas, strong mode choice, detailed controls nearby | Precision canvas and aligned geometry/color controls | Generous preview well, elegant source selection, compact detailed controls |
| Viewmodels | Class strip and broad credited preview; explicit build action | Group matrix organized around the selected class and preview | Class choices and preview treated like an organized visual collection |
| Sounds | Two clear hit/kill slots with audition controls, then library rows | Compact dual-slot workspace, precise level controls, efficient catalog | Distinct audition surfaces and calm source browsing; no decorative waveform without real data |
| Mods | Browse / Installed / Casual stay distinct, with broad gallery entries and readable pack rows | Compact inventory-like pack rows and strong operational controls | Gallery-led browsing paired with quiet installed-pack rows |
| Files | Dark editorial chrome around a full working editor; no oversized heading | Densest and most tool-like pane, persistent file list and integrated tools | Softer chrome, same generous editor space and compact source controls |
| Launch | Clear options field, concise Steam state and explicit copy/write action | Aligned text workspace with precise source/state labels | Spacious but focused single-purpose page |
| Inventory, development only | Strong account heading and readable item grid | Compact account-bound grid and plain sort/page controls | Collection-like grid; no implication that a profile owns or moves the items |
| Import / conflict / draft dialog | Broad readable summary, framed decision area | Compact factual summary, clear action ordering | Calm layered surface, generous explanation, equally explicit decisions |
| Running / failure / empty state | Warm semantic message in the shared shell | Precise state text with local recovery action | Quiet surface and unmistakable recovery wording |

## Motion choreography

The objective is several purposeful kinds of motion, not more simultaneous motion. Start from the repository's 150 ms color/opacity and 220 ms movement rules. The values below stay within that model; a later prototype can establish whether any token needs to change.

**Shared timing vocabulary:** color and opacity changes use 150 ms; a moved surface or selection indicator uses 220 ms. Entry decelerates with `cubic-bezier(0.2, 0, 0, 1)`. Reversible position changes use `cubic-bezier(0.4, 0, 0.2, 1)`. No springs, overshoot, bounce, long chained reveals or input-blocking animation. The three directions can differ in material and spacing without giving the same action incompatible timing.

| Interaction | Choreography | Essential behavior |
|---|---|---|
| Pane navigation | Keep shell and profile still; replace the work area with a 150 ms opacity transition | Do not slide whole pages or wait for an exit animation before responding. Restore the pane's appropriate draft and position |
| Sidebar active marker | Move only the small marker in 220 ms; text and background change in 150 ms | Focus and selected pane are separate states; keyboard focus appears immediately |
| Segmented choice | Translate the selected backing within the control in 220 ms; update label state immediately | No delayed value update and no false saved-state acknowledgement |
| Button / switch | Color response in 150 ms; switch thumb travels in 220 ms | Hit area does not move or shrink; actual value changes at activation |
| Menu | Appear from the trigger's side with at most 4 px of local travel and 150 ms opacity | Menu is interactive immediately; restore focus when dismissed |
| Dialog | Dim the background in 150 ms; surface moves at most 6 px into place over 220 ms | Make background inert and move focus immediately; do not animate destructive activation |
| Disclosure | Reveal the content region over 220 ms without moving unrelated page chrome | Preserve focused content visibility. Do not scroll the whole page as an effect |
| Catalog paging / filter | Keep toolbar and pagination in place; replace results with a 150 ms fade once available | No cascading card entrance on every page. Keep truthful loading and source coverage |
| HUD preview / image change | Fade the image in 150 ms inside a fixed aspect-ratio slot | Caption/source updates with the image; no zoom, parallax or layout jump |
| Binds recording | One local state change: keycap becomes a clearly labeled recording control | Avoid indefinite pulsing. Capture belongs only to the active visible pane |
| Crosshair and numeric adjustment | Update preview directly with input; use no lagging tween between user-chosen values | The preview must feel attached to the control. Never animate through values the user did not choose |
| Audio audition | Play/stop control changes locally; actual playback remains the source of truth | No auto-audio, decorative spectrum or ambient sound. Hidden pane stops playback |
| Autosave feedback | Stable toast location; fade in/out in 150 ms | Retain existing 400 ms delayed Saving and fresh 1600 ms completion. A failure stays until its own resolution/dismissal |
| Deferred draft while TF2 runs | One clear message on the relevant transition; otherwise static state | No persistent pulsing lock or repeated notice animation |
| Profile switch / build / install | Static list of real phases; current phase changes when the backend reports it | Never animate a percentage without measured progress. Existing minimum panel display time is not fake work |
| Error / conflict | Reveal factual message and recovery actions without shake or alarm effects | Keep the failed draft and the real reason. Focus only when a deliberate review opens |

For reduced motion, **all nonessential transition durations become zero**, including fades, marker travel, dialogs, disclosures and image swaps. This follows the repository's stricter policy. Focus, selection, labels and progress text still update immediately; actual audition or an explicitly requested content preview retains its functional controls. Use `prefers-reduced-motion` consistently across CSS and any scripted animation. Do not require motion to understand state. [W3C: Animation from interactions](https://www.w3.org/WAI/WCAG21/Understanding/animation-from-interactions).

Dialogs must contain focus, return it to an appropriate trigger or next task when closed, and offer a visible close/cancel action where cancellation is supported. Escape must respect the current operation's cancellation contract; a visual redesign must not invent cancellation for an in-flight disk mutation. [W3C: Modal dialog pattern](https://www.w3.org/WAI/ARIA/apg/patterns/dialog-modal/).

## Proof needed before choosing or implementing

Each option should show the same Comfig, Binds, Gameplay and HUD states at the same window size, followed by every other pane. Include open profile/menu states, selected controls, a real busy state, a persistent error, import review, dirty Files with tools open, and the running-game banner. Add at least one compact-window view of a dense pane. These additional states reveal whether a visual language remains useful beyond its most attractive screen.

The image set is a visual decision aid. It cannot prove keyboard behavior, assistive-technology support, motion quality or window resizing. After selection, a small implemented shell plus representative settings, catalog, editor and dialog states should validate those behaviors before the entire app is restyled. Audit findings should cite actual screenshots; motion claims should come from an interactive prototype or recording.

Do not judge an option only by its showcase page. Compare clarity of current profile, speed of finding an action, readability at actual desktop scale, consistency across unlike tasks, restraint of the TF2 influence and how comfortably failures and unsaved work fit into the system.
