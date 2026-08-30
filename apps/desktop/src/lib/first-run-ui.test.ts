import { describe, expect, it } from "vitest";
import { emptyLibrary, previewSavedLibrary } from "./library-ui";
import {
  canApplyWizard,
  firstRunSurface,
  toggleAddon,
  wizardApplyCopy,
} from "./first-run-ui";

const empty = emptyLibrary("/tf2", true);

describe("first-run routing", () => {
  it("sends an empty library to save-only or wizard", () => {
    expect(firstRunSurface(empty, "existing")).toBe("first-existing");
    expect(firstRunSurface(empty, "unused")).toBe("first-unused");
    expect(firstRunSurface(empty, null)).toBe("loading");
  });

  it("keeps a library with profiles on the ready screen", () => {
    expect(firstRunSurface(previewSavedLibrary("/tf2"), "unused")).toBe("ready");
    expect(firstRunSurface(previewSavedLibrary("/tf2"), "existing")).toBe("ready");
  });

  it("does not run first-run on a mismatched library", () => {
    expect(
      firstRunSurface({ ...empty, usable: false, rootMismatch: true }, "unused"),
    ).toBe("ready");
  });

  it("applies the wizard only with a name while unlocked", () => {
    expect(canApplyWizard("Main", false, false)).toBe(true);
    expect(canApplyWizard("  ", false, false)).toBe(false);
    expect(canApplyWizard("Main", true, false)).toBe(false);
    expect(canApplyWizard("Main", false, true)).toBe(false);
    expect(wizardApplyCopy(true)).toBe("Close TF2 to apply");
    expect(wizardApplyCopy(false)).toBe("Apply");
  });

  it("toggles official addons", () => {
    expect(toggleAddon([], "no-tutorial")).toEqual(["no-tutorial"]);
    expect(toggleAddon(["no-tutorial"], "no-tutorial")).toEqual([]);
  });
});
