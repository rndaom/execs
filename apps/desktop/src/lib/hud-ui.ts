import type { HudCatalogEntry, HudRecord, HudSchemaView, HudStat, HudUiState } from "./bridge";

export type HudSort = "name" | "updated" | "downloads" | "views";

export const HUD_SORTS: { id: HudSort; label: string }[] = [
  { id: "name", label: "A to Z" },
  { id: "updated", label: "Last updated" },
  { id: "downloads", label: "Most downloads" },
  { id: "views", label: "Most views" },
];

/**
 * Order the catalog. Numbers come from tf2huds.dev and dates from comfig.app,
 * neither of which knows every HUD, so the unknowns sink to the bottom in
 * name order instead of pretending to be zero.
 */
export function sortHudCatalog(
  entries: HudCatalogEntry[],
  stats: Record<string, HudStat>,
  sort: HudSort,
): HudCatalogEntry[] {
  const byName = (a: HudCatalogEntry, b: HudCatalogEntry) =>
    a.name.localeCompare(b.name, undefined, { sensitivity: "base", numeric: true });
  const stat = (entry: HudCatalogEntry) => stats[entry.id.toLowerCase()] ?? stats[entry.id];
  const sorted = [...entries];
  switch (sort) {
    case "updated":
      sorted.sort((a, b) => {
        const da = stat(a)?.updated ?? "";
        const db = stat(b)?.updated ?? "";
        return db.localeCompare(da) || byName(a, b);
      });
      break;
    case "downloads":
    case "views":
      sorted.sort((a, b) => {
        const na = stat(a)?.[sort] ?? -1;
        const nb = stat(b)?.[sort] ?? -1;
        return nb - na || byName(a, b);
      });
      break;
    default:
      sorted.sort(byName);
  }
  return sorted;
}

/** "398k downloads · updated Jan 2026", or null when nothing is known. */
export function hudStatCopy(stat: HudStat | undefined): string | null {
  if (!stat) {
    return null;
  }
  const parts: string[] = [];
  if (typeof stat.downloads === "number") {
    parts.push(`${compactCount(stat.downloads)} downloads`);
  }
  if (typeof stat.views === "number") {
    parts.push(`${compactCount(stat.views)} views`);
  }
  if (stat.updated) {
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
    tf2hudsUrl: "https://tf2huds.dev/hud/rayshud",
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
    tf2hudsUrl: "https://tf2huds.dev/hud/toonhud",
  },
];

export const PREVIEW_HUD_SCHEMA: HudSchemaView = {
  author: "raysfire",
  supported: true,
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

export function previewInferredState(): HudUiState {
  return {
    installed: {
      id: "rayshud",
      hash: null,
      source: "local",
      options: {},
    },
    inferred: true,
    schemaSupported: true,
    catalogHash: "abc123",
    updateAvailable: false,
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

export const HUD_CATALOG_PAGE_SIZE = 20;

export type HudCatalogPage = {
  items: HudCatalogEntry[];
  page: number;
  pageCount: number;
  total: number;
};

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
      return "Fetched from the author's Dropbox link.";
    case "gamebanana":
      return "Fetched from the author's GameBanana page.";
    case "thread":
      return "Fetched from the archive linked in the author's thread.";
    case "none":
      return "No download this app can fetch — open the author's page.";
    default:
      return null;
  }
}

export function installedHudLabel(state: HudUiState): string | null {
  if (!state.installed) {
    return null;
  }
  return state.inferred ? "Installed (from this profile)" : "Installed";
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

// Moved to lib/color.ts (shared with the crosshair tint); re-exported so the
// HUD and crosshair panes keep their existing import site.
export { hexToRgb, rgbToHex } from "./color";
