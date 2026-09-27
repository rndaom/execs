import type { ComfigHitsound, HitsoundKind, HitsoundPick, PickedHitsound } from "./bridge";
import { type SoundChoice, STOCK_HITSOUND_EFFECTS } from "./hitsound-ui";

/** Where a library sound comes from. */
export type SoundSourceId = "own" | "stock" | "comfig";

export const SOUND_SOURCE_LABELS: Record<SoundSourceId, string> = {
  own: "Your file",
  stock: "Built into TF2",
  comfig: "comfig.app",
};

/** One row of the browsable library, usable in either slot. */
export type SoundLibraryEntry = {
  /** Stable key across sources. */
  id: string;
  label: string;
  source: SoundSourceId;
  /** What the picker installs / auditions for a given slot. */
  choiceFor: (kind: HitsoundKind) => SoundChoice;
  pickFor: (kind: HitsoundKind) => HitsoundPick;
  /** Secondary text under the name. */
  meta?: string;
  /** The slot an uploader made it for; either slot still accepts it. */
  madeFor?: HitsoundKind;
  /** Position in its source's own list. */
  order?: number;
};

/**
 * Suggested: yours, then TF2's own effects, then comfig.app uploads made for
 * the slot you are choosing, then the rest, each in its source's own order.
 */
export type SoundSort = "suggested" | "name-asc" | "name-desc";

export const SOUND_SORTS: { id: SoundSort; label: string }[] = [
  { id: "suggested", label: "Suggested" },
  { id: "name-asc", label: "A to Z" },
  { id: "name-desc", label: "Z to A" },
];

export type SoundFilter = "all" | "favorites" | "stock" | "comfig";

export const SOUND_FILTERS: { id: SoundFilter; label: string }[] = [
  { id: "all", label: "All" },
  { id: "favorites", label: "Favorites" },
  { id: "stock", label: "Built into TF2" },
  { id: "comfig", label: "comfig.app" },
];

const FAVORITES_KEY = "execs.sounds.favorites";

/** Favorite sounds are an app-wide convenience, never part of a profile. */
export function readSoundFavorites(): Set<string> {
  try {
    const stored = JSON.parse(window.localStorage.getItem(FAVORITES_KEY) ?? "[]");
    return new Set(
      Array.isArray(stored)
        ? stored.filter((id): id is string => typeof id === "string" && id.length <= 200)
        : [],
    );
  } catch {
    return new Set();
  }
}

export function writeSoundFavorites(favorites: ReadonlySet<string>) {
  try {
    window.localStorage.setItem(FAVORITES_KEY, JSON.stringify([...favorites].slice(0, 5000)));
  } catch {
    // Ignored: remembering favorites is a convenience, not a requirement.
  }
}

export const SOUND_LIBRARY_PAGE_SIZE = 24;

export function pageSoundLibrary(entries: SoundLibraryEntry[], requestedPage: number) {
  const pageCount = Math.ceil(entries.length / SOUND_LIBRARY_PAGE_SIZE);
  const page = Math.min(Math.max(0, requestedPage), Math.max(0, pageCount - 1));
  const start = page * SOUND_LIBRARY_PAGE_SIZE;
  return {
    page,
    pageCount,
    first: entries.length ? start + 1 : 0,
    last: Math.min(start + SOUND_LIBRARY_PAGE_SIZE, entries.length),
    entries: entries.slice(start, start + SOUND_LIBRARY_PAGE_SIZE),
  };
}

export function soundPageLinks(
  page: number,
  pageCount: number,
): (number | "gap-start" | "gap-end")[] {
  if (pageCount <= 7) return Array.from({ length: pageCount }, (_, index) => index + 1);
  const keep = new Set([1, pageCount, page, page + 1, page + 2]);
  const ordered = [...keep]
    .filter((value) => value >= 1 && value <= pageCount)
    .sort((a, b) => a - b);
  const links: (number | "gap-start" | "gap-end")[] = [];
  ordered.forEach((value, index) => {
    if (index > 0 && value - ordered[index - 1] > 1) {
      links.push(value === pageCount ? "gap-end" : "gap-start");
    }
    links.push(value);
  });
  return links;
}

export function parseSoundPageJump(value: string, pageCount: number): number | null {
  if (!/^[1-9]\d*$/.test(value)) return null;
  const page = Number(value);
  return Number.isSafeInteger(page) && page <= pageCount ? page - 1 : null;
}

