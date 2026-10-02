# execs promo

The promo video, the README's GIF and screenshots, and the release announcement
graphic. Outside the pnpm workspace: install with `pnpm install --ignore-workspace`
here, after `pnpm install` at the repository root.

## Rebuild

1. **Serve the app's preview** the way a release build looks, on port 1433:

   ```bash
   node ../../node_modules/vite/bin/vite.js --config capture/vite.config.ts
   ```

   `capture/vite.config.ts` changes nothing in `apps/desktop`; it edits the
   served modules. Development-only labels are compiled out, Steam already has
   the sample profile's launch options, Sounds starts from TF2's default sound,
   and the Inventory runs the app's own simulator with the release app's live
   wording. Each edit names its exact anchor and fails loudly when the app
   changes under it.

2. **Capture.** `pnpm capture` drives the real interface in headless Chrome
   (`CHROME_PATH` overrides the Windows default) at 2x and writes three sets:
   video captures to `public/captures/` (gitignored) with the element boxes the
   video frames on in `public/captures/targets.json`, the News tiles as
   `public/captures/tile-*.png` from a narrower layout drawn larger, and the
   README screenshots to `docs/media/screen-*.png`. HUD and mod art hosts are
   blocked, so no third-party HUD or mod artwork is captured.

3. **Render.** `pnpm render` writes `out/execs-promo.mp4` with sound for other
   platforms. `pnpm gif` writes the README's silent `out/execs-promo.gif`; copy it
   to `docs/media/promo.gif`. `pnpm announcement` renders the release graphic, and `pnpm readme` the
   README's header and install-steps images into `docs/media/`.
   `pnpm studio` previews everything.

## Local sources

Two inputs stay on the owner's machine and reach only rendered media:

- **Class emblems.** Put the `get_class_icons` result in
  `capture/class-icons.local.json`; the capture server and `capture/emblems.mjs`
  read it. Without it the class row shows names.
- **The backpack.** `capture/backpack.ts` builds the Inventory scenes from the
  Inventory art cache in the execs data dir (`EXECS_DATA_DIR` overrides it):
  Valve's item images and descriptions for the owner's public inventory, with
  synthetic item IDs and no Steam persona, avatar, account ID or "Crafted by"
  lines. Everything past page one is protected, and the crafted hat is one of
  the backpack's own. Without a cache the preview's test backpack appears.

## Pieces

- `src/timeline.json` is the one clock: 120 BPM at 30 fps, so a beat is 15
  frames. The picture (`src/timing.ts`) and the soundtrack read the same events.
- `music/compose.mjs` synthesizes the soundtrack from scratch (drums, bass,
  brass, a plucked lead, bells, the dot's pop and the Inventory's sounds) into
  `public/local/soundtrack.wav`. Nothing is sampled, so there is nothing to
  license.
- `src/DotField.tsx` redraws the app's backdrop with the app's own `fieldLayout`.
- `src/Stage.tsx` is the app window: camera, cursor, region reveals, item tiles
  that fly between slots, orange change pops, dot bursts and key presses, all in
  capture coordinates.
- `gif.mjs` renders lossless frames at 960 px (an H.264 source's noise doubles a
  GIF), gives each scene its own 256-colour palette so item art keeps TF2's
  quality tints, and joins the scenes into one looping GIF.
