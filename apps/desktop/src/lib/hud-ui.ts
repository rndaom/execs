import type { HudCatalogEntry, HudRecord, HudSchemaView, HudStat, HudUiState } from "./bridge";

export type HudSort = "name" | "updated" | "downloads" | "views";

export const HUD_SORTS: { id: HudSort; label: string }[] = [
  { id: "name", label: "A to Z" },
  { id: "updated", label: "Last updated" },
  { id: "downloads", label: "Most downloads" },
  { id: "views", label: "Most views" },
];

export type HudCatalogControls = { query: string; sort: HudSort; page: number };
export type HudCatalogAction =
  | { type: "search"; query: string }
  | { type: "sort"; sort: HudSort }
  | { type: "page"; page: number };

export function hudCatalogControls(
  current: HudCatalogControls,
  action: HudCatalogAction,
): HudCatalogControls {
  switch (action.type) {
    case "search":
      return { ...current, query: action.query, page: 0 };
    case "sort":
      return { ...current, sort: action.sort, page: 0 };
    case "page":
      return { ...current, page: action.page };
  }
}

function validHudCount(value: number | null | undefined): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

function hudUpdatedTime(value: string | null | undefined): number | null {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const time = Date.parse(value);
  return Number.isFinite(time) && new Date(time).toISOString().slice(0, 10) === value ? time : null;
}

/** A missing source value has no rank; zero is still a published count. */
function hudRankValue(stat: HudStat | undefined, sort: Exclude<HudSort, "name">): number | null {
  if (sort === "updated") return hudUpdatedTime(stat?.updated);
  const count = stat?.[sort];
  return validHudCount(count) ? count : null;
}

/** Metric sorts include only HUDs the source can rank; A to Z includes every HUD. */
export function sortHudCatalog(
  entries: HudCatalogEntry[],
  stats: Record<string, HudStat>,
  sort: HudSort,
): HudCatalogEntry[] {
  const byName = (a: HudCatalogEntry, b: HudCatalogEntry) =>
    a.name.localeCompare(b.name, undefined, { sensitivity: "base", numeric: true });
  const stat = (entry: HudCatalogEntry) => stats[entry.id.toLowerCase()] ?? stats[entry.id];
  if (sort === "name") return [...entries].sort(byName);
  const ranked = entries.flatMap((entry) => {
    const value = hudRankValue(stat(entry), sort);
    return value === null ? [] : [{ entry, value }];
  });
  ranked.sort((a, b) => b.value - a.value || byName(a.entry, b.entry));
  return ranked.map(({ entry }) => entry);
}

/** "398k downloads · updated Jan 2026", or null when nothing is known. */
export function hudStatCopy(stat: HudStat | undefined): string | null {
  if (!stat) {
    return null;
  }
  const parts: string[] = [];
  if (validHudCount(stat.downloads)) {
    parts.push(`${compactCount(stat.downloads)} downloads`);
  }
  if (validHudCount(stat.views)) {
    parts.push(`${compactCount(stat.views)} views`);
  }
  if (stat.updated && hudUpdatedTime(stat.updated) !== null) {
    parts.push(`updated ${monthYear(stat.updated)}`);
  }
  return parts.length > 0 ? parts.join(" · ") : null;
}

export function compactCount(value: number): string {
  if (value >= 1_000_000) {
    return `${(value / 1_000_000).toFixed(value >= 10_000_000 ? 0 : 1)}M`;
  }
  if (value >= 1_000) {
    return `${(value / 1_000).toFixed(value >= 10_000 ? 0 : 1)}k`;
  }
  return String(value);
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function monthYear(iso: string): string {
  const [year, month] = iso.split("-");
  const index = Number(month) - 1;
  return MONTHS[index] ? `${MONTHS[index]} ${year}` : iso;
}

export const PREVIEW_HUD_CATALOG: HudCatalogEntry[] = [
  {
    id: "rayshud",
    name: "rayshud",
    author: "raysfire",
    repo: "https://github.com/raysfire/rayshud",
    hash: "abc123",
    github: true,
    install: "github",
    flags: ["menus", "customization"],
    banner:
      "https://raw.githubusercontent.com/mastercomfig/hud-db/main/hud-resources/rayshud/hud.webp",
    screenshots: [
      "https://raw.githubusercontent.com/mastercomfig/hud-db/main/hud-resources/rayshud/hud.webp",
      "https://raw.githubusercontent.com/mastercomfig/hud-db/main/hud-resources/rayshud/scoreboard.webp",
    ],
    album: null,
    comfigUrl: "https://comfig.app/huds/page/rayshud/",
  },
  {
    id: "toonhud",
    name: "ToonHUD",
    author: "toonhud",
    repo: "https://toonhud.com/",
    hash: "11.4",
    github: false,
    install: "none",
    flags: ["customization"],
    banner: null,
    screenshots: [],
    album: null,
    comfigUrl: "https://comfig.app/huds/page/toonhud/",
  },
];

export const PREVIEW_HUD_SCHEMA: HudSchemaView = {
  author: "raysfire",
  sections: [
    {
      name: "Colors",
      controls: [
        {
          name: "HealthBuff",
          label: "Buff",
          controlType: "color",
          value: "0 153 255 255",
          choices: [],
        },
      ],
    },
    {
      name: "Extras",
      controls: [
        {
          name: "minmode",
          label: "Minmode",
          controlType: "checkbox",
          value: "false",
          choices: [],
        },
        {
          name: "Scoreboard",
          label: "Scoreboard",
          controlType: "combo",
          value: "default",
          choices: [
            { label: "Default", value: "default" },
            { label: "Minimal", value: "minimal" },
          ],
        },
        {
          name: "Ubercharge",
          label: "Ubercharge flash",
          controlType: "number",
          value: "10",
          choices: [],
          minimum: "0",
          maximum: "30",
        },
      ],
    },
  ],
};

export function emptyHudState(): HudUiState {
  return {
    installed: null,
    inferred: false,
    schemaSupported: false,
    catalogHash: null,
    updateAvailable: false,
  };
}

export function previewInstalledState(): HudUiState {
  return {
    installed: {
      id: "rayshud",
      hash: "oldhash",
      source: "hudDb",
      options: { HealthBuff: "0 153 255 255", minmode: "false" },
    },
    inferred: false,
    schemaSupported: true,
    catalogHash: "abc123",
    updateAvailable: true,
  };
}

export function filterHudCatalog(entries: HudCatalogEntry[], query: string): HudCatalogEntry[] {
  const needle = normalizeHudSearch(query);
  if (!needle) {
    return entries;
  }
  return entries.filter((entry) => {
    return [entry.name, entry.author, entry.id].some((value) =>
      normalizeHudSearch(value).includes(needle),
    );
  });
}

/** Fold case and drop punctuation so "m0rehud" matches "m0re HUD". */
export function normalizeHudSearch(value: string): string {
  return value.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, "");
}

