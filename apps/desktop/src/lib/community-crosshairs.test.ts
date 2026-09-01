import { describe, expect, it } from "vitest";
import {
  COMMUNITY_CROSSHAIR_PREFIX,
  COMMUNITY_CROSSHAIRS,
  communityLibraryName,
  migrateCommunityName,
  searchCommunityCrosshairs,
} from "./community-crosshairs";
import { CROSSHAIR_SHAPES, isBuiltinCrosshairShape, validCrosshairName } from "./crosshair-ui";

describe("community crosshair catalog", () => {
  it("ships the whole Venom pack exactly once", () => {
    expect(COMMUNITY_CROSSHAIRS).toHaveLength(173);
    expect(new Set(COMMUNITY_CROSSHAIRS.map((entry) => entry.id)).size).toBe(173);
  });

  it("carries only names the pack writer accepts", () => {
    for (const entry of COMMUNITY_CROSSHAIRS) {
      expect(validCrosshairName(entry.id), entry.id).toBe(true);
      expect(validCrosshairName(communityLibraryName(entry.id)), entry.id).toBe(true);
    }
  });

  it("excludes the animated crossanim_* sprites", () => {
    expect(COMMUNITY_CROSSHAIRS.filter((entry) => entry.id.startsWith("crossanim_"))).toEqual([]);
    expect(COMMUNITY_CROSSHAIRS.filter((entry) => entry.file.startsWith("crossanim_"))).toEqual([]);
  });

  it("never lands a stored name on a first-party shape", () => {
    // Two upstream stems ("circle", "dot") are first-party shape names; the
    // namespace is what keeps one VTF from meaning two things.
    const bare = COMMUNITY_CROSSHAIRS.filter((entry) => isBuiltinCrosshairShape(entry.id));
    expect(bare.map((entry) => entry.id).sort()).toEqual(["circle", "dot"]);
    for (const entry of COMMUNITY_CROSSHAIRS) {
      expect(CROSSHAIR_SHAPES).not.toContain(communityLibraryName(entry.id));
      expect(isBuiltinCrosshairShape(communityLibraryName(entry.id)), entry.id).toBe(false);
    }
  });

  it("migrates only the legacy names that actually collide", () => {
    expect(migrateCommunityName("circle", isBuiltinCrosshairShape)).toBe(
      `${COMMUNITY_CROSSHAIR_PREFIX}circle`,
    );
    expect(migrateCommunityName("dot", isBuiltinCrosshairShape)).toBe(
      `${COMMUNITY_CROSSHAIR_PREFIX}dot`,
    );
    // A non-colliding legacy name still matches the bytes in the installed
    // pack, so renaming it would strand them.
    const plain = COMMUNITY_CROSSHAIRS.find((entry) => !isBuiltinCrosshairShape(entry.id));
    expect(plain).toBeDefined();
    expect(migrateCommunityName(plain?.id ?? "", isBuiltinCrosshairShape)).toBe(plain?.id);
    expect(migrateCommunityName("my_own_png", isBuiltinCrosshairShape)).toBe("my_own_png");
  });
});

describe("searchCommunityCrosshairs", () => {
  it("returns the whole catalog for a blank query", () => {
    expect(searchCommunityCrosshairs("")).toHaveLength(COMMUNITY_CROSSHAIRS.length);
    expect(searchCommunityCrosshairs("   ")).toHaveLength(COMMUNITY_CROSSHAIRS.length);
  });

  it("matches case-insensitively on a substring of the id", () => {
    const hits = searchCommunityCrosshairs("ZEEQ");
    expect(hits.length).toBeGreaterThan(0);
    expect(hits.every((entry) => entry.id.includes("zeeq"))).toBe(true);
  });

  it("returns nothing for a query no entry contains", () => {
    expect(searchCommunityCrosshairs("no_such_crosshair_anywhere")).toEqual([]);
  });
});
