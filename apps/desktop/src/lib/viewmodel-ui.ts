import type { ViewmodelRecord, ViewmodelSource, ViewmodelSourceCatalog } from "./bridge";

export const EXECS_VIEWMODELS_PACK = "execs-viewmodels";

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

type ViewmodelGroup = ViewmodelSourceCatalog["groups"][number];
type ViewmodelItem = ViewmodelGroup["items"][number];

/** English names for stock schema identifiers, which are not display labels. */
const STOCK_WEAPON_NAMES: Record<string, string> = {
  BAT: "Bat",
  BONESAW: "Bonesaw",
  BOTTLE: "Bottle",
  BUILDER: "Toolbox",
  BUILDER_SPY: "Sapper",
  CLUB: "Kukri",
  FIREAXE: "Fire Axe",
  FISTS: "Fists",
  FLAMETHROWER: "Flame Thrower",
  GRAPPLINGHOOK: "Grappling Hook",
  GRENADELAUNCHER: "Grenade Launcher",
  KNIFE: "Knife",
  MEDIGUN: "Medi Gun",
  MINIGUN: "Minigun",
  PASSTIME_GUN: "PASS Time Jack",
  PDA_ENGINEER_BUILD: "Construction PDA",
  PDA_ENGINEER_DESTROY: "Destruction PDA",
  PIPEBOMBLAUNCHER: "Stickybomb Launcher",
  PISTOL: "Pistol",
  PISTOL_SCOUT: "Pistol",
  REVOLVER: "Revolver",
  ROCKETLAUNCHER: "Rocket Launcher",
  SCATTERGUN: "Scattergun",
  SHOTGUN_HWG: "Shotgun",
  SHOTGUN_PRIMARY: "Shotgun",
  SHOTGUN_PYRO: "Shotgun",
  SHOTGUN_SOLDIER: "Shotgun",
  SHOVEL: "Shovel",
  SMG: "SMG",
  SNIPERRIFLE: "Sniper Rifle",
  SPELLBOOK: "Spellbook",
  SYRINGEGUN_MEDIC: "Syringe Gun",
  WRENCH: "Wrench",
};

