import type { AppUpdateState } from "../hooks/useAppUpdate";
import {
  INSTALL_LABEL,
  LATER_LABEL,
  showUpdateBanner,
  updateBannerCopy,
  updateProgressCopy,
} from "../lib/updater-ui";

/** "Update available" strip. Later dismisses it for the session. */
export function UpdateBanner({ update, blocked }: { update: AppUpdateState; blocked: boolean }) {
  if (!showUpdateBanner(update.available, update.dismissed) || !update.available) {
    return null;
  }
  return (
    <div role="status" data-testid="app-update-banner" className="app-banner app-banner-update">
      <p>{updateBannerCopy(update.available.version)}</p>
      {update.progress ? (
        <p data-testid="app-update-progress">{updateProgressCopy(update.progress)}</p>
      ) : (
        <div className="flex items-center gap-2">
          <button
            type="button"
            data-testid="app-update-install"
            onClick={() => void update.install()}
            disabled={blocked || update.checking}
            className="btn btn-primary"
          >
            {INSTALL_LABEL}
          </button>
          <button
            type="button"
            data-testid="app-update-later"
            onClick={update.dismiss}
            className="btn btn-ghost"
          >
            {LATER_LABEL}
          </button>
        </div>
      )}
    </div>
  );
}
