import { describe, expect, it, vi } from "vitest";
import type { GameBananaMod } from "./bridge";
import {
  foldCategories,
  formatModBytes,
  gameBananaIdOf,
  gameBananaMetaLine,
  gameBananaPageKey,
  gameBananaPager,
  isGameBananaInstalled,
  MATURE_STORAGE_KEY,
  MOD_CONFIRM_BYTES,
  type ModSelection,
  modDomId,
  modMetaLine,
  modNeedsRemoveConfirm,
  modSourceLabel,
  modSourceUrl,
  modsApplyEnabled,
  modsStatusLine,
  PREVIEW_GAMEBANANA_CATEGORIES,
  PREVIEW_GAMEBANANA_RECORDS,
  PREVIEW_MODS_STATUS,
  PREVIEW_PROFILE_MODS,
  readMaturePreference,
  relativeDate,
  selectionDirty,
  sortGameBananaMods,
  summarizeReport,
  toggleName,
  visibleModSelection,
  writeMaturePreference,
} from "./mods-ui";

function selection(over: Partial<ModSelection> = {}): ModSelection {
  return { addons: [], particleMods: [], profileParticleMods: [], ...over };
}

const INSTALLED = selection({
  addons: ["No Burning Overlay"],
  particleMods: ["Square_Series"],
});

describe("mods ui", () => {
  it("toggles names in and out", () => {
    expect(toggleName([], "a")).toEqual(["a"]);
    expect(toggleName(["a", "b"], "a")).toEqual(["b"]);
  });

  it("formats sizes for humans", () => {
    expect(formatModBytes(512)).toBe("512 B");
    expect(formatModBytes(41_200)).toBe("40 KB");
    expect(formatModBytes(24_800_000)).toBe("23.7 MB");
  });

  it("marks the selection dirty only when it differs from installed", () => {
    const status = PREVIEW_MODS_STATUS;
    expect(selectionDirty(status, INSTALLED)).toBe(false);
    // Order does not matter.
    expect(selectionDirty(status, selection({ particleMods: ["Square_Series"] }))).toBe(true);
    expect(selectionDirty(status, selection({ addons: ["No Burning Overlay"] }))).toBe(true);
    expect(selectionDirty(null, selection())).toBe(false);
  });

  it("reports relocated and generated materials", () => {
    expect(
      summarizeReport({
        patchedFiles: [],
        skipped: [],
        addonsInstalled: ["Flat Textures"],
        particleModsInstalled: [],
        customVpkWritten: true,
        gameinfoBypassed: true,
        baselineReset: false,
        synthesizedVmts: 1,
        relocatedModelMaterials: 12,
      }),
    ).toBe("1 addon packed, 12 model materials relocated, 1 missing material generated");
  });

  it("summarizes an apply report", () => {
    expect(
      summarizeReport({
        patchedFiles: ["particles/a.pcf", "particles/b.pcf"],
        skipped: [{ file: "c.pcf", modName: "m", reason: "too big" }],
        addonsInstalled: ["X"],
        particleModsInstalled: ["Y"],
        customVpkWritten: true,
        gameinfoBypassed: true,
        baselineReset: false,
        synthesizedVmts: 0,
        relocatedModelMaterials: 0,
      }),
    ).toBe("2 particle files patched, 1 addon packed, 1 skipped");
    expect(
      summarizeReport({
        patchedFiles: [],
        skipped: [],
        addonsInstalled: [],
        particleModsInstalled: [],
        customVpkWritten: false,
        gameinfoBypassed: true,
        synthesizedVmts: 0,
        relocatedModelMaterials: 0,
        baselineReset: true,
      }),
    ).toBe("nothing selected — stock files restored, game update detected, snapshots refreshed");
  });
});

