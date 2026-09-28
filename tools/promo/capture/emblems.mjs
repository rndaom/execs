// Flattens TF2's class emblems into the single-colour masks the app shows, for
// the promo's class row. The source is the owner's own `get_class_icons` dump
// (capture/class-icons.local.json); the PNGs land in the gitignored
// public/local/ and reach only rendered media. Without the dump the promo
// shows class names instead.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { deflateSync } from "node:zlib";
import { flattenEmblem } from "../../../apps/desktop/src/lib/class-icons.ts";

const here = import.meta.dirname;
const dump = process.env.EXECS_CLASS_ICONS ?? path.join(here, "class-icons.local.json");
const out = path.resolve(here, "../public/local/emblems");

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});

function crc32(bytes) {
  let c = 0xffffffff;
  for (const byte of bytes) c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([length, body, crc]);
}

function png(width, height, rgba) {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8; // bit depth
  header[9] = 6; // RGBA
  const rows = Buffer.alloc((width * 4 + 1) * height);
  for (let y = 0; y < height; y += 1) {
    rows[y * (width * 4 + 1)] = 0;
    Buffer.from(rgba.buffer, y * width * 4, width * 4).copy(rows, y * (width * 4 + 1) + 1);
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", header),
    chunk("IDAT", deflateSync(rows)),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

if (!existsSync(dump)) {
  console.log("No class emblem dump; the promo will show class names.");
  process.exit(0);
}
mkdirSync(out, { recursive: true });
const sprites = JSON.parse(readFileSync(dump, "utf8"));
for (const [id, sprite] of Object.entries(sprites)) {
  const mask = flattenEmblem({ ...sprite, rgba: sprite.rgba });
  writeFileSync(path.join(out, `${id}.png`), png(sprite.width, sprite.height, mask));
}
console.log(
  `Wrote ${Object.keys(sprites).length} emblem masks to ${path.relative(process.cwd(), out)}`,
);
