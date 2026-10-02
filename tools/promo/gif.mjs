// The README GIF: the promo without sound, at 960 px and the video's own 30 fps.
//
//   node gif.mjs [out.gif]      (default out/execs-promo.gif)
//
// Frames are rendered losslessly (an H.264 source's noise doubles the GIF),
// each scene gets its own 256-colour palette so the Inventory keeps TF2's
// quality tints, and the scenes are joined into one looping GIF by giving
// every frame its scene's palette as a local colour table.
import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";

const here = import.meta.dirname;
const outFile = path.resolve(process.argv[2] ?? path.join(here, "out/execs-promo.gif"));
const work = path.join(here, "out/gif");
const frames = path.join(work, "frames");
const cli = path.join(here, "node_modules/@remotion/cli/remotion-cli.js");
const timeline = JSON.parse(readFileSync(path.join(here, "src/timeline.json"), "utf8"));

const FPS = timeline.fps;
const frameAt = (name) => {
  const [bar, beat] = timeline.events[name];
  return Math.round((bar * 4 + beat) * (60 / timeline.bpm) * FPS);
};
const TOTAL = frameAt("end") + FPS;
/** Scene starts; the Inventory panel fades in four frames before its beat. */
const CUTS = [
  0,
  frameAt("drop"),
  frameAt("news"),
  frameAt("inventory") - 4,
  frameAt("outro"),
  TOTAL,
];

// Run from this folder so the frame directory can be passed relative: Remotion
// rejects an absolute output path whose parent folders contain a dot.
const remotion = (...args) =>
  execFileSync(process.execPath, [cli, ...args], { stdio: "inherit", cwd: here });

rmSync(work, { recursive: true, force: true });
mkdirSync(frames, { recursive: true });
remotion(
  "render",
  "Promo",
  path.relative(here, frames),
  "--sequence",
  "--image-format=png",
  "--scale=0.5",
  "--log=warn",
);

const scenes = [];
for (let index = 0; index < CUTS.length - 1; index += 1) {
  const [start, end] = [CUTS[index], CUTS[index + 1]];
  const input = [
    "-framerate",
    String(FPS),
    "-start_number",
    String(start),
    "-i",
    path.join(frames, "element-%04d.png"),
  ];
  const palette = path.join(work, `palette-${index}.png`);
  const gif = path.join(work, `scene-${index}.gif`);
  remotion(
    "ffmpeg",
    "-v",
    "error",
    "-y",
    ...input,
    "-frames:v",
    String(end - start),
    "-vf",
    "palettegen=max_colors=256:stats_mode=full",
    palette,
  );
  remotion(
    "ffmpeg",
    "-v",
    "error",
    "-y",
    ...input,
    "-i",
    palette,
    "-lavfi",
    "[0:v][1:v]paletteuse=dither=bayer:bayer_scale=5:diff_mode=rectangle",
    "-frames:v",
    String(end - start),
    "-loop",
    "0",
    gif,
  );
  scenes.push(readFileSync(gif));
}

/** One GIF's parts: screen descriptor, global colour table, and its blocks after them. */
function parse(bytes) {
  if (bytes.toString("latin1", 0, 6) !== "GIF89a") throw new Error("Not a GIF89a file");
  const packed = bytes[10];
  const tableSize = packed & 0x80 ? 3 * 2 ** ((packed & 7) + 1) : 0;
  const table = bytes.subarray(13, 13 + tableSize);
  const blocks = [];
  let offset = 13 + tableSize;
  const skipSubBlocks = () => {
    while (bytes[offset] !== 0) offset += bytes[offset] + 1;
    offset += 1;
  };
  while (bytes[offset] !== 0x3b) {
    const start = offset;
    if (bytes[offset] === 0x21) {
      const label = bytes[offset + 1];
      offset += 2;
      skipSubBlocks();
      blocks.push({
        kind: label === 0xff ? "application" : "extension",
        bytes: bytes.subarray(start, offset),
      });
    } else if (bytes[offset] === 0x2c) {
      const descriptor = bytes[offset + 9];
      const localSize = descriptor & 0x80 ? 3 * 2 ** ((descriptor & 7) + 1) : 0;
      offset += 10 + localSize + 1;
      skipSubBlocks();
      blocks.push({ kind: "image", bytes: bytes.subarray(start, offset), hasLocal: localSize > 0 });
    } else {
      throw new Error(`Unexpected GIF block 0x${bytes[offset].toString(16)} at ${offset}`);
    }
  }
  return { screen: bytes.subarray(6, 13), table, tableSizeBits: packed & 7, blocks };
}

const parsed = scenes.map(parse);
const first = parsed[0];
const parts = [Buffer.from("GIF89a", "latin1")];
// No global table: every frame carries its scene's palette.
const screen = Buffer.from(first.screen);
screen[4] &= 0x70;
parts.push(screen);
const loop = first.blocks.find((block) => block.kind === "application");
if (loop) parts.push(loop.bytes);
for (const scene of parsed) {
  for (const block of scene.blocks) {
    if (block.kind === "application") continue;
    if (block.kind !== "image" || block.hasLocal) {
      parts.push(block.bytes);
      continue;
    }
    // Image descriptor, then this scene's palette as the local colour table.
    const descriptor = Buffer.from(block.bytes.subarray(0, 10));
    descriptor[9] = (descriptor[9] & 0x40) | 0x80 | scene.tableSizeBits;
    parts.push(descriptor, scene.table, block.bytes.subarray(10));
  }
}
parts.push(Buffer.from([0x3b]));
mkdirSync(path.dirname(outFile), { recursive: true });
writeFileSync(outFile, Buffer.concat(parts));
const frameCount = parsed.reduce(
  (sum, scene) => sum + scene.blocks.filter((b) => b.kind === "image").length,
  0,
);
console.log(
  `Wrote ${path.relative(process.cwd(), outFile)}: ${frameCount} frames, ${(Buffer.concat(parts).length / 1e6).toFixed(1)} MB`,
);