describe("mods apply gating", () => {
  const status = PREVIEW_MODS_STATUS;
  const stale = {
    ...status,
    status: { ...status.status, stale: true },
  };

  it("sees a reordered selection as unchanged", () => {
    expect(selectionDirty(status, INSTALLED)).toBe(false);
    expect(selectionDirty(status, { ...INSTALLED, addons: [...INSTALLED.addons].reverse() })).toBe(
      false,
    );
    expect(selectionDirty(status, { ...INSTALLED, addons: [] })).toBe(true);
    expect(selectionDirty(status, { ...INSTALLED, particleMods: ["Other"] })).toBe(true);
    expect(selectionDirty(null, selection())).toBe(false);
  });

  it("counts the profile's own particle sources as part of the selection", () => {
    // Nothing from your mods is patched in the fixture, so picking one is dirty.
    expect(selectionDirty(status, { ...INSTALLED, profileParticleMods: ["gb-618734"] })).toBe(true);
    expect(modsApplyEnabled(status, { ...INSTALLED, profileParticleMods: ["gb-618734"] })).toBe(
      true,
    );
    const withSource = {
      ...status,
      status: { ...status.status, profileParticleMods: ["gb-618734"] },
    };
    expect(selectionDirty(withSource, { ...INSTALLED, profileParticleMods: ["gb-618734"] })).toBe(
      false,
    );
    expect(selectionDirty(withSource, INSTALLED)).toBe(true);
  });

  it("forgets a pick whose pack was removed", () => {
    const picked = { ...INSTALLED, profileParticleMods: ["gb-618734"] };
    const sources = [{ modId: "gb-618734", name: "Clean Rocket Trails", pcfFiles: ["a.pcf"] }];
    expect(visibleModSelection(picked, sources, []).profileParticleMods).toEqual(["gb-618734"]);
    // The pack is gone: no row could untick it, so it stops counting.
    expect(visibleModSelection(picked, [], []).profileParticleMods).toEqual([]);
    // Still patched in — the backend knows it, so the selection matches disk.
    expect(visibleModSelection(picked, [], ["gb-618734"]).profileParticleMods).toEqual([
      "gb-618734",
    ]);
    // Nothing to prune returns the very same object.
    expect(visibleModSelection(INSTALLED, [], [])).toBe(INSTALLED);
  });

  it("treats a payload without the field as nothing installed", () => {
    const older = { ...status, status: { ...status.status, profileParticleMods: undefined } };
    expect(selectionDirty(older, INSTALLED)).toBe(false);
    expect(selectionDirty(older, { ...INSTALLED, profileParticleMods: ["gb-618734"] })).toBe(true);
  });

  it("lights Apply for a changed selection", () => {
    expect(modsApplyEnabled(status, INSTALLED)).toBe(false);
    expect(modsApplyEnabled(status, { ...INSTALLED, addons: [] })).toBe(true);
  });

  it("lights Apply after a TF2 update even when the selection is untouched", () => {
    // The stale notice tells the user to re-apply; the button has to agree.
    expect(selectionDirty(stale, INSTALLED)).toBe(false);
    expect(modsApplyEnabled(stale, INSTALLED)).toBe(true);
    expect(modsStatusLine(stale, INSTALLED, false)).toContain("TF2 updated");
  });

  it("never applies without a cached library, whatever else is true", () => {
    const uncached = { ...stale, modsCached: false };
    expect(modsApplyEnabled(uncached, selection())).toBe(false);
    expect(modsApplyEnabled(null, selection())).toBe(false);
    expect(modsStatusLine(uncached, selection(), false)).toContain("Download the mod library");
  });

  it("says the draft is kept before anything else", () => {
    // The same three lines every pane with a button now uses.
    expect(modsStatusLine(stale, INSTALLED, true)).toBe("Draft kept until TF2 closes");
    expect(modsStatusLine(status, INSTALLED, false)).toBe("Up to date");
    expect(modsStatusLine(status, selection(), false)).toBe("Unsaved changes");
  });
});

