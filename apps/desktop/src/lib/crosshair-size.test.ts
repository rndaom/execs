import { describe, expect, it } from "vitest";
import {
  actualCssSize,
  fileCrosshairSize,
  launchOptionDisplay,
  resampleSprite,
  resolveGameDisplay,
  screenShare,
  scriptCrosshairSize,
  stretchFactor,
  visibleBounds,
} from "./crosshair-size";

const fullHd = { width: 1920, height: 1080, windowed: false };

describe("in-game crosshair size", () => {
  it("draws a weapon-script sprite at its size × scale / 32, rounded like the engine", () => {
    expect(scriptCrosshairSize(64, 64, 32)).toEqual({ width: 64, height: 64 });
    expect(scriptCrosshairSize(64, 64, 16)).toEqual({ width: 32, height: 32 });
    expect(scriptCrosshairSize(64, 64, 48)).toEqual({ width: 96, height: 96 });
    // (int)(31 × 33 / 32 + 0.5) = 32, (int)(47 × 33 / 32 + 0.5) = 48.
    expect(scriptCrosshairSize(31, 47, 33)).toEqual({ width: 32, height: 48 });
  });

  it("draws a cl_crosshair_file sprite as a 2 × scale square whatever its texture", () => {
    expect(fileCrosshairSize(32)).toEqual({ width: 64, height: 64 });
    expect(fileCrosshairSize(24.4)).toEqual({ width: 48, height: 48 });
    expect(fileCrosshairSize(24.5)).toEqual({ width: 50, height: 50 });
  });

  it("takes the same pixels at every resolution, so a bigger screen shows a smaller share", () => {
    const drawn = scriptCrosshairSize(64, 64, 32);
    const at720 = screenShare(drawn, { width: 1280, height: 720, windowed: false });
    const at1440 = screenShare(drawn, { width: 2560, height: 1440, windowed: false });
    expect(at720.width).toBeCloseTo(0.05);
    expect(at1440.width).toBeCloseTo(0.025);
  });
});

describe("actual size on this screen", () => {
  it("covers exactly the crosshair's device pixels at native resolution", () => {
    const drawn = { width: 64, height: 64 };
    const monitor = { width: 1920, height: 1080 };
    expect(actualCssSize(drawn, fullHd, monitor, 1)).toEqual({ width: 64, height: 64 });
    // 150% Windows scaling or app zoom: fewer CSS pixels, same device pixels.
    expect(actualCssSize(drawn, fullHd, monitor, 1.5)).toEqual({
      width: 64 / 1.5,
      height: 64 / 1.5,
    });
  });

  it("grows with fullscreen stretching but not in a window", () => {
    const low = { width: 1280, height: 720, windowed: false };
    const monitor = { width: 2560, height: 1440 };
    expect(stretchFactor(low, monitor)).toEqual({ width: 2, height: 2 });
    expect(actualCssSize({ width: 64, height: 64 }, low, monitor, 1)).toEqual({
      width: 128,
      height: 128,
    });
    expect(stretchFactor({ ...low, windowed: true }, monitor)).toEqual({ width: 1, height: 1 });
    // A stretched 4:3 resolution widens the crosshair only horizontally.
    const stretched = stretchFactor(
      { width: 1440, height: 1080, windowed: false },
      {
        width: 1920,
        height: 1080,
      },
    );
    expect(stretched.width).toBeCloseTo(4 / 3);
    expect(stretched.height).toBe(1);
  });

  it("assumes nothing when the game resolution does not fit this screen", () => {
    expect(stretchFactor(fullHd, { width: 1280, height: 1024 })).toEqual({ width: 1, height: 1 });
    expect(stretchFactor(fullHd, null)).toEqual({ width: 1, height: 1 });
  });
});

