# execs surface inventory and capture plan

Prepared 2026-09-22 from the working tree at `G:/Projects/execs`.

This report is **code inspection**, not a completed visual audit. No screenshots were taken by this research agent. Every capture below remains a checklist item until the audit's screenshot ledger supplies an image and observation. The browser audit should separate a defect seen in a screenshot, an interaction reproduced in the preview, a code-backed risk, and an unobserved native-only state.

The current application has **10 production settings panes, one development-only Inventory pane, 31 named browser preview states, onboarding/profile flows, and shared status/recovery/update surfaces**. The redesign needs to preserve these distinct jobs. A single pane mockup would not represent the application.

## Entry points and environment

- `pnpm dev` serves Vite, normally at `http://localhost:1420`. `EXECS_DEV_PORT` can change it. `?preview=<state>` is parsed in `apps/desktop/src/lib/preview.ts:53` and selected at startup in `main.tsx:13`.
- The preview is available in development browser builds. `lib/api.ts:27` selects the in-memory adapter only when the host is **not** Tauri and `import.meta.env.DEV` is true. A `?preview=` URL in the native app is not a sandbox.
- Reload the URL to reset the preview's in-memory data. Native disk, Steam, imports and network behavior are not validated by preview interactions.
- Disclosures remember open state per profile in `localStorage` (`components/ui/Disclosure.tsx:4`). GameBanana's mature-content filter also persists (`lib/mods-ui.ts:359`). Record or reset those preferences for reproducible captures; reloading alone does not necessarily collapse a disclosure.
- Default native window is 1200 × 800; minimum is 960 × 640 (`src-tauri/tauri.conf.json:19`). Capture the default size and the minimum size. At 960 px the navigation uses its horizontal layout because `SettingsLayout.tsx` switches to the sidebar at Tailwind `lg`; most hero rows collapse below 1100 px (`index.css:287`). The Files workbench changes at 720 px, but 720 px is below the configured native minimum.
- Actual native media and state require separate read-only observation. Do not launch TF2, write player files, install/update, repair live game data or simulate a Tauri host just to improve the screenshot set.
- The existing guide says Inventory is development-only and has not yet been assigned to 0.2.0. Audit and show its design if useful, but do not silently include it in the combined release scope.

## Every named preview URL

Append the state to `http://localhost:1420/?preview=` (or the actual dev-server port). These are initial conditions, not independent application routes. Settings navigation is React state, so clicking another pane does not update the URL.

| Preview value | Seeded surface / reason to capture |
| --- | --- |
| `empty` | Finder, no discovered installation; Browse recovery. Also the default for unknown/no preview state. |
| `one` | Finder, one discovered installation. Capture selected/unselected Confirm behavior. |
| `many` | Finder, two installations; selected path distinction. |
| `confirmed` | Confirmed install with uninitialized empty library, existing-setup first-run classification. |
| `locked` | Confirmed existing setup with TF2 write lock. |
| `library` | Initialized empty library, existing-setup onboarding. This name does not mean a populated profile menu. |
| `saved` | One saved active profile, normal settings shell. Default pane is Comfig. |
| `absorb` | Saved active profile with added `toonhud` and removed `oldpack`; Custom files changed prompt. |
| `switch` | Main + Alt profiles and switch progress seeded at Write files. |
| `import` | Main + Imported profiles, Main remains active. This is **not** the import-review modal. |
| `folder-repair` | Active Main profile owns unsafe `materials` / `resource` folder names; alert and review. |
| `first-existing` | Existing customization: name and Save this setup. |
| `first-unused` | Unused-install wizard, name/preset/addons. |
| `first-unused-locked` | Same wizard with game-running lock. |
| `create` | New-profile wizard with Current setup / Fresh TF2 choice. |
| `settings-comfig` | Comfig with Medium, texture-quality override and No tutorial addon. |
| `settings-binds` | Binds with movement, teamplay and some loadout bindings. |
| `settings-gameplay` | Gameplay, managed FOV values. |
| `settings-hud` | Stock HUD plus a small catalog; rayshud install and ToonHUD link-out. |
| `settings-hud-browser` | Larger HUD catalog, real public artwork URLs, synthetic varied/missing statistics and multiple pages. |
| `settings-hud-installed` | Installed rayshud, update available, options schema. |
| `settings-crosshair` | Saved custom crosshair record, stock/custom controls and custom workflow. |
| `settings-viewmodels` | Saved viewmodel record, class/group editing. Native screenshots unavailable in browser. |
| `settings-sounds` | Community `quack` hit sound, library and slot editing. Playback unavailable in browser. |
| `settings-mods` | Two installed mods, selected default library, preloader state and one particle repair issue. |
| `settings-files` | Five editable cfg fixtures and package inventory; CodeMirror workspace. |
| `settings-launch` | Recommended launch string. Save returns the simulated Steam-open result. |
| `settings-locked` | Full settings shell with fixed TF2-running lock; starts on Comfig. Navigate to all other panes to observe draft/disabled distinctions. |
| `update-available` | Comfig + update banner. |
| `update-installing` | Comfig + update banner seeded in Downloading state. |
| `release-notes` | Release-notes modal with a fixed 0.1.3 example. This is fixture copy, not the proposed release notes. |

