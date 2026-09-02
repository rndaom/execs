import type {
  CatalogAddon,
  CatalogParticleMod,
  GameBananaCategory,
  GameBananaMod,
  GameBananaSort,
  ModRecord,
  ModSource,
  ModsCatalog,
  ParticleSource,
  PreloaderReport,
  PreloaderStatusPayload,
} from "./bridge";
import { compactCount } from "./hud-ui";

/** Credit shown on the pane; the mechanism and default library come from
 * cueki's casual-pre-loader, rebuilt natively for execs. */
export const PRELOADER_CREDIT =
  "Preloader mechanism and default mod library from cueki's casual-pre-loader (GPL-3.0), reimplemented natively. Mod credits belong to their original authors.";

export const PRELOADER_REPO_URL = "https://github.com/cueki/casual-pre-loader";

/** One-line explanation used at the top of the pane. */
export const PRELOADER_EXPLAINER = "Custom content that survives Valve Casual's sv_pure.";

/** How long the pane keeps polling for Steam's verify to finish. */
export const REPAIR_POLL_MS = 5_000;
export const REPAIR_TIMEOUT_MS = 20 * 60_000;

/**
 * Whether a repair has finished: every particle file execs could not restore
 * now reads as stock again. Steam's verify also puts back the files execs
 * patched itself, so the caller re-applies the selection afterwards.
 */
export function repairComplete(status: PreloaderStatusPayload | null): boolean {
  return status !== null && status.status.untrackedModified.length === 0;
}

export function toggleName(list: string[], name: string): string[] {
  return list.includes(name) ? list.filter((entry) => entry !== name) : [...list, name];
}

export function formatModBytes(bytes: number): string {
  if (bytes >= 1024 * 1024) {
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  }
  if (bytes >= 1024) {
    return `${Math.round(bytes / 1024)} KB`;
  }
  return `${bytes} B`;
}

/**
 * Everything one Apply writes: the default library's addons and particle mods,
 * plus the particle sources that came from the profile's own mods.
 */
export type ModSelection = {
  addons: string[];
  particleMods: string[];
  profileParticleMods: string[];
};

/** What is on disk right now — the seed every draft starts from. */
export function installedModSelection(status: PreloaderStatusPayload | null): ModSelection {
  return {
    addons: status?.status.addons ?? [],
    particleMods: status?.status.particleMods ?? [],
    profileParticleMods: status?.status.profileParticleMods ?? [],
  };
}

/**
 * Drop picks whose source is gone — the pack was removed while it was ticked.
 * Nothing on screen could untick them any more, so Apply would stay lit over an
 * id the backend cannot satisfy. An id that is still installed stays: the
 * backend has it, and the selection still matches what is on disk.
 */
export function visibleModSelection(
  selection: ModSelection,
  sources: ParticleSource[],
  installed: string[],
): ModSelection {
  const known = new Set([...sources.map((source) => source.modId), ...installed]);
  const kept = selection.profileParticleMods.filter((id) => known.has(id));
  return kept.length === selection.profileParticleMods.length
    ? selection
    : { ...selection, profileParticleMods: kept };
}

/** Order-insensitive identity of a selection, for drafts and comparisons. */
export function serializeModSelection(selection: ModSelection): string {
  return JSON.stringify([
    [...selection.addons].sort(),
    [...selection.particleMods].sort(),
    [...selection.profileParticleMods].sort(),
  ]);
}

/** Selection differs from what's installed → the Apply button lights up. */
export function selectionDirty(
  status: PreloaderStatusPayload | null,
  selection: ModSelection,
): boolean {
  return serializeModSelection(installedModSelection(status)) !== serializeModSelection(selection);
}

/**
 * Whether Apply should be live.
 *
 * A TF2 update wipes the patched bytes without touching the recorded selection,
 * so `selectionDirty` is false exactly when the stale notice is telling the user
 * to apply again. Stale therefore enables Apply on its own.
 */
export function modsApplyEnabled(
  status: PreloaderStatusPayload | null,
  selection: ModSelection,
): boolean {
  if (!status?.modsCached) {
    return false;
  }
  return selectionDirty(status, selection) || status.status.stale === true;
}

