/*
 * The TF2 emblem as geometry: a disc cut into four quadrants by a slightly
 * tilted cross around a round centre. Units are emblem units with the centre
 * at the origin and an outer radius of 11. The spinner draws it as a path;
 * the Home dot field samples it point by point.
 */
export const EMBLEM_OUTER = 11;
export const EMBLEM_INNER = 4.5;
export const EMBLEM_HALF_GAP = 1.6;
/** Clockwise tilt of the cross, in degrees. */
export const EMBLEM_TILT = 7;

const TILT_RADIANS = (EMBLEM_TILT * Math.PI) / 180;
const COS = Math.cos(-TILT_RADIANS);
const SIN = Math.sin(-TILT_RADIANS);

/** Whether an emblem-space point (y grows downward, as on screen) is on the mark. */
export function insideTf2Emblem(x: number, y: number): boolean {
  const radius = Math.hypot(x, y);
  if (radius > EMBLEM_OUTER || radius < EMBLEM_INNER) return false;
  // Undo the tilt so the cross lies on the axes.
  const u = x * COS - y * SIN;
  const v = x * SIN + y * COS;
  return Math.abs(u) > EMBLEM_HALF_GAP && Math.abs(v) > EMBLEM_HALF_GAP;
}

/** One quadrant's outline as an SVG path; the mark is this turned four times. */
export const EMBLEM_QUADRANT_PATH = (() => {
  const innerSide = Math.sqrt(EMBLEM_INNER ** 2 - EMBLEM_HALF_GAP ** 2);
  const outerSide = Math.sqrt(EMBLEM_OUTER ** 2 - EMBLEM_HALF_GAP ** 2);
  const n = (value: number) => value.toFixed(3);
  // Along the horizontal gap, around the outer rim, back along the vertical
  // gap, then the concave arc of the centre hole.
  return [
    `M${n(innerSide)} ${n(EMBLEM_HALF_GAP)}`,
    `L${n(outerSide)} ${n(EMBLEM_HALF_GAP)}`,
    `A${EMBLEM_OUTER} ${EMBLEM_OUTER} 0 0 1 ${n(EMBLEM_HALF_GAP)} ${n(outerSide)}`,
    `L${n(EMBLEM_HALF_GAP)} ${n(innerSide)}`,
    `A${EMBLEM_INNER} ${EMBLEM_INNER} 0 0 0 ${n(innerSide)} ${n(EMBLEM_HALF_GAP)}`,
    "Z",
  ].join("");
})();
