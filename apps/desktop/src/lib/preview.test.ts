import { describe, expect, it } from "vitest";
import {
  previewConfirmed,
  previewInstalls,
  previewLocked,
  previewStateFromSearch,
} from "./preview";

describe("preview query", () => {
  it("reads known preview states", () => {
    expect(previewStateFromSearch("?preview=many")).toBe("many");
    expect(previewStateFromSearch("preview=locked")).toBe("locked");
    expect(previewStateFromSearch("")).toBeNull();
    expect(previewStateFromSearch("?preview=nope")).toBeNull();
  });

  it("maps finder and lock fixtures", () => {
    expect(previewInstalls("empty")).toEqual([]);
    expect(previewInstalls("many")).toHaveLength(2);
    expect(previewConfirmed("one")).toBeNull();
    expect(previewConfirmed("confirmed")?.path).toContain("Team Fortress 2");
    expect(previewLocked("locked")).toBe(true);
    expect(previewLocked("confirmed")).toBe(false);
  });
});