describe("which resolution the preview assumes", () => {
  const monitor = { width: 2560, height: 1440 };
  it("prefers the player's choice, then launch options, then TF2's setting, then the screen", () => {
    const saved = { width: 1920, height: 1080, windowed: false };
    expect(
      resolveGameDisplay({
        custom: { width: 1600, height: 900, windowed: true },
        launchOptions: "-w 1280 -h 720",
        saved,
        monitor,
      }),
    ).toEqual({ width: 1600, height: 900, windowed: true, source: "custom" });
    expect(
      resolveGameDisplay({ custom: null, launchOptions: "-w 1280 -h 720", saved, monitor }),
    ).toEqual({ width: 1280, height: 720, windowed: false, source: "launch" });
    expect(resolveGameDisplay({ custom: null, launchOptions: "", saved, monitor })).toEqual({
      ...saved,
      source: "tf2",
    });
    expect(resolveGameDisplay({ custom: null, launchOptions: "", saved: null, monitor })).toEqual({
      width: 2560,
      height: 1440,
      windowed: false,
      source: "screen",
    });
  });

  it("treats a borderless window as unstretched and ignores nonsense", () => {
    expect(
      resolveGameDisplay({
        custom: { width: 5, height: 5, windowed: false },
        launchOptions: "-w abc",
        saved: { width: 1920, height: 1080, windowed: true, borderless: true },
        monitor,
      }),
    ).toEqual({ width: 1920, height: 1080, windowed: true, source: "tf2" });
  });

  it("reads Source's window flags from launch options", () => {
    expect(launchOptionDisplay("-novid -windowed -noborder -w 1600 -h 900")).toEqual({
      windowed: true,
      width: 1600,
      height: 900,
    });
    expect(launchOptionDisplay("-fullscreen")).toEqual({ windowed: false });
  });

  it("ignores a wrapper's own sizes before %command%", () => {
    // gamescope's -W/-H are its output size; TF2 itself gets no size here.
    expect(
      launchOptionDisplay("gamescope -w 1920 -h 1080 -W 2560 -H 1440 -f -- %command%"),
    ).toEqual({});
    expect(launchOptionDisplay("gamescope -W 2560 -H 1440 -- %command% -w 1920 -h 1080")).toEqual({
      width: 1920,
      height: 1080,
    });
  });
});

describe("resampling like the GPU", () => {
  // A 4×4 sprite with one opaque column at x = 2.
  const column = Array.from({ length: 16 }, (_, index) =>
    index % 4 === 2 ? [255, 255, 255, 255] : [0, 0, 0, 0],
  ).flat();

  it("point-samples execs sprites, so halving can drop a one-pixel line", () => {
    const half = resampleSprite(column, 4, 4, { width: 2, height: 2 }, "nearest");
    // Samples land on texels 1 and 3: the line at x = 2 disappears in game.
    expect(Array.from(half).filter((_, index) => index % 4 === 3)).toEqual([0, 0, 0, 0]);
    const same = resampleSprite(column, 4, 4, { width: 4, height: 4 }, "nearest");
    expect(Array.from(same)).toEqual(column);
  });

  it("filters Valve's sprites, so halving blends the line instead", () => {
    const half = resampleSprite(column, 4, 4, { width: 2, height: 2 }, "linear");
    const alpha = Array.from(half).filter((_, index) => index % 4 === 3);
    expect(alpha[0]).toBe(0);
    expect(alpha[1]).toBe(128);
  });
});

describe("what a player actually sees", () => {
  it("measures the drawn pixels, not the sprite's empty margin", () => {
    const size = { width: 8, height: 8 };
    const rgba = new Uint8ClampedArray(8 * 8 * 4);
    for (const [x, y] of [
      [2, 3],
      [5, 3],
      [3, 6],
    ]) {
      rgba[(y * 8 + x) * 4 + 3] = 255;
    }
    expect(visibleBounds(rgba, size)).toEqual({ x: 2, y: 3, width: 4, height: 4 });
    expect(visibleBounds(new Uint8ClampedArray(8 * 8 * 4), size)).toBeNull();
  });
});