export const HUD_CATALOG_PAGE_SIZE = 6;

export type HudCatalogPage = {
  items: HudCatalogEntry[];
  page: number;
  pageCount: number;
  total: number;
};

/** Keep the ends reachable without filling the toolbar with every page. */
export function hudPageLinks(
  page: number,
  pageCount: number,
): (number | "gap-before" | "gap-after")[] {
  if (pageCount <= 7) {
    return Array.from({ length: pageCount }, (_, index) => index);
  }
  const start = Math.max(1, Math.min(page - 1, pageCount - 4));
  const end = Math.min(pageCount - 2, Math.max(page + 1, 3));
  const links: (number | "gap-before" | "gap-after")[] = [0];
  if (start > 1) links.push("gap-before");
  for (let index = start; index <= end; index += 1) links.push(index);
  if (end < pageCount - 2) links.push("gap-after");
  links.push(pageCount - 1);
  return links;
}

export function parseHudPageJump(value: string, pageCount: number): number | null {
  if (!/^\d+$/.test(value.trim())) return null;
  const page = Number(value);
  return Number.isSafeInteger(page) && page >= 1 && page <= pageCount ? page - 1 : null;
}

/** Slice one page out of the (already filtered) catalog, clamping the page index. */
export function paginateHudCatalog(
  entries: HudCatalogEntry[],
  page: number,
  pageSize = HUD_CATALOG_PAGE_SIZE,
): HudCatalogPage {
  const total = entries.length;
  const pageCount = Math.max(1, Math.ceil(total / pageSize));
  const clamped = Math.min(Math.max(0, page), pageCount - 1);
  return {
    items: entries.slice(clamped * pageSize, clamped * pageSize + pageSize),
    page: clamped,
    pageCount,
    total,
  };
}

/** Step through a HUD's screenshots with wrap-around. */
export function stepHudScreenshot(index: number, delta: number, count: number): number {
  if (count <= 0) {
    return 0;
  }
  return (((index + delta) % count) + count) % count;
}

export function optionValue(record: HudRecord | null, name: string, fallback: string): string {
  return record?.options[name] ?? fallback;
}

export function schemaSupportedIds(): string[] {
  return ["rayshud", "budhud", "flawhud", "m0rehud", "kbnhud", "hypnotize-hud"];
}

export function canInstallHud(entry: HudCatalogEntry): boolean {
  return entry.install !== "none";
}

/** One line on where a non-GitHub install comes from, or null for GitHub. */
export function hudInstallSourceCopy(entry: HudCatalogEntry): string | null {
  switch (entry.install) {
    case "direct":
      return "From Dropbox";
    case "gamebanana":
      return "From GameBanana";
    case "thread":
      return "From the author's thread";
    case "none":
      return "No direct download";
    default:
      return null;
  }
}

export function installedHudLabel(state: HudUiState): string | null {
  if (!state.installed) {
    return null;
  }
  return state.inferred ? "Found in this profile" : "Installed";
}

export function seedHudOptions(
  schema: HudSchemaView | null,
  record: HudRecord | null,
): Record<string, string> {
  const next: Record<string, string> = {};
  if (!schema) {
    return next;
  }
  for (const section of schema.sections) {
    for (const control of section.controls) {
      next[control.name] = optionValue(record, control.name, control.value);
    }
  }
  return next;
}

export function hudOptionsDirty(
  draft: Record<string, string>,
  seeded: Record<string, string>,
): boolean {
  const keys = new Set([...Object.keys(draft), ...Object.keys(seeded)]);
  for (const key of keys) {
    if ((draft[key] ?? "") !== (seeded[key] ?? "")) {
      return true;
    }
  }
  return false;
}

export function isHudCheckboxOn(value: string): boolean {
  return ["1", "true", "yes", "on"].includes(value.trim().toLowerCase());
}

export function parseHudRgba(value: string): { r: number; g: number; b: number; a: number } {
  const parts = value
    .trim()
    .split(/\s+/)
    .map((part) => Number(part));
  const clamp = (n: number) => Math.min(255, Math.max(0, Number.isFinite(n) ? Math.round(n) : 0));
  return {
    r: clamp(parts[0] ?? 255),
    g: clamp(parts[1] ?? 255),
    b: clamp(parts[2] ?? 255),
    a: clamp(parts[3] ?? 255),
  };
}

export function formatHudRgba(r: number, g: number, b: number, a: number): string {
  return `${r} ${g} ${b} ${a}`;
}