/** The one-line reason under the Apply button. */
export function modsStatusLine(
  status: PreloaderStatusPayload | null,
  selection: ModSelection,
  running: boolean,
): string {
  if (running) {
    return "TF2 is open — game files cannot be patched";
  }
  if (status && !status.modsCached) {
    return "Download the mod library first";
  }
  if (selectionDirty(status, selection)) {
    return "Selection differs from what's installed";
  }
  if (status?.status.stale) {
    return "TF2 updated — re-apply to put these mods back";
  }
  return "Up to date";
}

/** Short human summary for the report banner after an apply. */
export function summarizeReport(report: PreloaderReport): string {
  const parts: string[] = [];
  if (report.particleModsInstalled.length > 0) {
    parts.push(
      `${report.patchedFiles.length} particle ${report.patchedFiles.length === 1 ? "file" : "files"} patched`,
    );
  }
  if (report.addonsInstalled.length > 0) {
    parts.push(
      `${report.addonsInstalled.length} ${report.addonsInstalled.length === 1 ? "addon" : "addons"} packed`,
    );
  }
  if (parts.length === 0) {
    parts.push("nothing selected — stock files restored");
  }
  if (report.relocatedModelMaterials > 0) {
    // Model materials cannot serve from their stock paths on Casual.
    parts.push(`${report.relocatedModelMaterials} model materials relocated`);
  }
  if (report.synthesizedVmts > 0) {
    parts.push(
      `${report.synthesizedVmts} missing ${report.synthesizedVmts === 1 ? "material" : "materials"} generated`,
    );
  }
  if (report.skipped.length > 0) {
    parts.push(`${report.skipped.length} skipped`);
  }
  if (report.baselineReset) {
    parts.push("game update detected, snapshots refreshed");
  }
  return parts.join(", ");
}

// ---------------------------------------------------------------------------
// Your mods
// ---------------------------------------------------------------------------

/** Above this, removing a pack asks first — it is a long download to redo. */
export const MOD_CONFIRM_BYTES = 50 * 1024 * 1024;

export function modNeedsRemoveConfirm(mod: ModRecord): boolean {
  return mod.bytes > MOD_CONFIRM_BYTES;
}

export function modSourceLabel(source: ModSource): string {
  return source.kind === "gamebanana" ? "GameBanana" : "Local";
}

/** The page a pack came from, when it has one. */
export function modSourceUrl(source: ModSource): string | null {
  return source.kind === "gamebanana" ? source.url : null;
}

/** "Local · 12 MB" — where it came from, then how big it is. */
export function modMetaLine(mod: ModRecord): string {
  return `${modSourceLabel(mod.source)} · ${formatModBytes(mod.bytes)}`;
}

/** A stable, selector-safe suffix for a record's test id. */
export function modDomId(id: string): string {
  return id.replace(/[^a-z0-9]+/gi, "-").toLowerCase();
}

/** The GameBanana listing a pack was installed from, if any. */
export function gameBananaIdOf(mod: ModRecord): number | null {
  return mod.source.kind === "gamebanana" ? mod.source.id : null;
}

/** Whether one GameBanana listing is already installed in this profile. */
export function isGameBananaInstalled(mods: ModRecord[], id: number): boolean {
  return mods.some((mod) => gameBananaIdOf(mod) === id);
}

// ---------------------------------------------------------------------------
// GameBanana browser
// ---------------------------------------------------------------------------

export const GAMEBANANA_SORTS: { id: GameBananaSort; label: string }[] = [
  { id: "downloads", label: "Downloads" },
  { id: "likes", label: "Likes" },
  { id: "views", label: "Views" },
  { id: "updated", label: "Updated" },
  { id: "new", label: "New" },
];

/** How long the search input waits before it asks GameBanana. */
export const GAMEBANANA_SEARCH_DEBOUNCE_MS = 400;

/**
 * Order what is loaded. A search cannot be ordered server-side (documented on
 * the Rust side), so the pill has to mean the same thing either way.
 */