Source of truth: `lib/preview.ts:11`, `lib/preview-bridge.ts:108`, `lib/library-ui.ts:71`.

## Shell, onboarding and profile flows

| Surface | Interaction/state coverage | Main source |
| --- | --- | --- |
| Settings navigation | Setup: Comfig/Binds/Gameplay; Look: HUD/Crosshair/Viewmodels/Sounds; More: Mods/Files/Launch; dev Steam: Inventory. Active marker, hover, keyboard focus, narrow horizontal navigation, long pane scroll. | `SettingsLayout.tsx:37`, `lib/settings-ui.ts:47` |
| Header | Wordmark, active profile menu, install label + full-path tooltip/copy feedback, Launch TF2, Game running indicator. Disabled launch reason and Review changes/Open Mods routes. Cancel launch wait has a native `window.confirm`. | `components/ReadyPanel/ReadyHeader.tsx:49`, `App.tsx:143`, `App.tsx:309` |
| Profile menu | Open/closed, active/inactive list, New profile, Save current as input, export icon, Import, Change install; running-state restrictions and unsafe-folder repair. Menu scrolls internally after 208 px. | `components/ReadyPanel/ProfileMenu.tsx:90` |
| Finder | Scanning, no installation, one/multiple, selected installation, Browse, validation error, busy Confirm. Full path is visible as secondary text. | `components/FinderPanel.tsx:34` |
| Existing setup | Profile name empty/filled, detected-customization reasons, What gets saved, Save this setup, Change install, locked. | `FirstRunExisting.tsx:31` |
| Setup/new profile | Name; Current setup/Fresh TF2 on New profile only; featured/all eight presets; all eight official addon choices; Apply/Create, Cancel, game lock, real progress afterward. | `SetupWizard.tsx:57`, `lib/first-run-ui.ts:40` |
| Profile import | ZIP read, review summary, flagged-config disclosure expanded/collapsed, Trust and import, cancel, saving, completion, Switch to profile or Repair folder names, error. In browser, open Profile → Import; adapter delays read 900 ms and confirmation 1100 ms. | `components/ProfileImportDialog.tsx:25`, `lib/preview-bridge.ts:361` |
| Absorb prompt | Added and removed custom packs, Update profile, Restore removed, Keep profile, Escape defers. Modal has no scrim and appears top right. | `components/ReadyPanel/PackPrompt.tsx:22` |
| Folder repair | Active-profile warning; rename mapping and error in review; repair/cancel; inactive-profile menu entry. | `components/ReadyPanel/FolderRepair.tsx:18`, `ReadyPanel.tsx:99` |
| Switch | Real staged checklist, in-progress/completed panel; recovery banner after interrupted switch; empty-active-profile fallback after a failed destructive phase. | `components/SwitchProgressList.tsx:47`, `ReadyPanel.tsx:127` |
| Footer | App version/hotfix tooltip, Check for updates/checking/latest/error, Report a bug link, Copy diagnostics/copied/failed, affiliation copy. Native settings footer is a fixed 28 px row with 10 px text. | `components/AppFooter.tsx:37` |

