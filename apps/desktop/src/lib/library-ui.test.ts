import { describe, expect, it } from "vitest";
import { canSaveCurrent, emptyLibrary, libraryStatusCopy, previewSavedLibrary } from "./library-ui";

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

  it("builds a saved-preview library with an active profile", () => {
    const saved = previewSavedLibrary("/tf2", "Main");
    expect(saved.profiles).toHaveLength(1);
    expect(saved.profiles[0].name).toBe("Main");
    expect(saved.activeProfileId).toBe(saved.profiles[0].id);
  });
});
