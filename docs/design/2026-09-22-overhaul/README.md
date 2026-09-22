# execs overhaul review

The current development direction uses neutral black, gray and white with TF2 orange selections and necessary highlights, and removes decorative text. The earlier Foundry concept gallery and its **85 accepted captures across 15 pages and flows** document the previous candidate; they are retained as historical evidence and do not verify the revised appearance. The [integrated QA report](design-qa.md) records that earlier implementation and its platform limits. The [combined plan](combined-release-plan.md) records the current direction.

The review is a local screenshot artifact. It makes no native calls, saves no product settings and uses no external dependencies. Its interactive-fixture link opens the separate development app at `http://127.0.0.1:1422/?preview=settings-comfig`; the screenshots show production UI running browser fixture data, not a packaged native session. Inventory remains development-only. No release or deployment is part of this review.

From this directory:

```powershell
python -m http.server 1424 --bind 127.0.0.1
```

Then open [the implementation review](http://127.0.0.1:1424/implementation/review.html). If Python is not on PATH, the bundled runtime is at `C:\Users\Random\.cache\codex-runtimes\codex-primary-runtime\dependencies\python\python.exe`.

## Current implementation review

- `implementation/review.html`, `review.css` and `review.js` provide the page/flow selector, accepted-state choices and accessible full-size viewer.
- `implementation/review-data.json` lists the accepted screenshots, their viewport and limitations, their scoped QA sources, and the relevant Foundry board view. Rejected and superseded captures are excluded explicitly rather than inferred from directory contents.
- Each screenshot appears beside a focused view of its original Foundry board. The board file is unchanged and remains available in full. Generated artwork, names and counts are illustrative; the application and its tests establish real behavior.
- [Review verification](implementation/review-qa.md) records the gallery checks. [Integrated QA](design-qa.md) records the application checks; the gallery does not duplicate or extend native qualification.

Choose a page or flow, then an accepted state. The viewer supports Fit, 100%, zoom controls, keyboard scrolling and Escape. Closing it returns focus to the opening button. Original-file and scoped-QA links remain available beside every comparison. The gallery makes no animated progress claims and has no idle animation.

## Original concept phase — 22 September 2026, before implementation

The [three-direction gallery](index.html) is preserved as design history. At that stage, it was a review artifact rather than an implemented redesign, and no product UI code had changed. Its App settings and profile deletion concepts were planned work; those flows now have implementation evidence in the current review above. Its original “Current app” evidence refers to the pre-overhaul audit, not the implemented Foundry UI.

### Original files and data

The concept collection contains **15 image-generated PNG boards: five per direction, twenty page/state views per direction**, plus 67 pre-overhaul screenshots (66 accepted). Built-in ImageGen produced the boards at 1672 × 941 pixels; they are concept presentation images, not pixel-perfect implementation specs. The complete generation prompt set and screenshot/style references are saved in `options/prompts.json`.

- `index.html`, `gallery.css`, `gallery.js`: static review interface.
- `options/manifest.json`: authoritative option and board metadata, maintained separately. The gallery fetches it without a persistent cache.
- `options/<direction>/<board>.png`: original generated boards. These are never cropped or rewritten by the gallery.
- `audit/captures.json`: authoritative pre-overhaul audit ledger. Records with `accepted: false` are excluded; all other records retain their notes. Screenshot filenames are resolved under `audit/` from the ledger paths.
- The documents section links the concept review, audit, coverage inventory, design research, motion specification and release planning files. `concept-review.md` sits beside this gallery.

The manifest shape is `{ options: [{ id, name, description, palette, boards: [{ file, title, views, note }] }] }`. Board `file` paths are relative to this directory, for example `options/01-foundry/01-core.png`. `palette` accepts an array of hex colors, an array of `{ name, color }` objects, or a name-to-hex-color object. `views` accepts labels or `{ title, status }` objects. Planned/development labels remain visible beside the view names. The gallery tolerates missing images and offers explicit reload/retry actions; it does not poll.

### Reviewing the original concepts

Choose a direction with the tabs. The compact desktop introduction keeps those choices prominent in a 1280×720 window. Arrow keys, Home and End navigate the tab list. Open a board or screenshot for a modal viewer, then use Fit, 100%, zoom controls or the original-file link. Escape closes the viewer. The screenshot evidence is grouped by surface and remains separate from generated concepts. Workspaces boards explicitly identify generated catalog artwork, names and counts as illustrative rather than product data.

The motion section is an abstract timing specimen, not a product prototype. Selecting a direction applies its palette to the samples while preserving the same 150/220 ms timing. Its navigation, menu and dialog demonstrate finite feedback and focus handling. The save example is explicitly simulated and writes nothing; it does not report a real operation or percentage. System reduced motion disables decorative transitions throughout the gallery, with an additional specimen-only toggle. No animations loop or run continuously while idle.

### Original scope and validation

At the concept phase, App settings and profile deletion boards described planned work. Inventory is development-only and is not assigned to release shipment by its inclusion here. Browser fixture evidence cannot verify native disk, Steam, media or installer behavior. Image-generated concepts do not establish text accuracy or accessible implementation.

The gallery can be syntax-checked with `node --check gallery.js` and served with the standard-library Python server above. Visual and keyboard verification should use the gallery in the browser after the manifest and images are present. All review assets stay local; no deployment is part of this artifact.

Concept-phase checks are saved in `verification.json`: all 15 boards decode and return HTTP 200, all 67 source captures exist, gallery JavaScript syntax passes, and option keyboard navigation, image zoom, evidence viewing, menu/dialog focus, finite feedback and reduced-motion controls were exercised in the browser. Product tests were not part of that concept-only phase; current application validation is in [integrated QA](design-qa.md). `options/generation-record.json` records the built-in generation outputs; `options/prompts.json` preserves the exact briefs. The [capture coverage](audit-coverage.md) explains the original visual audit's limits.