## Pane-by-pane capture coverage

Each checkbox names a distinct visual surface or meaningful selection. Different numeric values alone do not create a new surface; capture values that visibly change an illustration, enabled state, content grouping, or feedback. A complete audit should not pretend every permutation of hundreds of assets has been viewed.

### Comfig

Sources: `ComfigPane.tsx:190`, `lib/comfig-catalog.ts:17` and `:127`.

- [ ] Default Medium preset and beside-it screenshot.
- [ ] Show all presets; select both an extreme preset and None (custom/no-image placeholder). Eight presets: Ultra, High, Medium high, Medium, Medium low, Low, Very low, None.
- [ ] Fine-tune modules expanded: Networking tab (5 controls), Graphics tab (31 controls, Show more/fewer), HUD tab (2), Sound tab (2).
- [ ] A module changed away from the preset; representative short/long choice control; module search result and no-match state.
- [ ] Official addons, including selected/unselected state and an action failure if reproduced.
- [ ] Packages and extras area: installed/update vs missing/install, comfig-custom import/replace, preset guide and extras destinations.
- [ ] Locked Comfig distinguishes immediate package writes from deferred cfg drafts.

### Binds

Sources: `BindsPane.tsx:32`, `:171`; `lib/binds-ui.ts:18`.

- [ ] Movement, Teamplay and Loadouts sections with all 13 actions visible across scroll positions.
- [ ] Recording banner and the selected listening row.
- [ ] New keyboard binding, mouse button/scroll binding, unbound row, Escape cancellation.
- [ ] Unsupported-key recorder notice, if accessible through an ordinary key input.
- [ ] Game-running retained draft and post-recording save feedback.

### Gameplay

Source: `GameplayPane.tsx:71`.

- [ ] World FOV / Viewmodel FOV, Draw viewmodel and Min viewmodels.
- [ ] Representative changed values and switch states. Viewmodel FOV supports 0.1–179.9 with decimals; world FOV remains 54–90.
- [ ] Advanced open: left-handed, transparent viewmodels, first-person tracers, all tracers and caveat notes.
- [ ] TF2-running draft state; transparent-viewmodels immediate addon write remains disabled.
- [ ] Missing mastercomfig packages prerequisite for transparent viewmodels (not covered by a named preview).

### HUD

Sources: `HudPane.tsx:175`, `:297`, `:534`, `:827`, `:1080`; `lib/hud-ui.ts:138`.

- [ ] Stock HUD state, small catalog, direct-install and link-out cards.
- [ ] Installed rayshud state, update available and updated state, Browse HUDs action, screenshot thumbnail.
- [ ] HUD options collapsed/expanded; fixture color + alpha, Minmode switch, Scoreboard combo and Ubercharge numeric control.
- [ ] Larger schema examples, unsupported options, textbox/large-combo/invalid-value states need isolated fixtures or native observation; current fixture contains only four controls.
- [ ] Multi-page catalog A to Z page 1, later page, numbered navigation, page jump and bottom pager.
- [ ] Last updated, Most downloads, Most views; ranking coverage/missing-stat explanation.
- [ ] Search result and no results, missing artwork card.
- [ ] Screenshot lightbox, next image and thumbnails; GitHub album loading and Imgur external behavior where available.
- [ ] Import HUD modal (Choose ZIP or 7z / Choose folder) and cancellation.
- [ ] Catalog loading/partial-cache/error, stats loading/error and schema retry state require additional fixtures or safe observed failures.

### Crosshair

Sources: `CrosshairPane.tsx:220`, `StockCrosshairSettings.tsx:118`, `crosshair/*`.

