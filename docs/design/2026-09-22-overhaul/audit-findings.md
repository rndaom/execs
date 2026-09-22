# execs visual audit

Reviewed 2026-09-22. The completed browser capture pass saved **67 screenshots, with 66 accepted as useful evidence** (one overscrolled duplicate is excluded). It covers all 10 production panes, development Inventory, alternate selections, menus, setup, profile/import flows, locks, repairs, updates and dirty-file guards. The detailed critique below independently reviews 14 representative screenshots; the complete visual ledger and notes are in [captures.json](G:/Projects/execs/docs/design/2026-09-22-overhaul/audit/captures.json) and the [review gallery](G:/Projects/execs/docs/design/2026-09-22-overhaul/index.html). This is broad visual coverage, not every combinatorial state or native-behavior certification. See [surface-inventory.md](G:/Projects/execs/docs/design/2026-09-22-overhaul/research/surface-inventory.md) for source-level coverage and remaining native checks.

**Overall:** the application already has a coherent, restrained foundation. Its biggest visual weaknesses are small, faint supporting text and page layouts that spend too much of the first viewport introducing the task before showing its useful content. The strongest redesign will improve hierarchy and interaction context while retaining the clear profile scope, honest status and explicit file-changing actions.

## Scope and evidence

The user goal is to configure and switch TF2 setups confidently, then judge three complete, consistent visual directions for a combined release. The accessibility goal is legible text, clear state, understandable consequences and keyboard-usable controls; this screenshot review cannot establish full accessibility conformance.

The selected images are 1280 × 720 browser captures. Screenshots 002–033 below show the **0.2.0 development preview**. Screenshots 034 and 038 show the **public 0.1.8 frontend in a separate browser fixture**, visibly confirmed by the footer. The Mods tabbed layout must not be described as though it came from the same source baseline as the other panes. Neither set proves native Steam or disk behavior.

Health labels below mean: **Strong** = a useful pattern to preserve; **Mixed** = sound structure with a visible opportunity; **Limited** = the capture cannot support a fuller judgment. They are design judgments, not defect severities.

## Primary redesign priorities

1. **Make secondary information readable at normal size.** Paths, category labels, helper text, preview captions and footer actions become visually weak across the application. Increase the smallest text, raise contrast and reduce how often important caveats use the faintest tier. Evidence: [002](G:/Projects/execs/docs/design/2026-09-22-overhaul/audit/002-comfig-preset.png), [009](G:/Projects/execs/docs/design/2026-09-22-overhaul/audit/009-gameplay-advanced.png), [019](G:/Projects/execs/docs/design/2026-09-22-overhaul/audit/019-viewmodels-scout.png), [031](G:/Projects/execs/docs/design/2026-09-22-overhaul/audit/031-launch-options.png).
2. **Let each page put its main task in the first viewport.** HUD shows only the first images at the bottom, with their identifying text below the visible area. Shipped Mods places its results below the viewport after the task chooser, summary, repair message and filters. Compact these layers without burying recovery. Evidence: [010](G:/Projects/execs/docs/design/2026-09-22-overhaul/audit/010-hud-catalog.png), [034](G:/Projects/execs/docs/design/2026-09-22-overhaul/audit/034-mods-shipped-browse.png).
3. **Keep controls, their result and their action together.** Crosshair's initial view shows size/color/scene while the shape and build workflow are farther down. Inventory's selected card has a shortened name while most of its detail region is above the current scroll position. Design persistent or nearby context for these working surfaces. Evidence: [015](G:/Projects/execs/docs/design/2026-09-22-overhaul/audit/015-crosshair-in-game.png), [033](G:/Projects/execs/docs/design/2026-09-22-overhaul/audit/033-inventory-item-selected.png). The designer itself provides a good compact model: [017](G:/Projects/execs/docs/design/2026-09-22-overhaul/audit/017-crosshair-designer.png).
4. **Give the product a stronger identity through composition and materials, not decoration over controls.** The current dark shell, warm text and small rust accents are consistent but visually quiet. Comfig's real TF2 image and the crosshair scene bring the clearest game connection. Each concept should extend that restrained warmth, intentional typography and useful media rather than add mascots, arbitrary weathering or oversized TF2 branding. Evidence: [002](G:/Projects/execs/docs/design/2026-09-22-overhaul/audit/002-comfig-preset.png), [015](G:/Projects/execs/docs/design/2026-09-22-overhaul/audit/015-crosshair-in-game.png), [031](G:/Projects/execs/docs/design/2026-09-22-overhaul/audit/031-launch-options.png). This is art direction derived from the user's request, not a usability defect.
5. **Preserve the task-specific layouts that already work.** Files appropriately uses a wide editor workbench; sound slots work side by side; Viewmodels has class tabs and a stage/list relationship; the designer has a compact modal workspace. A shared shell and control language should not flatten these into one generic settings template. Evidence: [026](G:/Projects/execs/docs/design/2026-09-22-overhaul/audit/026-files-problems.png), [021](G:/Projects/execs/docs/design/2026-09-22-overhaul/audit/021-sounds-default.png), [019](G:/Projects/execs/docs/design/2026-09-22-overhaul/audit/019-viewmodels-scout.png), [017](G:/Projects/execs/docs/design/2026-09-22-overhaul/audit/017-crosshair-designer.png).

