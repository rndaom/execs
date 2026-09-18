# Sounds browser verification — 2026-09-18

Target: integrated Vite candidate at http://127.0.0.1:1426/?preview=settings-sounds (valid state confirmed from preview.ts; ready is not a named fixture).

- Chrome on Windows via CUA, actual page DOM/accessibility snapshot and screenshots.
- 1200×800: side-by-side hit/kill controls, readable library search/filter/sort and rows, no page horizontal overflow (scrollWidth 1200).
- 960×640: slots stack, navigation becomes horizontal scrolling, search/filter/sort remain readable; no page horizontal overflow (scrollWidth 960). Captured top, slot and filtered library views.
- Accessible names verified on actual DOM: Play Quack (hit sound, Community pack · installed), Play Default ding (kill sound, Built into TF2), contextual catalog assignment buttons, Hit sound volume and Kill sound volume.
- Keyboard selected comfig.app filter; catalog reduced to Kill bell and Quake 3 hit. Assigned Kill bell to kill slot; slot enabled and showed Kill bell. Navigated to Binds then returned using keyboard; assignment and catalog filter/search retained. Search Quake returned only Quake 3 hit.
- Pressing Tab from Assign Quake 3 hit as hit sound moved to its kill assignment. Native button order remains usable.
- Browser warning/error log returned no entries.
- Audition buttons and Add a WAV are intentionally disabled with Needs the desktop app in browser fixtures. No actual audio playback or screen-reader speech tested. Dedicated hook regressions cover stale audition behavior.
- No product defects observed in this fixture. Some CUA click actions did not change the expected state under viewport override; keyboard actions succeeded and were reverified from DOM/screenshots. Do not interpret those failed tool actions as app defects.
- No real profile/game writes. Screenshots and DOM snapshots are fixture data only.

Artifacts: 1200x800.png, 960x640-top.png, 960x640.png, 960x640-library.png, initial-dom.txt, filtered-dom.txt.
