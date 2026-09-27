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
  /** Emblem centre and outer radius in CSS px. */
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

export function smoothstep(value: number): number {
  const t = Math.min(1, Math.max(0, value));
  return t * t * (3 - 2 * t);
}

/**
 * The pointer lights dots like an LED matrix: every dot within reach of the
 * path the cursor just travelled takes on energy, which then fades out. The
 * result is a narrow, crisp trail of lit dots, never a moving blob.
 */
export const TRAIL_RADIUS = 24;
/** Dots this close to the path light fully; beyond it they dim to the edge. */
const TRAIL_CORE = 0.4;
/** How long a lit dot takes to fade to about a third of its brightness, in ms. */
export const TRAIL_FADE = 520;

/**
 * How strongly a dot can light, 0–1: fully inside the emblem and near it,
 * dissolving with the field toward the top-left so the trail never ends at an
 * edge.
 */
export function trailPresence(dot: FieldDot): number {
  if (dot.ink > 0) return 1;
  return smoothstep(Math.sqrt(dot.field) * 1.6);
}

/** Light the dots near the segment `from`→`to`; energy only ever rises here. */
export function lightAlong(
  dots: readonly FieldDot[],
  energy: Float32Array,
  from: { x: number; y: number },
  to: { x: number; y: number },
  radius = TRAIL_RADIUS,
): void {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const length2 = dx * dx + dy * dy;
  const minX = Math.min(from.x, to.x) - radius;
  const maxX = Math.max(from.x, to.x) + radius;
  const minY = Math.min(from.y, to.y) - radius;
  const maxY = Math.max(from.y, to.y) + radius;
  for (let index = 0; index < dots.length; index += 1) {
    const dot = dots[index];
    if (dot.x < minX || dot.x > maxX || dot.y < minY || dot.y > maxY) continue;
    // Distance from the dot to the travelled segment.
    const t =
      length2 === 0
        ? 0
        : Math.min(1, Math.max(0, ((dot.x - from.x) * dx + (dot.y - from.y) * dy) / length2));
    const distance = Math.hypot(dot.x - (from.x + t * dx), dot.y - (from.y + t * dy));
    const core = radius * TRAIL_CORE;
    const lit = distance <= core ? 1 : smoothstep(1 - (distance - core) / (radius - core));
    if (lit > energy[index]) energy[index] = lit;
  }
}

/** Fade every lit dot for `dt` ms. Returns true while anything is still lit. */
export function fadeTrail(energy: Float32Array, dt: number, fade = TRAIL_FADE): boolean {
  const keep = Math.exp(-Math.max(0, dt) / fade);
  let lit = false;
  for (let index = 0; index < energy.length; index += 1) {
    if (energy[index] === 0) continue;
    const next = energy[index] * keep;
    energy[index] = next < 0.01 ? 0 : next;
    if (energy[index] > 0) lit = true;
  }
  return lit;
}