/** Cosmetic, promotional or internal skin copies that should not name a group of weapons. */
const VARIANT_NAME =
  /^(upgradeable|festive|festivized|promo|silver|gold|rust|blood|carbonado|diamond|ttg|australium|strange|genuine|vintage|unique|haunted|collector'?s?|civilian)\b|botkiller|mk\.\s*i|poker night|\b20\d\d\b/i;
/** Lowercase internal names such as war paint skins. */
const INTERNAL_NAME = /^[a-z0-9]+(?:_[a-z0-9]+)+$/;

function isVariantName(schemaName: string): boolean {
  return VARIANT_NAME.test(schemaName) || INTERNAL_NAME.test(schemaName.trim());
}

/** A readable English name for an installed schema identifier. */
export function viewmodelItemName(schemaName: string): string {
  const name = schemaName.trim().replace(/^upgradeable\s+/i, "");
  const stock = /^TF_WEAPON_(.+)$/i.exec(name);
  if (stock) {
    const key = stock[1].toUpperCase();
    return (
      STOCK_WEAPON_NAMES[key] ??
      key
        .toLowerCase()
        .split("_")
        .filter(Boolean)
        .map((word) => word.slice(0, 1).toUpperCase() + word.slice(1))
        .join(" ")
    );
  }
  return name.replace(/^the\s+/i, "");
}

function representativeItems(group: ViewmodelGroup): ViewmodelItem[] {
  return [...group.items].sort(
    (left, right) =>
      Number(isVariantName(left.schemaName)) - Number(isVariantName(right.schemaName)) ||
      left.id - right.id,
  );
}

/** Distinct readable item names, stock and base weapons first. Items that only
 * share these animations from another loadout slot are listed last. */
export function viewmodelGroupItemNames(group: ViewmodelGroup): string[] {
  const section = viewmodelGroupSlot(group);
  const items = representativeItems(group);
  const ordered = [
    ...items.filter((item) => slotSection(item.slot, group.class) === section),
    ...items.filter((item) => slotSection(item.slot, group.class) !== section),
  ];
  const names: string[] = [];
  for (const item of ordered) {
    if (isVariantName(item.schemaName) && names.length) continue;
    const name = viewmodelItemName(item.schemaName);
    if (name && !names.includes(name)) names.push(name);
  }
  return names;
}

export function viewmodelGroupLabel(group: ViewmodelGroup): string {
  const name = viewmodelGroupItemNames(group)[0] ?? `Item ${group.items[0]?.id ?? "unknown"}`;
  return group.inspect ? `${name} inspect` : name;
}

export type ViewmodelSectionId = "primary" | "secondary" | "melee" | "pda" | "other" | "inspect";

const SECTION_ORDER: ViewmodelSectionId[] = [
  "primary",
  "secondary",
  "melee",
  "pda",
  "other",
  "inspect",
];

const SECTION_LABELS: Record<ViewmodelSectionId, string> = {
  primary: "Primary",
  secondary: "Secondary",
  melee: "Melee",
  pda: "PDA and buildings",
  other: "Other",
  inspect: "Inspect",
};

function slotSection(slot: string | null | undefined, className: string): ViewmodelSectionId {
  // TF2's schema stores Spy's Revolver and Sapper under different slots than
  // the loadout shows them.
  if (className === "spy" && slot === "secondary") return "primary";
  if (className === "spy" && slot === "building") return "secondary";
  if (slot === "primary" || slot === "secondary" || slot === "melee") return slot;
  if (slot === "pda" || slot === "pda2" || slot === "building") return "pda";
  return "other";
}

/** The loadout section most of a group's items use; shared action items do not decide it. */
export function viewmodelGroupSlot(group: ViewmodelGroup): Exclude<ViewmodelSectionId, "inspect"> {
  const counts = new Map<ViewmodelSectionId, number>();
  for (const item of group.items) {
    const section = slotSection(item.slot, group.class);
    counts.set(section, (counts.get(section) ?? 0) + 1);
  }
  let best: Exclude<ViewmodelSectionId, "inspect"> = "other";
  let bestCount = 0;
  for (const section of SECTION_ORDER) {
    if (section === "inspect" || section === "other") continue;
    const count = counts.get(section) ?? 0;
    if (count > bestCount) {
      best = section;
      bestCount = count;
    }
  }
  return best;
}

function groupOrder(group: ViewmodelGroup): number {
  return representativeItems(group)[0]?.id ?? Number.MAX_SAFE_INTEGER;
}

function groupMatches(group: ViewmodelGroup, term: string): boolean {
  return (
    !term ||
    viewmodelGroupLabel(group).toLocaleLowerCase().includes(term) ||
    group.items.some(
      (item) =>
        viewmodelItemName(item.schemaName).toLocaleLowerCase().includes(term) ||
        item.schemaName.toLocaleLowerCase().includes(term) ||
        String(item.id).includes(term),
    )
  );
}

export function viewmodelGroupsForClass(
  catalog: ViewmodelSourceCatalog,
  selectedClass: string,
  query: string,
): ViewmodelGroup[] {
  const term = query.trim().toLocaleLowerCase();
  return catalog.groups
    .filter((group) => group.class === selectedClass)
    .filter((group) => groupMatches(group, term))
    .sort(
      (left, right) =>
        SECTION_ORDER.indexOf(viewmodelGroupSlot(left)) -
          SECTION_ORDER.indexOf(viewmodelGroupSlot(right)) ||
        groupOrder(left) - groupOrder(right) ||
        left.id.localeCompare(right.id),
    );
}

/** One choice in the list: a weapon group plus any reskins that follow it. */
export type ViewmodelRow = { id: string; groups: ViewmodelGroup[] };

/** Halloween bread reskins ship their own animations; generic melee swings may accompany them. */
const BREAD_ANIMATION = /bread|^@bm_/i;
const SHARED_SWING = /^@melee_allclass/i;

function isBreadGroup(group: ViewmodelGroup): boolean {
  return (
    group.animations.some((animation) => BREAD_ANIMATION.test(animation)) &&
    group.animations.every(
      (animation) => BREAD_ANIMATION.test(animation) || SHARED_SWING.test(animation),
    )
  );
}

/**
 * Every row for one class, in loadout order. A bread reskin joins the row of
 * the base weapon with the same installed weapon type (Mutated Milk follows
 * Mad Milk), so one choice covers both; without a match it keeps its own row.
 */
export function viewmodelRowsForClass(
  catalog: ViewmodelSourceCatalog,
  selectedClass: string,
): ViewmodelRow[] {
  const groups = viewmodelGroupsForClass(catalog, selectedClass, "");
  const rows = new Map<string, ViewmodelRow>();
  const breads: ViewmodelGroup[] = [];
  for (const group of groups) {
    if (isBreadGroup(group)) breads.push(group);
    else rows.set(group.id, { id: group.id, groups: [group] });
  }
  for (const bread of breads) {
    const types = new Set(bread.items.map((item) => item.itemClass).filter(Boolean));
    const base = groups.find(
      (group) =>
        rows.has(group.id) &&
        Boolean(group.inspect) === Boolean(bread.inspect) &&
        group.items.some((item) => item.itemClass && types.has(item.itemClass)),
    );
    if (base) rows.get(base.id)?.groups.push(bread);
    else rows.set(bread.id, { id: bread.id, groups: [bread] });
  }
  const order = groups.map((group) => group.id);
  return [...rows.values()].sort((left, right) => order.indexOf(left.id) - order.indexOf(right.id));
}

export function viewmodelRowLabel(row: ViewmodelRow): string {
  return viewmodelGroupLabel(row.groups[0]);
}

/** Readable names for everything a row covers, its main weapon first. */
export function viewmodelRowItemNames(row: ViewmodelRow): string[] {
  const names: string[] = [];
  for (const group of row.groups) {
    for (const name of viewmodelGroupItemNames(group)) {
      if (!names.includes(name)) names.push(name);
    }
  }
  return names;
}

/** Loadout sections for one class, in TF2's loadout order with inspect animations last. */
export function viewmodelSectionsForClass(
  catalog: ViewmodelSourceCatalog,
  selectedClass: string,
  query: string,
): { id: ViewmodelSectionId; label: string; rows: ViewmodelRow[] }[] {
  const term = query.trim().toLocaleLowerCase();
  const rows = viewmodelRowsForClass(catalog, selectedClass).filter((row) =>
    row.groups.some((group) => groupMatches(group, term)),
  );
  return SECTION_ORDER.map((id) => ({
    id,
    label: SECTION_LABELS[id],
    rows: rows.filter((row) => {
      const group = row.groups[0];
      return id === "inspect" ? group.inspect : !group.inspect && viewmodelGroupSlot(group) === id;
    }),
  })).filter((section) => section.rows.length > 0);
}

export type ViewmodelChoice = ViewmodelHideMode | "shown";
export type ViewmodelSlotId = "primary" | "secondary" | "melee" | "pda";

const SLOT_LABELS: Record<ViewmodelSlotId, string> = {
  primary: "Primary",
  secondary: "Secondary",
  melee: "Melee",
  pda: "PDA",
};

/**
 * One class as the player chooses it: a line per loadout slot, one line for
 * every inspect animation, and the weapons behind each slot for exceptions.
 * Spellbooks and the grappling hook have no slot line; they stay shown unless
 * changed on their own.
 */
export type ViewmodelClassLayout = {
  slots: { id: ViewmodelSlotId; label: string; rows: ViewmodelRow[] }[];
  other: ViewmodelRow[];
  inspect: ViewmodelRow[];
};

export function viewmodelClassLayout(
  catalog: ViewmodelSourceCatalog,
  className: string,
): ViewmodelClassLayout {
  const rows = viewmodelRowsForClass(catalog, className);
  const weapons = rows.filter((row) => !row.groups[0].inspect);
  return {
    slots: (["primary", "secondary", "melee", "pda"] as const)
      .map((id) => ({
        id,
        label: SLOT_LABELS[id],
        rows: weapons.filter((row) => viewmodelGroupSlot(row.groups[0]) === id),
      }))
      .filter((slot) => slot.rows.length > 0),
    other: weapons.filter((row) => viewmodelGroupSlot(row.groups[0]) === "other"),
    inspect: rows.filter((row) => row.groups[0].inspect),
  };
}

export function viewmodelRowChoice(
  choices: ViewmodelDraftChoices,
  row: ViewmodelRow,
): ViewmodelChoice {
  return choices[row.groups[0].id] ?? "shown";
}

/** What most of a slot's weapons use; a tie goes to the first (stock) weapon. */
export function viewmodelSlotChoice(
  choices: ViewmodelDraftChoices,
  rows: ViewmodelRow[],
): ViewmodelChoice {
  const counts = new Map<ViewmodelChoice, number>();
  for (const row of rows) {
    const choice = viewmodelRowChoice(choices, row);
    counts.set(choice, (counts.get(choice) ?? 0) + 1);
  }
  let best: ViewmodelChoice = "shown";
  let bestCount = 0;
  for (const row of rows) {
    const choice = viewmodelRowChoice(choices, row);
    const count = counts.get(choice) ?? 0;
    if (count > bestCount) {
      best = choice;
      bestCount = count;
    }
  }
  return best;
}

/** Set every group in these rows, reskins included. */
export function viewmodelWithRows(
  choices: ViewmodelDraftChoices,
  rows: ViewmodelRow[],
  choice: ViewmodelChoice,
): ViewmodelDraftChoices {
  const next = { ...choices };
  for (const row of rows) {
    for (const group of row.groups) {
      if (choice === "shown") delete next[group.id];
      else next[group.id] = choice;
    }
  }
  return next;
}

/** Change a slot: weapons following it move with it, weapons set on their own stay. */
export function viewmodelWithSlot(
  choices: ViewmodelDraftChoices,
  rows: ViewmodelRow[],
  choice: ViewmodelChoice,
): ViewmodelDraftChoices {
  const current = viewmodelSlotChoice(choices, rows);
  return viewmodelWithRows(
    choices,
    rows.filter((row) => viewmodelRowChoice(choices, row) === current),
    choice,
  );
}

export function viewmodelInspectChoice(
  choices: ViewmodelDraftChoices,
  rows: ViewmodelRow[],
): "shown" | "full" | "mixed" {
  const hidden = rows.filter((row) => viewmodelRowChoice(choices, row) !== "shown").length;
  return hidden === 0 ? "shown" : hidden === rows.length ? "full" : "mixed";
}

/** Weapons set differently from their slot, and extras that are not shown. */
export function viewmodelExceptions(
  choices: ViewmodelDraftChoices,
  layout: ViewmodelClassLayout,
): ViewmodelRow[] {
  return [
    ...layout.slots.flatMap((slot) => {
      const choice = viewmodelSlotChoice(choices, slot.rows);
      return slot.rows.filter((row) => viewmodelRowChoice(choices, row) !== choice);
    }),
    ...layout.other.filter((row) => viewmodelRowChoice(choices, row) !== "shown"),
  ];
}

const CHOICE_WORDS: Record<ViewmodelChoice, string> = {
  shown: "shown",
  full: "hidden",
  weapon: "hands only",
};

/** "Primary hidden, Inspect hidden, Shortstop shown", or null when everything is shown. */
export function viewmodelClassSummary(
  choices: ViewmodelDraftChoices,
  layout: ViewmodelClassLayout,
): string | null {
  const parts: string[] = [];
  for (const slot of layout.slots) {
    const choice = viewmodelSlotChoice(choices, slot.rows);
    if (choice !== "shown") parts.push(`${slot.label} ${CHOICE_WORDS[choice]}`);
  }
  const inspect = viewmodelInspectChoice(choices, layout.inspect);
  if (layout.inspect.length && inspect !== "shown") {
    parts.push(inspect === "full" ? "Inspect hidden" : "Some inspects hidden");
  }
  for (const row of viewmodelExceptions(choices, layout)) {
    parts.push(`${viewmodelRowLabel(row)} ${CHOICE_WORDS[viewmodelRowChoice(choices, row)]}`);
  }
  return parts.length ? parts.join(", ") : null;
}

/** Rows in one class whose shared animations are set to different hide modes. */
export function viewmodelConflictRows(
  catalog: ViewmodelSourceCatalog,
  choices: ViewmodelDraftChoices,
  className: string,
): ViewmodelRow[] {
  const conflicts = conflictingViewmodelGroupIds(catalog, choices);
  return viewmodelRowsForClass(catalog, className).filter((row) =>
    row.groups.some((group) => conflicts.has(group.id)),
  );
}

/**
 * Hidden rows that share animations with a shown row in the same class. The
 * build keeps a shared animation shown, so these rows stay partly visible.
 */
export function viewmodelPartlyShownRows(
  catalog: ViewmodelSourceCatalog,
  choices: ViewmodelDraftChoices,
  className: string,
): { row: ViewmodelRow; shownWith: ViewmodelRow[] }[] {
  const rows = viewmodelRowsForClass(catalog, className);
  const rowOf = new Map(rows.flatMap((row) => row.groups.map((group) => [group.id, row] as const)));
  return rows.flatMap((row) => {
    const shownWith = new Set<ViewmodelRow>();
    for (const group of row.groups) {
      if (!choices[group.id]) continue;
      for (const other of group.overlaps) {
        const otherRow = rowOf.get(other);
        if (!choices[other] && otherRow && otherRow !== row) shownWith.add(otherRow);
      }
    }
    return shownWith.size ? [{ row, shownWith: [...shownWith] }] : [];
  });
}

/** Whole-profile starting points; every class and weapon row follows the same rule. */
export type ViewmodelPreset = "show-all" | "hide-all" | "keep-melee";

export const VIEWMODEL_PRESET_LABELS: Record<ViewmodelPreset, string> = {
  "show-all": "Show all",
  "hide-all": "Hide all",
  "keep-melee": "Keep melee visible",
};

/**
 * The draft a preset produces. A row keeps its reskins together; a melee
 * inspect animation counts as melee.
 */
export function viewmodelPresetChoices(
  catalog: ViewmodelSourceCatalog,
  preset: ViewmodelPreset,
  mode: ViewmodelHideMode,
): ViewmodelDraftChoices {
  const next: ViewmodelDraftChoices = {};
  if (preset === "show-all") return next;
  for (const className of viewmodelClasses(catalog)) {
    for (const row of viewmodelRowsForClass(catalog, className)) {
      if (preset === "keep-melee" && viewmodelGroupSlot(row.groups[0]) === "melee") continue;
      // Inspect animations are only ever shown or hidden.
      for (const group of row.groups) next[group.id] = group.inspect ? "full" : mode;
    }
  }
  return next;
}

export type ViewmodelChoiceChange = {
  row: ViewmodelRow;
  from: ViewmodelHideMode | "shown";
  to: ViewmodelHideMode | "shown";
};

/** Rows whose choice differs between two drafts, in class and loadout order. */
export function viewmodelChoiceChanges(
  catalog: ViewmodelSourceCatalog,
  before: ViewmodelDraftChoices,
  after: ViewmodelDraftChoices,
): ViewmodelChoiceChange[] {
  return viewmodelClasses(catalog).flatMap((className) =>
    viewmodelRowsForClass(catalog, className).flatMap((row) => {
      const id = row.groups[0].id;
      const from = before[id] ?? "shown";
      const to = after[id] ?? "shown";
      return from === to ? [] : [{ row, from, to }];
    }),
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