describe("your mods", () => {
  const [local, gb] = PREVIEW_PROFILE_MODS;

  it("names the source and the size", () => {
    expect(modSourceLabel(local.source)).toBe("Local");
    expect(modSourceLabel(gb.source)).toBe("GameBanana");
    expect(modMetaLine(local)).toBe("Local · 12.0 MB");
    expect(modMetaLine(gb)).toBe("GameBanana · 58.9 MB");
  });

  it("only offers a link for a pack that has a page", () => {
    expect(modSourceUrl(local.source)).toBeNull();
    expect(modSourceUrl(gb.source)).toBe("https://gamebanana.com/mods/618734");
  });

  it("asks before removing a big pack only", () => {
    expect(modNeedsRemoveConfirm(local)).toBe(false);
    expect(modNeedsRemoveConfirm(gb)).toBe(true);
    expect(modNeedsRemoveConfirm({ ...local, bytes: MOD_CONFIRM_BYTES })).toBe(false);
    expect(modNeedsRemoveConfirm({ ...local, bytes: MOD_CONFIRM_BYTES + 1 })).toBe(true);
  });

  it("looks up what came from GameBanana", () => {
    expect(gameBananaIdOf(local)).toBeNull();
    expect(gameBananaIdOf(gb)).toBe(618_734);
    expect(isGameBananaInstalled(PREVIEW_PROFILE_MODS, 618_734)).toBe(true);
    expect(isGameBananaInstalled(PREVIEW_PROFILE_MODS, 602_110)).toBe(false);
    expect(isGameBananaInstalled([], 618_734)).toBe(false);
  });

  it("makes a selector-safe test id", () => {
    expect(modDomId("Clean Rocket Trails!")).toBe("clean-rocket-trails-");
  });
});

