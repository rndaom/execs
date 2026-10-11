import { describe, expect, it } from "vitest";
import type { HudCatalogEntry, ProfileLibrary, SetupOverview } from "./bridge";
import {
  changeSummary,
  differingFacts,
  factValue,
  hudLabel,
  hudPicture,
  libraryKey,
  modsLabel,
  performanceLabel,
  playBlockedReason,
  resolveSelection,
  SETUP_FACTS,
  stepSelection,
  switchBlockedReason,
} from "./setups-ui";

function overview(patch: Partial<SetupOverview> = {}): SetupOverview {
  return {
    id: "main",
    hud: "rayshud",
    crosshair: "dot",
    crosshairDesign: null,
    fov: "90",
    sensitivity: "2.5",
    hitSound: "Quake hit",
    killSound: "Bell",
    performance: "high",
    mods: 2,
    ...patch,
  };
}

function hudEntry(patch: Partial<HudCatalogEntry>): HudCatalogEntry {
  return {
    id: "rayshud",
    name: "rayshud",
    author: "Ray",
    repo: "",
    hash: "",
    github: true,
    install: "github",
    flags: [],
    banner: null,
    screenshots: [],
    album: null,
    comfigUrl: "",
    ...patch,
  };
}

function library(patch: Partial<ProfileLibrary> = {}): ProfileLibrary {
  return {
    initialized: true,
    usable: true,
    rootMismatch: false,
    tf2Root: "/tf2",
    confirmedRoot: "/tf2",
    activeProfileId: "a",
    profiles: [
      { id: "a", name: "Main", createdAt: "1", updatedAt: "1" },
      { id: "b", name: "Comp", createdAt: "1", updatedAt: "2" },
      { id: "c", name: "Fun", createdAt: "1", updatedAt: "3" },
    ],
    ...patch,
  };
}

