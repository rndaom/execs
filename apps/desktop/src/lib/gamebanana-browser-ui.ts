import type {
  GameBananaDownloadVariant,
  GameBananaMod,
  GameBananaPage,
  GameBananaSort,
  GameBananaTotal,
} from "./bridge";
import { compactCount } from "./hud-ui";
import { formatModBytes } from "./mods-ui";

export const GAMEBANANA_SORTS: { id: GameBananaSort; label: string }[] = [
  { id: "new", label: "New" },
  { id: "updated", label: "Updated" },
  { id: "downloads", label: "Popular" },
  { id: "likes", label: "Likes" },
  { id: "views", label: "Views" },
];

export const GAMEBANANA_DEFAULT_SORT: GameBananaSort = "new";
export const GAMEBANANA_SEARCH_DEBOUNCE_MS = 400;
export const GAMEBANANA_QUERY_MAX_SCALARS = 128;
export const GAMEBANANA_PAGE_CACHE_MAX_ENTRIES = 32;
export const GAMEBANANA_PAGE_CACHE_MAX_FRESH_MS = 10 * 60_000;
export const GAMEBANANA_PAGE_CACHE_STALE_GRACE_MS = 5 * 60_000;

export type GameBananaRequest = {
  query: string;
  sort: GameBananaSort;
  category: number | null;
  page: number;
  includeMature: boolean;
};

export function normalizeGameBananaQuery(query: string): string {
  return query.trim().replace(/\s+/g, " ");
}

export function gameBananaQueryError(query: string): string | null {
  const normalized = normalizeGameBananaQuery(query);
  if (normalized.includes(",")) return "Search terms cannot contain commas.";
  if (Array.from(normalized).length > GAMEBANANA_QUERY_MAX_SCALARS) {
    return `Search terms can be at most ${GAMEBANANA_QUERY_MAX_SCALARS} characters.`;
  }
  return null;
}

export function gameBananaRequestKey(request: GameBananaRequest): string {
  return [
    normalizeGameBananaQuery(request.query).toLowerCase(),
    request.sort,
    request.category ?? "all",
    Math.max(1, request.page),
    request.includeMature ? "rated" : "unrated",
  ].join("\u001f");
}

export type GameBananaPager = {
  label: string;
  pageCount: number | null;
  hasPrevious: boolean;
  hasNext: boolean;
};

export function gameBananaPager(
  page: number,
  total: GameBananaTotal,
  perPage: number,
  complete: boolean,
): GameBananaPager {
  const pageCount =
    total.kind === "exact" && total.value > 0 && perPage > 0
      ? Math.ceil(total.value / perPage)
      : null;
  return {
    label: pageCount === null ? `Page ${page}` : `Page ${page} of ${pageCount}`,
    pageCount,
    hasPrevious: page > 1,
    // GameBanana's completion flag is authoritative even when its count is
    // absent, capped, or temporarily disagrees with a filtered page.
    hasNext: !complete,
  };
}

export function gameBananaTotalLabel(total: GameBananaTotal): string | null {
  switch (total.kind) {
    case "exact":
      return `${total.value.toLocaleString()} ${total.value === 1 ? "result" : "results"}`;
    case "estimated":
      return `About ${total.value.toLocaleString()} ${total.value === 1 ? "result" : "results"}`;
    case "capped":
      return `${total.value.toLocaleString()}+ results`;
    case "unknown":
      return null;
  }
}

export function gameBananaPageScopeNote(page: GameBananaPage): string | null {
  const local = Object.entries(page.filters)
    .filter(([, scope]) => scope === "page")
    .map(([filter]) => filter);
  if (local.length === 0) return null;
  return "Safety filters apply to each GameBanana page, so a page can be empty before the results end.";
}

const DAY_SECONDS = 86_400;