## Numbered review and pane health

The steps follow product navigation and related dialogs. These are accepted current-run screenshots, inspected from their saved files. Scrolled views are labeled rather than treated as broken crops.

### 1. Comfig preset — Mixed

The preset tiles, selected ring/dot and real in-game image communicate the choice clearly. The centered content leaves substantial space between the navigation and controls and below the image; Fine-tune modules is near the lower edge. A more purposeful use of width could expose the current preset, override summary and next choice together. This screenshot covers the initial viewport, not all modules/addons.

![Step 1 — Comfig preset, Medium selected](G:/Projects/execs/docs/design/2026-09-22-overhaul/audit/002-comfig-preset.png)

### 2. Binds recording — Strong with density opportunity

“Recording Jump” and “Escape cancels” are explicit, and the listening key cell is distinct. Movement and Teamplay groupings are easy to scan. Large vertical gaps and row spacing mean Loadouts is not visible here. This is a scrolled view: the title is above the viewport, not missing from the product. The image does not prove key conflict handling or successful recording.

![Step 2 — Binds recording Jump, scrolled view](G:/Projects/execs/docs/design/2026-09-22-overhaul/audit/007-binds-recording.png)

### 3. Gameplay with Advanced open — Mixed

Two distinct FOV controls and visible numeric values are clear. Draw viewmodel and Min viewmodels use familiar switches. The pane offers no visible contextual image to explain how world versus viewmodel FOV differs; the large empty bands could support one if it represents the effect honestly. The Advanced rules are noticeably faint. Only the upper Advanced rows are visible, so this image does not cover tracers.

![Step 3 — Gameplay and upper Advanced controls](G:/Projects/execs/docs/design/2026-09-22-overhaul/audit/009-gameplay-advanced.png)

### 4. HUD browsing — Mixed

Active HUD identity, search, sorting, counted results and numbered page navigation are clear. “Preview data” is disclosed. However, the stock-HUD introduction and multiple control rows consume most of the viewport; the first cards' names and install actions are below it. Catalog browsing should show enough of each result to make a decision before scrolling.

![Step 4 — HUD catalog first viewport](G:/Projects/execs/docs/design/2026-09-22-overhaul/audit/010-hud-catalog.png)

### 5. Import HUD dialog — Strong

Two large, labeled choices explain ZIP/7z versus extracted folder without exposing backend details. The replacement consequence is stated immediately, and Cancel is visible. The scrim makes the decision easy to locate. Keep this clarity in all three concepts. Keyboard focus, Escape and native file-picker behavior need interaction evidence; the still image cannot verify them.

