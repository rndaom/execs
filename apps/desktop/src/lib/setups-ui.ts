import type { HudCatalogEntry, ProfileLibrary, SetupOverview } from "./bridge";
import { crosshairLabel } from "./crosshair-labels";
import { hudDisplayName } from "./hud-ui";

/** What a setup is made of, in the order the Setups page lists it. */
export const SETUP_FACTS = [
  { key: "hud", label: "HUD" },
  { key: "crosshair", label: "Crosshair" },
  { key: "fov", label: "Field of view" },
  { key: "sensitivity", label: "Sensitivity" },
  { key: "hitSound", label: "Hit sound" },
  { key: "killSound", label: "Kill sound" },
  { key: "performance", label: "Performance" },
  { key: "mods", label: "Mods" },
] as const;

export type SetupFactKey = (typeof SETUP_FACTS)[number]["key"];

/** Shown where a setup leaves a part as TF2 has it. */
export const TF2_OWN = "TF2's own";

function words(slug: string): string {
  const text = slug.replaceAll(/[-_]+/g, " ").trim();
  return text ? text[0].toUpperCase() + text.slice(1) : slug;
}

/** `90`, `90.0` and `" 90 "` are the same number; anything else stays as written. */
function number(value: string): number | null {
  const trimmed = value.trim();
  if (trimmed === "") return null;
  const parsed = Number(trimmed);
  return Number.isFinite(parsed) ? parsed : null;
}

function findHud(id: string, catalog: readonly HudCatalogEntry[]): HudCatalogEntry | undefined {
  return (
    catalog.find((entry) => entry.id === id) ??
    catalog.find((entry) => entry.id.toLowerCase() === id.toLowerCase())
  );
}

export function hudLabel(id: string | null, catalog: readonly HudCatalogEntry[]): string {
  if (id === null) return TF2_OWN;
  const entry = findHud(id, catalog);
  return entry ? hudDisplayName(entry) : id;
}

/**
 * The HUD's own picture for the showcase, or null when it has none. An in-game
 * screenshot reads better than the logo banner or main menu many HUDs list first.
 */
export function hudPicture(id: string | null, catalog: readonly HudCatalogEntry[]): string | null {
  if (id === null) return null;
  const entry = findHud(id, catalog);
  if (!entry) return null;
  const file = (url: string) => url.split("/").pop() ?? "";
  const isBanner = (url: string) => /banner|logo/i.test(file(url));
  const isMenu = (url: string) => /menu|backpack|scoreboard|loadout|store/i.test(file(url));
  return (
    entry.screenshots.find((url) => !isBanner(url) && !isMenu(url)) ??
    entry.screenshots.find((url) => !isBanner(url)) ??
    entry.screenshots[0] ??
    entry.banner
  );
}

/** mastercomfig's preset aliases, said the way the Comfig pane says them. */
export function performanceLabel(alias: string | null): string {
  if (alias === null) return "Off";
  const key = alias.trim().toLowerCase().replaceAll("-", "_");
  return key === "none" ? "Custom" : words(key);
}

export function modsLabel(count: number): string {
  if (count <= 0) return "None";
  return count === 1 ? "1 mod" : `${count} mods`;
}

function soundLabel(id: string | null): string {
  if (id === null) return TF2_OWN;
  // Names are kept as saved, so "Half-Life" stays hyphenated.
  const text = id
    .replace(/\.(wav|mp3|ogg)$/i, "")
    .replaceAll("_", " ")
    .trim();
  return text ? text[0].toUpperCase() + text.slice(1) : id;
}

function numberLabel(value: string | null, unit = ""): string {
  if (value === null) return TF2_OWN;
  const parsed = number(value);
  return parsed === null ? value : `${parsed}${unit}`;
}

export function factValue(
  key: SetupFactKey,
  overview: SetupOverview,
  catalog: readonly HudCatalogEntry[],
): string {
  switch (key) {
    case "hud":
      return hudLabel(overview.hud, catalog);
    case "crosshair":
      return overview.crosshair === null ? TF2_OWN : crosshairLabel(overview.crosshair);
    case "fov":
      return numberLabel(overview.fov, "°");
    case "sensitivity":
      return numberLabel(overview.sensitivity);
    case "hitSound":
      return soundLabel(overview.hitSound);
    case "killSound":
      return soundLabel(overview.killSound);
    case "performance":
      return performanceLabel(overview.performance);
    case "mods":
      return modsLabel(overview.mods);
  }
}

