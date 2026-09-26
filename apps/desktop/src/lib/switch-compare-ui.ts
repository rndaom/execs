export type SetChange = { added: string[]; removed: string[]; changed: string[] };
export type TextChange = { from: string | null; to: string | null };
export type ValueChange = { name: string; from: string | null; to: string | null };

export type ProfileComparison = {
  fromId: string;
  fromName: string;
  toId: string;
  toName: string;
  revision: string;
  launchOptions: TextChange | null;
  hud: TextChange | null;
  hitSound: TextChange | null;
  killSound: TextChange | null;
  packs: SetChange;
  cfgFiles: SetChange;
  configCfgChanged: boolean;
  values: ValueChange[];
  valuesTruncated: boolean;
  casual: SetChange;
  blocked: string | null;
};

/** App-owned packs read better by what they hold than by folder name. */
const PACK_LABELS: Record<string, string> = {
  "execs-crosshairs": "Custom crosshairs",
  "execs-hitsounds": "Hit and kill sounds",
  "execs-viewmodels.vpk": "Viewmodels",
  "execs-hud-backups": "HUD backups",
  "mastercomfig-base.vpk": "mastercomfig",
  "comfig-custom": "comfig custom files",
};

export function packLabel(name: string): string {
  return PACK_LABELS[name.toLowerCase()] ?? name;
}

export type CompareRow = { label: string; from: string; to: string };
export type CompareSection = { id: string; title: string; rows: CompareRow[]; note?: string };

const NONE = "None";

function textRow(label: string, change: TextChange | null): CompareRow[] {
  return change ? [{ label, from: change.from ?? NONE, to: change.to ?? NONE }] : [];
}

function setRows(change: SetChange, label: (name: string) => string): CompareRow[] {
  return [
    ...change.added.map((name) => ({ label: label(name), from: "Not installed", to: "Added" })),
    ...change.removed.map((name) => ({ label: label(name), from: "Installed", to: "Removed" })),
    ...change.changed.map((name) => ({ label: label(name), from: "Installed", to: "Replaced" })),
  ];
}

export function compareSections(comparison: ProfileComparison): CompareSection[] {
  const sections: CompareSection[] = [];
  const general = [
    ...textRow("HUD", comparison.hud),
    ...textRow("Hit sound", comparison.hitSound),
    ...textRow("Kill sound", comparison.killSound),
    ...textRow("Launch options", comparison.launchOptions),
  ];
  if (general.length > 0) sections.push({ id: "general", title: "Setup", rows: general });
  const values = comparison.values.map((value) => ({
    label: value.name,
    from: value.from ?? "Not set",
    to: value.to ?? "Not set",
  }));
  if (values.length > 0)
    sections.push({
      id: "values",
      title: "Settings and binds",
      rows: values,
      note: comparison.valuesTruncated ? "More settings differ than are listed." : undefined,
    });
  const packs = setRows(comparison.packs, packLabel);
  if (packs.length > 0) sections.push({ id: "packs", title: "Custom files", rows: packs });
  const cfgs = setRows(comparison.cfgFiles, (path) => path.replace(/^tf\/cfg\//, ""));
  if (comparison.configCfgChanged)
    cfgs.push({ label: "config.cfg", from: "Current copy", to: "Replaced" });
  if (cfgs.length > 0)
    sections.push({
      id: "cfgs",
      title: "Config files",
      rows: cfgs,
      note: comparison.configCfgChanged
        ? "Steam's local Cloud copy of config.cfg is updated too. Steam uploads it when it syncs."
        : undefined,
    });
  const casual = setRows(comparison.casual, (name) => name);
  if (casual.length > 0) sections.push({ id: "casual", title: "Casual setup", rows: casual });
  return sections;
}

export function comparisonIsEmpty(comparison: ProfileComparison): boolean {
  return compareSections(comparison).length === 0;
}
