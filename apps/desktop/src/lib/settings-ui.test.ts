import { describe, expect, it } from "vitest";
import { emptyLibrary, previewSavedLibrary } from "./library-ui";
import { canWriteSettings, SETTINGS_TABS, SETTINGS_TAB_LABELS, showSettingsChrome } from "./settings-ui";

describe("settings chrome", () => {
  it("includes the HUD and later-studio tabs in the settings chrome", () => {
    expect(SETTINGS_TABS).toContain("hud");
    expect(SETTINGS_TABS).toContain("crosshair");
    expect(SETTINGS_TABS).toContain("viewmodels");
    expect(SETTINGS_TAB_LABELS.hud).toBe("HUD");
    expect(SETTINGS_TAB_LABELS.crosshair).toBe("Crosshair");
    expect(SETTINGS_TAB_LABELS.viewmodels).toBe("Viewmodels");
  });

  it("shows only when a usable library has an active profile", () => {
    expect(showSettingsChrome(null)).toBe(false);
    expect(showSettingsChrome(emptyLibrary("/tf2", true))).toBe(false);
    expect(showSettingsChrome(previewSavedLibrary("/tf2"))).toBe(true);
    expect(
      showSettingsChrome({
        ...previewSavedLibrary("/tf2"),
        usable: false,
        rootMismatch: true,
        activeProfileId: null,
        profiles: [],
      }),
    ).toBe(false);
  });

  it("blocks writes while TF2 is running or busy", () => {
    expect(canWriteSettings(false, false)).toBe(true);
    expect(canWriteSettings(true, false)).toBe(false);
    expect(canWriteSettings(false, true)).toBe(false);
  });
});
