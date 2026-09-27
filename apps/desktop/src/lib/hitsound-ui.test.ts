import { describe, expect, it } from "vitest";
import type { HitsoundEntry } from "./bridge";
import { defaultGameplay } from "./gameplay-ui";
import {
  boostOf,
  packChangeNeeded,
  type SlotDraft,
  sameChoice,
  seedSoundsDraft,
  slotChange,
  soundsToCvars,
} from "./hitsound-ui";

const installed: HitsoundEntry = { name: "quack", source: "community" };

describe("installed source identity", () => {
  it("distinguishes same-name comfig sounds and accepts the original hash after boost", () => {
    const installed = {
      kind: "installed",
      entry: { source: "comfig", name: "Bubble Pop", hash: "A", boost: 6 },
    } as const;
    expect(sameChoice(installed, { kind: "comfig", name: "Bubble Pop", hash: "A" })).toBe(true);
    expect(sameChoice(installed, { kind: "comfig", name: "Bubble Pop", hash: "B" })).toBe(false);
    expect(
      sameChoice(
        { kind: "installed", entry: { source: "comfig", name: "Bubble Pop" } },
        { kind: "comfig", name: "Bubble Pop", hash: "A" },
      ),
    ).toBe(false);
  });
  it("matches picked files by token, never by display name", () => {
    const installed = {
      kind: "installed",
      entry: { source: "file", name: "hit.wav", token: "A" },
    } as const;
    const picked = {
      token: "A",
      name: "hit.wav",
      converted: false,
      info: {
        formatTag: 1,
        channels: 1,
        sampleRate: 44100,
        bitsPerSample: 16,
        dataBytes: 2,
        durationMs: 1,
      },
    };
    expect(sameChoice(installed, { kind: "file", picked })).toBe(true);
    expect(sameChoice(installed, { kind: "file", picked: { ...picked, token: "B" } })).toBe(false);
  });
});

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

describe("dormant custom files", () => {
  it("keeps a saved WAV through unrelated settings edits and restores it without replacing bytes", () => {
    const cvars = { ...defaultGameplay(), tf_dingalingaling_effect: 2 };
    const record = { hit: installed };
    const seeded = seedSoundsDraft(record, cvars);
    expect(seeded.hit.choice).toEqual({ kind: "stock", effect: 2 });
    expect(packChangeNeeded(seeded, record)).toBe(false);
    const volumeEdit = { ...seeded, hit: { ...seeded.hit, volume: 42 } };
    expect(packChangeNeeded(volumeEdit, record)).toBe(false);
    expect(slotChange("hit", volumeEdit.hit, installed)).toEqual({ change: "keep" });

    const restored = {
      ...seeded,
      hit: { ...seeded.hit, choice: { kind: "installed" as const, entry: installed } },
    };
    expect(soundsToCvars(restored, cvars).tf_dingalingaling_effect).toBe(0);
    expect(slotChange("hit", restored.hit, installed)).toEqual({ change: "keep" });
  });

  it("clears a saved WAV when default ding is chosen, and replaces it for a new file", () => {
    expect(slotChange("hit", slot({ choice: { kind: "stock", effect: 0 } }), installed)).toEqual({
      change: "clear",
    });
    expect(slotChange("hit", slot({ choice: { kind: "stock", effect: 3 } }), installed)).toEqual({
      change: "keep",
    });
    const picked = {
      token: "new",
      name: "new.wav",
      converted: false,
      info: {
        formatTag: 1,
        channels: 1,
        sampleRate: 44100,
        bitsPerSample: 16,
        dataBytes: 2,
        durationMs: 1,
      },
    };
    expect(slotChange("hit", slot({ choice: { kind: "file", picked } }), installed)).toEqual({
      change: "install",
      pick: { kind: "file", token: "new", name: "new.wav" },
      boost: 0,
    });
  });
});
