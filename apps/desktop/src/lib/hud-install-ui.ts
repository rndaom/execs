import type { HudCatalogEntry, HudInstallProgress, HudInstallStep } from "./bridge";

/**
 * The HUD card's install overlay as plain state. Its steps are the backend's
 * own events (`hud-install-progress`); nothing here invents a stage, a timing
 * or a percentage.
 */
export type HudInstallKind = "install" | "update";

export type HudInstallRun = {
  id: string;
  source: string;
  kind: HudInstallKind;
  /** Null until the backend reports its first step. */
  step: HudInstallStep | null;
};

const HUD_INSTALL_ORDER: readonly HudInstallStep[] = ["downloading", "checking", "installing"];

export function hudDownloadHost(entry: Pick<HudCatalogEntry, "install">): string {
  switch (entry.install) {
    case "direct":
      return "Dropbox";
    case "gamebanana":
      return "GameBanana";
    case "thread":
      return "the author's teamfortress.tv thread";
    default:
      return "GitHub";
  }
}

export function startHudInstall(entry: HudCatalogEntry, kind: HudInstallKind): HudInstallRun {
  return { id: entry.id, source: hudDownloadHost(entry), kind, step: null };
}

function stepIndex(step: HudInstallStep | null): number {
  return step ? HUD_INSTALL_ORDER.indexOf(step) : -1;
}

/** Apply a backend step to the matching install. Steps never go back. */
export function applyHudInstallProgress(
  run: HudInstallRun | null,
  progress: HudInstallProgress,
): HudInstallRun | null {
  if (!run || run.id.toLowerCase() !== progress.id.toLowerCase()) return run;
  if (stepIndex(progress.step) <= stepIndex(run.step)) return run;
  return { ...run, step: progress.step };
}

export function hudInstallDetail(run: HudInstallRun): string {
  switch (run.step) {
    case null:
      return "Starting…";
    case "downloading":
      return `Downloading from ${run.source}.`;
    case "checking":
      return "Unpacking the download and checking that it is a TF2 HUD.";
    case "installing":
      return "Saving it to this profile and TF2's custom folder.";
  }
}
