import { describe, expect, it } from "vitest";
import {
  canApplyWizard,
  defaultStartFrom,
  firstRunSurface,
  START_FROM_OPTIONS,
  showStartFromChoice,
  toggleAddon,
  wizardApplyCopy,
} from "./first-run-ui";
import { emptyLibrary, previewSavedLibrary } from "./library-ui";

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
    expect(firstRunSurface({ ...empty, usable: false, rootMismatch: true }, "unused")).toBe(
      "ready",
    );
  });

  it("applies the wizard only with a name while unlocked", () => {
    expect(canApplyWizard("Main", false, false)).toBe(true);
    expect(canApplyWizard("  ", false, false)).toBe(false);
    expect(canApplyWizard("Main", true, false)).toBe(false);
    expect(canApplyWizard("Main", false, true)).toBe(false);
    expect(wizardApplyCopy(true)).toBe("Close TF2 to apply");
    expect(wizardApplyCopy(false)).toBe("Apply");
    expect(wizardApplyCopy(false, true)).toBe("Create");
    expect(wizardApplyCopy(true, true)).toBe("Close TF2 to apply");
  });

  it("offers Start from only when there is an active profile to copy", () => {
    const saved = previewSavedLibrary("/tf2");
    expect(showStartFromChoice(saved, true)).toBe(true);
    // First run: the wizard is not the Create flow and nothing is active.
    expect(showStartFromChoice(saved, false)).toBe(false);
    expect(showStartFromChoice(empty, true)).toBe(false);
    expect(showStartFromChoice(null, true)).toBe(false);
  });

  it("defaults to the current setup, and to fresh with no active profile", () => {
    expect(defaultStartFrom(previewSavedLibrary("/tf2"))).toBe("current");
    expect(defaultStartFrom(empty)).toBe("fresh");
    expect(defaultStartFrom(null)).toBe("fresh");
    expect(START_FROM_OPTIONS.map((option) => option.id)).toEqual(["current", "fresh"]);
  });

  it("toggles official addons", () => {
    expect(toggleAddon([], "no-tutorial")).toEqual(["no-tutorial"]);
    expect(toggleAddon(["no-tutorial"], "no-tutorial")).toEqual([]);
  });
});
