# Preview matrix capture session — checklist

One sitting, roughly 30–40 minutes. Produces every screenshot the preview
system needs for scene 1 (`pl_upward`). Scene 2 (water, `koth_sawmill`) is a
later, shorter session.

## Prep (once)

1. `node tools/capture/generate-capture-cfgs.mjs`
2. Copy everything from `tools/capture/out/` into `Team Fortress 2/tf/cfg/`
3. Launch options for the session: `-novid -windowed -w 1920 -h 1080`
   (fixed resolution keeps every shot aligned; remove afterwards)
4. TF2 stores screenshots in `tf/screenshots/` as `.jpg` (with `jpeg_quality
   100` from the baseline cfg) — clear the folder first so the session's shots
   are easy to collect.

## In-game setup

1. Create a local server: `map pl_upward`
2. Console: `exec capture_baseline`
3. Walk/noclip to the BLU spawn exit overlook (pick a vista with buildings,
   terrain, props, and skybox — you'll keep this exact view for every shot)
4. `getpos` → copy the printed `setpos …; setang …` line into
   `tf/cfg/capture_camera.cfg` (alt-tab, edit, save)
5. `exec capture_camera` — verify the view snaps back to the same spot.
   From here on: NEVER move the mouse during captures; re-exec
   `capture_camera` before every screenshot.

## Capture loop

For each cfg below: `exec <name>`, then `exec capture_camera`, wait ~3s for
textures/materials to settle, then `screenshot`. Note the mapping of
screenshot number → cell in a scratch file as you go (the shots are numbered
sequentially by the engine).

Module cells (order matters only where noted):

- capture_shadows_off / _low / _high
- capture_textures_low / _medium / _high / _ultra   (each needs ~3s settle)
- capture_lighting_low / _medium / _high            (run `mat_reloadallmaterials` after each, then re-exec camera)
- capture_lod_low / _medium / _high                 (fully correct only after `map pl_upward` reload — do these three with a reload each, re-exec baseline + camera after)
- capture_gibs_on + capture_ragdolls_on, then _off: stage with `bot -team red -class soldier`; crit rocket the bot from the same spot; screenshot the corpse corner both ways. Imperfect alignment is fine for these two — they're binary.

After each module's cells: `exec capture_baseline` + `exec capture_camera`
to reset before the next module.

Tier composites (baseline NOT needed between these — each cfg sets everything):

- capture_tier_stock / _low / _medium-low / _medium / _high / _ultra
  (each: exec, `mat_reloadallmaterials`, exec capture_camera, settle, screenshot)

Total: ~15 module shots + 2 staged pairs + 6 tier shots ≈ 25 screenshots.

## Afterwards

1. Collect `tf/screenshots/*.jpg`, rename per your scratch mapping to:
   `s1-module-<module>-<level>.jpg` and `s1-tier-<tier>.jpg`
2. Drop them in `tools/capture/raw/`
3. `node tools/capture/process-captures.mjs` — crops to 16:9, emits
   1600/800/400w WebP into `tools/capture/processed/` with final R2 names
4. Upload: `npx wrangler r2 object put` per file (script prints the exact
   commands), then flip `capturesAvailable` to `true` in
   `packages/preview-matrix/src/matrix.json`
5. Remove the capture cfgs from `tf/cfg/` and clear the launch options
