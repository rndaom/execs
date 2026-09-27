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
  /** Resting radius in CSS px. */
  radius: number;
  /** Resting opacity; 0 means the dot is not drawn. */
  alpha: number;
};

export type FieldLayout = {
  dots: FieldDot[];
  /** Emblem centre and outer radius in CSS px. */
  cx: number;
  cy: number;
  radius: number;
  /** The grid under the dots, to find the ones near a point without a scan. */
  spacing: number;
  originX: number;
  originY: number;
  columns: number;
  rows: number;
  /** Dot index for each grid cell, row by row; -1 where the field has no dot. */
  cells: Int32Array;
};

export const FIELD_SPACING = 13;

/** Emblem dots: the halftone's largest radius and its opacity at the corner. */
const INK_RADIUS = 2.4;
const INK_ALPHA = 0.26;
/** Grid dots: one small size, barely there. */
const FIELD_RADIUS = 1;
const FIELD_ALPHA = 0.065;
/** The largest radius any dot has at rest. */
export const DOT_RADIUS_MAX = INK_RADIUS;

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
  const cells = new Int32Array(columns * rows).fill(-1);
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
      const ink = hits / 9;
      const field = falloff * falloff;
      const weight = 0.3 + 0.7 * smoothstep(1 - corner);
      cells[row * columns + column] = dots.length;
      dots.push({ x, y, ink, field, weight, ...restingLook(ink, field, weight) });
    }
  }
  return { dots, cx, cy, radius, spacing, originX, originY, columns, rows, cells };
}

function restingLook(ink: number, field: number, weight: number) {
  if (ink > 0) {
    return {
      radius: INK_RADIUS * (0.45 + 0.55 * ink),
      alpha: INK_ALPHA * weight * (0.6 + 0.4 * ink),
    };
  }
  if (field > 0.02) return { radius: FIELD_RADIUS, alpha: FIELD_ALPHA * field * weight };
  return { radius: 0, alpha: 0 };
}

export function smoothstep(value: number): number {
  const t = Math.min(1, Math.max(0, value));
  return t * t * (3 - 2 * t);
}

/**
 * The grid cells whose dot centres lie in the box, as inclusive column and row
 * ranges; empty ranges when none do.
 */
export function cellsIn(
  layout: FieldLayout,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
): { c0: number; r0: number; c1: number; r1: number } {
  const { spacing, originX, originY, columns, rows } = layout;
  return {
    c0: Math.max(0, Math.ceil((x0 - originX) / spacing)),
    r0: Math.max(0, Math.ceil((y0 - originY) / spacing)),
    c1: Math.min(columns - 1, Math.floor((x1 - originX) / spacing)),
    r1: Math.min(rows - 1, Math.floor((y1 - originY) / spacing)),
  };
}

/** Call `visit` with the index of every dot whose resting centre lies in the box. */
export function forEachDotIn(
  layout: FieldLayout,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  visit: (index: number) => void,
): void {
  const { c0, r0, c1, r1 } = cellsIn(layout, x0, y0, x1, y1);
  for (let row = r0; row <= r1; row += 1) {
    for (let column = c0; column <= c1; column += 1) {
      const index = layout.cells[row * layout.columns + column];
      if (index >= 0) visit(index);
    }
  }
}

/**
 * The pointer stirs the field. Dots within reach slide away from it and a
 * little along its motion, then spring back to their places once it rests or
 * leaves. Nothing changes colour or leaves a trail: the answer is movement.
 */
export const STIR_RADIUS = 110;
/** The widest push away from the pointer, in CSS px, a third of the way out. */
export const STIR_PUSH = 5;
/** How far a moving pointer drags the dots under it along, in CSS px. */
export const STIR_DRAG = 4;
/** No dot ever strays farther than this from its place, in CSS px. */
export const STIR_LIMIT = 8;
/** Pointer speed, in px per ms, is turned into drag over this many ms. */
const DRAG_TIME = 8;
/** A spring toward the target, per ms: about 13 rad/s, lightly damped. */
const STIFFNESS = 0.00018;
const DAMPING = 0.016;
/** The pointer counts as moving this long after its last move, in ms. */
const MOVING = 140;
/** How quickly the stir rises while the pointer moves, fades once it rests, and fades once it leaves, in ms. */
const RISE = 70;
const REST = 380;
const GONE = 180;
/** A fading stir this weak moves nothing visibly; it ends there. */
const FADED = 0.02;
/** How quickly the pointer's measured speed fades without new moves, in ms. */
const SPEED_FADE = 90;
/** Integration step ceiling, in ms, so long frames stay stable. */
const STEP = 16;

export type StirPointer = {
  x: number;
  y: number;
  /** Measured pointer velocity in px per ms. */
  vx: number;
  vy: number;
  /** When the pointer last moved, in ms. */
  movedAt: number;
  /** Whether the pointer is over the surface. */
  over: boolean;
  /** How strongly the pointer stirs, 0–1. */
  strength: number;
};

export type Stir = {
  /** Each dot's offset from its place, and its velocity per ms. */
  ox: Float32Array;
  oy: Float32Array;
  vx: Float32Array;
  vy: Float32Array;
  /** 1 while the dot is listed in `active`. */
  listed: Uint8Array;
  /** Dots that are away from their place or still moving. */
  active: number[];
  /** Box around the active dots' places, in CSS px; empty when nothing moves. */
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
};

export function createPointer(): StirPointer {
  return { x: 0, y: 0, vx: 0, vy: 0, movedAt: Number.NEGATIVE_INFINITY, over: false, strength: 0 };
}