export function sortGameBananaMods(
  records: GameBananaMod[],
  sort: GameBananaSort,
): GameBananaMod[] {
  const byName = (a: GameBananaMod, b: GameBananaMod) =>
    a.name.localeCompare(b.name, undefined, { sensitivity: "base", numeric: true });
  const sorted = [...records];
  switch (sort) {
    case "downloads":
      // Withheld counts sink rather than pretending to be zero.
      sorted.sort((a, b) => (b.downloads ?? -1) - (a.downloads ?? -1) || byName(a, b));
      break;
    case "likes":
      sorted.sort((a, b) => b.likes - a.likes || byName(a, b));
      break;
    case "views":
      sorted.sort((a, b) => b.views - a.views || byName(a, b));
      break;
    case "updated":
      sorted.sort((a, b) => b.updatedAt - a.updatedAt || byName(a, b));
      break;
    default:
      sorted.sort((a, b) => b.addedAt - a.addedAt || byName(a, b));
  }
  return sorted;
}

export type GameBananaPager = {
  label: string;
  pageCount: number | null;
  hasPrevious: boolean;
  hasNext: boolean;
};

/**
 * One page at a time, with an honest label: GameBanana does not always say how
 * many there are, and "Page 3 of ?" is worse than "Page 3". Without a count the
 * only thing that ends the run is the page saying it is the last one.
 */
export function gameBananaPager(
  page: number,
  total: number,
  perPage: number,
  complete: boolean,
): GameBananaPager {
  const pageCount = perPage > 0 && total > 0 ? Math.ceil(total / perPage) : null;
  return {
    label: pageCount === null ? `Page ${page}` : `Page ${page} of ${pageCount}`,
    pageCount,
    hasPrevious: page > 1,
    hasNext: !complete && (pageCount === null || page < pageCount),
  };
}

/** The cache key one loaded page belongs to. */
export function gameBananaPageKey(
  query: string,
  sort: GameBananaSort,
  category: number | null,
  page: number,
  includeMature: boolean,
): string {
  return [
    query.trim().toLowerCase(),
    sort,
    category ?? "all",
    page,
    includeMature ? "mature" : "sfw",
  ].join(" ");
}

/** Where the mature-content choice is remembered, like the disclosures. */
export const MATURE_STORAGE_KEY = "execs.gamebanana.mature";

/**
 * Whether to ask for flagged listings. Off unless the user turned it on: a
 * blocked or unavailable localStorage forgets the choice rather than opening
 * the filter by accident.
 */
export function readMaturePreference(): boolean {
  try {
    return window.localStorage.getItem(MATURE_STORAGE_KEY) === "1";
  } catch {
    return false;
  }
}

export function writeMaturePreference(include: boolean): void {
  try {
    window.localStorage.setItem(MATURE_STORAGE_KEY, include ? "1" : "0");
  } catch {
    // Remembering it is a convenience, not a requirement.
  }
}

const DAY_SECONDS = 86_400;

/** "today", "3 days ago", "2 months ago" — terse, sentence case. */
export function relativeDate(unixSeconds: number, now: number = Date.now()): string {
  const elapsed = Math.floor(now / 1000) - Math.floor(unixSeconds);
  if (elapsed < DAY_SECONDS) {
    return "today";
  }
  const days = Math.floor(elapsed / DAY_SECONDS);
  if (days === 1) {
    return "yesterday";
  }
  if (days < 7) {
    return `${days} days ago`;
  }
  if (days < 35) {
    const weeks = Math.floor(days / 7);
    return weeks === 1 ? "a week ago" : `${weeks} weeks ago`;
  }
  if (days < 365) {
    const months = Math.floor(days / 30);
    return months === 1 ? "a month ago" : `${months} months ago`;
  }
  const years = Math.floor(days / 365);
  return years === 1 ? "a year ago" : `${years} years ago`;
}