- [ ] In-game mode with weapon default; selected stock shape; size and tint variations over the reference scene.
- [ ] Color field, hue slider, valid/invalid hex entry, Saturation and brightness disclosure expanded.
- [ ] Custom mode with installed pack, inactive saved pack, mode change pending, Use in-game crosshair.
- [ ] Built-in source with a different base shape and pending Build pack action.
- [ ] My designs source empty/populated; open Design a crosshair, every available style, shape-specific controls, outline/opacity/center dot/drop shadow, name and saved design.
- [ ] Community source and search/empty state; native Community crosshairs picker, selected tile, multiple picks, paging/search/add. Browser disables opening this picker.
- [ ] Import PNG field and a permitted fixture image; size normalization/resize choice, wrong format/error where safely supported.
- [ ] Weapon overrides expanded in All classes; representative Mixed shapes state; shape popup open.
- [ ] Each class tab (Scout, Soldier, Pyro, Demoman, Heavy, Engineer, Medic, Sniper, Spy), per-weapon override and Copy to all classes.
- [ ] Discard custom edits, Build pack completion, Remove saved pack, game-running restrictions.

### Viewmodels

Sources: `ViewmodelPane.tsx:171`, `:315`, `lib/viewmodel-groups.ts`.

- [ ] All nine class tabs, with each class's primary/secondary/melee group list visible.
- [ ] A focused shown group and a hidden group; keyboard focus should change the stage just like pointer hover.
- [ ] Hide all and Show all, hidden-group counts, Soldier's Original caveat.
- [ ] Hide mode Full / Weapon (both controls, plus any stage limitation clearly labeled).
- [ ] Pack and preload disclosure: Import/Replace VPK, Remove pack, route-to-Mods explanation.
- [ ] No pack, built pack, imported pack and draft/build status; Rebuild pack vs Build pack.
- [ ] Windows compiler unavailable state and real artwork loading/failure require native observation or fixtures. Browser previews deliberately show “Nothing on screen” / “No preview yet”.

### Sounds

Sources: `SoundsPane.tsx:247`, `:278`, `:402`, `:514`; `lib/sound-library.ts:32`.

- [ ] Hit + Kill slots, one enabled and one disabled, stock vs custom assignment.
- [ ] Volume, custom-file Boost Off/+6/+12 dB; boost appears only for non-stock choices.
- [ ] Library All/Built in/Community/comfig.app filters, A to Z/Z to A/Source sort, search and no results.
- [ ] Selected Hit and Kill assignment buttons, representative shared sound assigned to both slots.
- [ ] Advanced: each slot's pitch at 10/150 damage and repeat delay.
- [ ] Native playing/stopped, audition failure, Add a WAV selected/error, unavailable catalog and Remove sound files.
- [ ] Game-running drafts and deferred-save feedback. Browser intentionally disables audition and WAV picking.

### Mods

Sources: `ModsPane.tsx:229`, `components/ModList.tsx:46`, `components/GameBananaBrowser.tsx:191`.

- [ ] Casual preload hero, Preload on launch, Material bypass, status summary and Restore stock files.
- [ ] Your mods populated and empty; Add mods/Add folder; normal remove and large-download remove confirmation.
- [ ] `Clean Rocket Trails` fixture is 61.8 MB and opens the large-mod confirmation; keep it for the initial capture, then dismiss.
- [ ] GameBanana disclosure expanded, initial grid, search/no results, all five sorts, category selection and next page.
- [ ] Mature toggle off/on, mature badge/filtered-empty-page state; this preference is stored.
- [ ] More categories expanded needs a larger fixture: current preview has only Skins/Effects/Sounds.
- [ ] Installed card and install-in-progress/completed states. Preview installs a simulated record.
- [ ] Default mod library addon picks, particle picks, From your mods picks, pending Apply mods.
- [ ] Skipped last time; Last install report after Apply mods.
- [ ] Particle repair warning → Repair with Steam → waiting/finish/cancel maintenance controls. This is safe only in browser preview; the adapter clears the one simulated untracked patch and sets a simulated verification flag.
- [ ] Recovery required, stale-after-TF2-update, library download, missing gameinfo, preload-not-in-Steam, repair timeout and native cancellation confirmation need separate evidence. No named preview seeds these states.

### Files

Sources: `FilesPane.tsx:479`, `components/FilesEditor.tsx:527`, `components/FilesReference.tsx:25`.

