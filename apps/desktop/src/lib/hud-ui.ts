import type { HudCatalogEntry, HudRecord, HudSchemaView, HudUiState } from "./bridge";

export const PREVIEW_HUD_CATALOG: HudCatalogEntry[] = [
  {
    id: "rayshud",
    name: "rayshud",
    author: "raysfire",
    repo: "https://github.com/raysfire/rayshud",
    hash: "abc123",
    github: true,
    flags: ["menus", "customization"],
    banner: null,
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
  return entry.github;
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