/** "▲ 1.2k · 340 downloads · Updated 3 days ago". */
export function gameBananaMetaLine(mod: GameBananaMod, now: number = Date.now()): string {
  const parts = [`▲ ${compactCount(mod.likes)}`];
  if (mod.downloads !== null) {
    parts.push(`${compactCount(mod.downloads)} downloads`);
  }
  parts.push(`Updated ${relativeDate(mod.updatedAt, now)}`);
  return parts.join(" · ");
}

/** Above this many categories the tail folds behind "More" — no dropdowns. */
export const CATEGORY_FOLD_LIMIT = 4;

/**
 * Categories that fit the pill, and the ones that only appear after "More".
 * Five still fit; six or more fold everything past the fourth.
 */
export function foldCategories(categories: GameBananaCategory[]): {
  shown: GameBananaCategory[];
  hidden: GameBananaCategory[];
} {
  if (categories.length <= CATEGORY_FOLD_LIMIT + 1) {
    return { shown: categories, hidden: [] };
  }
  return {
    shown: categories.slice(0, CATEGORY_FOLD_LIMIT),
    hidden: categories.slice(CATEGORY_FOLD_LIMIT),
  };
}

export const PREVIEW_PROFILE_MODS: ModRecord[] = [
  {
    id: "local-jungle-viewmodels",
    name: "Jungle Inferno viewmodels",
    source: { kind: "local" },
    pack: "jungle-viewmodels.vpk",
    files: 42,
    bytes: 12_600_000,
    installedAt: "2026-08-30T18:04:00Z",
  },
  {
    id: "gb-618734",
    name: "Clean Rocket Trails",
    source: { kind: "gamebanana", id: 618_734, url: "https://gamebanana.com/mods/618734" },
    pack: "clean-rocket-trails.vpk",
    files: 9,
    bytes: 61_800_000,
    installedAt: "2026-09-01T09:20:00Z",
  },
];

export const PREVIEW_GAMEBANANA_CATEGORIES: GameBananaCategory[] = [
  { id: 4737, name: "Skins" },
  { id: 5225, name: "Effects" },
  { id: 5064, name: "Sounds" },
];

/** A 1×1 neutral pixel — one card in the fixtures has a picture. */
const PREVIEW_THUMB =
  "data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='220' height='124'><rect width='220' height='124' fill='%231F1F1F'/><circle cx='110' cy='62' r='26' fill='%23CF6A32'/></svg>";

const HOUR = 3_600;

export const PREVIEW_GAMEBANANA_RECORDS: GameBananaMod[] = [
  {
    id: 618_734,
    name: "Clean Rocket Trails",
    author: "sparkplug",
    category: "Effects",
    categoryId: 5225,
    likes: 1_284,
    views: 92_400,
    downloads: 41_300,
    updatedAt: Math.floor(Date.UTC(2026, 7, 28) / 1000),
    addedAt: Math.floor(Date.UTC(2025, 2, 3) / 1000),
    thumb: PREVIEW_THUMB,
    url: "https://gamebanana.com/mods/618734",
    mature: false,
  },
  {
    id: 602_110,
    name: "Flat Scattergun",
    author: "beancan",
    category: "Skins",
    categoryId: 4737,
    likes: 861,
    views: 60_120,
    downloads: 22_940,
    updatedAt: Math.floor(Date.UTC(2026, 8, 1) / 1000) - 6 * HOUR,
    addedAt: Math.floor(Date.UTC(2026, 5, 19) / 1000),
    thumb: null,
    url: "https://gamebanana.com/mods/602110",
    mature: true,
  },
  {
    id: 590_884,
    name: "Muted Hit Markers",
    author: "quietkid",
    category: "Sounds",
    categoryId: 5064,
    likes: 402,
    views: 18_770,
    downloads: null,
    updatedAt: Math.floor(Date.UTC(2026, 6, 12) / 1000),
    addedAt: Math.floor(Date.UTC(2024, 10, 2) / 1000),
    thumb: null,
    url: "https://gamebanana.com/mods/590884",
    mature: false,
  },
  {
    id: 577_301,
    name: "No Explosion Smoke",
    author: "sparkplug",
    category: "Effects",
    categoryId: 5225,
    likes: 2_940,
    views: 210_500,
    downloads: 118_600,
    updatedAt: Math.floor(Date.UTC(2026, 3, 5) / 1000),
    addedAt: Math.floor(Date.UTC(2023, 1, 14) / 1000),
    thumb: null,
    url: "https://gamebanana.com/mods/577301",
    mature: false,
  },
  {
    id: 561_442,
    name: "Vintage Sniper Rifle",
    author: "oldworks",
    category: "Skins",
    categoryId: 4737,
    likes: 178,
    views: 9_310,
    downloads: 4_220,
    updatedAt: Math.floor(Date.UTC(2025, 11, 22) / 1000),
    addedAt: Math.floor(Date.UTC(2025, 9, 30) / 1000),
    thumb: null,
    url: "https://gamebanana.com/mods/561442",
    mature: true,
  },
  {
    id: 540_019,
    name: "Softer Footsteps",
    author: "quietkid",
    category: "Sounds",
    categoryId: 5064,
    likes: 96,
    views: 5_400,
    downloads: 1_870,
    updatedAt: Math.floor(Date.UTC(2024, 4, 9) / 1000),
    addedAt: Math.floor(Date.UTC(2024, 4, 9) / 1000),
    thumb: null,
    url: "https://gamebanana.com/mods/540019",
    mature: false,
  },
];