- [ ] Default stable workbench, full file list, selected file and cursor/readout.
- [ ] Each fixture (`autoexec.cfg`, `danger.cfg`, `execs_binds.cfg`, `execs_gameplay.cfg`, `config.cfg`); distinguish dirty dots and managed-owned routing.
- [ ] File filtering, no match, limited inventory, no cfgs, provided read-only/binary file. Last three are capture gaps in normal preview data.
- [ ] Dirty editable file, Save, Discard; two dirty files and Save all; retained draft after navigating away/back.
- [ ] File context menu from ellipsis and right-click: open, save, Save as new cfg, problems, cfg references, copy path, owning pane, discard, New cfg where applicable.
- [ ] Editor context menu: undo/redo/copy/select all, Find, wrap, save, Save as, New cfg, Problems, Help; keyboard navigation/Escape.
- [ ] Find/replace two-row toolbar, search highlights, case/regex/whole-word controls, wrap toggle, autocomplete popup/command info.
- [ ] New cfg Startup collision → Open; Class choice; Helper name, location and custom folder; invalid path.
- [ ] Save as new cfg panel, unique name/location, collision, read-only source copied as a user-owned cfg.
- [ ] Problems This file / All files, actual `danger.cfg` warning and empty state; select an issue to jump to source.
- [ ] Help active-command summary, Details, Guides search/disclosure, Snippets disclosure, Insert preview and inserted content.
- [ ] Source changed/removed alert, Compare current source side-by-side, Keep draft/Use current source, restore path. No named preview exposes external drift.
- [ ] Analysis loading/timeout/crash/budget failure, Retry analysis and disabled Save. Do not fabricate these by changing browser internals.
- [ ] Game-running editable draft with explicit Save blocked; profile/install/new-profile transition opens Save Files drafts?; save/discard/cancel outcomes.

### Launch

Source: `LaunchPane.tsx:52`.

- [ ] Launch string, copy action/copied/failed, native Steam-open vs Steam-closed result.
- [ ] Forbidden flag warning and “removed on save” feedback. **Preview does not strip flags**: its `setProfileLaunchOptions` simply stores the string and always returns `steam_open` (`preview-bridge.ts:559`). Observe the warning UI without treating the simulated persistence as native behavior.
- [ ] Game-running draft, autosave feedback, Never stored explanation.

### Inventory — development only

Sources: `SettingsHost.tsx:1245`, `InventoryPane.tsx:193`, `hooks/useInventorySnapshot.ts`.

- [ ] Navigate via dev sidebar from a populated settings preview. There is no `settings-inventory` URL.
- [ ] Persona summary, blank item-detail panel, 50-slot Backpack page, second page and manual page input.
- [ ] Select Scattergun, named Strange Scattergun on page 2, War Paint and Professional Killstreak Kit, including details disclosure.
- [ ] About this backpack; quality filter open and selected; Name/Quality/Type order; query/no results; Unplaced items.
- [ ] Refreshing, stale snapshot, connection failure/Retry, partial artwork and account-change reset need actual or isolated fixture evidence.
- [ ] Current fixtures deliberately return no artwork; this cannot establish native artwork quality or availability.

## Shared feedback, errors and transitions

| Capture | How to reach or coverage gap |
| --- | --- |
| Game-running banner | `settings-locked`, `locked`, `first-unused-locked`. Preview lock never changes during that session. |
| Maintenance lock | Browser Mods repair flow; update fixtures. Native launch-wait behavior is not simulated by Launch TF2. |
| Degraded lock/listener state | Code exists in `components/WriteLockBanner.tsx:16`; no named fixture. |
| Saving toast | `useAutosave` debounces 700 ms; Saving appears only when a write exceeds 400 ms. Fast preview mutations may skip this transient state. |
| Success toast | Named-pane feedback after a valid preview edit; completion lasts a fresh 1600 ms. |
| Deferred draft toast | Edit supported cvar controls under `settings-locked`; it does not mean Files will autosave. |
| Source-owned persistent error | Unsupported preview import triggers a real **preview-limitation** message. Label it as such, not a production import defect. Other error variants need safe fixtures. |
| Settings read incomplete | `SettingsHost.tsx:1222` retry and cfg-incomplete notices; no named preview. Controls are blocked while Files remains available. |
| Pending changes guard | Make a custom pack draft or Files draft, then Profile → New profile/Change install/switch or update install; guard names panes and routes back to them. |
| Guard with failed, locked or explicit-apply draft | `hooks/useFilesExitGuard.tsx:130`; normal, locked and failed states differ. Capture Save and continue, Discard and continue, Cancel and Open pane. |
| Update banner | `update-available`; Later dismisses only for session. `update-installing` seeds Downloading. Preview install then emits Installing/Restarting immediately, not a real installation. |
| Release notes | `release-notes`, close and external release-link action. |
| Native confirmation dialogs | Cancel launch wait uses `window.confirm` (`App.tsx:309`). Native import pickers and permission/download environments are not browser app modals. |

