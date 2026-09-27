import type { StockCrosshairSprite } from "./bridge";

/**
 * Turn a shaded TF2 class emblem into a flat mask: white pixels whose alpha is
 * the emblem's coverage weighted by brightness. Dark outlines drop away and
 * lit detail (belts, rocket fins, the sniper scope) survives, so the emblem
 * can be filled with any single interface colour.
 */
export function flattenEmblem(sprite: StockCrosshairSprite): Uint8ClampedArray<ArrayBuffer> {
  const { width, height, rgba } = sprite;
  const out = new Uint8ClampedArray(new ArrayBuffer(width * height * 4));
  for (let index = 0; index < width * height; index += 1) {
    const offset = index * 4;
    const coverage = (rgba[offset + 3] ?? 0) / 255;
    const luminance =
      (0.3 * (rgba[offset] ?? 0) +
        0.59 * (rgba[offset + 1] ?? 0) +
        0.11 * (rgba[offset + 2] ?? 0)) /
      255;
    const weight = Math.min(1, luminance ** 0.8 * 1.6) * coverage;
    out[offset] = 255;
    out[offset + 1] = 255;
    out[offset + 2] = 255;
    out[offset + 3] = Math.round(weight * 255);
  }
  return out;
}

/** A data URL for the flattened emblem, or null where no canvas is available. */
export function emblemMaskUrl(sprite: StockCrosshairSprite): string | null {
  if (typeof document === "undefined") return null;
  const valid =
    sprite.width > 0 &&
    sprite.height > 0 &&
    sprite.rgba.length === sprite.width * sprite.height * 4;
  if (!valid) return null;
  const canvas = document.createElement("canvas");
  canvas.width = sprite.width;
  canvas.height = sprite.height;
  let context: CanvasRenderingContext2D | null = null;
  try {
    context = canvas.getContext("2d");
  } catch {
    return null;
  }
  if (!context) return null;
  context.putImageData(new ImageData(flattenEmblem(sprite), sprite.width, sprite.height), 0, 0);
  try {
    return canvas.toDataURL("image/png");
  } catch {
    return null;
  }
}