![Step 5 — Import HUD format choice](G:/Projects/execs/docs/design/2026-09-22-overhaul/audit/012-hud-import-menu.png)

### 6. Custom Crosshair controls — Mixed

The mode choice and live color field are clear; the TF2 scene provides useful context. The substantial color editor dominates the first viewport while shape selection and Build pack are outside it. Consider a working layout that makes the selected asset, size/tint and pending build status visible together. The filename says “in-game,” but the inspected image visibly has **Custom selected**; this report uses the visible state. It does not prove native sprite rendering or exact in-game appearance.

![Step 6 — Custom Crosshair mode, size and tint](G:/Projects/execs/docs/design/2026-09-22-overhaul/audit/015-crosshair-in-game.png)

### 7. Crosshair designer dialog — Strong

The preview, shape choices and parameters fit into one coherent working area. Cancel and Save to library are clear and separate from the page's Build pack action behind the scrim. This is a good example of consistency without forcing the main-page layout into a modal. The limit note and numeric readouts could be easier to read. The image covers Cross style only; other styles and motion are not validated here.

![Step 7 — Crosshair designer, Cross style](G:/Projects/execs/docs/design/2026-09-22-overhaul/audit/017-crosshair-designer.png)

### 8. Viewmodels, Scout — Mixed; media evidence limited

All nine class tabs fit; hidden-group counts, explicit Shown/Hidden text and the nearby stage communicate the task well. The header's Built pack badge and bottom Rebuild action clearly describe existing work. Secondary labels are faint. The blank stage is **intentional browser-fixture behavior**, not evidence that native previews are broken. Only part of the group list is visible here.

![Step 8 — Scout viewmodel groups in browser preview](G:/Projects/execs/docs/design/2026-09-22-overhaul/audit/019-viewmodels-scout.png)

### 9. Sounds, slot configuration — Mixed

Side-by-side hit and kill slots make their relationship clear. Stock versus installed community source is named, and Boost explains that it changes the file. Both slots are visibly off, making the selected sound strips very dim, even though their identity still matters. Library filters and the first assignment row are visible, but the pane mixes configuration and a long catalog. This image shows **volume and boost, not pitch**. Playback and WAV picking are disabled in browser preview; that is not a native defect.

![Step 9 — Sounds slots, volume, boost and library entry](G:/Projects/execs/docs/design/2026-09-22-overhaul/audit/021-sounds-default.png)

### 10. Files with Problems open — Strong

The file list, source editor and Problems panel stay in one workspace. The selected file, line/column and warning's explanation are identifiable, and “Save is allowed” distinguishes this warning from a block. This denser full-width layout is appropriate to its job. The image shows unchanged `autoexec.cfg`; a dim Save button is not proof that the warning blocks saving. Keyboard menus, conflicts, newer drafts and analysis failures remain separate checks.

![Step 10 — Files workbench with a non-blocking warning](G:/Projects/execs/docs/design/2026-09-22-overhaul/audit/026-files-problems.png)

### 11. Launch options — Strong task clarity; sparse visual hierarchy

One field, one Copy action and a plainly separated Never stored explanation make the job understandable. The native-write condition is stated in the lede. The large textarea is mostly empty for a one-line string, and the lower half has little useful content, making the layout feel unfinished compared with Files. A compact editor plus understandable saved/Steam status would be enough; it does not need invented performance metrics. This screenshot shows copy guidance, **not an observed Steam-running guard or successful native write**.

![Step 11 — Launch string and copy guidance](G:/Projects/execs/docs/design/2026-09-22-overhaul/audit/031-launch-options.png)

### 12. Inventory selection — Mixed; development scope

Search, order, quality filter, slot numbers and a selected outline are visible. The fixture disclosure is explicit. At this scrolled position, long item names truncate on cards and the corresponding detail region is mostly above the viewport. A nearby persistent inspector would improve selection continuity. The missing artwork is deliberate fixture data. Inventory remains a development feature; this review does not assign it to the combined release.

