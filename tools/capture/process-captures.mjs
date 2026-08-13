// Crops raw capture screenshots to 16:9 and emits 1600/800/400w WebP with the
// exact R2 key names the preview UI expects. Requires `sharp` (dev machine
// only): run `npm i sharp` inside tools/capture first.
// Input:  tools/capture/raw/s1-module-shadows-off.jpg, s1-tier-high.jpg, ...
// Output: tools/capture/processed/preview-matrix/v1/s1/module/shadows-off_1600.webp ...
import { mkdir, readdir, readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const matrix = JSON.parse(
  await readFile(join(here, "..", "..", "packages", "preview-matrix", "src", "matrix.json"), "utf8"),
);
const { default: sharp } = await import("sharp");

const rawDir = join(here, "raw");
const outRoot = join(here, "processed");
const WIDTHS = [1600, 800, 400];
const RE = /^(?<scene>s\d+)-(?<kind>module|tier)-(?<rest>.+)\.(jpg|jpeg|png)$/i;

const uploads = [];
for (const fileName of await readdir(rawDir)) {
  const match = fileName.match(RE);
  if (!match?.groups) {
    console.warn(`skipping unrecognized file: ${fileName}`);
    continue;
  }
  const { scene, kind, rest } = match.groups;
  const key = kind === "tier" ? rest : rest; // module files already "module-level"
  const source = sharp(await readFile(join(rawDir, fileName)));
  const meta = await source.metadata();
  const targetHeight = Math.round((meta.width / 16) * 9);
  const cropped = source.extract({
    left: 0,
    top: Math.max(0, Math.round((meta.height - targetHeight) / 2)),
    width: meta.width,
    height: Math.min(meta.height, targetHeight),
  });
  for (const width of WIDTHS) {
    const r2Key = `preview-matrix/${matrix.version}/${scene}/${kind}/${key}_${width}.webp`;
    const outPath = join(outRoot, r2Key);
    await mkdir(dirname(outPath), { recursive: true });
    await cropped.clone().resize({ width }).webp({ quality: 82 }).toFile(outPath);
    uploads.push(r2Key);
  }
}

console.log(`processed ${uploads.length} images into tools/capture/processed/`);
console.log("\nUpload commands:");
for (const key of uploads) {
  console.log(
    `npx wrangler r2 object put execs-media/${key} --file "tools/capture/processed/${key}"`,
  );
}
console.log(
  "\nThen set capturesAvailable: true in packages/preview-matrix/src/matrix.json and redeploy.",
);
