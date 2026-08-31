import type { CrosshairFile } from "./gameplay-ui";

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

export const STOCK_CROSSHAIR_SHAPES: Record<Exclude<CrosshairFile, "">, StockShapePrimitive[]> = {
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

/** null means "Default / none": each weapon draws its own sprite crosshair. */
export function stockCrosshairPrimitives(file: CrosshairFile): StockShapePrimitive[] | null {
  if (file === "") {
    return null;
  }
  return STOCK_CROSSHAIR_SHAPES[file];
}

export const STOCK_CROSSHAIR_LABELS: Record<CrosshairFile, string> = {
  "": "Default / none",
  crosshair1: "Cross with gaps + dot",
  crosshair2: "Three-arm cross + dot",
  crosshair3: "Open circle",
  crosshair4: "Diagonal X",
  crosshair5: "Dot",
  crosshair6: "Cross with gaps",
  crosshair7: "Solid plus",
};
