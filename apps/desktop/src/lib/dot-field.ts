import { EMBLEM_OUTER, insideTf2Emblem } from "./tf2-emblem";

/**
 * The background dot field: a halftone TF2 emblem anchored toward the
 * bottom-right of a surface, dissolving into a faint grid toward the top-left.
 * Dot size carries the image; colour and opacity stay low so content reads
 * over it.
 */
export type FieldDot = {
  x: number;
  y: number;
  /** Emblem coverage, 0–1, from nine sub-samples so the rim is a soft halftone. */
  ink: number;
  /** Background grid visibility, 0–1, fading away from the emblem. */
  field: number;
  /**
   * Strength toward the bottom-right corner, 0.3–1: the mark is brightest at
   * the edge and dissolves as it reaches into the page and its text.
   */
  weight: number;
};

export type FieldLayout = {
  dots: FieldDot[];
  /** Emblem centre and outer radius in CSS px, for the entrance and the lens. */
  cx: number;
  cy: number;
  radius: number;
};

export const FIELD_SPACING = 13;

/**
 * Place the emblem so roughly two thirds of it shows: its centre sits inside
 * the corner, scaled to the surface's shorter side.
 */
export function fieldLayout(width: number, height: number, spacing = FIELD_SPACING): FieldLayout {
  const radius = Math.max(160, Math.min(width, height) * 0.54);
  const cx = width - radius * 0.42;
  const cy = height - radius * 0.38;
  const reach = radius * 2.1;
  const toEmblem = EMBLEM_OUTER / radius;
  const third = spacing / 3;
  const dots: FieldDot[] = [];
  const columns = Math.ceil(width / spacing) + 1;
  const rows = Math.ceil(height / spacing) + 1;
  // Align the grid to the bottom-right corner so it looks anchored there.
  const originX = width - (columns - 1) * spacing;
  const originY = height - (rows - 1) * spacing;
  for (let row = 0; row < rows; row += 1) {
    for (let column = 0; column < columns; column += 1) {
      const x = originX + column * spacing;
      const y = originY + row * spacing;
      const distance = Math.hypot(x - cx, y - cy);
      if (distance > reach) continue;
      let hits = 0;
      if (distance <= radius + spacing) {
        for (let sy = -1; sy <= 1; sy += 1) {
          for (let sx = -1; sx <= 1; sx += 1) {
            if (
              insideTf2Emblem((x + sx * third - cx) * toEmblem, (y + sy * third - cy) * toEmblem)
            ) {
              hits += 1;
            }
          }
        }
      }
      const falloff = 1 - distance / reach;
      const corner = Math.hypot(width - x, height - y) / (radius * 2);
      dots.push({
        x,
        y,
        ink: hits / 9,
        field: falloff * falloff,
        weight: 0.3 + 0.7 * smoothstep(1 - corner),
      });
    }
  }
  return { dots, cx, cy, radius };
}

/** A soft lens that trails the pointer: position and strength ease, never snap. */
export type Lens = { x: number; y: number; strength: number };

export const LENS_RADIUS = 150;

export function smoothstep(value: number): number {
  const t = Math.min(1, Math.max(0, value));
  return t * t * (3 - 2 * t);
}

/**
 * Ease the lens toward the pointer for `dt` ms. Returns true once it has
 * arrived and its strength has settled, so drawing can stop.
 */
export function stepLens(
  lens: Lens,
  pointer: { x: number; y: number } | null,
  dt: number,
): boolean {
  const follow = 1 - Math.exp(-Math.max(0, dt) / 110);
  const fade = 1 - Math.exp(-Math.max(0, dt) / 180);
  if (pointer) {
    if (lens.strength < 0.01) {
      // A fresh lens appears where the pointer is rather than sliding in.
      lens.x = pointer.x;
      lens.y = pointer.y;
    } else {
      lens.x += (pointer.x - lens.x) * follow;
      lens.y += (pointer.y - lens.y) * follow;
    }
  }
  const target = pointer ? 1 : 0;
  lens.strength += (target - lens.strength) * fade;
  const moving = pointer !== null && Math.hypot(pointer.x - lens.x, pointer.y - lens.y) > 0.3;
  return !moving && Math.abs(target - lens.strength) < 0.004;
}

/** How strongly the lens touches a dot, 0–1. */
export function lensInfluence(lens: Lens, x: number, y: number, radius = LENS_RADIUS): number {
  if (lens.strength <= 0) return 0;
  return smoothstep(1 - Math.hypot(x - lens.x, y - lens.y) / radius) * lens.strength;
}
