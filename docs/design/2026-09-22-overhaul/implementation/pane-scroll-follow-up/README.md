# RND-291 pane scroll and Files draft follow-up

The Sounds → Mods → Files browser sequence passes at 1200×800 and 960×640 after a targeted Files editor lifecycle correction. First visits start at the heading; revisits restore separate pane offsets; the exact unsaved Files text and backward selection survive navigation and resizing.

This is browser fixture evidence from `http://localhost:1420/?preview=settings-sounds`, captured in Chrome through the documented fallback for unavailable in-app browser automation. It is not native Windows or Linux evidence. No sound assignment, mod installation, Files Save, game launch or native file write was performed. The only edited document was the disposable browser draft included here.

## Finding and correction

**P2 — Files lost its internal editor scroll when revisited.** The existing per-document cache read `scrollTop` in passive effect cleanup. React had already hidden the retained Files pane, so the browser reported zero. The draft, selection, undo history and outer workspace scroll survived, leaving the editor at its beginning with a later selected line still reported in its status.

The correction in `FilesEditor.tsx` captures the document state and scroll before React changes visibility or removes the editor. It retains the same profile/path cache and destroys inactive editor views as before. Restoration uses CodeMirror's scroll snapshot as well as the initial pixel coordinates, keeping virtualized line measurements from shifting the restored position. A cache is reused only for identical document text. The boundary renders no DOM and changes no layout or persistence flow.

| Before correction | Outer Files scroll | Internal editor scroll |
| --- | ---: | ---: |
| 1200×800 round trip | 278 → 278 | **1009 → 0** |
| Resize the retained draft to 960×640, then round trip | 438 → 438 | **1309 → 0** |

The first comparison is visible in [before navigation](07-files-scrolled-1200.png) and [lost editor scroll](10-files-restored-1200.png). The narrow comparison is recorded in [before navigation](11-files-before-navigation-960.png), [after navigation](12-files-lost-scroll-960.png), and the zero-scroll entry in [draft observations](draft-observations.json). At the narrow outer offset, the editor is above the viewport; its internal offset was read from the rendered scroll element without moving focus.

## Final behavior

The final fresh-fixture sequences use the same controls at each size. All values below are CSS pixels from the actual rendered DOM.

| Viewport | Sounds outer scroll | Mods outer scroll | Files outer scroll | Files internal scroll |
| --- | ---: | ---: | ---: | ---: |
| 1200×800 | 1724 → 1724 | 1077 → 1077 | 278 → 278 | **1009 → 1009** |
| 960×640 | 1804 → 1804 | 1867 → 1867 | 438 → 438 | **1129 → 1129** |

The different narrow starting editor offset follows a fresh 960×640 session; the original narrow reproduction instead resized the existing 1200×800 draft. Restoration is compared against each sequence's own measured starting offset.

The original resized-session baseline was also repeated after the fix: **outer 438 → 438 and internal 1309 → 1309**, with the same exact draft and selection. See [matched baseline](42-matched-files-baseline-960.png) and [matched restored workspace](43-matched-files-restored-960.png). The preceding [resize baseline](40-resized-files-baseline-960.png) and [settled return](41-resized-files-restored-960.png) retain the selected line in view before moving the outer workspace to the identical original offset.

| First visit | 1200×800 | 960×640 |
| --- | --- | --- |
| Sounds | scroll 0; heading y=81 · [capture](20-sounds-first-fixed-1200.png) | scroll 0; heading y=81 · [capture](30-sounds-first-fixed-960.png) |
| Mods | scroll 0; heading y=81 · [capture](21-mods-first-fixed-1200.png) | scroll 0; heading y=81 · [capture](31-mods-first-fixed-960.png) |
| Files | scroll 0; heading y=73 · [capture](22-files-first-fixed-1200.png) | scroll 0; heading y=73 · [capture](32-files-first-fixed-960.png) |

