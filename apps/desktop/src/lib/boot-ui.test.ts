import { describe, expect, it } from "vitest";
import { BOOT_MAX_MS, type BootInput, bootRemaining, bootStage } from "./boot-ui";

const READY: BootInput = {
  screen: "ready",
  scanning: false,
  libraryLoaded: true,
  surface: "ready",
  settingsOpen: true,
  settingsSettled: true,
  paneLabel: "Comfig",
  failed: false,
};

describe("bootStage", () => {
  it("waits for the install lookup, then shows the finder with its results", () => {
    expect(bootStage({ ...READY, screen: "finder", scanning: true })).toEqual({
      settled: false,
      status: "Looking for Team Fortress 2…",
    });
    expect(bootStage({ ...READY, screen: "finder" }).settled).toBe(true);
  });

  it("names each real read in order for a saved install", () => {
    expect(bootStage({ ...READY, libraryLoaded: false }).status).toBe("Reading your profiles…");
    expect(bootStage({ ...READY, surface: "loading" }).status).toBe("Checking this install…");
    expect(bootStage({ ...READY, settingsSettled: false }).status).toBe("Loading Comfig…");
    expect(bootStage(READY).settled).toBe(true);
  });

  it("does not wait for panes that will not show", () => {
    expect(bootStage({ ...READY, settingsOpen: false, settingsSettled: false }).settled).toBe(true);
  });

  it("gives way to the failure screen", () => {
    expect(bootStage({ ...READY, libraryLoaded: false, failed: true }).settled).toBe(true);
  });
});

describe("bootRemaining", () => {
  it("keeps a settled screen up for the minimum only", () => {
    expect(bootRemaining({ settled: true, status: "" }, 400, 1100)).toBe(700);
    expect(bootRemaining({ settled: true, status: "" }, 2000, 1100)).toBe(0);
  });

  it("never holds an unsettled start past the cap", () => {
    expect(bootRemaining({ settled: false, status: "x" }, 1000, 1100)).toBe(BOOT_MAX_MS - 1000);
    expect(bootRemaining({ settled: false, status: "x" }, BOOT_MAX_MS + 5, 1100)).toBe(0);
  });
});
