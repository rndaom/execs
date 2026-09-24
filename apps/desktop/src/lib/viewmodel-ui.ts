import type { ViewmodelRecord, ViewmodelSource } from "./bridge";

export const EXECS_VIEWMODELS_PACK = "execs-viewmodels";

export const VIEWMODEL_CASUAL_COPY =
  "Some packs need Casual preload on Valve Casual; check the pack author's instructions. Manage preload in Mods → Casual setup. FOV and min viewmodels live in Gameplay.";

/** Count saved selection IDs without interpreting the previous builder's group mapping. */
export function legacyViewmodelSelectionCount(record: ViewmodelRecord | null): number {
  if (record?.source !== "compiled") return 0;
  return new Set(
    (record.options?.hidden ?? "")
      .split(",")
      .map((id) => id.trim())
      .filter(Boolean),
  ).size;
}

export function previewViewmodelRecord(source: ViewmodelSource = "imported"): ViewmodelRecord {
  return {
    id: EXECS_VIEWMODELS_PACK,
    source,
    preload: true,
    options: {},
  };
}
