export const PREVIEW_APP_VERSION = "0.1.0";
export const PREVIEW_UPDATE_VERSION = "0.2.0";

export const INSTALL_LABEL = "Install";
export const LATER_LABEL = "Later";
export const CHECK_LABEL = "Check for updates";

export type AppUpdateInfo = {
  version: string;
  notes: string | null;
};

export type AppUpdateProgress = "downloading" | "installing" | "restarting";

export type UpdateCheckKind = "latest" | "error";

export function appVersionCopy(version: string): string {
  return `execs ${version}`;
}

export function updateBannerCopy(version: string): string {
  return `Update available — execs ${version}`;
}

export function updateProgressCopy(step: AppUpdateProgress): string {
  switch (step) {
    case "downloading":
      return "Downloading";
    case "installing":
      return "Installing";
    case "restarting":
      return "Restarting";
  }
}

export function updateCheckCopy(kind: UpdateCheckKind): string {
  return kind === "latest" ? "You're on the latest version." : "Could not check for updates.";
}

/** Pinned settings chrome is one 28px row; a second line is clipped. */
export function updateCheckButtonLabel(checkMessage: string | null): string {
  return checkMessage ?? CHECK_LABEL;
}

export function showUpdateBanner(update: AppUpdateInfo | null, dismissed: boolean): boolean {
  return update !== null && !dismissed;
}

export function canInstallUpdate(progress: AppUpdateProgress | null): boolean {
  return progress === null;
}
