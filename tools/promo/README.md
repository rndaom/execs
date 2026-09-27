# execs promo

The promo video, its README poster, the README screenshots and the release
announcement graphic. Outside the pnpm workspace: install with
`pnpm install --ignore-workspace` here, after `pnpm install` at the repository root.

## Rebuild

1. **Serve the app's preview** the way a release build looks (Inventory, preview
   labels and catalog gaps compiled out), on port 1433:

   ```bash
   node ../../node_modules/vite/bin/vite.js --config capture/vite.config.ts
   ```

2. **Capture.** `pnpm capture` drives the real interface over the app's preview
   fixtures in headless Chrome (`CHROME_PATH` overrides the Windows default) at
   2x. Video captures go to `public/captures/` (gitignored) with the element boxes
   the video frames on in `public/captures/targets.json`; README screenshots go
   to `docs/media/screen-*.png`. HUD and mod art hosts are blocked, so no
   third-party artwork is captured.

3. **Render.** `pnpm render` writes `out/execs-promo.mp4`; copy it to
   `docs/media/promo.mp4`. Keep it under 10 MB, GitHub's upload limit for README
   video. `pnpm poster` and `pnpm announcement` render the stills. `pnpm studio`
   previews everything.

## Pieces

- `src/timeline.json` is the one clock: 120 BPM at 30 fps, so a beat is 15
  frames. The picture (`src/timing.ts`) and the soundtrack read the same events.
- `music/compose.mjs` synthesizes the soundtrack from scratch (drums, bass,
  brass, a plucked lead and the dot's pop) into `public/local/soundtrack.wav`.
  Nothing is sampled, so there is nothing to license.
- `src/DotField.tsx` redraws the app's backdrop with the app's own `fieldLayout`.
- `src/Stage.tsx` is the app window: camera, cursor, region reveals, orange
  change pops and key presses, all in capture coordinates.
- Class emblems: put the owner's `get_class_icons` result in
  `capture/class-icons.local.json`. The capture server and `capture/emblems.mjs`
  read it, and the emblems land only in gitignored files and rendered media.
  Without it the class row shows names and class tabs show text, as the preview
  does.
