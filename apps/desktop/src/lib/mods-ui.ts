import type {
  CatalogAddon,
  CatalogParticleMod,
  ModsCatalog,
  PreloaderReport,
  PreloaderStatusPayload,
} from "./bridge";

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

/** Selection differs from what's installed → the Apply button lights up. */
export function selectionDirty(
  status: PreloaderStatusPayload | null,
  addons: string[],
  particleMods: string[],
): boolean {
  const installedAddons = [...(status?.status.addons ?? [])].sort();
  const installedParticles = [...(status?.status.particleMods ?? [])].sort();
  const nextAddons = [...addons].sort();
  const nextParticles = [...particleMods].sort();
  return (
    JSON.stringify(installedAddons) !== JSON.stringify(nextAddons) ||
    JSON.stringify(installedParticles) !== JSON.stringify(nextParticles)
  );
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
  addons: string[],
  particleMods: string[],
): boolean {
  if (!status?.modsCached) {
    return false;
  }
  return selectionDirty(status, addons, particleMods) || status.status.stale === true;
}

/** The one-line reason under the Apply button. */
export function modsStatusLine(
  status: PreloaderStatusPayload | null,
  addons: string[],
  particleMods: string[],
  running: boolean,
): string {
  if (running) {
    return "TF2 is open — game files cannot be patched";
  }
  if (status && !status.modsCached) {
    return "Download the mod library first";
  }
  if (selectionDirty(status, addons, particleMods)) {
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
  },
  modsCached: true,
  modsSizeBytes: 81_529_475,
  preloadLaunchInSteam: true,
  profilePreload: true,
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