describe("gamebanana browser", () => {
  const NOW = Date.UTC(2026, 8, 2);
  const record = (over: Partial<GameBananaMod>): GameBananaMod => ({
    id: 1,
    name: "A",
    author: "a",
    category: "Skins",
    categoryId: 1,
    likes: 0,
    views: 0,
    downloads: 0,
    updatedAt: 0,
    addedAt: 0,
    thumb: null,
    url: "https://gamebanana.com/mods/1",
    mature: false,
    ...over,
  });

  it("sorts the loaded records by every pill", () => {
    const ids = (sort: Parameters<typeof sortGameBananaMods>[1]) =>
      sortGameBananaMods(PREVIEW_GAMEBANANA_RECORDS, sort).map((mod) => mod.id);
    expect(ids("likes")[0]).toBe(577_301);
    expect(ids("views")[0]).toBe(577_301);
    expect(ids("downloads")[0]).toBe(577_301);
    expect(ids("updated")[0]).toBe(602_110);
    expect(ids("new")[0]).toBe(602_110);
    // Sorting never drops or duplicates a record.
    expect(ids("likes")).toHaveLength(PREVIEW_GAMEBANANA_RECORDS.length);
  });

  it("sinks a withheld download count instead of reading it as zero", () => {
    const sorted = sortGameBananaMods(
      [record({ id: 1, downloads: null }), record({ id: 2, downloads: 0 })],
      "downloads",
    );
    expect(sorted.map((mod) => mod.id)).toEqual([2, 1]);
  });

  it("labels the pager from the count when there is one", () => {
    const pager = gameBananaPager(3, 240, 20, false);
    expect(pager.label).toBe("Page 3 of 12");
    expect(pager.pageCount).toBe(12);
    expect(pager.hasPrevious).toBe(true);
    expect(pager.hasNext).toBe(true);
    expect(gameBananaPager(1, 240, 20, false).hasPrevious).toBe(false);
    expect(gameBananaPager(12, 240, 20, false).hasNext).toBe(false);
  });

  it("drops the total from the label when GameBanana withholds it", () => {
    const pager = gameBananaPager(3, 0, 20, true);
    expect(pager.label).toBe("Page 3");
    expect(pager.pageCount).toBeNull();
    // Nothing but the page itself can say the run has ended.
    expect(pager.hasNext).toBe(false);
    expect(gameBananaPager(3, 0, 20, false).hasNext).toBe(true);
  });

  it("stops at a page that says it is the last one", () => {
    expect(gameBananaPager(2, 240, 20, true).hasNext).toBe(false);
  });

  it("keys a cached page by everything that changes it", () => {
    expect(gameBananaPageKey(" Rocket ", "likes", 5225, 2, false)).toBe(
      gameBananaPageKey("rocket", "likes", 5225, 2, false),
    );
    expect(gameBananaPageKey("rocket", "likes", null, 2, false)).not.toBe(
      gameBananaPageKey("rocket", "likes", 5225, 2, false),
    );
    expect(gameBananaPageKey("rocket", "likes", null, 1, false)).not.toBe(
      gameBananaPageKey("rocket", "likes", null, 2, false),
    );
    expect(gameBananaPageKey("rocket", "views", null, 1, false)).not.toBe(
      gameBananaPageKey("rocket", "likes", null, 1, false),
    );
    // The mature flag changes what a page holds, so it changes the key.
    expect(gameBananaPageKey("rocket", "likes", null, 1, true)).not.toBe(
      gameBananaPageKey("rocket", "likes", null, 1, false),
    );
  });

  it("keeps mature content off until it is asked for", () => {
    // No storage at all (or a blocked one) must never open the filter.
    expect(readMaturePreference()).toBe(false);
    const store = new Map<string, string>();
    const stub = {
      localStorage: {
        getItem: (key: string) => store.get(key) ?? null,
        setItem: (key: string, value: string) => void store.set(key, value),
      },
    };
    vi.stubGlobal("window", stub);
    try {
      expect(readMaturePreference()).toBe(false);
      writeMaturePreference(true);
      expect(store.get(MATURE_STORAGE_KEY)).toBe("1");
      expect(readMaturePreference()).toBe(true);
      writeMaturePreference(false);
      expect(store.get(MATURE_STORAGE_KEY)).toBe("0");
      expect(readMaturePreference()).toBe(false);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("flags exactly the fixtures that are meant to be flagged", () => {
    const flagged = PREVIEW_GAMEBANANA_RECORDS.filter((mod) => mod.mature).map((mod) => mod.name);
    expect(flagged).toEqual(["Flat Scattergun", "Vintage Sniper Rifle"]);
  });

  it("says how long ago in words", () => {
    const days = (count: number) => NOW / 1000 - count * 86_400;
    expect(relativeDate(days(0), NOW)).toBe("today");
    expect(relativeDate(days(1), NOW)).toBe("yesterday");
    expect(relativeDate(days(3), NOW)).toBe("3 days ago");
    expect(relativeDate(days(8), NOW)).toBe("a week ago");
    expect(relativeDate(days(21), NOW)).toBe("3 weeks ago");
    expect(relativeDate(days(70), NOW)).toBe("2 months ago");
    expect(relativeDate(days(400), NOW)).toBe("a year ago");
    expect(relativeDate(days(1200), NOW)).toBe("3 years ago");
    // A clock skewed into the future must not read as "-0 days ago".
    expect(relativeDate(days(-2), NOW)).toBe("today");
  });

  it("writes the card meta line, downloads only when known", () => {
    expect(gameBananaMetaLine(PREVIEW_GAMEBANANA_RECORDS[0], NOW)).toBe(
      "▲ 1.3k · 41k downloads · Updated 5 days ago",
    );
    expect(gameBananaMetaLine(PREVIEW_GAMEBANANA_RECORDS[2], NOW)).toBe(
      "▲ 402 · Updated a month ago",
    );
  });

  it("folds a long category list behind More", () => {
    expect(foldCategories(PREVIEW_GAMEBANANA_CATEGORIES).hidden).toEqual([]);
    const many = Array.from({ length: 7 }, (_, index) => ({ id: index, name: `c${index}` }));
    expect(foldCategories(many).shown).toHaveLength(4);
    expect(foldCategories(many).hidden).toHaveLength(3);
    expect(foldCategories(many.slice(0, 5)).hidden).toEqual([]);
  });
});
