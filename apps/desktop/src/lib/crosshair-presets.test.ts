import { describe, expect, it } from "vitest";
import { crosshairLabel } from "./crosshair-labels";
import { CROSSHAIR_PRESETS, isCrosshairPreset, presetPixels } from "./crosshair-presets";
import { CROSSHAIR_SHAPES, seedCrosshairDraft, validCrosshairName } from "./crosshair-ui";

const SIZE = 64;

describe("execs shapes", () => {
  it("draws every shape centred inside the sprite, each one different", () => {
    const seen = new Set<string>();
    for (const preset of CROSSHAIR_PRESETS) {
      expect(validCrosshairName(preset.name), preset.name).toBe(true);
      const pixels = presetPixels(preset.name);
      if (!pixels) throw new Error(`No pixels for ${preset.name}`);
      expect(pixels).toHaveLength(SIZE * SIZE * 4);
      let left = SIZE;
      let right = -1;
      let top = SIZE;
      let bottom = -1;
      for (let y = 0; y < SIZE; y += 1) {
        for (let x = 0; x < SIZE; x += 1) {
          if (pixels[(y * SIZE + x) * 4 + 3] === 0) continue;
          left = Math.min(left, x);
          right = Math.max(right, x);
          top = Math.min(top, y);
          bottom = Math.max(bottom, y);
        }
      }
      expect(right, preset.name).toBeGreaterThanOrEqual(left);
      // Centred on the 31/32 line both ways, as the engine centres the sprite.
      expect(SIZE - 1 - right, preset.name).toBe(left);
      expect(SIZE - 1 - bottom, preset.name).toBe(top);
      const key = Array.from(pixels).join(",");
      expect(seen.has(key), preset.name).toBe(false);
      seen.add(key);
    }
  });

  it("keeps the reserved names apart from earlier shapes and library entries", () => {
    for (const preset of CROSSHAIR_PRESETS) {
      expect(isCrosshairPreset(preset.name)).toBe(true);
      expect((CROSSHAIR_SHAPES as readonly string[]).includes(preset.name)).toBe(false);
      expect(crosshairLabel(preset.name)).toBe(preset.label);
    }
    expect(isCrosshairPreset("design-dot")).toBe(false);
    // A saved pack that used a shape seeds back to it even before its preview loads.
    expect(seedCrosshairDraft({ id: "p", shape: "shape-gap", assignments: {} }).shape).toBe(
      "shape-gap",
    );
  });
});
