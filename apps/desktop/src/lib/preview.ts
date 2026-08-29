import type { ProfileLibrary, Tf2Install } from "./bridge";
import { emptyLibrary } from "./library-ui";

export const PREVIEW_STATES = ["empty", "one", "many", "confirmed", "locked", "library"] as const;

export type PreviewState = (typeof PREVIEW_STATES)[number];

const ONE: Tf2Install = {
  path: "/home/user/.local/share/Steam/steamapps/common/Team Fortress 2",
};

const MANY: Tf2Install[] = [
  ONE,
  { path: "/mnt/games/SteamLibrary/steamapps/common/Team Fortress 2" },
];

export function previewStateFromSearch(search: string): PreviewState | null {
  const value = new URLSearchParams(search.startsWith("?") ? search.slice(1) : search).get(
    "preview",
  );
  return PREVIEW_STATES.find((state) => state === value) ?? null;
}

export function previewInstalls(state: PreviewState): Tf2Install[] {
  if (state === "one" || state === "confirmed" || state === "locked" || state === "library") {
    return [ONE];
  }
  if (state === "many") {
    return MANY;
  }
  return [];
}

export function previewConfirmed(state: PreviewState): Tf2Install | null {
  if (state === "confirmed" || state === "locked" || state === "library") {
    return ONE;
  }
  return null;
}

export function previewLocked(state: PreviewState): boolean {
  return state === "locked";
}

export function previewLibrary(state: PreviewState): ProfileLibrary | null {
  if (state === "library") {
    return emptyLibrary(ONE.path, true);
  }
  if (state === "confirmed" || state === "locked") {
    return emptyLibrary(ONE.path, false);
  }
  return null;
}
