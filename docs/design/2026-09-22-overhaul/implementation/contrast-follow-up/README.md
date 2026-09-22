# Rendered text contrast follow-up — 22 September 2026

**Scoped result: passed.** All **27 meaningful text samples** pass the normal-text **4.5:1** threshold; the lowest is **5.4247:1**. This is a bounded check of current Foundry React UI rendered in Chrome, using the development fixture API at `127.0.0.1:1422`. It includes nine accepted screenshots across HUD, Files, import, App settings and running/deferred states. It is not complete WCAG certification or native WebView2/WebKit contrast qualification.

The inspected product sources were based on `0687af0e44fed7d1f70bc71b1acbe2475ce897ff`; the measured panes and shared CSS had no uncommitted changes at collection. The App settings failure uses the additional development-only fixture described below. This report does not inherit qualification from generated concepts or earlier screenshots. The fixture's HUD catalog values and profile paths are illustrative; no native profile, game or settings writes were made.

## Method and reproducibility

1. Reach each state through its normal UI, save a screenshot, inspect the exact saved image, and read that state's DOM styles. Screenshots 01–09 are 1920 × 889, device pixel ratio 1; the computed font is Inter. [Browser metadata](browser-environment.json) records the observed environment. No viewport override was applied by this audit. An initial stale HUD frame was replaced before acceptance; the retained 01 visibly shows Most downloads and its coverage note.
2. [The read-only collector](collect-rendered-styles.mjs) records the target's computed foreground, placeholder pseudo-element where applicable, font size/weight, bounding box, and every ancestor's computed background, image, opacity, filter, backdrop-filter and blend mode. [Raw observations](raw-observations.json) retain the URL, UTC timestamp and actual viewport for each state. No source token is substituted for a computed color.
3. [The calculation](calculate-contrast.mjs) parses Chrome's RGB/sRGB and Oklab serializations. It converts Oklab to encoded sRGB, composites the text/background through ancestor layers using source-over alpha and group opacity, then computes relative luminance and `(lighter + 0.05) / (darker + 0.05)`. Background images, filters and blend modes are flagged for separate review; none occur in these sampled ancestor chains. The app surfaces are opaque before reaching the browser canvas, so the white fallback is unused.
4. All sampled text is normal-size text; the 4.5 threshold is tested without rounding. Displayed hex values and two-decimal ratios are only summaries. The raw floating-point values remain in [results](contrast-results.json). Run `node docs/design/2026-09-22-overhaul/implementation/contrast-follow-up/calculate-contrast.mjs` from the repo root to reproduce them. The script also checks black/white contrast, equality, alpha blending and Oklab endpoint conversions.

