import { describe, expect, it } from "vitest";
import { COMMUNITY_CROSSHAIR_PREFIX, migrateCommunityName } from "./community-crosshairs";
import { isBuiltinCrosshairShape } from "./crosshair-ui";

describe("retired community crosshair names", () => {
  it("keeps the two legacy collisions distinct from first-party shapes", () => {
    expect(migrateCommunityName("circle", isBuiltinCrosshairShape)).toBe(
      `${COMMUNITY_CROSSHAIR_PREFIX}circle`,
    );
    expect(migrateCommunityName("dot", isBuiltinCrosshairShape)).toBe(
      `${COMMUNITY_CROSSHAIR_PREFIX}dot`,
    );
  });

  it("leaves non-colliding legacy names and user designs untouched", () => {
    expect(migrateCommunityName("bomo1", isBuiltinCrosshairShape)).toBe("bomo1");
    expect(migrateCommunityName("design-mine", isBuiltinCrosshairShape)).toBe("design-mine");
    expect(migrateCommunityName("cross", isBuiltinCrosshairShape)).toBe("cross");
  });
});
