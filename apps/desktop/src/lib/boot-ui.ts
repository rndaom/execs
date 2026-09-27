import type { FirstRunSurface } from "./first-run-ui";

/** The startup screen stays at least this long so it reads as a screen, not a flash. */
export const BOOT_MIN_MS = 1100;
/** It never holds the app longer than this; the page's own loading takes over. */
export const BOOT_MAX_MS = 10_000;
/** A confirmed install stays on screen this long before setup continues. */
export const CONFIRM_HOLD_MS = 1300;
/** After that, setup waits this much longer for its first read before showing it. */
export const CONFIRM_MAX_MS = 6000;

export type BootInput = {
  screen: "finder" | "ready";
  /** Looking up the saved install and scanning Steam libraries. */
  scanning: boolean;
  libraryLoaded: boolean;
  surface: FirstRunSurface;
  /** The profile workspace (sidebar and panes) will show. */
  settingsOpen: boolean;
  /** The workspace finished its first settings read, or reported why it could not. */
  settingsSettled: boolean;
  /** The pane the workspace opens on. */
  paneLabel: string;
  /** A startup read failed; the screen that shows the failure takes over. */
  failed: boolean;
};

export type BootStage = { settled: boolean; status: string };

/**
 * What startup is waiting for, in the order it happens. Each status names a
 * real read; the first screen is settled once it has something to show.
 */
export function bootStage(input: BootInput): BootStage {
  if (input.screen === "finder") {
    return input.scanning
      ? { settled: false, status: "Looking for Team Fortress 2…" }
      : { settled: true, status: "" };
  }
  if (input.failed) return { settled: true, status: "" };
  if (!input.libraryLoaded) return { settled: false, status: "Reading your profiles…" };
  if (input.surface === "loading") return { settled: false, status: "Checking this install…" };
  if (input.settingsOpen && !input.settingsSettled) {
    return { settled: false, status: `Loading ${input.paneLabel}…` };
  }
  return { settled: true, status: "" };
}

/** Milliseconds until the startup screen may leave, measured from page start. */
export function bootRemaining(stage: BootStage, elapsed: number, minimum: number): number {
  return stage.settled ? Math.max(0, minimum - elapsed) : Math.max(0, BOOT_MAX_MS - elapsed);
}
