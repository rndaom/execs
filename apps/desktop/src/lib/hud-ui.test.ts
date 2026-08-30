import { describe, expect, it } from "vitest";
import {
  canInstallHud,
  filterHudCatalog,
  formatHudRgba,
  hudOptionsDirty,
  hudUpdateAvailable,
  installedHudLabel,
  optionValue,
  parseHudRgba,
  PREVIEW_HUD_CATALOG,
  PREVIEW_HUD_SCHEMA,
  previewInferredState,
  previewInstalledState,
  rgbToHex,
  seedHudOptions,
} from "./hud-ui";

describe("hud catalog helpers", () => {
  it("filters by name and author", () => {
    expect(filterHudCatalog(PREVIEW_HUD_CATALOG, "toon")).toEqual([PREVIEW_HUD_CATALOG[1]]);
    expect(filterHudCatalog(PREVIEW_HUD_CATALOG, "rays")).toEqual([PREVIEW_HUD_CATALOG[0]]);
    expect(filterHudCatalog(PREVIEW_HUD_CATALOG, "")).toHaveLength(2);
  });

  it("marks an update when the installed hash is behind hud-db", () => {
    expect(hudUpdateAvailable(previewInstalledState())).toBe(true);
    expect(
      optionValue(previewInstalledState().installed, "HealthBuff", "255 255 255 255"),
    ).toBe("0 153 255 255");
  });

  it("disables install for non-GitHub catalog rows", () => {
    expect(canInstallHud(PREVIEW_HUD_CATALOG[0])).toBe(true);
    expect(canInstallHud(PREVIEW_HUD_CATALOG[1])).toBe(false);
  });

  it("labels a local HUD as installed from this profile", () => {
    expect(installedHudLabel(previewInstalledState())).toBe("Installed");
    expect(installedHudLabel(previewInferredState())).toBe("Installed (from this profile)");
  });

  it("seeds schema options from the profile and marks dirty edits", () => {
    const seeded = seedHudOptions(PREVIEW_HUD_SCHEMA, previewInstalledState().installed);
    expect(seeded.HealthBuff).toBe("0 153 255 255");
    expect(seeded.minmode).toBe("false");
    expect(hudOptionsDirty(seeded, seeded)).toBe(false);
    expect(hudOptionsDirty({ ...seeded, minmode: "true" }, seeded)).toBe(true);
  });

  it("round-trips HUD color strings", () => {
    expect(parseHudRgba("0 153 255 255")).toEqual({ r: 0, g: 153, b: 255, a: 255 });
    expect(formatHudRgba(0, 153, 255, 128)).toBe("0 153 255 128");
    expect(rgbToHex(0, 153, 255)).toBe("#0099ff");
  });
});
