import { describe, expect, it } from "vitest";
import {
  canInstallHud,
  filterHudCatalog,
  formatHudRgba,
  HUD_CATALOG_PAGE_SIZE,
  hudOptionsDirty,
  installedHudLabel,
  isHudCheckboxOn,
  normalizeHudSearch,
  optionValue,
  PREVIEW_HUD_CATALOG,
  PREVIEW_HUD_SCHEMA,
  paginateHudCatalog,
  parseHudRgba,
  previewInferredState,
  previewInstalledState,
  rgbToHex,
  seedHudOptions,
  stepHudScreenshot,
} from "./hud-ui";

describe("hud catalog helpers", () => {
  it("filters by name and author", () => {
    expect(filterHudCatalog(PREVIEW_HUD_CATALOG, "toon")).toEqual([PREVIEW_HUD_CATALOG[1]]);
    expect(filterHudCatalog(PREVIEW_HUD_CATALOG, "Toon HUD")).toEqual([PREVIEW_HUD_CATALOG[1]]);
    expect(filterHudCatalog(PREVIEW_HUD_CATALOG, "rays")).toEqual([PREVIEW_HUD_CATALOG[0]]);
    expect(filterHudCatalog(PREVIEW_HUD_CATALOG, "")).toHaveLength(2);
  });

  it("marks an update when the installed hash is behind hud-db", () => {
    expect(previewInstalledState().updateAvailable).toBe(true);
    expect(optionValue(previewInstalledState().installed, "HealthBuff", "255 255 255 255")).toBe(
      "0 153 255 255",
    );
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

describe("hud catalog pagination", () => {
  const many = Array.from({ length: 45 }, (_, index) => ({
    ...PREVIEW_HUD_CATALOG[0],
    id: `hud-${index}`,
    name: `HUD ${index}`,
  }));

  it("slices pages and reports counts", () => {
    const first = paginateHudCatalog(many, 0);
    expect(first.items).toHaveLength(HUD_CATALOG_PAGE_SIZE);
    expect(first.pageCount).toBe(3);
    expect(first.total).toBe(45);
    const last = paginateHudCatalog(many, 2);
    expect(last.items).toHaveLength(5);
    expect(last.items[0].id).toBe("hud-40");
  });

  it("clamps out-of-range pages instead of going blank", () => {
    expect(paginateHudCatalog(many, 99).page).toBe(2);
    expect(paginateHudCatalog(many, -3).page).toBe(0);
    const empty = paginateHudCatalog([], 5);
    expect(empty.page).toBe(0);
    expect(empty.pageCount).toBe(1);
    expect(empty.items).toEqual([]);
  });

  it("steps screenshots with wrap-around", () => {
    expect(stepHudScreenshot(0, 1, 3)).toBe(1);
    expect(stepHudScreenshot(2, 1, 3)).toBe(0);
    expect(stepHudScreenshot(0, -1, 3)).toBe(2);
    expect(stepHudScreenshot(0, 1, 0)).toBe(0);
  });
});

describe("hud option and search edges", () => {
  it("reads every truthy spelling hud-db schemas use", () => {
    for (const on of ["1", "true", "yes", "on", " TRUE ", "Yes"]) {
      expect(isHudCheckboxOn(on), on).toBe(true);
    }
    for (const off of ["0", "false", "no", "off", "", "   ", "2", "enabled"]) {
      expect(isHudCheckboxOn(off), off).toBe(false);
    }
  });

  it("folds case and punctuation so styled HUD names still match", () => {
    expect(normalizeHudSearch("m0re HUD")).toBe("m0rehud");
    expect(normalizeHudSearch("  Rays' HUD!  ")).toBe("rayshud");
    expect(normalizeHudSearch("budhud-remastered")).toBe("budhudremastered");
    expect(normalizeHudSearch("-_-")).toBe("");
  });
});
