# Files minimum-width diagnostic

Fresh Chrome preview verified on 2026-09-22 at `http://localhost:1420/?preview=settings-files`. No production files were edited during this diagnostic.

The current compact Find rules **arrive and work in a fresh browser tab**. The actual CSS viewport was 960×640 at DPR 1, document width was 960px, and `matchMedia('(max-width: 1100px)').matches` returned true. CodeMirror's search panel computed five grid tracks: `298.219px 52.0312px 69.5312px 52.2188px 24px`. All Find and Replace actions fit inside the editor.

Evidence: [Find panel](01-find-chrome-960.png), a directly inspected 960×640 capture. The layout is three rows: Find/navigation/close, matching options, then Replace/actions. This confirms the new responsive implementation works in Chrome. It does not prove whether the older IAB result came from stale module CSS or a different effective media-query viewport; that discrepancy needs the IAB's computed styles and `matchMedia` result.

| Visible control | Left–right (CSS px) | Top–bottom (CSS px) |
|---|---:|---:|
| Entire search panel | 397–933 | 222.50–338.25 |
| Find input | 405–696.63 | 232.69–260.69 |
| Next | 709.22–754.66 | 232.69–260.69 |
| Previous | 767.25–830.19 | 232.69–260.69 |
| All | 842.78–888.41 | 232.69–260.69 |
| Close | 901–925 | 234.69–258.69 |
| Match case | 405–480.98 | 268.88–291.88 |
| Regexp | 709.22–761.25 | 268.88–291.88 |
| By word | 767.25–895 | 268.88–291.88 |
| Replace input | 405–696.63 | 300.06–328.06 |
| Replace action | 709.22–830.19 | 300.06–328.06 |
| Replace all | 842.78–918.41 | 300.06–328.06 |

The helper destination also wraps correctly. The unsubmitted helper name `competitive_practice_configuration`, with the helpers destination, produced the full path `tf/cfg/overrides/helpers/competitive_practice_configuration.cfg`. It wraps over three readable lines within a 175px-wide block (x209–384, y446.88–505.38), using `word-break: break-all`; document width remains 960px. [Helper-path screenshot](02-helper-path-chrome-960.png) shows the full wrapped destination and reachable Start editing action. No cfg was created or saved.

The settled console returned no warnings or errors. The viewport override was reset and the dedicated diagnostic tab was closed.