## Preview fidelity boundaries

1. The viewmodel stage is native-gated (`ViewmodelPane.tsx:78`); it has no browser artwork fallback. Crosshair's scene **does** have a pinned remote Scout background fallback (`crosshair/CrosshairScene.tsx:12`). Stock crosshair sprite decode still fails by design in preview and uses geometry fallback.
2. Crosshair Community picker is disabled outside Tauri (`CrosshairPane.tsx:333`); its image/download methods intentionally return empty/reject in `preview-bridge.ts:673`.
3. Sound audition and WAV picking are disabled outside Tauri (`SoundsPane.tsx:124`); the comfig sound list is a tiny fixture.
4. HUD and mod archive/folder imports throw `PreviewOnly`. Profile ZIP import is fully simulated. Viewmodel VPK import is also simulated immediately and changes the record; it does not open a native picker.
5. HUD artwork URLs point to remote catalog sources. Catalog/stat values are fixtures, not current usage/popularity. The expanded catalog is visibly labeled Preview data.
6. GameBanana fixtures use synthetic names/statistics and placeholder artwork, three records per page, only three category options. They cannot establish the quality/density of real product photos.
7. Inventory is five fixture items across a 300-slot capacity with no images. A redesign should show the intended richer native content only as clearly labeled concept material.
8. Preview writes usually resolve immediately. Real busy/error/progress/locking timing cannot be judged from those paths. External links can still navigate to real websites because the opener is browser-safe, even though application data is simulated.

## Code-backed interaction and accessibility risks

These are evidence from implementation, **not screenshot observations** and not a substitute for keyboard/screen-reader testing.

| Finding | Evidence | Design/audit consequence |
| --- | --- | --- |
| Secondary text has a weak contrast tier. | `index.css:36` sets faint ink to `#6f695c`. Calculated sRGB ratios are 3.44:1 on `#121212`, 3.26:1 on `#181818`, 3.02:1 on `#1f1f1f`; used for 10–12.5 px footer text, paths and eyebrows. Error ink `#b8383b` reaches 2.88:1 on raised panel. | Visually inspect low-contrast metadata at actual scale; establish a legible metadata token and error-text token in every concept. Calculations use opaque colors, so translucent/error surfaces need their own measured pairs. |
| Finder selection lacks a programmatic selected state. | `FinderPanel.tsx:72` uses `data-selected` and an `aria-hidden` dot on a plain button; no radio semantics or `aria-pressed`. | Include keyboard/assistive-tech selection in acceptance criteria, not just an attractive selected card. |
| Crosshair popup claims listbox behavior without full keyboard behavior. | `crosshair/CrosshairChoice.tsx:44` handles Escape/outside pointer; items have `role=option`, but there is no Arrow/Home/End navigation, active-descendant/roving tabindex, first-option focus or explicit focus restore after selection. | Audit opening/choosing/closing using keyboard. Use a consistent accessible choice-grid pattern for the redesign. |
| Native confirmation is outside the themed modal system. | `App.tsx:309` calls `window.confirm` for launch-wait cancellation; most other decisions use `Modal`. | Include this state in the overhaul, retaining the exact cancellation warning and gate. |
| Warnings share the exact accent color. | `index.css:38` brand and `:44` warn are both `#cf6a32`. | Preserve a distinctive warning shape/copy/icon hierarchy; compare selection, primary action and warning simultaneously. Do not solve only by palette. |
| Footer depends on a compact fixed row. | `AppFooter.tsx:43` uses height 28, overflow-hidden and 10 px text; later check-result copy occupies the same row. | Capture minimum width, long update failure feedback and increased text size for clipping or loss of action discoverability. |
| Layout thresholds create a materially different desktop experience. | Native minimum 960 px, sidebar only at `lg`, hero collapse at 1100 px, with a crosshair override from 960 px. Files uses its own full-width workbench. | Inspect 1200 and 960 px and 200% text/zoom; let dense Files and rich browsing panes have purpose-specific layouts in the redesign. |
| Modal keyboard trapping is implemented, but background inerting is limited to modal stacks. | `ui/Modal.tsx:19` marks lower dialogs inert; Tab is intercepted within the top dialog. It does not mark the entire non-modal application inert. The no-scrim pack prompt still has `aria-modal=true`. | Test virtual-cursor/background interaction and pointer behavior. Preserve existing focus restoration, Escape and modal stacking when restyling. This is a test target, not a confirmed assistive-tech failure. |
| Some successful interactions are intentionally transient or silent. | Autosave debounce/delayed Saving, success lifetime, file picker cancellation skips success; `Toast`, `useAutosave`, write runner. | Design status timing and ownership explicitly. A screenshot alone cannot prove the saving contract. |

