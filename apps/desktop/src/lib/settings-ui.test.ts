import { describe, expect, it, vi } from "vitest";
import { emptyLibrary, previewSavedLibrary } from "./library-ui";
import {
  canWriteSettings,
  editLabel,
  readLastPane,
  SETTINGS_TAB_GROUPS,
  SETTINGS_TAB_LABELS,
  SETTINGS_TABS,
  SETUP_GROUPS,
  showSettingsChrome,
  writeLastPane,
} from "./settings-ui";

describe("settings chrome", () => {
  it("includes the HUD and later-studio tabs in the settings chrome", () => {
    expect(SETTINGS_TABS).toContain("hud");
    expect(SETTINGS_TABS).toContain("crosshair");
    expect(SETTINGS_TABS).toContain("viewmodels");
    expect(SETTINGS_TAB_LABELS.hud).toBe("HUD");
    expect(SETTINGS_TAB_LABELS.crosshair).toBe("Crosshair");
    expect(SETTINGS_TAB_LABELS.viewmodels).toBe("Viewmodels");
  });

  it("lists every tab, including Inventory, in production builds", async () => {
    vi.stubEnv("DEV", false);
    vi.resetModules();
    try {
      const production = await import("./settings-ui");
      expect(production.SETTINGS_TAB_GROUPS.flatMap((group) => group.tabs)).toEqual([
        ...SETTINGS_TABS,
      ]);
      expect(production.SETTINGS_TAB_GROUPS.at(-1)).toEqual({
        label: "Steam",
        tabs: ["inventory"],
      });
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it("groups the sidebar like the Edit page, without headings that repeat a pane's name", () => {
    expect(SETUP_GROUPS.map((group) => group.label)).toEqual([
      "Look",
      "Feel",
      "Sound",
      "Mods",
      "Performance",
      "Advanced",
    ]);
    expect(SETTINGS_TAB_GROUPS).toEqual([
      { label: "Look", tabs: ["hud", "crosshair", "viewmodels"] },
      { label: "Feel", tabs: ["gameplay", "binds"] },
      { label: "", tabs: ["sounds", "mods", "comfig"] },
      { label: "Advanced", tabs: ["files", "launch"] },
      { label: "Steam", tabs: ["inventory"] },
    ]);
    expect(SETTINGS_TAB_LABELS.comfig).toBe("Performance");
  });

  it("names the Edit page after the setup in the game", () => {
    expect(editLabel("FPS")).toBe("Edit FPS");
    expect(editLabel("  ")).toBe("Edit");
    expect(editLabel(null)).toBe("Edit");
  });

  it("shows only when a usable library has an active profile", () => {
    expect(showSettingsChrome(null)).toBe(false);
    expect(showSettingsChrome(emptyLibrary("/tf2", true))).toBe(false);
    expect(showSettingsChrome(previewSavedLibrary("/tf2"))).toBe(true);
    expect(
      showSettingsChrome({
        ...previewSavedLibrary("/tf2"),
        usable: false,
        rootMismatch: true,
        activeProfileId: null,
        profiles: [],
      }),
    ).toBe(false);
  });

  it("blocks writes while TF2 is running or busy", () => {
    expect(canWriteSettings(false, false)).toBe(true);
    expect(canWriteSettings(true, false)).toBe(false);
    expect(canWriteSettings(false, true)).toBe(false);
  });
});

describe("the last pane", () => {
  it("reopens a known pane and forgets anything else or a blocked store", () => {
    const store = new Map<string, string>();
    const storage = {
      getItem: (key: string) => store.get(key) ?? null,
      setItem: (key: string, value: string) => void store.set(key, value),
    };
    expect(readLastPane(storage)).toBeNull();
    writeLastPane(storage, "mods");
    expect(readLastPane(storage)).toBe("mods");
    store.set("execs:last-pane", "not-a-pane");
    expect(readLastPane(storage)).toBeNull();
    const blocked = {
      getItem: () => {
        throw new Error("blocked");
      },
      setItem: () => {
        throw new Error("blocked");
      },
    };
    expect(readLastPane(blocked)).toBeNull();
    expect(() => writeLastPane(blocked, "hud")).not.toThrow();
  });
});
