import { describe, expect, it } from "vitest";
import {
  previewConfirmed,
  previewCreating,
  previewFirstRunKind,
  previewInstalls,
  previewLibrary,
  previewLocked,
  previewSettingsTab,
  previewStateFromSearch,
} from "./preview";

describe("preview query", () => {
  it("reads known preview states", () => {
    expect(previewStateFromSearch("?preview=many")).toBe("many");
    expect(previewStateFromSearch("preview=locked")).toBe("locked");
    expect(previewStateFromSearch("?preview=library")).toBe("library");
    expect(previewStateFromSearch("?preview=saved")).toBe("saved");
    expect(previewStateFromSearch("?preview=absorb")).toBe("absorb");
    expect(previewStateFromSearch("?preview=switch")).toBe("switch");
    expect(previewStateFromSearch("?preview=import")).toBe("import");
    expect(previewStateFromSearch("?preview=first-existing")).toBe("first-existing");
    expect(previewStateFromSearch("?preview=first-unused")).toBe("first-unused");
    expect(previewStateFromSearch("?preview=first-unused-locked")).toBe("first-unused-locked");
    expect(previewStateFromSearch("?preview=create")).toBe("create");
    expect(previewStateFromSearch("?preview=settings-comfig")).toBe("settings-comfig");
    expect(previewStateFromSearch("?preview=settings-binds")).toBe("settings-binds");
    expect(previewStateFromSearch("?preview=settings-gameplay")).toBe("settings-gameplay");
    expect(previewStateFromSearch("?preview=settings-files")).toBe("settings-files");
    expect(previewStateFromSearch("?preview=settings-launch")).toBe("settings-launch");
    expect(previewStateFromSearch("?preview=settings-locked")).toBe("settings-locked");
    expect(previewStateFromSearch("")).toBeNull();
    expect(previewStateFromSearch("?preview=nope")).toBeNull();
  });

  it("maps finder, lock, and library fixtures", () => {
    expect(previewInstalls("empty")).toEqual([]);
    expect(previewInstalls("many")).toHaveLength(2);
    expect(previewConfirmed("one")).toBeNull();
    expect(previewConfirmed("confirmed")?.path).toContain("Team Fortress 2");
    expect(previewConfirmed("library")?.path).toContain("Team Fortress 2");
    expect(previewLocked("locked")).toBe(true);
    expect(previewLocked("confirmed")).toBe(false);
    expect(previewLibrary("empty")).toBeNull();
    expect(previewLibrary("confirmed")?.initialized).toBe(false);
    expect(previewLibrary("library")).toMatchObject({
      initialized: true,
      usable: true,
      rootMismatch: false,
      profiles: [],
    });
    expect(previewConfirmed("saved")?.path).toContain("Team Fortress 2");
    expect(previewLibrary("saved")).toMatchObject({
      initialized: true,
      usable: true,
      profiles: [{ name: "Main" }],
    });
    expect(previewLibrary("saved")?.activeProfileId).toBe("preview-1");
    expect(previewConfirmed("absorb")?.path).toContain("Team Fortress 2");
    expect(previewLibrary("absorb")?.activeProfileId).toBe("preview-1");
    expect(previewLibrary("switch")?.profiles).toHaveLength(2);
    expect(previewLibrary("switch")?.profiles[1].name).toBe("Alt");
    expect(previewConfirmed("import")?.path).toContain("Team Fortress 2");
    expect(previewLibrary("import")).toMatchObject({
      initialized: true,
      usable: true,
      profiles: [{ name: "Main" }, { name: "Imported" }],
    });
    expect(previewLibrary("import")?.activeProfileId).toBe("preview-1");
    expect(previewConfirmed("first-existing")?.path).toContain("Team Fortress 2");
    expect(previewLibrary("first-existing")?.profiles).toEqual([]);
    expect(previewFirstRunKind("first-existing")).toBe("existing");
    expect(previewFirstRunKind("confirmed")).toBe("existing");
    expect(previewFirstRunKind("library")).toBe("existing");
    expect(previewFirstRunKind("first-unused")).toBe("unused");
    expect(previewFirstRunKind("first-unused-locked")).toBe("unused");
    expect(previewLocked("first-unused-locked")).toBe(true);
    expect(previewLibrary("first-unused")?.profiles).toEqual([]);
    expect(previewCreating("create")).toBe(true);
    expect(previewLibrary("create")?.profiles[0].name).toBe("Main");
    expect(previewLibrary("create")?.activeProfileId).toBe("preview-1");
    expect(previewFirstRunKind("create")).toBeNull();
    expect(previewSettingsTab("settings-comfig")).toBe("comfig");
    expect(previewSettingsTab("settings-binds")).toBe("binds");
    expect(previewSettingsTab("settings-gameplay")).toBe("gameplay");
    expect(previewSettingsTab("settings-files")).toBe("files");
    expect(previewSettingsTab("settings-launch")).toBe("launch");
    expect(previewSettingsTab("settings-locked")).toBe("comfig");
    expect(previewSettingsTab("saved")).toBeNull();
    expect(previewLibrary("settings-comfig")?.activeProfileId).toBe("preview-1");
    expect(previewLocked("settings-locked")).toBe(true);
    expect(previewFirstRunKind("settings-comfig")).toBeNull();
  });
});
