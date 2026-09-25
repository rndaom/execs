import type { ViewmodelRecord, ViewmodelSource, ViewmodelSourceCatalog } from "./bridge";

export const EXECS_VIEWMODELS_PACK = "execs-viewmodels";

export const VIEWMODEL_CASUAL_COPY =
  "Some packs need Casual preload on Valve Casual; check the pack author's instructions. Manage preload in Mods → Casual setup. FOV and min viewmodels live in Gameplay.";

export type ViewmodelHideMode = "full" | "weapon";
export type ViewmodelDraftChoices = Record<string, ViewmodelHideMode>;

const CLASS_ORDER = [
  "scout",
  "soldier",
  "pyro",
  "demoman",
  "heavy",
  "engineer",
  "medic",
  "sniper",
  "spy",
] as const;

export function viewmodelClassLabel(value: string): string {
  return value === "demoman" ? "Demoman" : value.slice(0, 1).toUpperCase() + value.slice(1);
}

/** The catalog hash binds membership; fingerprints also catch unchanged groups on updated sources. */
export function viewmodelCatalogRevision(catalog: ViewmodelSourceCatalog): string {
  return JSON.stringify([catalog.catalog, catalog.sourceFingerprints]);
}

export function viewmodelClasses(catalog: ViewmodelSourceCatalog): string[] {
  const present = new Set(catalog.groups.map((group) => group.class));
  return [...present].sort((left, right) => {
    const leftOrder = CLASS_ORDER.indexOf(left as (typeof CLASS_ORDER)[number]);
    const rightOrder = CLASS_ORDER.indexOf(right as (typeof CLASS_ORDER)[number]);
    return (
      (leftOrder < 0 ? CLASS_ORDER.length : leftOrder) -
        (rightOrder < 0 ? CLASS_ORDER.length : rightOrder) || left.localeCompare(right)
    );
  });
}

export function viewmodelGroupLabel(group: ViewmodelSourceCatalog["groups"][number]): string {
  const names = [...new Set(group.items.map((item) => item.schemaName.trim()).filter(Boolean))];
  return names[0] ?? `Item ${group.items[0]?.id ?? "unknown"}`;
}

export function viewmodelGroupsForClass(
  catalog: ViewmodelSourceCatalog,
  selectedClass: string,
  query: string,
): ViewmodelSourceCatalog["groups"] {
  const term = query.trim().toLocaleLowerCase();
  return catalog.groups
    .filter((group) => group.class === selectedClass)
    .filter(
      (group) =>
        !term ||
        group.items.some(
          (item) =>
            item.schemaName.toLocaleLowerCase().includes(term) || String(item.id).includes(term),
        ),
    )
    .sort(
      (left, right) =>
        viewmodelGroupLabel(left).localeCompare(viewmodelGroupLabel(right)) ||
        left.id.localeCompare(right.id),
    );
}

export function selectedViewmodelChoices(choices: ViewmodelDraftChoices) {
  return Object.entries(choices)
    .map(([groupId, mode]) => ({ groupId, mode }))
    .sort((left, right) => left.groupId.localeCompare(right.groupId));
}

/** Exact payload shape for the gated native build command; a draft never sends it on its own. */
export function viewmodelDraftBuildRequest(
  catalog: ViewmodelSourceCatalog,
  choices: ViewmodelDraftChoices,
  preload: boolean,
) {
  return {
    catalog: catalog.catalog,
    sourceFingerprints: catalog.sourceFingerprints,
    choices: selectedViewmodelChoices(choices),
    preload,
  };
}

/** Different transforms cannot target one installed animation in the same candidate. */
export function conflictingViewmodelGroupIds(
  catalog: ViewmodelSourceCatalog,
  choices: ViewmodelDraftChoices,
): Set<string> {
  const conflicts = new Set<string>();
  for (const group of catalog.groups) {
    const mode = choices[group.id];
    if (!mode) continue;
    for (const other of group.overlaps) {
      if (choices[other] && choices[other] !== mode) {
        conflicts.add(group.id);
        conflicts.add(other);
      }
    }
  }
  return conflicts;
}

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
