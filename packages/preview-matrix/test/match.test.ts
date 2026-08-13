import { describe, expect, it } from "vitest";
import { matchPreview, matrix, moduleImageKey, tierImageKey } from "../src/index.ts";

describe("matrix data integrity", () => {
  it("every tier vector covers every module with a valid level", () => {
    for (const tier of matrix.tiers) {
      for (const module of matrix.modules) {
        expect(
          module.levels,
          `tier ${tier.id} module ${module.id}`,
        ).toContain(tier.vector[module.id]);
      }
    }
  });

  it("every cvar rule level exists in its module's levels", () => {
    for (const module of matrix.modules) {
      for (const rule of module.cvarRules) {
        expect(module.levels).toContain(rule.level);
      }
    }
  });
});

describe("matchPreview", () => {
  it("returns null for configs touching no visual modules", () => {
    expect(matchPreview({ moduleLevels: {}, effective: { cl_interp: "0.0152" } })).toBeNull();
  });

  it("matches an aggressive performance config to the low tier", () => {
    const match = matchPreview({
      moduleLevels: {},
      effective: {
        r_shadows: "0",
        mat_picmip: "2",
        mat_phong: "0",
        mat_specular: "0",
        r_waterdrawreflection: "0",
        r_rootlod: "2",
        violence_hgibs: "0",
        cl_ragdoll_physics_enable: "0",
      },
    });
    expect(match?.tier).toBe("low");
    expect(match?.confidence).toBe(1);
    expect(match?.moduleLevels.shadows).toBe("off");
  });

  it("matches a max-quality config to ultra", () => {
    const match = matchPreview({
      moduleLevels: {},
      effective: {
        r_shadows: "1",
        r_shadowrendertotexture: "1",
        mat_picmip: "-1",
        mat_phong: "1",
        r_waterdrawreflection: "1",
        r_rootlod: "0",
        violence_hgibs: "1",
        cl_ragdoll_physics_enable: "1",
      },
    });
    expect(match?.tier).toBe("ultra");
  });

  it("prefers explicit mastercomfig module levels over raw cvars", () => {
    const match = matchPreview({
      moduleLevels: { texture_quality: "ultra", shadows: "off" },
      // Contradictory cvar — the module declaration wins.
      effective: { mat_picmip: "2" },
    });
    expect(match?.moduleLevels.textures).toBe("ultra");
    expect(match?.moduleLevels.shadows).toBe("off");
  });

  it("translates mastercomfig level vocab (medium gibs -> on)", () => {
    const match = matchPreview({
      moduleLevels: { gibs: "medium", ragdolls: "off" },
      effective: {},
    });
    expect(match?.moduleLevels.gibs).toBe("on");
    expect(match?.moduleLevels.ragdolls).toBe("off");
  });

  it("resolves a single lone cvar without contradiction", () => {
    const match = matchPreview({ moduleLevels: {}, effective: { r_shadows: "0" } });
    expect(match?.moduleLevels.shadows).toBe("off");
    expect(match?.confidence).toBeCloseTo(1 / matrix.modules.length);
  });

  it("leaves contradicted modules unresolved rather than guessing", () => {
    // r_shadows 1 alone satisfies parts of both low and high rules equally —
    // whichever wins must not be "off".
    const match = matchPreview({ moduleLevels: {}, effective: { r_shadows: "1" } });
    expect(match?.moduleLevels.shadows).not.toBe("off");
  });

  it("mid-range config lands between low and high", () => {
    const match = matchPreview({
      moduleLevels: {},
      effective: {
        r_shadows: "1",
        r_shadowrendertotexture: "0",
        mat_picmip: "1",
        mat_phong: "0",
        mat_specular: "1",
      },
    });
    expect(["medium", "medium-low"]).toContain(match?.tier);
  });
});

describe("image keys", () => {
  it("builds versioned R2 keys", () => {
    expect(tierImageKey("s1", "high", 1600)).toBe("preview-matrix/v1/s1/tier/high_1600.webp");
    expect(moduleImageKey("s1", "shadows", "off", 800)).toBe(
      "preview-matrix/v1/s1/module/shadows-off_800.webp",
    );
  });
});