describe("fact values", () => {
  const catalog = [
    hudEntry({ id: "rayshud", name: "Ray's HUD", screenshots: ["https://img/ray-1.webp"] }),
    hudEntry({ id: "flawhud", name: "flawhud", banner: "https://img/flaw-banner.webp" }),
    hudEntry({ id: "123", name: "123" }),
  ];

  it("names a HUD from the catalog, else shows what the profile has", () => {
    expect(hudLabel("rayshud", catalog)).toBe("Ray's HUD");
    expect(hudLabel("RayShud", catalog)).toBe("Ray's HUD");
    expect(hudLabel("123", catalog)).toBe("Untitled HUD");
    expect(hudLabel("my-own-folder", catalog)).toBe("my-own-folder");
    expect(hudLabel(null, catalog)).toBe("TF2's own");
  });

  it("prefers an in-game screenshot, then the banner, else no picture", () => {
    expect(hudPicture("rayshud", catalog)).toBe("https://img/ray-1.webp");
    const bannerFirst = hudEntry({
      id: "bud",
      banner: "https://img/bud/logo.webp",
      screenshots: [
        "https://img/bud/logo.webp",
        "https://img/bud/bud-banner.webp",
        "https://img/bud/menu.webp",
        "https://img/bud/play.webp",
      ],
    });
    expect(hudPicture("bud", [bannerFirst])).toBe("https://img/bud/play.webp");
    expect(
      hudPicture("bud", [{ ...bannerFirst, screenshots: bannerFirst.screenshots.slice(0, 3) }]),
    ).toBe("https://img/bud/menu.webp");
    expect(
      hudPicture("bud", [{ ...bannerFirst, screenshots: ["https://img/bud/logo.webp"] }]),
    ).toBe("https://img/bud/logo.webp");
    expect(hudPicture("flawhud", catalog)).toBe("https://img/flaw-banner.webp");
    expect(hudPicture("123", catalog)).toBeNull();
    expect(hudPicture("unknown", catalog)).toBeNull();
    expect(hudPicture(null, catalog)).toBeNull();
  });

  it("says mastercomfig presets in words", () => {
    expect(performanceLabel("high")).toBe("High");
    expect(performanceLabel("medium_low")).toBe("Medium low");
    expect(performanceLabel("very-low")).toBe("Very low");
    expect(performanceLabel("none")).toBe("Custom");
    expect(performanceLabel(null)).toBe("Off");
  });

  it("counts mods", () => {
    expect(modsLabel(0)).toBe("None");
    expect(modsLabel(1)).toBe("1 mod");
    expect(modsLabel(5)).toBe("5 mods");
  });

  it("formats every fact, leaving unset parts as TF2's own", () => {
    const value = (key: (typeof SETUP_FACTS)[number]["key"], patch?: Partial<SetupOverview>) =>
      factValue(key, overview(patch), catalog);
    expect(value("hud")).toBe("Ray's HUD");
    expect(value("crosshair")).toBe("Small dot");
    expect(value("crosshair", { crosshair: "design-my-ring" })).toBe("My ring");
    const named = JSON.stringify({ style: "ring", label: "Tournament ring" });
    expect(value("crosshair", { crosshair: "design-my-ring", crosshairDesign: named })).toBe(
      "Tournament ring",
    );
    expect(value("crosshair", { crosshair: "designed", crosshairDesign: named })).toBe(
      "Tournament ring",
    );
    expect(value("crosshair", { crosshair: "designed" })).toBe("My crosshair");
    expect(value("fov")).toBe("90°");
    expect(value("fov", { fov: "90.0" })).toBe("90°");
    expect(value("sensitivity", { sensitivity: "1.800000" })).toBe("1.8");
    expect(value("hitSound")).toBe("Quake hit");
    expect(value("hitSound", { hitSound: "hit_ding.wav" })).toBe("Hit ding");
    expect(value("killSound")).toBe("Bell");
    expect(value("performance")).toBe("High");
    expect(value("mods")).toBe("2 mods");

    const bare = {
      hud: null,
      crosshair: null,
      crosshairDesign: null,
      fov: null,
      sensitivity: null,
      hitSound: null,
      killSound: null,
      performance: null,
      mods: 0,
    };
    const labels = SETUP_FACTS.map((fact) => value(fact.key, bare));
    expect(labels).toEqual([
      "TF2's own",
      "TF2's own",
      "TF2's own",
      "TF2's own",
      "TF2's own",
      "TF2's own",
      "Off",
      "None",
    ]);
  });

  it("keeps a field of view that is not a number as written", () => {
    expect(factValue("fov", overview({ fov: "wide" }), [])).toBe("wide");
  });
});

describe("differences from the setup in the game", () => {
  it("lists nothing for an identical setup", () => {
    expect(differingFacts(overview({ id: "other" }), overview())).toEqual([]);
  });

  it("lists each fact that differs, in page order", () => {
    const other = overview({ hud: null, sensitivity: "1.8", killSound: null, mods: 0 });
    expect(differingFacts(other, overview())).toEqual(["hud", "sensitivity", "killSound", "mods"]);
  });

  it("treats the same number written two ways, and the same HUD in another case, as equal", () => {
    const other = overview({
      fov: "90.0",
      sensitivity: "2.50",
      hud: "RaysHUD",
      performance: "HIGH",
    });
    expect(differingFacts(other, overview({ hud: "rayshud" }))).toEqual([]);
  });

  it("counts a part set against a part left alone as different", () => {
    expect(differingFacts(overview({ crosshair: null }), overview())).toEqual(["crosshair"]);
    expect(differingFacts(overview({ fov: null }), overview({ fov: null }))).toEqual([]);
    expect(differingFacts(overview({ fov: "wide" }), overview({ fov: "90" }))).toEqual(["fov"]);
  });

  it("tells two different designs saved under the same name apart", () => {
    const design = (label: string) =>
      overview({ crosshair: "designed", crosshairDesign: JSON.stringify({ style: "dot", label }) });
    expect(differingFacts(design("A"), design("B"))).toEqual(["crosshair"]);
    expect(differingFacts(design("A"), design("A"))).toEqual([]);
  });

  it("summarises the count against the active setup's name", () => {
    expect(changeSummary(3, "Main")).toBe("3 changes from Main");
    expect(changeSummary(1, "Main")).toBe("1 change from Main");
    expect(changeSummary(0, "Main")).toBe("Same as Main");
  });
});

