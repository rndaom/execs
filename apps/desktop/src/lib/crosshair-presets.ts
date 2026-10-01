import {
  type CrosshairDesign,
  defaultCrosshairDesign,
  renderCrosshairDesign,
} from "./crosshair-designer";
import { CROSSHAIR_CANVAS_SIZE } from "./crosshair-ui";

/**
 * execs' ready-made crosshairs: the shapes players actually use, drawn by the
 * designer so each one can be opened and adjusted. They travel in the pack as
 * ordinary 64×64 sprites under reserved `shape-` names; the app renders their
 * pixels on demand, so a draft never stores them.
 *
 * Earlier execs shapes (`dot`, `cross`, `plus-gap`, `circle`, `t`,
 * `execs-*`) stay buildable for profiles that use them.
 */
export const PRESET_PREFIX = "shape-";

const base = (update: Partial<CrosshairDesign>): CrosshairDesign => ({
  ...defaultCrosshairDesign(),
  outline: 0,
  gap: 0,
  dot: false,
  thickness: 2,
  ...update,
});

export const CROSSHAIR_PRESETS: readonly {
  name: string;
  label: string;
  design: CrosshairDesign;
}[] = [
  { name: "shape-dot", label: "Dot", design: base({ style: "dot", size: 8, dotSize: 2 }) },
  { name: "shape-cross", label: "Cross", design: base({ style: "cross", size: 9 }) },
  { name: "shape-gap", label: "Gap cross", design: base({ style: "cross", size: 6, gap: 3 }) },
  {
    name: "shape-gap-dot",
    label: "Gap cross + dot",
    design: base({ style: "cross", size: 6, gap: 3, dot: true, dotSize: 1 }),
  },
  { name: "shape-circle", label: "Circle", design: base({ style: "circle", size: 7 }) },
  {
    name: "shape-circle-dot",
    label: "Circle + dot",
    design: base({ style: "circle", size: 8, dot: true, dotSize: 1 }),
  },
  { name: "shape-x", label: "X", design: base({ style: "x", size: 6, gap: 2 }) },
  {
    name: "shape-outlined",
    label: "Outlined",
    design: base({ style: "cross", size: 6, gap: 3, dot: true, dotSize: 1, outline: 1 }),
  },
];

const BY_NAME = new Map(CROSSHAIR_PRESETS.map((preset) => [preset.name, preset]));
const pixelCache = new Map<string, Uint8ClampedArray>();

export function isCrosshairPreset(name: string): boolean {
  return BY_NAME.has(name);
}

export function presetDesign(name: string): CrosshairDesign | null {
  return BY_NAME.get(name)?.design ?? null;
}

export function presetLabel(name: string): string | null {
  return BY_NAME.get(name)?.label ?? null;
}

/** The preset's untinted 64×64 sprite, the exact bytes a build sends. */
export function presetPixels(name: string): Uint8ClampedArray | null {
  const design = presetDesign(name);
  if (!design) return null;
  let pixels = pixelCache.get(name);
  if (!pixels) {
    pixels = renderCrosshairDesign(design, null);
    pixelCache.set(name, pixels);
  }
  return pixels;
}

export const PRESET_SIZE = CROSSHAIR_CANVAS_SIZE;
