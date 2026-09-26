import { describe, expect, it } from "vitest";
import {
  groupRestorePoints,
  type RestorePoint,
  restoredProfileName,
  restorePointTitle,
} from "./restore-points-ui";

const point = (patch: Partial<RestorePoint> = {}): RestorePoint => ({
  id: "1".padStart(32, "0"),
  profileId: "main",
  profileName: "Main",
  createdAt: Date.UTC(2026, 8, 26, 12, 0),
  bytes: 1024,
  ...patch,
});

describe("restore points", () => {
  it("titles a point by its name or its time", () => {
    expect(restorePointTitle(point({ label: "Before HUD" }))).toBe("Before HUD");
    expect(restorePointTitle(point(), "en-US")).toMatch(/^Saved Sep 26/);
  });

  it("names the restored profile within the 80-character limit", () => {
    expect(restoredProfileName(point(), "en-US")).toBe("Main (restored Sep 26)");
    const long = restoredProfileName(point({ profileName: "x".repeat(90) }), "en-US");
    expect(long.length).toBeLessThanOrEqual(80);
    expect(long.endsWith("(restored Sep 26)")).toBe(true);
  });

  it("lists the chosen profile first and deleted profiles last", () => {
    const groups = groupRestorePoints(
      [
        point({ id: "a", profileId: "gone", profileName: "Old" }),
        point({ id: "b", profileId: "other" }),
        point({ id: "c", profileId: "main" }),
      ],
      [
        { id: "main", name: "Main" },
        { id: "other", name: "Casual" },
        { id: "empty", name: "Empty" },
      ],
      "empty",
    );
    expect(groups.map((group) => [group.profileName, group.deleted, group.points.length])).toEqual([
      ["Empty", false, 0],
      ["Casual", false, 1],
      ["Main", false, 1],
      ["Old", true, 1],
    ]);
  });
});