function sameText(a: string | null, b: string | null, fold = false): boolean {
  if (a === null || b === null) return a === b;
  return fold ? a.toLowerCase() === b.toLowerCase() : a === b;
}

function sameNumber(a: string | null, b: string | null): boolean {
  if (a === null || b === null) return a === b;
  const left = number(a);
  const right = number(b);
  return left !== null && right !== null ? left === right : a === b;
}

/** Whether two setups hold the same value for one fact. */
export function sameFact(key: SetupFactKey, a: SetupOverview, b: SetupOverview): boolean {
  switch (key) {
    case "hud":
      return sameText(a.hud, b.hud, true);
    case "crosshair":
      return sameText(a.crosshair, b.crosshair);
    case "fov":
      return sameNumber(a.fov, b.fov);
    case "sensitivity":
      return sameNumber(a.sensitivity, b.sensitivity);
    case "hitSound":
      return sameText(a.hitSound, b.hitSound);
    case "killSound":
      return sameText(a.killSound, b.killSound);
    case "performance":
      return sameText(a.performance, b.performance, true);
    case "mods":
      return a.mods === b.mods;
  }
}

/** The facts where `setup` differs from `base`. */
export function differingFacts(setup: SetupOverview, base: SetupOverview): SetupFactKey[] {
  return SETUP_FACTS.filter((fact) => !sameFact(fact.key, setup, base)).map((fact) => fact.key);
}

/** The line under a setup's name: how far it is from the one in the game. */
export function changeSummary(count: number, baseName: string): string {
  if (count === 0) return `Same as ${baseName}`;
  return `${count} ${count === 1 ? "change" : "changes"} from ${baseName}`;
}

/**
 * Changes whenever the overviews must be read again: a setup added, removed,
 * saved over, or made the one in the game.
 */
export function libraryKey(library: ProfileLibrary | null): string {
  if (!library) return "";
  const profiles = library.profiles.map((profile) => `${profile.id}@${profile.updatedAt}`);
  return `${library.activeProfileId ?? ""}|${profiles.join(",")}`;
}

/** The setup to show: the chosen one while it exists, else the one in the game. */
export function resolveSelection(library: ProfileLibrary | null, chosen: string | null) {
  if (!library || library.profiles.length === 0) return null;
  const ids = library.profiles.map((profile) => profile.id);
  if (chosen !== null && ids.includes(chosen)) return chosen;
  if (library.activeProfileId !== null && ids.includes(library.activeProfileId)) {
    return library.activeProfileId;
  }
  return ids[0];
}

/** One step through the list; the ends stop rather than wrap. */
export function stepSelection(ids: readonly string[], current: string | null, step: -1 | 1) {
  const index = current === null ? -1 : ids.indexOf(current);
  const next = Math.min(ids.length - 1, Math.max(0, index + step));
  return ids[next] ?? null;
}

/** Why a setup cannot be switched to right now, as one short line. */
export function switchBlockedReason({
  running,
  busy,
  recoveryPending,
  isRecoveryTarget,
  unsafeFolders,
}: {
  running: boolean;
  busy: boolean;
  recoveryPending: boolean;
  isRecoveryTarget: boolean;
  unsafeFolders: boolean;
}): string | null {
  if (running) return "Close TF2 to switch.";
  if (busy) return "Wait for the current operation to finish.";
  if (recoveryPending && !isRecoveryTarget) return "Finish the interrupted switch first.";
  if (unsafeFolders) return "Repair this setup's folder names first.";
  return null;
}

/** Why the game cannot start from here right now, as one short line. */
export function playBlockedReason({
  launchBlockReason,
  busy,
  recoveryPending,
  unsafeFolders,
}: {
  launchBlockReason: string | null;
  busy: boolean;
  recoveryPending: boolean;
  unsafeFolders: boolean;
}): string | null {
  if (launchBlockReason) return launchBlockReason;
  if (busy) return "Wait for the current operation to finish.";
  if (recoveryPending) return "Finish the interrupted switch first.";
  if (unsafeFolders) return "Repair the folder names first.";
  return null;
}
