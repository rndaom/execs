import type { StockCrosshairSprite } from "../lib/bridge";
import { isCrosshairPreset, presetPixels } from "../lib/crosshair-presets";
import {
  CROSSHAIR_CANVAS_SIZE,
  CUSTOM_CROSSHAIR_SHAPE,
  isBuiltinCrosshairShape,
  renderCrosshairRgba,
  tf2CrosshairFile,
} from "../lib/crosshair-ui";
import { stockCrosshairRgba } from "../lib/stock-crosshair-shapes";
import type { PreviewPixels } from "./useCrosshairDraft";

const builtinCache = new Map<string, PreviewPixels>();
const stockFallbackCache = new Map<string, PreviewPixels | null>();

function square(rgba: Uint8ClampedArray): PreviewPixels {
  return { width: CROSSHAIR_CANVAS_SIZE, height: CROSSHAIR_CANVAS_SIZE, rgba };
}

/**
 * One answer to "what does this crosshair look like" for every picture on the
 * page: execs shapes, TF2's own sprites (decoded from the player's files, or
 * their known geometry until then), the legacy imported image and every
 * library entry. `tf-default` and external materials have no single picture.
 */
export function crosshairPixelsFor(
  name: string,
  {
    previewFor,
    stockSprites,
    customRgba,
  }: {
    previewFor: (name: string) => PreviewPixels | null;
    stockSprites: Record<string, StockCrosshairSprite> | null;
    customRgba: number[] | null;
  },
): PreviewPixels | null {
  const file = tf2CrosshairFile(name);
  if (file !== null) {
    if (file === "") return null;
    const sprite = stockSprites?.[file];
    if (sprite) return sprite;
    if (!stockFallbackCache.has(file)) {
      const rgba = stockCrosshairRgba(file);
      stockFallbackCache.set(file, rgba ? square(rgba) : null);
    }
    return stockFallbackCache.get(file) ?? null;
  }
  if (isCrosshairPreset(name)) {
    // Stable objects, so pictures repaint only when something changes.
    let cached = builtinCache.get(name);
    const rgba = cached ? null : presetPixels(name);
    if (!cached && rgba) {
      cached = square(rgba);
      builtinCache.set(name, cached);
    }
    return cached ?? null;
  }
  if (name === CUSTOM_CROSSHAIR_SHAPE) {
    return customRgba
      ? { width: CROSSHAIR_CANVAS_SIZE, height: CROSSHAIR_CANVAS_SIZE, rgba: customRgba }
      : previewFor(name);
  }
  if (isBuiltinCrosshairShape(name)) {
    let cached = builtinCache.get(name);
    if (!cached) {
      cached = square(renderCrosshairRgba(name));
      builtinCache.set(name, cached);
    }
    return cached;
  }
  return previewFor(name);
}

/** Whether TF2 draws this choice with `cl_crosshair_file` sizing (2 × scale). */
export function drawsAsCrosshairFile(name: string, packLive: boolean): boolean {
  return !packLive && tf2CrosshairFile(name) !== null;
}
