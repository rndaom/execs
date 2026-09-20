# Files pane audit — 0.1.7 usability hotfix

## Audit scope

The Files pane from the public 0.1.7 maintenance line, exercised in the supported browser preview
at the desktop app's 1200×800 window size. The user goal is to find a TF2 cfg, edit it, understand
problems, and save without learning a custom page structure.

## Released flow

1. **Open the Files pane — unhealthy.** The editor is visible, but five equal-weight actions sit
   above it and the file list is hidden. The screen does not establish a primary path.

   ![Released Files pane](01-released-files-pane.png)

2. **Open a file — unhealthy.** “Open file” appends a large search-and-file section below the
   editor and scrolls the editor away. Selecting another file requires reopening that section.

   ![Released file picker](02-open-file-picker.png)

3. **Review Problems — unhealthy.** Problems appears as another full card below the editor. The
   user loses the code context that the finding refers to.

   ![Released Problems panel](03-problems-panel.png)

4. **Use Reference — unhealthy.** Reference immediately exposes source provenance, defaults,
   restrictions, guides and snippets as one long document. Useful detail overwhelms the command
   the user is trying to understand.

   ![Released Reference panel](04-reference-panel.png)

5. **Create a cfg — poor.** New cfg is separated from file navigation and appears below the editor,
   so a basic file action feels like a second page.

   ![Released New cfg panel](05-new-cfg-panel.png)

## Findings

The editor itself is capable: syntax color, per-file drafts, completion, search, line navigation,
analysis and explicit saving are all present. The layout hides those strengths.

The structural problems are the hidden file hierarchy, equal emphasis across unrelated actions,
and panels that join normal document flow after the editor. Copy compounds the problem by
explaining implementation limits and provenance before the user asks for them. From the captured
screens, focusable controls and labels exist, but keyboard order becomes long and spatial context
changes whenever a panel opens. Contrast, screen-reader output and complete keyboard behavior need
separate testing; screenshots alone cannot establish WCAG compliance.

## Implemented direction

The hotfix replaces the stacked page with a conventional workbench. Explorer is persistent, the
editor never changes identity or location, New cfg opens inside Explorer, and Problems, Reference
and file info share one lower tool panel. Reference starts with the active command and keeps
details, guides and snippets collapsed until requested.

![Redesigned Files workbench](10-redesigned-files-workbench.png)

![Integrated Problems panel](11-redesigned-problems-panel.png)

![Compact Reference panel](12-redesigned-reference-panel.png)

![New cfg in Explorer](13-redesigned-new-cfg.png)

The same two-column workbench remains usable at the app's 960×640 minimum size.

![Minimum-size verification](14-redesigned-minimum-size.png)

## Simplification pass

Follow-up review found that the first workbench still repeated paths and the selected filename,
gave three secondary tools the same weight as Save, and exposed every New cfg preset at once. The
second pass keeps one obvious path through the screen:

1. **Choose a file — healthy.** The persistent list shows names only. Full paths and ownership
   remain available through accessible labels, tooltips and file info.
2. **Edit and save — healthy.** The filename and Save share one header. Discard appears only after
   an edit; Find and Wrap are the only editor tools shown by default.
3. **Review Problems — healthy.** One status-bar action opens a contextual drawer with This file
   and All files scopes and human line labels.
4. **Get command help — healthy.** Help starts with the command under the cursor; deeper details,
   guides and snippets remain collapsed.
5. **Create a cfg — healthy.** Startup, Class or Helper is the first decision. Class choices and
   helper naming appear only when selected.

![Simplified Files editor](20-simplified-files-editor.png)

![Simplified Problems drawer](21-simplified-problems.png)

![Contextual Help drawer](22-simplified-help.png)

![Progressive New cfg flow](23-simplified-new-cfg.png)

The screenshots establish hierarchy, density and visible labels. Full keyboard order,
screen-reader announcements, focus recovery and contrast still require dedicated accessibility
testing; screenshots alone cannot establish WCAG compliance.

## Drawer polish

The expanded tools received a final density and hierarchy pass after the simplified workbench was
reviewed in the running dev app.

1. **Review Problems — healthy.** A compact segmented scope control replaces the oversized action
   buttons. Each finding is now a distinct issue row with location, severity and save impact, so it
   reads like an editor problem list instead of a block of explanatory copy.

   ![Problems before drawer polish](30-before-drawer-polish-problems.png)

   ![Polished Problems drawer](32-polished-problems.png)

