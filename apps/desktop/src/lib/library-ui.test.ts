import { describe, expect, it } from "vitest";
import {
  canExportProfile,
  canImportProfile,
  canSaveCurrent,
  emptyLibrary,
  hasPackChanges,
  libraryStatusCopy,
  previewImportedLibrary,
  previewPackDelta,
  previewSavedLibrary,
  previewSwitchLibrary,
  switchStepIndex,
} from "./library-ui";

const ready = emptyLibrary("/tf2", true);

describe("library UI helpers", () => {
  it("describes empty, counted, and mismatched libraries", () => {
    expect(libraryStatusCopy(ready)).toBe("No profiles yet");
    expect(
      libraryStatusCopy({
        ...ready,
        profiles: [{ id: "a", name: "Main", createdAt: "", updatedAt: "" }],
      }),
    ).toBe("1 profile");
    expect(
      libraryStatusCopy({
        ...ready,
        profiles: [
          { id: "a", name: "Main", createdAt: "", updatedAt: "" },
          { id: "b", name: "Alt", createdAt: "", updatedAt: "" },
        ],
      }),
    ).toBe("2 profiles");
    expect(libraryStatusCopy({ ...ready, rootMismatch: true, usable: false })).toBe(
      "Profiles belong to another TF2 install.",
    );
  });

  it("saves only when the library is usable and unlocked", () => {
    expect(canSaveCurrent(ready, false, "Main")).toBe(true);
    expect(canSaveCurrent(ready, false, "  ")).toBe(false);
    expect(canSaveCurrent(ready, true, "Main")).toBe(false);
    expect(canSaveCurrent({ ...ready, usable: false, rootMismatch: true }, false, "Main")).toBe(
      false,
    );
  });

  it("flags pack add/remove for the absorb prompt", () => {
    expect(hasPackChanges(previewPackDelta())).toBe(true);
    expect(
      hasPackChanges({
        ownedChanged: ["tf/cfg/config.cfg"],
        ownedMissing: [],
        packsAdded: [],
        packsRemoved: [],
        configCfg: true,
      }),
    ).toBe(false);
  });

  it("builds a two-profile switch preview and orders steps", () => {
    const library = previewSwitchLibrary("/tf2");
    expect(library.profiles.map((profile) => profile.name)).toEqual(["Main", "Alt"]);
    expect(library.activeProfileId).toBe("preview-1");
    expect(switchStepIndex("write")).toBe(3);
    expect(switchStepIndex("done")).toBe(5);
  });

  it("builds a saved-preview library with an active profile", () => {
    const saved = previewSavedLibrary("/tf2", "Main");
    expect(saved.profiles).toHaveLength(1);
    expect(saved.profiles[0].name).toBe("Main");
    expect(saved.activeProfileId).toBe(saved.profiles[0].id);
  });

  it("exports while running and refuses import while running", () => {
    expect(canExportProfile(ready, false)).toBe(true);
    expect(canExportProfile(ready, true)).toBe(true);
    expect(canExportProfile({ ...ready, usable: false, rootMismatch: true }, false)).toBe(false);
    expect(canImportProfile(ready, false)).toBe(true);
    expect(canImportProfile(ready, true)).toBe(false);
    expect(canImportProfile({ ...ready, usable: false, rootMismatch: true }, false)).toBe(false);
  });

  it("builds an import-preview library without stealing active", () => {
    const imported = previewImportedLibrary("/tf2");
    expect(imported.profiles.map((profile) => profile.name)).toEqual(["Main", "Imported"]);
    expect(imported.activeProfileId).toBe("preview-1");
    expect(imported.activeProfileId).not.toBe("preview-2");
  });
});
