import { describe, expect, it } from "vitest";
import { confirmEnabled, formatInstallLabel } from "./finder-ui";

describe("finder UI helpers", () => {
  it("enables confirm only when a path is selected and scan is done", () => {
    expect(confirmEnabled(null, false)).toBe(false);
    expect(confirmEnabled("/tf2", true)).toBe(false);
    expect(confirmEnabled("/tf2", false)).toBe(true);
  });

  it("labels an install by its last path segment", () => {
    expect(formatInstallLabel("/home/user/Steam/steamapps/common/Team Fortress 2")).toBe(
      "Team Fortress 2",
    );
    expect(formatInstallLabel("D:\\SteamLibrary\\steamapps\\common\\Team Fortress 2")).toBe(
      "Team Fortress 2",
    );
  });
});
