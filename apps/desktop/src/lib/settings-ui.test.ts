import { describe, expect, it } from "vitest";
import { emptyLibrary, previewSavedLibrary } from "./library-ui";
import { canWriteSettings, showSettingsChrome } from "./settings-ui";

describe("settings chrome", () => {
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
