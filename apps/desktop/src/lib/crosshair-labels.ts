import { COMMUNITY_CROSSHAIR_PREFIX } from "./community-crosshairs";
import { designLabel } from "./crosshair-designer";
import { isCrosshairPreset, presetLabel } from "./crosshair-presets";
import {
  CUSTOM_CROSSHAIR_SHAPE,
  EXTERNAL_CROSSHAIR_CHOICE,
  isBuiltinCrosshairShape,
  tf2CrosshairFile,
} from "./crosshair-ui";
import { STOCK_CROSSHAIR_LABELS } from "./stock-crosshair-shapes";

/** Earlier execs shapes, shown only to profiles that still use them. */
const SHAPE_LABELS: Record<string, string> = {
  dot: "Small dot",
  cross: "Thin cross",
  "plus-gap": "Thin gap cross",
  circle: "Thin circle",
  t: "T",
  "execs-chevron": "Chevron",
  "execs-diamond": "Diamond",
  "execs-ring-cross": "Ring cross",
};

/** Library name prefixes for the player's own crosshairs. */
export const DESIGN_PREFIX = "design-";
export const IMAGE_PREFIX = "png-";
export const VTF_PREFIX = "vtf-";

function humanize(slug: string): string {
  const text = slug.replaceAll(/[-_]+/g, " ").trim();
  return text ? text[0].toUpperCase() + text.slice(1) : slug;
}

/**
 * The name a player sees for any crosshair choice: TF2's own, execs shapes,
 * saved designs (with their saved names), imports and older library VTFs.
 */
export function crosshairLabel(name: string, designs: Record<string, string> = {}): string {
  if (name === EXTERNAL_CROSSHAIR_CHOICE) return "Material from another pack";
  const file = tf2CrosshairFile(name);
  if (file !== null) return STOCK_CROSSHAIR_LABELS[file as keyof typeof STOCK_CROSSHAIR_LABELS];
  if (name === CUSTOM_CROSSHAIR_SHAPE) return "Imported image";
  if (isCrosshairPreset(name)) return presetLabel(name) ?? name;
  if (isBuiltinCrosshairShape(name)) return SHAPE_LABELS[name] ?? humanize(name);
  if (name.startsWith(DESIGN_PREFIX)) {
    return designLabel(designs[name]) ?? humanize(name.slice(DESIGN_PREFIX.length));
  }
  if (name === "designed") return designLabel(designs[name]) ?? "My crosshair";
  for (const prefix of [IMAGE_PREFIX, VTF_PREFIX, COMMUNITY_CROSSHAIR_PREFIX]) {
    if (name.startsWith(prefix)) return humanize(name.slice(prefix.length));
  }
  return humanize(name);
}

/** A short word for where a library crosshair came from. */
export function crosshairKind(name: string): "design" | "image" | "vtf" | null {
  if (name.startsWith(DESIGN_PREFIX) || name === "designed") return "design";
  if (name.startsWith(IMAGE_PREFIX) || name === CUSTOM_CROSSHAIR_SHAPE) return "image";
  if (isBuiltinCrosshairShape(name) || isCrosshairPreset(name) || tf2CrosshairFile(name) !== null) {
    return null;
  }
  return "vtf";
}

/** A library-safe name from free text, unique against `taken`. */
export function libraryName(prefix: string, label: string, taken: (name: string) => boolean) {
  const slug =
    label
      .toLowerCase()
      .replace(/\.(png|vtf)$/i, "")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "")
      .slice(0, 40) || "crosshair";
  let name = `${prefix}${slug}`;
  for (let suffix = 2; taken(name); suffix += 1) name = `${prefix}${slug}-${suffix}`;
  return name;
}
