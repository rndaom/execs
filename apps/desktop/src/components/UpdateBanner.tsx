import type { AppUpdateState } from "../hooks/useAppUpdate";
import {
  INSTALL_LABEL,
  LATER_LABEL,
  showUpdateBanner,
  updateBannerCopy,
  updateProgressCopy,
} from "../lib/updater-ui";

/** "Update available" strip. Later dismisses for the session (RND-159). */
export function UpdateBanner({ update }: { update: AppUpdateState }) {
  if (!showUpdateBanner(update.available, update.dismissed) || !update.available) {
    return null;
  }
  return (
    <div
      role="status"
      data-testid="app-update-banner"
      className="flex flex-wrap items-center justify-center gap-3 border-b border-brand bg-brand/20 px-4 py-2 text-sm text-ink"
    >
      <p>{updateBannerCopy(update.available.version)}</p>
      {update.progress ? (
        <p data-testid="app-update-progress">{updateProgressCopy(update.progress)}</p>
      ) : (
        <div className="flex items-center gap-2">
          <button
            type="button"
            data-testid="app-update-install"
            onClick={() => void update.install()}
            className="btn btn-primary px-4 py-1"
          >
            {INSTALL_LABEL}
          </button>
          <button
            type="button"
            data-testid="app-update-later"
            onClick={update.dismiss}
            className="btn btn-ghost px-4 py-1"
          >
            {LATER_LABEL}
          </button>
        </div>
      )}
    </div>
  );
}
