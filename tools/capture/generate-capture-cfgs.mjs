// Generates the capture-session cfg files from matrix.json so the data and
// the capture commands can never drift. Output: tools/capture/out/*.cfg
// Copy the out/ folder contents into tf/cfg/ before the session.
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const matrix = JSON.parse(
  await readFile(join(here, "..", "..", "packages", "preview-matrix", "src", "matrix.json"), "utf8"),
);
const out = join(here, "out");
await mkdir(out, { recursive: true });

const written = [];

// Baseline: pins every module to the capture baseline + hides HUD.
const baseline = [
  "// execs capture baseline — exec once per session, and again after any dxlevel restart",
  ...matrix.captureBaseline.cfg,
  "// camera: run getpos, paste the printed setpos/setang into capture_camera.cfg",
  'echo ">>> baseline applied — exec capture_camera next"',
].join("\n");
await writeFile(join(out, "capture_baseline.cfg"), `${baseline}\n`);
written.push("capture_baseline.cfg");

// Camera placeholder — filled in during the session with getpos output.
await writeFile(
  join(out, "capture_camera.cfg"),
  [
    "// Paste the setpos/setang line printed by `getpos` here, then re-exec.",
    "// Example: setpos 480.1 -1220.5 620.0; setang 4.2 141.7 0",
    'echo ">>> camera.cfg not filled in yet — run getpos, paste, save"',
    "",
  ].join("\n"),
);
written.push("capture_camera.cfg");

// Per-cell capture cfgs.
for (const module of matrix.modules) {
  for (const [level, commands] of Object.entries(module.capture)) {
    const name = `capture_${module.id}_${level}.cfg`;
    const body = [
      `// ${module.label} = ${level}${module.captureNote ? ` — ${module.captureNote}` : ""}`,
      ...commands,
      `echo ">>> ${module.id}=${level} applied. Wait for settle, then: screenshot"`,
    ].join("\n");
    await writeFile(join(out, name), `${body}\n`);
    written.push(name);
  }
}

// Tier composite cfgs — apply a full tier vector at once.
for (const tier of matrix.tiers) {
  const name = `capture_tier_${tier.id}.cfg`;
  const lines = [`// Tier composite: ${tier.label}`];
  for (const module of matrix.modules) {
    const level = tier.vector[module.id];
    lines.push(...module.capture[level]);
  }
  lines.push(`echo ">>> tier ${tier.id} applied. Wait for settle, then: screenshot"`);
  await writeFile(join(out, name), `${lines.join("\n")}\n`);
  written.push(name);
}

console.log(`wrote ${written.length} cfgs to tools/capture/out/`);
console.log(written.join("\n"));