describe("library and selection", () => {
  it("changes its key when a setup is added, saved over or made active", () => {
    const base = libraryKey(library());
    expect(libraryKey(library())).toBe(base);
    expect(libraryKey(library({ activeProfileId: "b" }))).not.toBe(base);
    expect(
      libraryKey(
        library({
          profiles: [
            { id: "a", name: "Main", createdAt: "1", updatedAt: "9" },
            ...library().profiles.slice(1),
          ],
        }),
      ),
    ).not.toBe(base);
    expect(libraryKey(library({ profiles: library().profiles.slice(0, 2) }))).not.toBe(base);
    expect(libraryKey(null)).toBe("");
  });

  it("keeps the chosen setup while it exists, else the one in the game, else the first", () => {
    expect(resolveSelection(library(), "b")).toBe("b");
    expect(resolveSelection(library(), null)).toBe("a");
    expect(resolveSelection(library(), "deleted")).toBe("a");
    expect(resolveSelection(library({ activeProfileId: null }), "deleted")).toBe("a");
    expect(resolveSelection(library({ activeProfileId: "gone" }), null)).toBe("a");
    expect(resolveSelection(library({ profiles: [] }), "a")).toBeNull();
    expect(resolveSelection(null, "a")).toBeNull();
  });

  it("steps through the list and stops at the ends", () => {
    const ids = ["a", "b", "c"];
    expect(stepSelection(ids, "a", 1)).toBe("b");
    expect(stepSelection(ids, "c", 1)).toBe("c");
    expect(stepSelection(ids, "a", -1)).toBe("a");
    expect(stepSelection(ids, "c", -1)).toBe("b");
    expect(stepSelection(ids, null, 1)).toBe("a");
    expect(stepSelection([], "a", 1)).toBeNull();
  });
});

describe("why an action is unavailable", () => {
  const free = { running: false, busy: false, recoveryPending: false, isRecoveryTarget: false };

  it("allows a switch when nothing is in the way", () => {
    expect(switchBlockedReason({ ...free, unsafeFolders: false })).toBeNull();
  });

  it("gives one reason, the most important first", () => {
    expect(switchBlockedReason({ ...free, running: true, busy: true, unsafeFolders: true })).toBe(
      "Close TF2 to switch.",
    );
    expect(switchBlockedReason({ ...free, busy: true, unsafeFolders: true })).toBe(
      "Wait for the current operation to finish.",
    );
    expect(switchBlockedReason({ ...free, recoveryPending: true, unsafeFolders: false })).toBe(
      "Finish the interrupted switch first.",
    );
    expect(switchBlockedReason({ ...free, unsafeFolders: true })).toBe(
      "Repair this setup's folder names first.",
    );
  });

  it("lets an interrupted switch finish on its own target", () => {
    expect(
      switchBlockedReason({
        ...free,
        recoveryPending: true,
        isRecoveryTarget: true,
        unsafeFolders: false,
      }),
    ).toBeNull();
  });

  it("explains a blocked launch with the app's own reason first", () => {
    const open = {
      launchBlockReason: null,
      busy: false,
      recoveryPending: false,
      unsafeFolders: false,
    };
    expect(playBlockedReason(open)).toBeNull();
    expect(
      playBlockedReason({ ...open, launchBlockReason: "Wait for the update.", busy: true }),
    ).toBe("Wait for the update.");
    expect(playBlockedReason({ ...open, busy: true })).toBe(
      "Wait for the current operation to finish.",
    );
    expect(playBlockedReason({ ...open, recoveryPending: true })).toBe(
      "Finish the interrupted switch first.",
    );
    expect(playBlockedReason({ ...open, unsafeFolders: true })).toBe(
      "Repair the folder names first.",
    );
  });
});
