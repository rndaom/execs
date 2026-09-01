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
export const PRELOADER_EXPLAINER =
  "Patches particle files inside the game's own archives and relaxes gameinfo.txt so custom content survives Valve Casual's sv_pure. Every changed byte is snapshotted first and one click restores stock files.";

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
  },
  modsCached: true,
  modsSizeBytes: 81_529_475,
  preloadLaunchInSteam: true,
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