export function createStir(count: number): Stir {
  return {
    ox: new Float32Array(count),
    oy: new Float32Array(count),
    vx: new Float32Array(count),
    vy: new Float32Array(count),
    listed: new Uint8Array(count),
    active: [],
    minX: Number.POSITIVE_INFINITY,
    minY: Number.POSITIVE_INFINITY,
    maxX: Number.NEGATIVE_INFINITY,
    maxY: Number.NEGATIVE_INFINITY,
  };
}

/** The pointer moved to (x, y), in the surface's CSS px, at `now` ms. */
export function movePointer(pointer: StirPointer, x: number, y: number, now: number): void {
  const gap = now - pointer.movedAt;
  if (!pointer.over || gap > MOVING) {
    // Arriving, or moving again after a rest: no speed from the jump.
    pointer.vx = 0;
    pointer.vy = 0;
  } else if (gap > 0) {
    const blend = Math.min(1, gap / 32);
    pointer.vx += ((x - pointer.x) / gap - pointer.vx) * blend;
    pointer.vy += ((y - pointer.y) / gap - pointer.vy) * blend;
  }
  pointer.x = x;
  pointer.y = y;
  pointer.movedAt = now;
  pointer.over = true;
}

export function leavePointer(pointer: StirPointer): void {
  pointer.over = false;
}

/**
 * Advance the stir by `dt` ms at time `now`. Returns true while any dot is
 * away from its place or the pointer still stirs, so frames can stop after.
 */
export function stepStir(
  layout: FieldLayout,
  stir: Stir,
  pointer: StirPointer,
  now: number,
  dt: number,
): boolean {
  const span = Math.max(0, dt);
  const moving = pointer.over && now - pointer.movedAt < MOVING;
  const fade = moving ? RISE : pointer.over ? REST : GONE;
  pointer.strength += ((moving ? 1 : 0) - pointer.strength) * (1 - Math.exp(-span / fade));
  if (!moving && pointer.strength < FADED) pointer.strength = 0;
  const slow = Math.exp(-span / SPEED_FADE);
  pointer.vx *= slow;
  pointer.vy *= slow;

  const strength = pointer.strength;
  const px = pointer.x;
  const py = pointer.y;
  if (strength > 0) {
    forEachDotIn(
      layout,
      px - STIR_RADIUS,
      py - STIR_RADIUS,
      px + STIR_RADIUS,
      py + STIR_RADIUS,
      (index) => {
        if (stir.listed[index] === 1 || layout.dots[index].alpha === 0) return;
        stir.listed[index] = 1;
        stir.active.push(index);
      },
    );
  }

  // Drag follows the pointer's motion, up to STIR_DRAG.
  let dragX = pointer.vx * DRAG_TIME;
  let dragY = pointer.vy * DRAG_TIME;
  const drag = Math.hypot(dragX, dragY);
  if (drag > STIR_DRAG) {
    dragX *= STIR_DRAG / drag;
    dragY *= STIR_DRAG / drag;
  }
  // 6.75 × u × (1 − u)² peaks at 1 when u = 1/3.
  const push = (6.75 * STIR_PUSH) / STIR_RADIUS;
  const steps = Math.max(1, Math.ceil(span / STEP));
  const h = span / steps;

  stir.minX = Number.POSITIVE_INFINITY;
  stir.minY = Number.POSITIVE_INFINITY;
  stir.maxX = Number.NEGATIVE_INFINITY;
  stir.maxY = Number.NEGATIVE_INFINITY;
  const { ox, oy, vx, vy, active } = stir;
  for (let slot = 0; slot < active.length; ) {
    const index = active[slot];
    const dot = layout.dots[index];
    let tx = 0;
    let ty = 0;
    if (strength > 0) {
      const ax = dot.x - px;
      const ay = dot.y - py;
      const u = Math.hypot(ax, ay) / STIR_RADIUS;
      if (u < 1) {
        // Outward, zero under the pointer itself so nothing flips as it passes.
        const out = push * (1 - u) * (1 - u) * strength;
        const bell = (1 - u * u) * (1 - u * u) * strength;
        tx = ax * out + dragX * bell;
        ty = ay * out + dragY * bell;
      }
    }
    let x = ox[index];
    let y = oy[index];
    let sx = vx[index];
    let sy = vy[index];
    for (let step = 0; step < steps; step += 1) {
      sx += (STIFFNESS * (tx - x) - DAMPING * sx) * h;
      sy += (STIFFNESS * (ty - y) - DAMPING * sy) * h;
      x += sx * h;
      y += sy * h;
    }
    const away = Math.hypot(x, y);
    if (away > STIR_LIMIT) {
      x *= STIR_LIMIT / away;
      y *= STIR_LIMIT / away;
    }
    if (
      tx === 0 &&
      ty === 0 &&
      Math.abs(x) < 0.02 &&
      Math.abs(y) < 0.02 &&
      Math.abs(sx) < 0.002 &&
      Math.abs(sy) < 0.002
    ) {
      // Home: back to exactly its place, off the list.
      ox[index] = 0;
      oy[index] = 0;
      vx[index] = 0;
      vy[index] = 0;
      stir.listed[index] = 0;
      active[slot] = active[active.length - 1];
      active.pop();
      continue;
    }
    ox[index] = x;
    oy[index] = y;
    vx[index] = sx;
    vy[index] = sy;
    if (dot.x < stir.minX) stir.minX = dot.x;
    if (dot.x > stir.maxX) stir.maxX = dot.x;
    if (dot.y < stir.minY) stir.minY = dot.y;
    if (dot.y > stir.maxY) stir.maxY = dot.y;
    slot += 1;
  }
  return active.length > 0 || strength > 0;
}
