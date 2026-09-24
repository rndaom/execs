import { describe, expect, it, vi } from "vitest";
import {
  DIRECT_BURNING_OVERLAY_ID,
  DIRECT_DEVELOPER_TEXTURES_ID,
  DIRECT_FLAT_TEXTURES_ID,
  DIRECT_SENTRY_OVERLAY_ID,
  foldCategories,
  formatModBytes,
  gameBananaIdOf,
  isGameBananaInstalled,
  MATURE_STORAGE_KEY,
  type ModSelection,
  modDomId,
  modMetaLine,
  modSourceLabel,
  modSourceUrl,
  modsApplyEnabled,
  modsStatusLine,
  PREVIEW_GAMEBANANA_CATEGORIES,
  PREVIEW_GAMEBANANA_RECORDS,
  PREVIEW_MODS_STATUS,
  PREVIEW_PROFILE_MODS,
  REPAIR_POLL_MS,
  REPAIR_SLOW_POLL_MS,
  readMaturePreference,
  repairActionDisabled,
  repairPollDelay,
  repairStateAfterBackendRead,
  selectionDirty,
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
  it("keeps polling without reopening a persisted verification hand-off", () => {
    expect(repairPollDelay("waiting")).toBe(REPAIR_POLL_MS);
    expect(repairPollDelay("timeout")).toBe(REPAIR_SLOW_POLL_MS);
    expect(repairPollDelay("confirming")).toBeNull();
    expect(repairPollDelay("done")).toBeNull();
    expect(repairActionDisabled(false, true, true, "timeout")).toBe(true);
    expect(repairActionDisabled(false, true, true, "waiting")).toBe(true);
    expect(repairActionDisabled(false, true, false, "timeout")).toBe(true);
  });

  it("trusts a cleared backend marker after an ambiguous completion response", () => {
    expect(repairStateAfterBackendRead("waiting", false, false)).toBe("idle");
    expect(repairStateAfterBackendRead("confirming", false, false)).toBe("idle");
    expect(repairStateAfterBackendRead("waiting", true, false)).toBe("waiting");
    // The optimistic start update may render before its IPC has persisted.
    expect(repairStateAfterBackendRead("waiting", false, true)).toBe("waiting");
  });

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

  it("sees unchanged source order as unchanged", () => {
    expect(selectionDirty(status, INSTALLED)).toBe(false);
    expect(selectionDirty(status, { ...INSTALLED, addons: [...INSTALLED.addons].reverse() })).toBe(
      false,
    );
    expect(selectionDirty(status, { ...INSTALLED, addons: [] })).toBe(true);
    expect(selectionDirty(status, { ...INSTALLED, particleMods: ["Other"] })).toBe(true);
    expect(selectionDirty(null, selection())).toBe(false);
  });

  it.each(["addons", "particleMods", "profileParticleMods"] as const)(
    "keeps a change to %s precedence unapplied until explicitly saved",
    (field) => {
      const ordered = { ...INSTALLED, [field]: ["first", "second"] };
      const payload = { ...status, status: { ...status.status, ...ordered } };
      const reordered = { ...ordered, [field]: ["second", "first"] };
      expect(selectionDirty(payload, ordered)).toBe(false);
      expect(selectionDirty(payload, reordered)).toBe(true);
      expect(modsApplyEnabled(payload, reordered)).toBe(true);
    },
  );

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
    expect(visibleModSelection(picked, sources).profileParticleMods).toEqual(["gb-618734"]);
    // The pack is gone: no row could untick it, so it stops counting.
    expect(visibleModSelection(picked, []).profileParticleMods).toEqual([]);
    // Nothing to prune returns the very same object.
    expect(visibleModSelection(INSTALLED, [])).toBe(INSTALLED);
  });

  it("drops a previous profile's globally installed particle ID and enables cleanup", () => {
    const previous = "high-vis-mvm-cash-particles-gigantic";
    const switched = {
      ...status,
      status: { ...status.status, profileParticleMods: [previous] },
      profileParticleSources: [],
    };
    const visible = visibleModSelection({ ...INSTALLED, profileParticleMods: [previous] }, []);
    expect(visible).toEqual(INSTALLED);
    expect(modsApplyEnabled(switched, visible)).toBe(true);
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

  it("routes an interrupted transaction through the dedicated recovery action", () => {
    const recovering = { ...status, recoveryRequired: true };
    expect(modsApplyEnabled(recovering, { ...INSTALLED, addons: [] })).toBe(false);
    expect(modsStatusLine(recovering, INSTALLED, false)).toBe("Finish interrupted recovery first");
  });

  it("requires the cached library only when selecting its content", () => {
    const uncached = { ...stale, modsCached: false };
    expect(modsApplyEnabled(uncached, selection())).toBe(true);
    const directFlat = selection({ addons: [DIRECT_FLAT_TEXTURES_ID] });
    expect(modsApplyEnabled(uncached, directFlat)).toBe(true);
    expect(modsStatusLine(uncached, directFlat, false)).toBe("Unsaved changes");
    const directDeveloper = selection({ addons: [DIRECT_DEVELOPER_TEXTURES_ID] });
    expect(modsApplyEnabled(uncached, directDeveloper)).toBe(true);
    expect(modsApplyEnabled(uncached, selection({ addons: [DIRECT_BURNING_OVERLAY_ID] }))).toBe(
      true,
    );
    expect(modsApplyEnabled(uncached, selection({ addons: [DIRECT_SENTRY_OVERLAY_ID] }))).toBe(
      true,
    );
    expect(
      modsApplyEnabled(
        uncached,
        selection({
          addons: [DIRECT_BURNING_OVERLAY_ID, DIRECT_SENTRY_OVERLAY_ID],
        }),
      ),
    ).toBe(true);
    expect(
      modsApplyEnabled(
        uncached,
        selection({
          addons: [DIRECT_FLAT_TEXTURES_ID, DIRECT_DEVELOPER_TEXTURES_ID],
        }),
      ),
    ).toBe(true);
    expect(
      modsApplyEnabled(uncached, selection({ addons: [DIRECT_FLAT_TEXTURES_ID, "factory new"] })),
    ).toBe(false);
    expect(modsApplyEnabled(uncached, INSTALLED)).toBe(false);
    expect(modsApplyEnabled(null, selection())).toBe(false);
    expect(modsStatusLine(uncached, INSTALLED, false)).toContain("Download the mod library");
    expect(modsStatusLine(uncached, selection(), false)).toBe("Unsaved changes");
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
    expect(modSourceLabel({ kind: "external" })).toBe("External");
    expect(modMetaLine(local)).toBe("Local · 12.0 MB");
    expect(modMetaLine(gb)).toBe("GameBanana · 58.9 MB");
    expect(modMetaLine({ ...local, source: { kind: "external" } })).toBe("External · 12.0 MB");
  });

  it("only offers a link for a pack that has a page", () => {
    expect(modSourceUrl(local.source)).toBeNull();
    expect(modSourceUrl(gb.source)).toBe("https://gamebanana.com/mods/618734");
    expect(modSourceUrl({ kind: "gamebanana", id: 7, url: "https://evil.example/fake" })).toBe(
      "https://gamebanana.com/mods/7",
    );
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

  it("folds a long category list behind More", () => {
    expect(foldCategories(PREVIEW_GAMEBANANA_CATEGORIES).hidden).toEqual([]);
    const many = Array.from({ length: 7 }, (_, index) => ({ id: index, name: `c${index}` }));
    expect(foldCategories(many).shown).toHaveLength(4);
    expect(foldCategories(many).hidden).toHaveLength(3);
    expect(foldCategories(many.slice(0, 5)).hidden).toEqual([]);
  });
});
