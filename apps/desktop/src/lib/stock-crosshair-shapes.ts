import type { StockCrosshairFile } from "./gameplay-ui";

/**
 * Frame-0 geometry of Valve's stock crosshair sprites, extracted from
 * materials/vgui/crosshairs/*.vtf in tf2_textures_dir.vpk (64×64 DXT5).
 * Coordinates live in the sprites' own 64×64 space; the preview scales the
 * whole viewBox by cl_crosshair_scale / 32, matching the engine's scale rule.
 */
export type StockShapePrimitive =
  | { kind: "rect"; x: number; y: number; w: number; h: number }
  | { kind: "ring"; cx: number; cy: number; r: number; stroke: number }
  | { kind: "disc"; cx: number; cy: number; r: number }
  | { kind: "line"; x1: number; y1: number; x2: number; y2: number; w: number };

const ARM_TOP: StockShapePrimitive = { kind: "rect", x: 31, y: 17, w: 2, h: 10 };
const ARM_BOTTOM: StockShapePrimitive = { kind: "rect", x: 31, y: 37, w: 2, h: 10 };
const ARM_LEFT: StockShapePrimitive = { kind: "rect", x: 17, y: 31, w: 10, h: 2 };
const ARM_RIGHT: StockShapePrimitive = { kind: "rect", x: 37, y: 31, w: 10, h: 2 };
const CENTER_DOT: StockShapePrimitive = { kind: "rect", x: 31, y: 31, w: 2, h: 2 };

const STOCK_CROSSHAIR_SHAPES: Record<Exclude<StockCrosshairFile, "">, StockShapePrimitive[]> = {
  crosshair1: [ARM_TOP, ARM_BOTTOM, ARM_LEFT, ARM_RIGHT, CENTER_DOT],
  crosshair2: [ARM_BOTTOM, ARM_LEFT, ARM_RIGHT, CENTER_DOT],
  crosshair3: [{ kind: "ring", cx: 32, cy: 32, r: 5.5, stroke: 2 }],
  crosshair4: [
    { kind: "line", x1: 25, y1: 25, x2: 38, y2: 38, w: 1.4 },
    { kind: "line", x1: 38, y1: 25, x2: 25, y2: 38, w: 1.4 },
  ],
  crosshair5: [{ kind: "disc", cx: 31.5, cy: 32.5, r: 4 }],
  crosshair6: [ARM_TOP, ARM_BOTTOM, ARM_LEFT, ARM_RIGHT],
  crosshair7: [
    { kind: "rect", x: 31, y: 21, w: 2, h: 22 },
    { kind: "rect", x: 21, y: 31, w: 22, h: 2 },
  ],
};

/** null means "Weapon default": each weapon draws its own sprite crosshair. */
export function stockCrosshairPrimitives(file: string): StockShapePrimitive[] | null {
  if (file === "") {
    return null;
  }
  return STOCK_CROSSHAIR_SHAPES[file as Exclude<StockCrosshairFile, "">] ?? null;
}

/**
 * Engine rule: the crosshair draws at its sprite size × `cl_crosshair_scale`/32.
 * The stock sprites are 64×64, so scale 32 is 1:1.
 */
export function stockCrosshairRenderedSize(scale: number, spriteSize = 64): number {
  return Math.round((spriteSize * scale) / 32);
}

export const STOCK_CROSSHAIR_LABELS: Record<StockCrosshairFile, string> = {
  "": "Weapon default",
  crosshair1: "Cross with gaps + dot",
  crosshair2: "Three-arm cross + dot",
  crosshair3: "Open circle",
  crosshair4: "Diagonal X",
  crosshair5: "Dot",
  crosshair6: "Cross with gaps",
  crosshair7: "Solid plus",
};

/**
 * The fallback geometry as a 64×64 white RGBA sprite, for pictures drawn
 * before (or without) the real sprites decoded from the player's game files.
 */
export function stockCrosshairRgba(file: string): Uint8ClampedArray | null {
  const primitives = stockCrosshairPrimitives(file);
  if (!primitives) return null;
  const size = 64;
  const pixels = new Uint8ClampedArray(size * size * 4);
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const px = x + 0.5;
      const py = y + 0.5;
      const on = primitives.some((shape) => {
        if (shape.kind === "rect") {
          return px >= shape.x && px < shape.x + shape.w && py >= shape.y && py < shape.y + shape.h;
        }
        if (shape.kind === "ring") {
          return Math.abs(Math.hypot(px - shape.cx, py - shape.cy) - shape.r) <= shape.stroke / 2;
        }
        if (shape.kind === "disc") return Math.hypot(px - shape.cx, py - shape.cy) <= shape.r;
        const vx = shape.x2 - shape.x1;
        const vy = shape.y2 - shape.y1;
        const t = Math.max(
          0,
          Math.min(1, ((px - shape.x1) * vx + (py - shape.y1) * vy) / (vx * vx + vy * vy)),
        );
        return Math.hypot(px - (shape.x1 + t * vx), py - (shape.y1 + t * vy)) <= shape.w / 2;
      });
      if (on) pixels.fill(255, (y * size + x) * 4, (y * size + x) * 4 + 4);
    }
  }
  return pixels;
}