Restored views: [Sounds 1200](24-sounds-restored-fixed-1200.png), [Mods 1200](25-mods-restored-fixed-1200.png), [Files 1200](26-files-restored-fixed-1200.png), [Sounds 960](34-sounds-restored-fixed-960.png), [Mods 960](35-mods-restored-fixed-960.png), and [Files 960](36-files-restored-fixed-960.png). The [960 editor reveal](37-files-editor-restored-fixed-960.png) then focuses Wrap through ordinary Tab navigation, scrolling only the outer workspace so the retained editor position can be seen.

## Reproduction and draft identity

1. Open the Sounds fixture. Focus Quack's Kill action and press Tab to the next sound's Hit action. Do not activate either action.
2. Focus the Sounds navigation item, press Tab to Mods, then Enter. Focus the Preview mod 13 details button and press Tab to its Install button without activating it.
3. Focus Mods navigation, press Tab to Files, then Enter. Paste [disposable-draft.cfg](disposable-draft.cfg) into `tf/cfg/overrides/autoexec.cfg`, without Save.
4. Use Ctrl+End, Up, End, then 16 × Shift+Left to select `keep this phrase` backward on line 69. Open Help → Guides; focus “Exec paths and load order” and press Tab to “Server and cheat restrictions.” This produces a nonzero outer Files offset while preserving a separate nonzero editor offset.
5. From Files navigation use Shift+Tab twice, then Enter for Sounds. Tab/Enter then opens Mods and Files in turn. Read each scroll offset before focusing a control inside the restored pane.
6. Copy the existing selection, then Ctrl+A/Ctrl+C to compare the full text byte-for-byte. Re-establish the same backward selection after this diagnostic copy. Resize with the draft active in both directions, verify the selection and bytes again, and confirm the active navigation item remains visible.

Every final copy comparison matched **2,470 UTF-8 bytes**, LF line endings and the trailing LF. The draft includes literal tabs and doubled spaces. SHA-256:

```text
ffa9a7f314dbf11805e58c834b14a3d17e290e440efe53e90f4e02b34b587024
```

The selected phrase, anchor offset 37 and head offset 21 in `// selection anchor: keep this phrase` were unchanged; the status remained Ln 69, Col 22. [Resize to 960](27-files-resize-960.png) and [resize to 1200](38-files-resize-1200.png) retain the draft and show the active Files navigation item. All recorded active items were fully inside the navigation scroll region. The document root stayed at scrollY=0 with scrollWidth equal to the requested viewport width.

## Validation and evidence boundaries

- The new behavioral regression fails on the old implementation (`0` instead of `380`) and passes after the correction. It models the browser returning zero for hidden or detached scroll elements, checks vertical and horizontal restoration across pane hiding, path changes and full unmount/remount, and confirms draft text, backward selection, Undo and no Save call.
- `pnpm --filter @execs/desktop test src/components/FilesEditor.test.tsx`: **10 tests pass**.
- `pnpm --filter @execs/desktop exec tsc --noEmit`: **passes**.
- The screenshot files retain the original bytes returned by the browser tool. [Capture dimensions](captures.json) lists each actual size and format. Every image is exactly 1200×800 or 960×640 as named.
- [Scroll observations](scroll-observations.json) records before, intermediate and final passes. Entries prefixed `intermediate snapshot-only` belong to the first correction, before CodeMirror's scroll snapshot was added; the final table uses only entries prefixed `final`.
- Measurements made in the same interaction call can precede CodeMirror's next layout frame. The additional resized run records that transient value (1099) and the settled value (1309); the screenshot and final matched comparison use the settled position.
- [Draft observations](draft-observations.json) records selection, hashes, byte counts and line endings from the UI clipboard checks. No hidden React or CodeMirror state was read in the browser.

The working-tree change is limited to `FilesEditor.tsx` and its interaction test. Outer pane memory, shared layout, native commands and the draft persistence policy were not modified. Temporary browser viewport overrides were reset and test tabs closed after capture.
