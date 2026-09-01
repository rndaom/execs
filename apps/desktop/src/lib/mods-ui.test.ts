import { describe, expect, it } from "vitest";
import {
  formatModBytes,
  modsApplyEnabled,
  modsStatusLine,
  PREVIEW_MODS_STATUS,
  selectionDirty,
  summarizeReport,
  toggleName,
} from "./mods-ui";

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
    expect(selectionDirty(status, ["No Burning Overlay"], ["Square_Series"])).toBe(false);
    // Order does not matter.
    expect(selectionDirty(status, [], ["Square_Series"])).toBe(true);
    expect(selectionDirty(status, ["No Burning Overlay"], [])).toBe(true);
    expect(selectionDirty(null, [], [])).toBe(false);
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
  const installed = { addons: ["No Burning Overlay"], particles: ["Square_Series"] };
  const stale = {
    ...status,
    status: { ...status.status, stale: true },
  };

  it("sees a reordered selection as unchanged", () => {
    expect(selectionDirty(status, installed.addons, installed.particles)).toBe(false);
    expect(selectionDirty(status, [...installed.addons].reverse(), installed.particles)).toBe(
      false,
    );
    expect(selectionDirty(status, [], installed.particles)).toBe(true);
    expect(selectionDirty(status, installed.addons, ["Other"])).toBe(true);
    expect(selectionDirty(null, [], [])).toBe(false);
  });

  it("lights Apply for a changed selection", () => {
    expect(modsApplyEnabled(status, installed.addons, installed.particles)).toBe(false);
    expect(modsApplyEnabled(status, [], installed.particles)).toBe(true);
  });

  it("lights Apply after a TF2 update even when the selection is untouched", () => {
    // The stale notice tells the user to re-apply; the button has to agree.
    expect(selectionDirty(stale, installed.addons, installed.particles)).toBe(false);
    expect(modsApplyEnabled(stale, installed.addons, installed.particles)).toBe(true);
    expect(modsStatusLine(stale, installed.addons, installed.particles, false)).toContain(
      "TF2 updated",
    );
  });

  it("never applies without a cached library, whatever else is true", () => {
    const uncached = { ...stale, modsCached: false };
    expect(modsApplyEnabled(uncached, [], [])).toBe(false);
    expect(modsApplyEnabled(null, [], [])).toBe(false);
    expect(modsStatusLine(uncached, [], [], false)).toContain("Download the mod library");
  });

  it("says TF2 is open before anything else", () => {
    expect(modsStatusLine(stale, installed.addons, installed.particles, true)).toContain(
      "TF2 is open",
    );
    expect(modsStatusLine(status, installed.addons, installed.particles, false)).toBe(
      "Installed mods match your selection",
    );
  });
});