![Step 12 — Development Inventory, selected War Paint card in a scrolled view](G:/Projects/execs/docs/design/2026-09-22-overhaul/audit/033-inventory-item-selected.png)

### 13. Mods browsing, 0.1.8 frontend — Mixed

Browse/Installed/Casual setup is a useful task division, and the summary explains installed state. The repair issue names the consequence and action. At 1280 × 720, however, no result cards appear in the first viewport: task selection, status, repair and catalog tools occupy it. The redesign needs a compact but unmistakable recovery area that coexists with browsing. This screenshot is public **0.1.8 frontend fixture evidence**, not the current 0.2.0 source layout.

![Step 13 — Public 0.1.8 Mods browsing with fixture repair state](G:/Projects/execs/docs/design/2026-09-22-overhaul/audit/034-mods-shipped-browse.png)

### 14. Remove mod dialog, 0.1.8 frontend — Strong consequence copy; consistency opportunity

The dialog names Clean Rocket Trails and says re-adding requires a 58.9 MB download. Remove mod and Keep mod are unmistakable. It appears near the top of the viewport, unlike the centered HUD import and designer dialogs, and its primary action uses the same orange as ordinary constructive actions. Establish a consistent destructive-action treatment and dialog placement. The capture does not independently prove initial keyboard focus; the capture ledger's focus note needs interaction/code corroboration. No removal was performed for this review.

![Step 14 — Public 0.1.8 remove-mod confirmation](G:/Projects/execs/docs/design/2026-09-22-overhaul/audit/038-mods-remove-confirmation.png)

## Code corroboration — separate from visual findings

These facts come from the current working tree and the earlier [surface inventory](G:/Projects/execs/docs/design/2026-09-22-overhaul/research/surface-inventory.md), not from observing screen-reader or native behavior. They must not automatically be attributed to the separate 0.1.8 Mods baseline.

- **Contrast:** `index.css` defines faint ink as `#6f695c`. Calculated opaque sRGB contrast is 3.44:1 against `#121212`, 3.26:1 against `#181818`, and 3.02:1 against `#1f1f1f`. The footer uses 10 px text. This supports the visible legibility concern, but is not a rendered contrast audit of every transparency, disabled state or image background.
- **Semantic colors:** brand and warning both use `#cf6a32`. The design needs non-color warning cues and a clear destructive-action hierarchy.
- **Interaction targets to test:** Finder selection has a visual `data-selected` state without radio/pressed semantics. `CrosshairChoice` declares listbox/option roles but does not implement Arrow/Home/End navigation or explicit choice focus restoration. These are code-backed test priorities; they were not reproduced in this image review.
- **Existing foundations:** class tabs implement roving keyboard focus, segmented controls use radios, modals implement Tab trapping/Escape/focus restoration, and the stylesheet has reduced-motion handling. Restyling should preserve these instead of rebuilding only the appearance.

## Evidence limits and next coverage

This pass did not inspect onboarding, profile-menu/import/recovery screens, update banners, minimum native window size, zoom, focus travel, live error recovery, animation timing or every expanded pane. Their captures may exist later in the growing ledger but are not claimed as reviewed here. [captures.json](G:/Projects/execs/docs/design/2026-09-22-overhaul/audit/captures.json) remains the capture index; notes there are working notes, not proof of a state.

Still images cannot validate keyboard access, hover behavior, motion quality, autosave timing, lock transitions, native file-picker results, audio, Steam writes or actual game rendering. Native-only artwork gaps must stay labeled. Preview data and the two frontend baselines must remain visible in the presentation.

For the three design options, use the same page/state comparison set and show how each resolves these priorities. Keep legitimate differences among the editor, catalog, controls and preview workspaces. Include a short motion storyboard per option; polished motion cannot be demonstrated by attractive stills alone.