2. **Open Help — healthy.** The active command stays in one compact summary row. Details, Guides
   and Snippets use a stable section switcher rather than three nested expanding cards.

   ![Help before drawer polish](31-before-drawer-polish-help.png)

3. **Browse Guides — healthy.** The selected section receives the full drawer width, search remains
   visible, and guide rows use consistent disclosures. Opening either drawer temporarily yields
   editor height so useful content is visible without another scroll hunt.

   ![Polished Help guides](33-polished-help-guides.png)

These screenshots verify the visible hierarchy, density and expanded states at 1200×800. Keyboard
order, screen-reader announcements, focus recovery and measured color contrast remain outside this
visual audit and need dedicated accessibility testing.

## Editor interaction polish

The final pass addresses the remaining editor chrome and secondary-action friction at 1200×800.

1. **Focus the editor — healthy.** The CodeMirror content outline previously produced a brand-color
   rule through the middle of short files. Focus now remains visible through the caret and active
   line without drawing that stray divider.

   ![Editor focus before polish](40-before-editor-chrome.png)

   ![Clean focused editor](43-clean-editor-focus.png)

2. **Open and close Find — healthy.** The raw CodeMirror controls are now a compact two-row toolbar
   with consistent fields, buttons and option toggles. The visible Find control reports its open
   state and closes the panel when pressed again; Escape and the close control remain available.

   ![Find before polish](41-before-find-panel.png)

   ![Polished Find panel](42-polished-find-panel.png)

3. **Right-click a file — healthy.** File info is removed from permanent chrome. The context menu
   offers Open or Focus, Problems, cfg relationships, Copy path, the owning settings pane when one
   exists, Discard changes only for dirty drafts, and New cfg.

   ![File context menu](44-file-context-menu.png)

4. **Right-click the editor — healthy.** The editor menu exposes Undo, Redo, Copy, Select all,
   Find, line wrapping, Save, Problems and command Help. Unavailable actions remain visibly disabled;
   arrow keys traverse the menu and Escape dismisses it.

   ![Editor context menu](45-editor-context-menu.png)

The screenshots establish the visual hierarchy and visible states. Automated interaction tests
cover Find toggling and both menu paths. Screen-reader announcements, high-contrast mode and full
keyboard traversal across the surrounding pane still need dedicated accessibility testing.

## Capability completion pass

A current-run audit of the revised workbench found that the remaining high-value gaps were file
identity and destination choices, not another visual restructure. The completion pass keeps those
operations inside the verified profile layer and leaves rename, delete and arbitrary operating-
system destinations out of this patch because they require new native transactions.

![Workbench before capability completion](50-before-capability-pass.png)

![New cfg before location choices](51-before-new-cfg-location.png)

![Square search highlight before polish](52-before-search-highlight.png)

1. **Save a copy — healthy.** File actions and the editor menu now expose Save as new cfg, and
   Ctrl+Shift+S opens the same compact form. Editable drafts and provided read-only cfgs can become
   a new user file without changing the original. The form defaults to a unique name, offers Root,
   helpers and a validated custom folder, shows the exact resolved path, and refuses collisions.

   ![Save as new cfg](54-after-save-as.png)

2. **Choose where a helper goes — healthy.** New cfg now treats file name and location as separate
   decisions. Startup and class files remain fixed at the loader root; helpers can use Root,
   helpers, represented safe folders or a validated custom subfolder. Existing targets say Open
   existing rather than silently reusing a file under a creation label.

   ![New cfg location picker](55-after-new-cfg-location.png)

3. **Find a match — healthy.** Ordinary matches use a subtle rounded neutral wash. The current
   match adds a neutral inset ring, so search state is clear without another brand-orange block.

   ![Rounded Find highlights](56-after-search-highlights.png)

4. **Navigate files — healthy.** The Explorer filter now describes its real path-filter behavior,
   duplicate basenames gain a muted parent suffix only when needed, and Arrow/Home/End plus
   Shift+F10 work from file rows. Ctrl+N opens New cfg, Alt+Z toggles wrapping, and menus return
   focus to their invoker when dismissal leaves focus on the document body.

Automated tests cover path-validation parity, vanilla and mastercomfig destinations, case-insensitive
collisions, read-only copy failure recovery, draft identity transfer, keyboard shortcuts, duplicate
labels and rounded search styling. Screenshots still cannot establish screen-reader announcement
quality, Windows high-contrast behavior, zoom reflow or measured WCAG contrast; those remain the
limits of this visual audit.
