import { describe, expect, it } from "vitest";
import type { HudStat } from "./bridge";
import {
  canInstallHud,
  compactCount,
  filterHudCatalog,
  formatHudRgba,
  HUD_CATALOG_PAGE_SIZE,
  type HudSort,
  hudCatalogControls,
  hudOptionsDirty,
  hudPageLinks,
  hudStatCopy,
  installedHudLabel,
  isHudCheckboxOn,
  normalizeHudSearch,
  optionValue,
  PREVIEW_HUD_CATALOG,
  PREVIEW_HUD_SCHEMA,
  paginateHudCatalog,
  parseHudPageJump,
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
    expect(first.pageCount).toBe(8);
    expect(first.total).toBe(45);
    const last = paginateHudCatalog(many, 7);
    expect(last.items).toHaveLength(3);
    expect(last.items[0].id).toBe("hud-42");
  });

  it("clamps out-of-range pages instead of going blank", () => {
    expect(paginateHudCatalog(many, 99).page).toBe(7);
    expect(paginateHudCatalog(many, -3).page).toBe(0);
    const empty = paginateHudCatalog([], 5);
    expect(empty.page).toBe(0);
    expect(empty.pageCount).toBe(1);
    expect(empty.items).toEqual([]);
  });

  it("keeps first, current, adjacent and last pages reachable in a long catalog", () => {
    expect(hudPageLinks(0, 4)).toEqual([0, 1, 2, 3]);
    expect(hudPageLinks(0, 20)).toEqual([0, 1, 2, 3, "gap-after", 19]);
    expect(hudPageLinks(8, 20)).toEqual([0, "gap-before", 7, 8, 9, "gap-after", 19]);
    expect(hudPageLinks(19, 20)).toEqual([0, "gap-before", 16, 17, 18, 19]);
  });

  it("accepts only whole page numbers in range for a direct jump", () => {
    expect(parseHudPageJump(" 8 ", 8)).toBe(7);
    expect(parseHudPageJump("1", 8)).toBe(0);
    for (const invalid of ["", "0", "9", "-1", "1.5", "1e0", "NaN", "Infinity"]) {
      expect(parseHudPageJump(invalid, 8), invalid).toBeNull();
    }
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

  it("ranks only HUDs with the selected metric; A to Z includes unknowns", () => {
    const names = (sort: HudSort) => sortHudCatalog(entries, stats, sort).map((e) => e.id);
    expect(names("name")).toEqual(["budhud", "rayshud", "toonhud"]);
    expect(names("updated")).toEqual(["budhud", "rayshud"]);
    expect(names("downloads")).toEqual(["budhud", "rayshud"]);
    expect(names("views")).toEqual(["rayshud", "budhud"]);
  });

  it("preserves each selected ranking across every page without an alphabetical unknown tail", () => {
    const known = Array.from({ length: 20 }, (_, index) => ({
      ...PREVIEW_HUD_CATALOG[0],
      id: `hud-${index}`,
      name: `HUD ${index}`,
    }));
    const unknown = Array.from({ length: 4 }, (_, index) => ({
      ...PREVIEW_HUD_CATALOG[0],
      id: `unknown-${index}`,
      name: `A ${index}`,
    }));
    const catalog = [...known, ...unknown];
    const metrics = Object.fromEntries(
      known.map((entry, index) => [
        entry.id,
        {
          downloads: index * 11,
          views: (index * 7) % 20,
          updated: `2026-09-${String(index + 1).padStart(2, "0")}`,
        },
      ]),
    );
    const descendingIds = Array.from({ length: 20 }, (_, index) => `hud-${19 - index}`);
    const expected: Record<HudSort, string[]> = {
      name: [...unknown, ...known].map((entry) => entry.id),
      downloads: descendingIds,
      updated: descendingIds,
      views: [17, 14, 11, 8, 5, 2, 19, 16, 13, 10, 7, 4, 1, 18, 15, 12, 9, 6, 3, 0].map(
        (index) => `hud-${index}`,
      ),
    };
    for (const sort of ["name", "downloads", "views", "updated"] as const) {
      const ranked = sortHudCatalog(catalog, metrics, sort);
      const first = paginateHudCatalog(ranked, 0);
      expect(first.pageCount).toBe(4);
      const pages = Array.from({ length: first.pageCount }, (_, index) =>
        paginateHudCatalog(ranked, index),
      );
      expect(
        pages.flatMap((page) => page.items.map((entry) => entry.id)),
        sort,
      ).toEqual(expected[sort]);
      expect(pages.every((page) => page.total === expected[sort].length)).toBe(true);
    }
    expect(catalog).toEqual([...known, ...unknown]);
  });

  it("combines search with metric coverage and keeps all matches discoverable in A to Z", () => {
    const matched = filterHudCatalog(entries, "hud");
    const ranked = sortHudCatalog(matched, stats, "downloads");
    expect(matched).toHaveLength(3);
    expect(ranked).toHaveLength(2);
    expect(matched.length - ranked.length).toBe(1);
    const unknownMatch = filterHudCatalog(entries, "toon");
    expect(sortHudCatalog(unknownMatch, stats, "downloads")).toEqual([]);
    expect(sortHudCatalog(unknownMatch, stats, "name").map((entry) => entry.id)).toEqual([
      "toonhud",
    ]);
    expect(sortHudCatalog(filterHudCatalog(entries, "missing"), stats, "views")).toEqual([]);
  });

  it("keeps real zero counts and rejects missing or invalid values per metric", () => {
    const values: HudStat[] = [
      { downloads: 0, views: 0, updated: "2024-02-29" },
      {},
      { downloads: -1, views: Number.NaN, updated: "2026-02-29" },
      { downloads: Number.POSITIVE_INFINITY, views: 1.5, updated: "2026-13-01" },
      { downloads: Number.MAX_SAFE_INTEGER + 1, views: -4, updated: "yesterday" },
      { views: 10, updated: "2026-9-01" },
      { downloads: null, views: null, updated: null },
    ];
    const catalog = values.map((_, index) => ({ ...PREVIEW_HUD_CATALOG[0], id: `hud-${index}` }));
    const metrics = Object.fromEntries(catalog.map((entry, index) => [entry.id, values[index]]));
    expect(sortHudCatalog(catalog, metrics, "downloads").map((entry) => entry.id)).toEqual([
      "hud-0",
    ]);
    expect(sortHudCatalog(catalog, metrics, "views").map((entry) => entry.id)).toEqual([
      "hud-5",
      "hud-0",
    ]);
    expect(sortHudCatalog(catalog, metrics, "updated").map((entry) => entry.id)).toEqual(["hud-0"]);
    expect(hudStatCopy(values[0])).toBe("0 downloads · 0 views · updated Feb 2024");
    expect(hudStatCopy(values[2])).toBeNull();
    expect(hudStatCopy(values[3])).toBeNull();
  });

  it("uses names only to break genuine metric ties", () => {
    const tied = { budhud: { downloads: 10 }, rayshud: { downloads: 10 } };
    expect(sortHudCatalog(entries, tied, "downloads").map((entry) => entry.id)).toEqual([
      "budhud",
      "rayshud",
    ]);
  });

  it("resets the page when changing sort, searching, or returning to all HUDs", () => {
    const current = { query: "hud", sort: "downloads" as const, page: 3 };
    for (const sort of ["updated", "views", "downloads", "name"] as const) {
      expect(hudCatalogControls(current, { type: "sort", sort })).toEqual({
        query: "hud",
        sort,
        page: 0,
      });
    }
    expect(hudCatalogControls(current, { type: "search", query: "toon" })).toEqual({
      query: "toon",
      sort: "downloads",
      page: 0,
    });
    expect(hudCatalogControls(current, { type: "page", page: 2 })).toEqual({ ...current, page: 2 });
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
