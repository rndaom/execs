import { describe, expect, it } from "vitest";
import { hexToRgb, rgbToHex } from "./color";

describe("colour conversion", () => {
  it("round-trips a hex colour", () => {
    expect(rgbToHex(0, 153, 255)).toBe("#0099ff");
    expect(hexToRgb("#0099ff")).toEqual({ r: 0, g: 153, b: 255 });
    expect(hexToRgb("0099FF")).toEqual({ r: 0, g: 153, b: 255 });
    expect(hexToRgb("  #cf6a32 ")).toEqual({ r: 207, g: 106, b: 50 });
  });

  it("rejects anything that is not a six-digit hex colour", () => {
    expect(hexToRgb("#fff")).toBeNull();
    expect(hexToRgb("rebeccapurple")).toBeNull();
    expect(hexToRgb("")).toBeNull();
  });

  it("clamps and rounds out-of-range channels", () => {
    expect(rgbToHex(-5, 255.4, 300)).toBe("#00ffff");
  });
});
