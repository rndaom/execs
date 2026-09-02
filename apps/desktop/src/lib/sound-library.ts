import type { ComfigHitsound, HitsoundKind, HitsoundPick, PickedHitsound } from "./bridge";
import { COMMUNITY_HITSOUNDS } from "./community-hitsounds";
import { type SoundChoice, STOCK_HITSOUND_EFFECTS } from "./hitsound-ui";

/** Where a library sound comes from. */
export type SoundSourceId = "own" | "stock" | "community" | "comfig";

export const SOUND_SOURCE_LABELS: Record<SoundSourceId, string> = {
  own: "Your file",
  stock: "Built into TF2",
  community: "Community pack",
  comfig: "comfig.app",
};

/** One row of the browsable library, usable in either slot. */
export type SoundLibraryEntry = {
  /** Stable key across sources. */
  id: string;
  label: string;
  source: SoundSourceId;
  /** Upstream hint about what it was made for; both slots still accept it. */
  suggested?: HitsoundKind;
  /** What the picker installs / auditions for a given slot. */
  choiceFor: (kind: HitsoundKind) => SoundChoice;
  pickFor: (kind: HitsoundKind) => HitsoundPick;
  /** Secondary text under the name. */
  meta?: string;
};

export type SoundSort = "name-asc" | "name-desc" | "source";

export const SOUND_SORTS: { id: SoundSort; label: string }[] = [
  { id: "name-asc", label: "A to Z" },
  { id: "name-desc", label: "Z to A" },
  { id: "source", label: "Source" },
];

const SOURCE_ORDER: SoundSourceId[] = ["own", "stock", "community", "comfig"];

export function stockEntries(): SoundLibraryEntry[] {
  return STOCK_HITSOUND_EFFECTS.map((effect) => ({
    id: `stock:${effect.index}`,
    label: effect.label,
    source: "stock",
    meta: effect.index === 0 ? "The plain ding — what a custom file replaces." : undefined,
    choiceFor: () => ({ kind: "stock", effect: effect.index }),
    pickFor: (kind) => ({ kind: "stock", stem: kind === "hit" ? effect.hit : effect.kill }),
  }));
}

export function communityEntries(): SoundLibraryEntry[] {
  return COMMUNITY_HITSOUNDS.map((entry) => ({
    id: `community:${entry.id}`,
    label: entry.label,
    source: "community",
    choiceFor: () => ({ kind: "community", id: entry.id }),
    pickFor: () => ({ kind: "community", name: entry.id }),
  }));
}

export function ownEntry(picked: PickedHitsound): SoundLibraryEntry {
  return {
    id: `own:${picked.token}`,
    label: picked.name,
    source: "own",
    meta: picked.converted ? "Converted to 16-bit 44.1 kHz for TF2." : undefined,
    choiceFor: () => ({ kind: "file", picked }),
    pickFor: () => ({ kind: "file", token: picked.token, name: picked.name }),
  };
}

export function comfigEntries(index: ComfigHitsound[]): SoundLibraryEntry[] {
  return index.map((entry) => ({
    id: `comfig:${entry.hash}`,
    label: entry.name,
    source: "comfig",
    suggested: entry.kind,
    choiceFor: () => ({ kind: "comfig", hash: entry.hash, name: entry.name }),
    pickFor: () => ({ kind: "comfig", hash: entry.hash, name: entry.name }),
  }));
}

/** Search across name and source, then sort. Stable within ties. */
export function filterSoundLibrary(
  entries: SoundLibraryEntry[],
  query: string,
  sort: SoundSort,
  sources: Set<SoundSourceId> | null,
): SoundLibraryEntry[] {
  const needle = query.trim().toLowerCase();
  const kept = entries.filter((entry) => {
    if (sources && !sources.has(entry.source)) {
      return false;
    }
    if (!needle) {
      return true;
    }
    return (
      entry.label.toLowerCase().includes(needle) ||
      SOUND_SOURCE_LABELS[entry.source].toLowerCase().includes(needle)
    );
  });
  const byName = (a: SoundLibraryEntry, b: SoundLibraryEntry) =>
    a.label.localeCompare(b.label, undefined, { sensitivity: "base", numeric: true });
  const sorted = [...kept];
  switch (sort) {
    case "name-desc":
      sorted.sort((a, b) => byName(b, a));
      break;
    case "source":
      sorted.sort(
        (a, b) => SOURCE_ORDER.indexOf(a.source) - SOURCE_ORDER.indexOf(b.source) || byName(a, b),
      );
      break;
    default:
      sorted.sort(byName);
  }
  return sorted;
}