Useful existing foundations to preserve: `ClassTabs` has roving tabindex and Arrow/Home/End navigation; `Segmented` uses real radio inputs with per-instance names; `Modal` traps Tab, restores focus, handles Escape and layered dialogs; controls frequently have explicit accessible labels; live regions announce saving/progress; the global reduced-motion rule reduces transitions and animations. See `components/ui/ClassTabs.tsx`, `Segmented.tsx`, `Modal.tsx`, `Toast.tsx` and `index.css:139`.

## Design-suite implications

The three options should each use the same comparison set and real tasks, with enough full-size sheets to judge every production pane. Grouping by one functional family per sheet keeps labels readable: Comfig; Binds + Gameplay; HUD browse + installed/options/lightbox; Crosshair + designer/overrides; Viewmodels; Sounds; Mods + GameBanana; Files + tools/menus; Launch; profiles/onboarding; shared feedback/recovery. Inventory can be a clearly labeled future/development extension.

Every option needs a shared shell, type/color/control tokens, dense and spacious page modes, selected/hover/focus/disabled/error states, and a motion storyboard. The current implementation has 150 ms color transitions, 220 ms entry/overlay motion, 500 ms switch-progress width animation, and reduced-motion support. Still images cannot demonstrate timing, interrupted transitions or continuity; include a separate motion specification or prototype after choosing a direction.

Visual freedom must preserve product truth: autosave vs explicit Save/Build/Apply, active-profile scope, Steam-account Inventory scope, game-running draft behavior, trustworthy previews, attributed third-party artwork, and real recovery/write-lock states. Do not invent telemetry, live FPS, cloud profile sharing, inventory trading/reordering, full weapon renders for war-paint swatches, or successful native actions solely to make a mockup look more complete.

## Completion gate for the screenshot audit

- Every current production pane has a settled default image at default native size, plus distinct expanded/modal/selection states above.
- Global onboarding, profile management, imports, recovery, lock, update and pending-draft decisions are included.
- Every capture is labeled with preview/native context, URL/entry action, state, viewport, and whether artwork/data is real or fixture.
- Default and minimum desktop widths, keyboard focus, a reduced-motion observation and meaningful scroll positions are checked.
- Missing native or rare error states are listed as gaps; no claim of “every aspect visually inspected” is made while those gaps remain.
- Findings refer to screenshot IDs when visual, interaction steps when reproduced, and source files when code-backed.
- Three design options have comparable page/state coverage, remain visually distinct across options, and remain internally coherent without copying one page template onto every task.

Only this research report was written by this agent. Product code, versions, backlog, native player data and release state were not changed.
