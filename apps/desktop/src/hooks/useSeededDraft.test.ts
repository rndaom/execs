import { describe, expect, it } from "vitest";
import { draftRecordKey, shouldReseedFor } from "./useSeededDraft";

const GAMEPLAY = "tf/cfg/overrides/execs_gameplay.cfg";

describe("draftRecordKey", () => {
  it("separates two profiles holding the same file", () => {
    expect(draftRecordKey("profile-a", GAMEPLAY)).not.toBe(draftRecordKey("profile-b", GAMEPLAY));
  });

  it("is stable for the same profile and record", () => {
    expect(draftRecordKey("profile-a", GAMEPLAY)).toBe(draftRecordKey("profile-a", GAMEPLAY));
  });

  it("treats a missing profile id as its own key", () => {
    expect(draftRecordKey(null, GAMEPLAY)).not.toBe(draftRecordKey("profile-a", GAMEPLAY));
  });
});

describe("shouldReseedFor", () => {
  it("keeps unsaved edits when the same record changes underneath them", () => {
    expect(shouldReseedFor("fov_desired 90", "fov_desired 85", true, false)).toBe(false);
  });

  it("takes the incoming value over a clean draft", () => {
    expect(shouldReseedFor("fov_desired 90", "fov_desired 85", false, false)).toBe(true);
  });

  it("drops a dirty draft when the profile in the key changes", () => {
    const before = draftRecordKey("profile-a", GAMEPLAY);
    const after = draftRecordKey("profile-b", GAMEPLAY);

    expect(shouldReseedFor("fov_desired 90", "fov_desired 85", true, before !== after)).toBe(true);
  });

  it("drops a dirty draft on a profile switch even when both profiles hold the same bytes", () => {
    const before = draftRecordKey("profile-a", GAMEPLAY);
    const after = draftRecordKey("profile-b", GAMEPLAY);

    expect(shouldReseedFor("fov_desired 90", "fov_desired 90", true, before !== after)).toBe(true);
  });

  it("seeds the first value with nothing to compare against", () => {
    expect(shouldReseedFor(null, "fov_desired 90", false, false)).toBe(true);
  });
});
