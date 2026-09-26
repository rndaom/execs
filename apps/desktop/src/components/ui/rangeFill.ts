import type { CSSProperties } from "react";

/** The filled share of a range track, for the `.range` accent run. */
export function rangeFill(value: number, min: number, max: number): CSSProperties {
  const span = max - min;
  const fraction = span > 0 ? Math.min(1, Math.max(0, (value - min) / span)) : 0;
  return { "--fill": `${(fraction * 100).toFixed(2)}%` } as CSSProperties;
}
