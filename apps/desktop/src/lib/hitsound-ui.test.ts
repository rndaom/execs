import { describe, expect, it } from "vitest";
import type { HitsoundEntry } from "./bridge";
import { boostOf, packChangeNeeded, type SlotDraft, slotChange } from "./hitsound-ui";

const installed: HitsoundEntry = { name: "quack", source: "community" };

function slot(overrides: Partial<SlotDraft>): SlotDraft {
  return {
    enabled: true,
    choice: { kind: "installed", entry: installed },
    volume: 100,
    boost: 0,
    pitchMin: 220,
    pitchMax: 20,
    ...overrides,
  };
}

describe("boost", () => {
  it("reads only the three steps off a record", () => {
    expect(boostOf(null)).toBe(0);
    expect(boostOf({ ...installed, boost: 6 })).toBe(6);
    expect(boostOf({ ...installed, boost: 7 })).toBe(0);
  });

  it("keeps an installed slot until its boost changes", () => {
    expect(slotChange("hit", slot({}), installed)).toEqual({ change: "keep" });
    expect(slotChange("hit", slot({ boost: 12 }), installed)).toEqual({
      change: "install",
      pick: { kind: "installed", slot: "hit" },
      boost: 12,
    });
  });

  it("carries the boost on a fresh install and counts it as a pack change", () => {
    const fresh = slot({ choice: { kind: "community", id: "bell" }, boost: 6 });
    expect(slotChange("kill", fresh, null)).toEqual({
      change: "install",
      pick: { kind: "community", name: "bell" },
      boost: 6,
    });
    expect(
      packChangeNeeded(
        { hit: slot({ boost: 6 }), kill: slot({}), repeatDelay: 0 },
        {
          hit: installed,
          kill: installed,
        },
      ),
    ).toBe(true);
  });
});
