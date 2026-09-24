# RND-294 — player documentation and promo correction

September 22, 2026. [Authoritative issue](https://linear.app/rndaom/issue/RND-294/correct-installer-platform-and-casual-compatibility-claims-in-player). Public baseline is v0.1.8; Foundry remains unreleased.

This records the September 22 review. The README screenshots and promo GIF were replaced on September 24 during the D7 asset-rights remediation. The hash below identifies the historical render, not the current `docs/media/promo.gif`.

## Corrected claims

- README no longer promises a one-time SmartScreen warning or tells players to keep every flagged download. It identifies absent Authenticode publisher signing, source/version/SHA-256 verification, conditional continuation and managed-device policy. New unsigned versions can receive renewed warnings; source: [Microsoft SmartScreen documentation](https://learn.microsoft.com/en-us/windows/apps/package-and-deploy/smartscreen-reputation), checked September 22.
- Viewmodel compilation is identified as Windows-only; Linux supports prebuilt import.
- The profile write description includes the mastercomfig/vanilla user cfg layers, `config.cfg` and its local Steam Cloud copy. It does not equate a local Cloud file with an acknowledged server round trip.
- Casual preloading is described as supporting selected customizations, subject to server/content/TF2-update limits, with explicit Restore stock files for gameinfo/particle changes. No blanket guarantee or claim that all existing Casual support is broken remains.
- The promo caption now describes optional supported-content preload and Restore. Its general game-lock wording refers to game files, and updates are described as a user choice.

## Media review

All four embedded README screenshots were visually inspected. Their footer says **execs 0.1.0** and they use sample data. They depict an older HUD import layout, older manual Save controls and the pre-0.1.8 Mods arrangement. These are historical demonstrations, not current v0.1.8 screen captures.

README now labels the demo/screenshots as an earlier release with sample data and notes that current layouts/controls differ. Promo screenshot scenes have the same visible earlier-release/sample-data caption. Existing captured media was retained; no unreleased Foundry/Inventory/deletion/Settings images were promoted to shipped-product screenshots.

The changed GIF was rendered from the corrected existing Remotion source. Its reviewed Mods and outro frames are [Mods caption](rnd-294-promo-mods-review.png) and [update choice](rnd-294-promo-outro-review.png). The then-current GIF was 18,619,933 bytes with SHA-256 `cb2c360cf3d7b4a8f539b48de94e63b3ad48fb24af47a05b6148b98e918ce2aa`.

## Validation and limits

- Promo standalone `pnpm exec tsc --noEmit` passed.
- `pnpm render:gif` rendered/encoded all 636 frames successfully (24fps, 800×450, 26.5 seconds).
- Remotion stills at frames 382 and 590 were visually inspected: corrected wording is complete, within bounds and readable; the provenance caption is visible.
- README/promo text was checked against current source, published-version boundaries and the cited primary installer guidance. This documentation correction does not implement Authenticode (optional RND-191), certify every Casual mod, or change product capability.
- No published release, tag or version file changed. The parent must include the concise Unreleased documentation correction with the integrated implementation commit.

RND-294's content/media correction is implemented and locally verified. Keep its final issue disposition tied to the parent integration/changelog review; do not infer that the whole Foundry candidate or native compatibility matrix is complete.
