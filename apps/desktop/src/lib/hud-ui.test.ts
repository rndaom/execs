import { describe, expect, it } from "vitest";
import {
  canInstallHud,
  compactCount,
  filterHudCatalog,
  formatHudRgba,
  HUD_CATALOG_PAGE_SIZE,
  type HudSort,
  hudOptionsDirty,
  hudStatCopy,
  installedHudLabel,
  isHudCheckboxOn,
  normalizeHudSearch,
  optionValue,
  PREVIEW_HUD_CATALOG,
  PREVIEW_HUD_SCHEMA,
  paginateHudCatalog,
  parseHudRgba,
  previewInstalledState,
  seedHudOptions,
  sortHudCatalog,
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
    const installed = previewInstalledState();
    expect(installedHudLabel(installed)).toBe("Installed");
    expect(
      installedHudLabel({
        ...installed,
        installed: { id: "rayshud", hash: null, source: "local", options: {} },
        inferred: true,
      }),
    ).toBe("Found in this profile");
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

describe("hud sorting", () => {
  const entries = PREVIEW_HUD_CATALOG.concat([
    { ...PREVIEW_HUD_CATALOG[0], id: "budhud", name: "budhud", author: "whayay" },
  ]);
  const stats = {
    rayshud: { updated: "2026-01-11", downloads: 398380, views: 1168295 },
    budhud: { updated: "2026-08-28", downloads: 900000, views: 500 },
  };

  it("sorts by name, date and counts, with unknowns last", () => {
    const names = (sort: HudSort) => sortHudCatalog(entries, stats, sort).map((e) => e.id);
    expect(names("name")).toEqual(["budhud", "rayshud", "toonhud"]);
    expect(names("updated")).toEqual(["budhud", "rayshud", "toonhud"]);
    expect(names("downloads")).toEqual(["budhud", "rayshud", "toonhud"]);
    expect(names("views")).toEqual(["rayshud", "budhud", "toonhud"]);
  });

  it("describes what is known in one line", () => {
    expect(hudStatCopy(stats.rayshud)).toBe("398k downloads · 1.2M views · updated Jan 2026");
    expect(hudStatCopy({ updated: "2024-03-02" })).toBe("updated Mar 2024");
    expect(hudStatCopy(undefined)).toBeNull();
    expect(hudStatCopy({})).toBeNull();
    expect(compactCount(999)).toBe("999");
    expect(compactCount(12_345)).toBe("12k");
    expect(compactCount(12_345_678)).toBe("12M");
  });
});
