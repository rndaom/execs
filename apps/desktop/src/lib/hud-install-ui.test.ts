import { describe, expect, it } from "vitest";
import type { HudCatalogEntry } from "./bridge";
import { applyHudInstallProgress, hudInstallDetail, startHudInstall } from "./hud-install-ui";

const entry = {
  id: "rayshud",
  name: "rayshud",
  author: "raysfire",
  banner: null,
  install: "github",
} as unknown as HudCatalogEntry;

describe("HUD install overlay", () => {
  it("starts without inventing a step and follows backend steps forward only", () => {
    let run = startHudInstall(entry, "install");
    expect(run.step).toBeNull();
    expect(hudInstallDetail(run)).toBe("Starting…");
    run = applyHudInstallProgress(run, { id: "RaysHUD", step: "downloading" }) ?? run;
    expect(hudInstallDetail(run)).toBe("Downloading from GitHub.");
    run = applyHudInstallProgress(run, { id: "rayshud", step: "installing" }) ?? run;
    expect(run.step).toBe("installing");
    expect(applyHudInstallProgress(run, { id: "rayshud", step: "checking" })).toBe(run);
  });

  it("ignores another HUD's progress", () => {
    const run = startHudInstall(entry, "install");
    expect(applyHudInstallProgress(run, { id: "toonhud", step: "downloading" })).toBe(run);
    expect(applyHudInstallProgress(null, { id: "rayshud", step: "downloading" })).toBeNull();
  });
});
