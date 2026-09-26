import { EMBLEM_OUTER, insideTf2Emblem } from "./tf2-emblem";

/** One dot of the Home emblem field, in CSS pixels. */
export type Dot = {
  x: number;
  y: number;
  /** How much of the emblem this dot covers, 0–1. Zero means a field dot. */
  ink: number;
  /** A field dot's resting visibility, 0–1, fading toward the edge. */
  field: number;
  /** Entrance delay in ms: a wave from the centre outward. */
  delay: number;
  /** Current displacement and highlight, eased toward the pointer's pull. */
  dx: number;
  dy: number;
  glow: number;
};

export type DotFieldOptions = {
  /** Square canvas size in CSS px. */
  size: number;
  /** Distance between dot centres in CSS px. */
  spacing: number;
  /** Emblem outer radius as a share of the canvas size. */
  emblemScale: number;
  /** Duration of the centre-outward entrance wave, in ms. */
  wave: number;
};

export const DOT_FIELD_DEFAULTS: DotFieldOptions = {
  size: 360,
  spacing: 8,
  emblemScale: 0.4,
  wave: 520,
};

/** Build the grid once; coverage uses four sub-samples so the rim reads round. */
export function layoutDots(options: DotFieldOptions = DOT_FIELD_DEFAULTS): Dot[] {
  const { size, spacing, emblemScale, wave } = options;
  const centre = size / 2;
  const emblemRadius = size * emblemScale;
  const toEmblem = EMBLEM_OUTER / emblemRadius;
  const count = Math.floor(size / spacing);
  const offset = (size - (count - 1) * spacing) / 2;
  const quarter = spacing / 4;
  const dots: Dot[] = [];
  for (let row = 0; row < count; row += 1) {
    for (let column = 0; column < count; column += 1) {
      const x = offset + column * spacing;
      const y = offset + row * spacing;
      const distance = Math.hypot(x - centre, y - centre);
      if (distance > centre) continue;
      let hits = 0;
      for (const [sx, sy] of [
        [-quarter, -quarter],
        [quarter, -quarter],
        [-quarter, quarter],
        [quarter, quarter],
      ]) {
        if (insideTf2Emblem((x + sx - centre) * toEmblem, (y + sy - centre) * toEmblem)) hits += 1;
      }
      const ink = hits / 4;
      const edge = 1 - distance / centre;
      dots.push({
        x,
        y,
        ink,
        field: ink > 0 ? 0 : edge ** 1.4,
        delay: (distance / centre) * wave,
        dx: 0,
        dy: 0,
        glow: 0,
      });
    }
  }
  return dots;
}

export type Pull = {
  /** Pointer in canvas CSS px, or null once it has left. */
  pointer: { x: number; y: number } | null;
  /** Reach of the pointer's influence in CSS px. */
  radius: number;
  /** Largest push away from the pointer in CSS px. */
  push: number;
};

export const DEFAULT_PULL = { radius: 86, push: 5 } as const;

function smoothstep(value: number) {
  const t = Math.min(1, Math.max(0, value));
  return t * t * (3 - 2 * t);
}

/**
 * Ease every dot toward the pointer's pull for `dt` ms. Returns true once the
 * field has settled, so the caller can stop drawing frames.
 */
export function stepDots(dots: Dot[], pull: Pull, dt: number): boolean {
  // Exponential easing: frame-rate independent, never overshoots.
  const k = 1 - Math.exp(-Math.max(0, dt) / 90);
  let settled = true;
  for (const dot of dots) {
    let tx = 0;
    let ty = 0;
    let tg = 0;
    if (pull.pointer) {
      const ax = dot.x - pull.pointer.x;
      const ay = dot.y - pull.pointer.y;
      const distance = Math.hypot(ax, ay);
      const strength = smoothstep(1 - distance / pull.radius);
      if (strength > 0) {
        const unit = distance > 0.001 ? 1 / distance : 0;
        tx = ax * unit * strength * pull.push;
        ty = ay * unit * strength * pull.push;
        tg = strength;
      }
    }
    dot.dx += (tx - dot.dx) * k;
    dot.dy += (ty - dot.dy) * k;
    dot.glow += (tg - dot.glow) * k;
    if (
      Math.abs(tx - dot.dx) > 0.02 ||
      Math.abs(ty - dot.dy) > 0.02 ||
      Math.abs(tg - dot.glow) > 0.005
    ) {
      settled = false;
    }
  }
  return settled;
}

/** Entrance progress for one dot at `elapsed` ms, eased, 0–1. */
export function entrance(dot: Dot, elapsed: number, fade = 280): number {
  const t = Math.min(1, Math.max(0, (elapsed - dot.delay) / fade));
  return 1 - (1 - t) ** 3;
}
