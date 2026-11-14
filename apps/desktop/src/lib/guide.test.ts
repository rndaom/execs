import { describe, expect, it } from "vitest";
import { guideUrl } from "./guide";

describe("guide links", () => {
  it("opens the page for the pane at this build's release tag", () => {
    expect(guideUrl("crosshair", "0.2.2", false)).toBe(
      "https://github.com/rndaom/execs/blob/v0.2.2/docs/guide/crosshair.md",
    );
    expect(guideUrl("app-settings", "0.2.2+1", false)).toBe(
      "https://github.com/rndaom/execs/blob/v0.2.2%2B1/docs/guide/app-settings.md",
    );
  });

  it("uses main for development builds and an unknown version", () => {
    expect(guideUrl("mods", "0.2.2", true)).toContain("/blob/main/docs/guide/mods.md");
    expect(guideUrl("mods", "", false)).toContain("/blob/main/docs/guide/mods.md");
  });
});
