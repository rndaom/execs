import { describe, expect, it } from "vitest";
import { previewStateFromSearch, previewUpdate, previewUpdateProgress } from "./preview";
import {
  appVersionCopy,
  CHECK_LABEL,
  canInstallUpdate,
  INSTALL_LABEL,
  LATER_LABEL,
  PREVIEW_UPDATE_VERSION,
  showUpdateBanner,
  updateBannerCopy,
  updateCheckButtonLabel,
  updateCheckCopy,
  updateProgressCopy,
} from "./updater-ui";

const UPDATE = { version: PREVIEW_UPDATE_VERSION, notes: null };

describe("updater UI helpers", () => {
  it("shows a versioned banner only until Later", () => {
    expect(updateBannerCopy("0.2.0")).toBe("Update available — execs 0.2.0");
    expect(showUpdateBanner(UPDATE, false)).toBe(true);
    expect(showUpdateBanner(UPDATE, true)).toBe(false);
    expect(showUpdateBanner(null, false)).toBe(false);
  });

  it("keeps install off while a real progress step is running", () => {
    expect(canInstallUpdate(null)).toBe(true);
    expect(canInstallUpdate("downloading")).toBe(false);
    expect(canInstallUpdate("installing")).toBe(false);
    expect(canInstallUpdate("restarting")).toBe(false);
  });

  it("labels download, install, and restart as real steps", () => {
    expect(updateProgressCopy("downloading")).toBe("Downloading");
    expect(updateProgressCopy("installing")).toBe("Installing");
    expect(updateProgressCopy("restarting")).toBe("Restarting");
  });

  it("keeps auto-check quiet and names manual outcomes", () => {
    expect(updateCheckCopy("latest")).toBe("You're on the latest version.");
    expect(updateCheckCopy("error")).toBe("Could not check for updates.");
    expect(appVersionCopy("0.1.0")).toBe("execs 0.1.0");
    expect(INSTALL_LABEL).toBe("Install");
    expect(LATER_LABEL).toBe("Later");
    expect(CHECK_LABEL).toBe("Check for updates");
    expect(updateCheckButtonLabel(null)).toBe(CHECK_LABEL);
    expect(updateCheckButtonLabel(updateCheckCopy("latest"))).toBe("You're on the latest version.");
    expect(updateCheckButtonLabel(updateCheckCopy("error"))).toBe("Could not check for updates.");
  });

  it("seeds preview fixtures and leaves other chrome alone", () => {
    expect(previewStateFromSearch("?preview=update-available")).toBe("update-available");
    expect(previewStateFromSearch("?preview=update-installing")).toBe("update-installing");
    expect(previewUpdate("update-available")).toEqual(UPDATE);
    expect(previewUpdate("update-installing")).toEqual(UPDATE);
    expect(previewUpdateProgress("update-available")).toBeNull();
    expect(previewUpdateProgress("update-installing")).toBe("downloading");
    expect(previewUpdate("settings-comfig")).toBeNull();
    expect(previewUpdate("locked")).toBeNull();
    expect(previewUpdateProgress("settings-locked")).toBeNull();
  });
});