/** "today", "3 days ago", "2 months ago" — terse, sentence case. */
export function relativeDate(unixSeconds: number, now: number = Date.now()): string {
  const elapsed = Math.max(0, Math.floor(now / 1000) - Math.floor(unixSeconds));
  if (elapsed < DAY_SECONDS) return "today";
  const days = Math.floor(elapsed / DAY_SECONDS);
  if (days === 1) return "yesterday";
  if (days < 7) return `${days} days ago`;
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

function validTimestamp(value: number | null): value is number {
  return value !== null && Number.isFinite(value) && value > 0;
}

function dateFact(mod: GameBananaMod, sort: GameBananaSort, now: number): string | null {
  if (sort === "updated") {
    return validTimestamp(mod.updatedAt) ? `Updated ${relativeDate(mod.updatedAt, now)}` : null;
  }
  if (sort === "new") {
    return validTimestamp(mod.addedAt) ? `Added ${relativeDate(mod.addedAt, now)}` : null;
  }
  return null;
}

/** Facts on a card follow the selected upstream order and never invent missing values. */
export function gameBananaMetaLine(
  mod: GameBananaMod,
  sort: GameBananaSort,
  now: number = Date.now(),
): string {
  const parts: string[] = [];
  if (sort === "downloads" && mod.downloads !== null) {
    parts.push(`${compactCount(mod.downloads)} downloads`);
  } else if (sort === "likes" && mod.likes !== null) {
    parts.push(`${compactCount(mod.likes)} likes`);
  } else if (sort === "views" && mod.views !== null) {
    parts.push(`${compactCount(mod.views)} views`);
  } else {
    const date = dateFact(mod, sort, now);
    if (date) parts.push(date);
  }

  if (sort !== "likes" && mod.likes !== null) parts.push(`▲ ${compactCount(mod.likes)}`);
  if (sort !== "downloads" && mod.downloads !== null) {
    parts.push(`${compactCount(mod.downloads)} downloads`);
  }
  return parts.length > 0 ? parts.join(" · ") : "Details unavailable";
}

export type GameBananaPageSnapshot = {
  key: string;
  page: GameBananaPage;
  freshUntil: number;
  staleUntil: number;
  lastUsed: number;
};

export type GameBananaPageCache = Map<string, GameBananaPageSnapshot>;
export type GameBananaCachedPage = {
  freshness: "fresh" | "stale";
  snapshot: GameBananaPageSnapshot;
};

export function pruneGameBananaPageCache(cache: GameBananaPageCache, now: number): void {
  for (const [key, entry] of cache) {
    if (entry.staleUntil <= now) cache.delete(key);
  }
  while (cache.size > GAMEBANANA_PAGE_CACHE_MAX_ENTRIES) {
    const oldest = [...cache.values()].sort((a, b) => a.lastUsed - b.lastUsed)[0];
    if (!oldest) break;
    cache.delete(oldest.key);
  }
}

export function readGameBananaPageCache(
  cache: GameBananaPageCache,
  key: string,
  now: number,
): GameBananaCachedPage | null {
  pruneGameBananaPageCache(cache, now);
  const entry = cache.get(key);
  if (!entry) return null;
  const touched = { ...entry, lastUsed: now };
  cache.delete(key);
  cache.set(key, touched);
  return { freshness: touched.freshUntil > now ? "fresh" : "stale", snapshot: touched };
}

export function writeGameBananaPageCache(
  cache: GameBananaPageCache,
  key: string,
  page: GameBananaPage,
  now: number,
): GameBananaPageSnapshot {
  const freshFor = Math.min(GAMEBANANA_PAGE_CACHE_MAX_FRESH_MS, Math.max(0, page.cache.freshForMs));
  const freshUntil = now + freshFor;
  const snapshot = {
    key,
    page,
    freshUntil,
    staleUntil: freshUntil + GAMEBANANA_PAGE_CACHE_STALE_GRACE_MS,
    lastUsed: now,
  };
  cache.delete(key);
  cache.set(key, snapshot);
  pruneGameBananaPageCache(cache, now);
  return snapshot;
}

const FILE_DATE = new Intl.DateTimeFormat(undefined, { dateStyle: "medium" });

/** Size, upload date and why a file cannot be chosen, for the file chooser. */
export function gameBananaVariantFacts(
  variant: GameBananaDownloadVariant,
  dates: Intl.DateTimeFormat = FILE_DATE,
): string {
  const facts = [variant.sizeBytes === null ? "Size unknown" : formatModBytes(variant.sizeBytes)];
  // Absolute dates tell an old version from a current one; relative ones blur.
  if (validTimestamp(variant.addedAt)) {
    facts.push(`Added ${dates.format(new Date(variant.addedAt * 1000))}`);
  }
  if (variant.splitPart) facts.push("Part of a split download");
  else if (!variant.supported) facts.push("Not supported for Mods");
  return facts.join(" · ");
}

/**
 * The only installable file is chosen up front. Next to split parts, the one
 * whole file is often an optional addon, so nothing is chosen for the player.
 */
export function gameBananaDefaultVariant(variants: GameBananaDownloadVariant[]): number | null {
  if (variants.some((variant) => variant.splitPart)) return null;
  const supported = variants.filter((variant) => variant.supported);
  return supported.length === 1 ? supported[0].id : null;
}