const SOURCE_ORDER: SoundSourceId[] = ["own", "stock", "comfig"];

export function stockEntries(): SoundLibraryEntry[] {
  return STOCK_HITSOUND_EFFECTS.map((effect) => ({
    id: `stock:${effect.index}`,
    label: effect.label,
    source: "stock",
    meta: effect.index === 0 ? "The plain ding" : undefined,
    order: effect.index,
    choiceFor: () => ({ kind: "stock", effect: effect.index }),
    pickFor: (kind) => ({ kind: "stock", stem: kind === "hit" ? effect.hit : effect.kill }),
  }));
}

export function ownEntry(picked: PickedHitsound): SoundLibraryEntry {
  return {
    id: `own:${picked.token}`,
    label: picked.name,
    source: "own",
    meta: picked.converted ? "Converted to 16-bit 44.1 kHz" : undefined,
    choiceFor: () => ({ kind: "file", picked }),
    pickFor: () => ({ kind: "file", token: picked.token, name: picked.name }),
  };
}

export function comfigEntries(index: ComfigHitsound[]): SoundLibraryEntry[] {
  return index.map((entry) => ({
    id: `comfig:${entry.hash}`,
    label: entry.name,
    source: "comfig",
    madeFor: entry.kind,
    order: entry.order,
    choiceFor: () => ({ kind: "comfig", hash: entry.hash, name: entry.name }),
    pickFor: () => ({ kind: "comfig", hash: entry.hash, name: entry.name }),
  }));
}

/** Stable across filtering/sorting; duplicate source names get a local ordinal. */
export function soundAccessibleNames(entries: SoundLibraryEntry[]): Map<string, string> {
  const groups = new Map<string, SoundLibraryEntry[]>();
  for (const entry of entries) {
    const key = JSON.stringify([entry.source, entry.label]);
    const group = groups.get(key) ?? [];
    group.push(entry);
    groups.set(key, group);
  }
  const names = new Map<string, string>();
  for (const group of groups.values()) {
    group.forEach((entry, index) => {
      const duplicate = group.length > 1 ? `, sound ${index + 1}` : "";
      names.set(entry.id, `${entry.label} (${SOUND_SOURCE_LABELS[entry.source]}${duplicate})`);
    });
  }
  return names;
}

/** Search, filter by source or favorites, then sort. Stable within ties. */
export function filterSoundLibrary(
  entries: SoundLibraryEntry[],
  query: string,
  sort: SoundSort,
  options: {
    filter?: SoundFilter;
    favorites?: ReadonlySet<string>;
    /** The slot being chosen, for Suggested. */
    target?: HitsoundKind;
  } = {},
): SoundLibraryEntry[] {
  const { filter = "all", favorites = new Set<string>(), target = "hit" } = options;
  const needle = query.trim().toLowerCase();
  const kept = entries.filter((entry) => {
    if (filter === "favorites" && !favorites.has(entry.id)) return false;
    // Your own file stays at hand under every source filter.
    if (
      (filter === "stock" || filter === "comfig") &&
      entry.source !== filter &&
      entry.source !== "own"
    )
      return false;
    if (!needle) return true;
    return (
      entry.label.toLowerCase().includes(needle) ||
      SOUND_SOURCE_LABELS[entry.source].toLowerCase().includes(needle)
    );
  });
  const byName = (a: SoundLibraryEntry, b: SoundLibraryEntry) =>
    a.label.localeCompare(b.label, undefined, { sensitivity: "base", numeric: true });
  const rank = (entry: SoundLibraryEntry) =>
    SOURCE_ORDER.indexOf(entry.source) * 2 + (entry.madeFor && entry.madeFor !== target ? 1 : 0);
  const sorted = [...kept];
  switch (sort) {
    case "name-asc":
      sorted.sort(byName);
      break;
    case "name-desc":
      sorted.sort((a, b) => byName(b, a));
      break;
    default:
      sorted.sort(
        (a, b) =>
          rank(a) - rank(b) ||
          (a.order ?? Number.MAX_SAFE_INTEGER) - (b.order ?? Number.MAX_SAFE_INTEGER) ||
          byName(a, b),
      );
  }
  return sorted;
}