export const PREVIEW_PARTICLE_SOURCES: ParticleSource[] = [
  {
    modId: "gb-618734",
    name: "Clean Rocket Trails",
    pcfFiles: ["rockettrail.pcf", "rockettrail_dx80.pcf"],
  },
];

export const PREVIEW_MODS_STATUS: PreloaderStatusPayload = {
  status: {
    gameinfoFound: true,
    gameinfoBypassed: true,
    patchedFiles: [
      "particles/explosion.pcf",
      "particles/explosion_dx80.pcf",
      "particles/muzzle_flash.pcf",
    ],
    addons: ["No Burning Overlay"],
    particleMods: ["Square_Series"],
    skipped: [
      {
        file: "soldierbuff.pcf",
        modName: "Square_Series",
        reason: "is 223 bytes over the stock budget even after shrinking",
      },
    ],
    stale: false,
    customVpkPresent: true,
    // One stale patch from an earlier install, so the preview shows the repair flow.
    untrackedModified: ["particles/muzzle_flash.pcf"],
    profileParticleMods: [],
  },
  modsCached: true,
  modsSizeBytes: 81_529_475,
  preloadLaunchInSteam: true,
  profilePreload: true,
  profileParticleSources: PREVIEW_PARTICLE_SOURCES,
};

const PREVIEW_ADDONS: CatalogAddon[] = [
  {
    id: "No Burning Overlay",
    name: "No Burning Overlay",
    kind: "Misc",
    description: "Removes first person burning effect while on fire.",
    fileCount: 3,
    bytes: 41_200,
    hasSound: false,
  },
  {
    id: "No Sentry Shield Overlay",
    name: "No Sentry Shield Overlay",
    kind: "Misc",
    description: "Removes the opaque shield for wrangled sentries.",
    fileCount: 5,
    bytes: 88_000,
    hasSound: false,
  },
  {
    id: "Ultimate Visual Fix Pack",
    name: "Ultimate Visual Fix Pack",
    kind: "Texture",
    description: "Fixes various visual bugs.",
    fileCount: 577,
    bytes: 24_800_000,
    hasSound: false,
  },
];

const PREVIEW_PARTICLES: CatalogParticleMod[] = [
  {
    name: "Square_Series",
    pcfFiles: ["explosion.pcf", "muzzle_flash.pcf", "rockettrail.pcf"],
    fileCount: 61,
    bytes: 9_400_000,
  },
  {
    name: "TF2_Classic",
    pcfFiles: ["rockettrail.pcf", "stickybomb.pcf"],
    fileCount: 18,
    bytes: 2_100_000,
  },
];

export const PREVIEW_MODS_CATALOG: ModsCatalog = {
  addons: PREVIEW_ADDONS,
  particleMods: PREVIEW_PARTICLES,
};