The threshold, placeholder inclusion and use of user-agent colors rather than antialiased glyph pixels follow [W3C's Contrast (Minimum) explanation](https://www.w3.org/WAI/WCAG22/Understanding/contrast-minimum.html). The luminance calculation follows [W3C G18](https://www.w3.org/WAI/WCAG22/Techniques/general/G18); color conversion/compositing references [CSS Color 4](https://www.w3.org/TR/css-color-4/#color-conversion-code).

## Captured states and measured pairs

| Reproduction and evidence | Sample text / foreground | Composed background | Ratio |
| --- | --- | --- | --- |
| `settings-hud-browser` → Most downloads. [01](01-hud-ranking.png) | Search placeholder `#A79C8B`; coverage `#BCB3A3` | `#151310` | 6.86 / 8.93 |
| Same catalog, visible card. [01](01-hud-ranking.png), [02](02-hud-credits.png) | Card statistics and author `#BCB3A3` | `#211E19` | 8.00 |
| Scroll catalog to its credits. [02](02-hud-credits.png) | Credit prose `#A79C8B`; credit link and Casual helper `#BCB3A3` | `#151310` | 6.86 / 8.93 |
| `settings-hud-installed` → Installed. [03](03-hud-caption.png) | Author screenshot caption and schema credit `#BCB3A3` | `#151310` | 8.93 |
| `settings-files` → Problems. [04](04-files-problems.png) | Filter placeholder `#A79C8B` | `#151310` | 6.86 |
| Same real cfglint finding. [04](04-files-problems.png) | Warning badge `#E3BB78`; message `#F0E9DB`; Save is allowed `#BCB3A3` | `#2C2821` | 8.13 / 12.13 / 7.06 |
| `profile-import-huds` → profile menu → Import → Config checks flagged 3 files. [05](05-import-warning-details.png) | File count, preserved-HUD explanation, trust warning and credential finding `#BCB3A3` | `#2C2821` | 7.06 |
| Same import modal. [05](05-import-warning-details.png) | Future Save profile step `#A79C8B` | `#2C2821` | **5.43** |
| Default browser fixture → App settings. [06](06-app-settings.png) | Motion helper, app data path and diagnostics helper `#BCB3A3` | `#211E19` | 8.00 |
| `settings-locked` → Gameplay → Fast weapon switch. [07](07-running-deferred.png) | Running banner `#F0E9DB` | approximately `#2A241A` | 12.76 |
| Same fixture-memory draft. [07](07-running-deferred.png) | Deferred toast `#F0E9DB`; gameplay restriction helper `#A79C8B` | `#2C2821` / `#151310` | 12.13 / 6.86 |
| `settings-app-failure` → App settings → Reduce. [08](08-app-settings-failure.png) | Preference-save error `#F0E9DB` | approximately `#2B201C` | 13.18 |
| Same failure state. [08](08-app-settings-failure.png) | Hovered Retry button and error toast `#F0E9DB` | `#2C2821` | 12.13 |

The banner is a useful compositing check: Chrome reports `oklab(0.812669 0.0173881 0.0950764 / 0.1)` over `rgb(21, 19, 16)`. Its calculated background is about RGB `(41.6, 35.8, 26.4)`. The screenshot's clear interior pixel at `(100, 20)` is `(40, 36, 25)`, within two 8-bit channel values; this spot check is supporting evidence, not a glyph contrast measurement.

## Limits and evidence integrity

No sampled meaningful text failed 4.5:1, and no product contrast change was made. Disabled Save/Trust controls, dimmed content behind the import modal, embedded HUD/game artwork, icon/border contrast, hover/focus states not listed above, display calibration, OS scaling, and all other application pages remain outside this bounded check. The future progress label is included as meaningful text rather than excluded as a disabled control.

The compositor models the solid and alpha backgrounds observed behind these text samples. It does not infer contrast over images, gradient extrema, sibling overlays, generated pseudo-element artwork, or arbitrary clipping from an ancestor list. Those would require separate paint-specific evidence. Screenshots were visually checked for these conditions before accepting samples. Anti-aliasing and JPEG edge pixels are not treated as authored foreground colors.

[Capture provenance](capture-provenance.json) records original-byte SHA-256, decoder format and dimensions. The CUA browser tool returns JPEG bytes despite the retained `.png` filenames; bytes are unchanged. This is separate follow-up evidence and does not change the implementation gallery's primary 85-capture/15-flow/five-board counts.

## App settings failure and validation

The existing fixture bridge always succeeded for preferences. A named `settings-app-failure` fixture now fails its first preference save with a clearly labeled `PreviewOnly` error, leaves persisted fixture preferences unchanged, and accepts the next attempt. It uses the existing active-profile/Comfig seed; open App settings from the sidebar and choose Reduce. The normal production `AppSettingsPane`, preference hook, Alert and toast render the failure. No DOM/CSS injection, native path change, or production error behavior was added. The fixture stays behind the existing development-only adapter import.

[08](08-app-settings-failure.png) shows the failed preference reverted to Follow system with its error and Retry action. The cursor now lies over Retry after the alert moves the layout, so the recorded Retry pair is explicitly its hover state. The error's 10% color composes over the app background; it is not measured against the uncomposited error token. Clicking Retry clears the error and selects Reduce in [09](09-app-settings-retry.png); [DOM verification](retry-verification.json) also records `data-motion="reduce"`. This is fixture-memory behavior only. The separate [native zoom/preference report](../native-windows/zoom-follow-up/README.md), including its [corrected native error capture](../native-windows/zoom-follow-up/10-corrected-settings-error.jpg), has its own executable identities and qualification limits.

Source scope is limited to `preview.ts`, `preview-bridge.ts`, `preview.test.ts` and the new `preview-bridge.app-settings.test.ts`. The two new regression tests check failed-write preservation and successful retry, plus isolation from normal fixtures and other fixture instances. The targeted run passed **5 tests in 2 files**; desktop TypeScript checking and scoped Biome checking also passed. All local report links resolve, and decoded screenshot dimensions match the recorded viewports. The audit tab was closed; no browser viewport override or preference outside fixture memory was changed.
