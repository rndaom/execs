import { describe, expect, it } from "vitest";
import { canCreateProfile, emptyLibrary, libraryStatusCopy } from "./library-ui";

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

  it("creates only when the library is usable and unlocked", () => {
    expect(canCreateProfile(ready, false, "Main")).toBe(true);
    expect(canCreateProfile(ready, false, "  ")).toBe(false);
    expect(canCreateProfile(ready, true, "Main")).toBe(false);
    expect(canCreateProfile({ ...ready, usable: false, rootMismatch: true }, false, "Main")).toBe(
      false,
    );
  });
});
