import type { ComfigPreset } from "../lib/bridge";
import { comfigPresetById } from "../lib/comfig-catalog";

/** One line for the selected preset, so the tiles can stay name-only. */
export function PresetSummary({ preset }: { preset: ComfigPreset }) {
  const entry = comfigPresetById(preset);
  if (!entry) return null;
  return (
    <p data-testid="preset-summary" className="t-meta mt-3">
      {entry.description}
    </p>
  );
}
