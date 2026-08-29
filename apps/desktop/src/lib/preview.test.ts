import { describe, expect, it } from "vitest";
import {
  previewConfirmed,
  previewInstalls,
  previewLibrary,
  previewLocked,
  previewStateFromSearch,
} from "./preview";

describe("preview query", () => {
  it("reads known preview states", () => {
    expect(previewStateFromSearch("?preview=many")).toBe("many");
    expect(previewStateFromSearch("preview=locked")).toBe("locked");
    expect(previewStateFromSearch("?preview=library")).toBe("library");
    expect(previewStateFromSearch("?preview=saved")).toBe("saved");
    expect(previewStateFromSearch("?preview=absorb")).toBe("absorb");
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
  });
});
