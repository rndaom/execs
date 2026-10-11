// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AppStatusProvider } from "./hooks/useAppStatus";
import type { Api } from "./lib/api";
import type { HudCatalogEntry, ProfileLibrary, SetupOverview } from "./lib/bridge";
import { SetupsHome } from "./SetupsHome";

let box: HTMLDivElement;
let root: Root;

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  box = document.createElement("div");
  document.body.append(box);
  root = createRoot(box);
});

afterEach(async () => {
  await act(async () => root.unmount());
  box.remove();
  vi.unstubAllGlobals();
});

const LIBRARY: ProfileLibrary = {
  initialized: true,
  usable: true,
  rootMismatch: false,
  tf2Root: "/tf2",
  confirmedRoot: "/tf2",
  activeProfileId: "main",
  profiles: [
    { id: "main", name: "Main", createdAt: "1", updatedAt: "1" },
    { id: "casual", name: "Casual", createdAt: "1", updatedAt: "1" },
    { id: "plain", name: "Plain", createdAt: "1", updatedAt: "1" },
  ],
};

const OVERVIEWS: SetupOverview[] = [
  {
    id: "main",
    hud: "rayshud",
    crosshair: "dot",
    fov: "90",
    sensitivity: "2.5",
    hitSound: "Quake hit",
    killSound: "Bell",
    performance: "high",
    mods: 2,
  },
  {
    id: "casual",
    hud: "flawhud",
    crosshair: "dot",
    fov: "90",
    sensitivity: "1.8",
    hitSound: "Quake hit",
    killSound: null,
    performance: "medium_low",
    mods: 0,
  },
  {
    id: "plain",
    hud: null,
    crosshair: null,
    fov: "110",
    sensitivity: "2.5",
    hitSound: null,
    killSound: null,
    performance: null,
    mods: 4,
  },
];

function hud(id: string, name: string, screenshots: string[]): HudCatalogEntry {
  return {
    id,
    name,
    author: "",
    repo: "",
    hash: "",
    github: true,
    install: "github",
    flags: [],
    banner: null,
    screenshots,
    album: null,
    comfigUrl: "",
  };
}

const CATALOG = [
  hud("rayshud", "Ray's HUD", ["https://img.test/ray.webp"]),
  hud("flawhud", "flawhud", []),
];

function makeApi({
  overviews = OVERVIEWS,
  fail = false,
}: {
  overviews?: SetupOverview[];
  fail?: boolean;
} = {}) {
  return {
    getSetupOverviews: vi.fn(async () => {
      if (fail) throw new Error("unreadable");
      return overviews;
    }),
    getCachedHudCatalog: vi.fn(async () => ({ entries: CATALOG, warning: null })),
  } as unknown as Api;
}

type Options = {
  api?: Api;
  library?: ProfileLibrary;
  running?: boolean;
  busy?: boolean;
  launching?: boolean;
  launchBlockReason?: string | null;
  recoveryTargetId?: string | null;
};

function handlers() {
  return {
    onSwitch: vi.fn(),
    onSwitchAndPlay: vi.fn(),
    onPlay: vi.fn(),
    onEdit: vi.fn(),
    onCreateNew: vi.fn(),
    onCompare: vi.fn(),
  };
}

async function show(options: Options = {}, on = handlers()) {
  const api = options.api ?? makeApi();
  const view = (next: Options) => (
    <AppStatusProvider
      value={{
        error: null,
        setError: vi.fn(),
        busy: next.busy ?? false,
        running: next.running ?? false,
      }}
    >
      <SetupsHome
        api={api}
        library={next.library ?? LIBRARY}
        launching={next.launching ?? false}
        launchBlockReason={next.launchBlockReason ?? null}
        recoveryTargetId={next.recoveryTargetId ?? null}
        {...on}
      />
    </AppStatusProvider>
  );
  await act(async () => root.render(view(options)));
  return {
    api,
    on,
    rerender: (next: Options) => act(async () => root.render(view({ ...options, ...next }))),
  };
}

const q = (selector: string) => box.querySelector<HTMLElement>(selector);
const text = (selector: string) => q(selector)?.textContent?.trim() ?? null;
const item = (id: string) => q(`[data-testid="setup-item-${id}"]`);
const fact = (key: string) => q(`[data-testid="setups-fact-${key}"]`);
const click = (element: Element | null) => act(async () => (element as HTMLElement).click());
const key = (element: Element | null, name: string) =>
  act(async () =>
    element?.dispatchEvent(new KeyboardEvent("keydown", { key: name, bubbles: true })),
  );

describe("the list", () => {
  it("lists every setup with its HUD, marks the one in the game and ends with New setup", async () => {
    await show();
    const items = Array.from(box.querySelectorAll("[data-setup-id]"));
    expect(items.map((element) => element.querySelector("b")?.textContent)).toEqual([
      "Main",
      "Casual",
      "Plain",
    ]);
    expect(item("main")?.textContent).toContain("In the game");
    expect(item("casual")?.textContent).toContain("flawhud");
    expect(item("plain")?.textContent).toContain("TF2's own");
    const buttons = Array.from(box.querySelectorAll(".setups-list > button"));
    expect(buttons.at(-1)?.textContent).toContain("New setup");
    expect(text(".setups-count")).toBe("3");
  });

  it("opens on the setup in the game and moves the selection on click", async () => {
    await show();
    expect(item("main")?.getAttribute("aria-current")).toBe("true");
    expect(text(".setups-name")).toBe("Main");

    await click(item("casual"));
    expect(item("casual")?.getAttribute("aria-current")).toBe("true");
    expect(item("main")?.getAttribute("aria-current")).toBeNull();
    expect(text(".setups-name")).toBe("Casual");
    expect(q("[data-testid='setups-show']")?.getAttribute("aria-label")).toBe("Casual");
  });

  it("moves the selection with the arrow keys and keeps focus on it", async () => {
    await show();
    item("main")?.focus();
    await key(item("main"), "ArrowDown");
    expect(text(".setups-name")).toBe("Casual");
    expect(document.activeElement).toBe(item("casual"));
    await key(item("casual"), "ArrowDown");
    expect(text(".setups-name")).toBe("Plain");
    // The ends stop rather than wrap or reach New setup.
    await key(item("plain"), "ArrowDown");
    expect(text(".setups-name")).toBe("Plain");
    expect(document.activeElement).toBe(item("plain"));
    await key(item("plain"), "ArrowUp");
    await key(item("casual"), "ArrowUp");
    await key(item("main"), "ArrowUp");
    expect(text(".setups-name")).toBe("Main");
  });

  it("keeps the selection when the library changes, and falls back when the setup is gone", async () => {
    const view = await show();
    await click(item("plain"));
    await view.rerender({
      library: { ...LIBRARY, profiles: LIBRARY.profiles.map((p) => ({ ...p, updatedAt: "2" })) },
    });
    expect(text(".setups-name")).toBe("Plain");
    expect(view.api.getSetupOverviews).toHaveBeenCalledTimes(2);

    await view.rerender({
      library: { ...LIBRARY, profiles: LIBRARY.profiles.filter((p) => p.id !== "plain") },
    });
    expect(text(".setups-name")).toBe("Main");
    expect(view.api.getSetupOverviews).toHaveBeenCalledTimes(3);
  });

  it("starts a new setup", async () => {
    const view = await show();
    await click(q("[data-testid='setups-new']"));
    expect(view.on.onCreateNew).toHaveBeenCalledOnce();
  });

  it("cannot start a new setup while busy, while TF2 runs or during recovery", async () => {
    await show({ busy: true });
    expect((q("[data-testid='setups-new']") as HTMLButtonElement).disabled).toBe(true);
    await show({ running: true });
    expect((q("[data-testid='setups-new']") as HTMLButtonElement).disabled).toBe(true);
    await show({ recoveryTargetId: "casual" });
    expect((q("[data-testid='setups-new']") as HTMLButtonElement).disabled).toBe(true);
  });
});

describe("the setup in the game", () => {
  it("offers Edit and Play, with the chip and no comparison", async () => {
    const view = await show();
    expect(text("[data-testid='setups-edit']")).toBe("Edit");
    expect(text("[data-testid='setups-play']")).toBe("Play");
    expect(q("[data-testid='setups-switch']")).toBeNull();
    expect(q("[data-testid='setups-switch-play']")).toBeNull();
    expect(text(".setups-chip")).toBe("In the game now");
    expect(q("[data-testid='setups-compare']")).toBeNull();
    expect(box.querySelectorAll("[data-same]")).toHaveLength(0);

    await click(q("[data-testid='setups-edit']"));
    await click(q("[data-testid='setups-play']"));
    expect(view.on.onEdit).toHaveBeenCalledOnce();
    expect(view.on.onPlay).toHaveBeenCalledOnce();
  });

  it("shows every detail in plain words", async () => {
    await show();
    expect(
      Array.from(box.querySelectorAll("[data-testid^='setups-fact-']")).map((element) => [
        element.querySelector("dt")?.textContent,
        element.querySelector("dd")?.textContent,
      ]),
    ).toEqual([
      ["HUD", "Ray's HUD"],
      ["Crosshair", "Small dot"],
      ["Field of view", "90°"],
      ["Sensitivity", "2.5"],
      ["Hit sound", "Quake hit"],
      ["Kill sound", "Bell"],
      ["Performance", "High"],
      ["Mods", "2 mods"],
    ]);
  });

  it("says why Play is unavailable and shows a running game", async () => {
    const blocked = await show({ launchBlockReason: "Finish preloader recovery in Mods." });
    expect((q("[data-testid='setups-play']") as HTMLButtonElement).disabled).toBe(true);
    expect(text("[data-testid='setups-reason']")).toBe("Finish preloader recovery in Mods.");
    await blocked.rerender({ launchBlockReason: null, running: true });
    const play = q("[data-testid='setups-play']") as HTMLButtonElement;
    expect(play.disabled).toBe(true);
    expect(play.textContent).toBe("TF2 is running");
    expect(q("[data-testid='setups-reason']")).toBeNull();
  });

  it("shows the game starting without a second reason", async () => {
    await show({ launching: true, busy: true });
    const play = q("[data-testid='setups-play']") as HTMLButtonElement;
    expect(play.disabled).toBe(true);
    expect(play.textContent).toContain("Starting TF2");
    expect(q("[data-testid='setups-reason']")).toBeNull();
  });
});

describe("another setup", () => {
  it("offers Switch and Switch and play, not Edit or Play", async () => {
    const view = await show();
    await click(item("casual"));
    expect(text("[data-testid='setups-switch']")).toBe("Switch");
    expect(text("[data-testid='setups-switch-play']")).toBe("Switch and play");
    expect(q("[data-testid='setups-edit']")).toBeNull();
    expect(q("[data-testid='setups-play']")).toBeNull();
    expect(q(".setups-chip")).toBeNull();

    await click(q("[data-testid='setups-switch']"));
    await click(q("[data-testid='setups-switch-play']"));
    expect(view.on.onSwitch).toHaveBeenCalledWith("casual");
    expect(view.on.onSwitchAndPlay).toHaveBeenCalledWith("casual");
  });

  it("counts the changes from the setup in the game and opens the comparison", async () => {
    const view = await show();
    await click(item("casual"));
    const compare = q("[data-testid='setups-compare']");
    expect(compare?.textContent).toBe("5 changes from Main");
    expect(compare?.className).toContain("text-link");
    // The single orange dot sits beside this line.
    expect(compare?.querySelector(".setups-dot")).not.toBeNull();
    await click(compare);
    expect(view.on.onCompare).toHaveBeenCalledWith("casual");

    await click(item("plain"));
    expect(text("[data-testid='setups-compare']")).toBe("7 changes from Main");
  });

  it("dims the details that are the same as in the game, and only those", async () => {
    await show();
    await click(item("casual"));
    const same = Array.from(box.querySelectorAll("[data-same='true']")).map((element) =>
      element.getAttribute("data-testid"),
    );
    expect(same).toEqual(["setups-fact-crosshair", "setups-fact-fov", "setups-fact-hitSound"]);
    expect(fact("hud")?.getAttribute("data-same")).toBeNull();
    expect(fact("hud")?.querySelector("dd")?.textContent).toBe("flawhud");
    expect(fact("performance")?.querySelector("dd")?.textContent).toBe("Medium low");
    expect(fact("killSound")?.querySelector("dd")?.textContent).toBe("TF2's own");
    expect(fact("mods")?.querySelector("dd")?.textContent).toBe("None");
    // Dimming is the only mark: no dot per detail.
    expect(box.querySelectorAll("dl .setups-dot")).toHaveLength(0);
    expect(box.querySelectorAll(".setups-dot:not(.setups-dot-ok)")).toHaveLength(1);
  });

  it("calls a setup identical to the one in the game the same", async () => {
    await show({
      api: makeApi({ overviews: [OVERVIEWS[0], { ...OVERVIEWS[0], id: "casual" }, OVERVIEWS[2]] }),
    });
    await click(item("casual"));
    expect(text("[data-testid='setups-compare']")).toBe("Same as Main");
    expect(q("[data-testid='setups-compare'] .setups-dot")).toBeNull();
    expect(box.querySelectorAll("[data-same='true']")).toHaveLength(8);
  });

  it("says one short line why switching is impossible while TF2 runs", async () => {
    const view = await show({ running: true });
    await click(item("casual"));
    expect((q("[data-testid='setups-switch']") as HTMLButtonElement).disabled).toBe(true);
    expect((q("[data-testid='setups-switch-play']") as HTMLButtonElement).disabled).toBe(true);
    expect(text("[data-testid='setups-reason']")).toBe("Close TF2 to switch.");

    await view.rerender({ running: false, busy: true });
    expect((q("[data-testid='setups-switch']") as HTMLButtonElement).disabled).toBe(true);
    expect(text("[data-testid='setups-reason']")).toBe("Wait for the current operation to finish.");
    expect((q("[data-testid='setups-compare']") as HTMLButtonElement).disabled).toBe(true);

    await view.rerender({ running: false, busy: false });
    expect((q("[data-testid='setups-switch']") as HTMLButtonElement).disabled).toBe(false);
    expect(q("[data-testid='setups-reason']")).toBeNull();
  });

  it("only lets an interrupted switch finish on its own setup", async () => {
    await show({ recoveryTargetId: "casual" });
    await click(item("plain"));
    expect((q("[data-testid='setups-switch']") as HTMLButtonElement).disabled).toBe(true);
    expect(text("[data-testid='setups-reason']")).toBe("Finish the interrupted switch first.");
    await click(item("casual"));
    expect((q("[data-testid='setups-switch']") as HTMLButtonElement).disabled).toBe(false);
  });

  it("does not offer a switch to a setup whose folders TF2 cannot mount", async () => {
    await show({
      library: {
        ...LIBRARY,
        profiles: LIBRARY.profiles.map((profile) =>
          profile.id === "casual" ? { ...profile, unsafeCustomFolders: ["materials"] } : profile,
        ),
      },
    });
    await click(item("casual"));
    expect((q("[data-testid='setups-switch']") as HTMLButtonElement).disabled).toBe(true);
    expect(text("[data-testid='setups-reason']")).toBe("Repair this setup's folder names first.");
  });
});

describe("the picture", () => {
  it("shows the HUD's first screenshot", async () => {
    await show();
    const image = q(".setups-shot img") as HTMLImageElement;
    expect(image.getAttribute("src")).toBe("https://img.test/ray.webp");
    expect(image.getAttribute("alt")).toBe("Ray's HUD screenshot");
    expect(q(".setups-shot")?.getAttribute("data-empty")).toBeNull();
    // The list carries the same picture, small.
    expect(item("main")?.querySelector("img")?.getAttribute("src")).toBe(
      "https://img.test/ray.webp",
    );
  });

  it("shows a flat block with a short label where there is no picture", async () => {
    await show();
    await click(item("plain"));
    expect(q(".setups-shot img")).toBeNull();
    expect(q(".setups-shot")?.getAttribute("data-empty")).toBe("true");
    expect(text(".setups-shot")).toBe("TF2's own HUD");

    await click(item("casual"));
    expect(q(".setups-shot img")).toBeNull();
    expect(text(".setups-shot")).toBe("flawhud");
  });

  it("falls back to the flat block when the image will not load", async () => {
    await show();
    await act(async () => q(".setups-shot img")?.dispatchEvent(new Event("error")));
    expect(q(".setups-shot img")).toBeNull();
    expect(text(".setups-shot")).toBe("Ray's HUD");
  });

  it("still lists setups when the HUD catalog cannot be read", async () => {
    const api = makeApi();
    (api.getCachedHudCatalog as unknown as ReturnType<typeof vi.fn>).mockRejectedValue(
      new Error("unreadable"),
    );
    await show({ api });
    expect(fact("hud")?.querySelector("dd")?.textContent).toBe("rayshud");
    expect(q(".setups-shot img")).toBeNull();
    expect(item("casual")).not.toBeNull();
  });

  it("uses only the saved catalog and shows HUD ids before one exists", async () => {
    const api = makeApi();
    (api.getCachedHudCatalog as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(null);
    const fetchCatalog = vi.fn();
    (api as unknown as { getHudCatalog: unknown }).getHudCatalog = fetchCatalog;
    await show({ api });
    expect(fact("hud")?.querySelector("dd")?.textContent).toBe("rayshud");
    expect(q(".setups-shot img")).toBeNull();
    expect(fetchCatalog).not.toHaveBeenCalled();
  });
});

describe("loading", () => {
  it("lays out the page before the details arrive", async () => {
    let resolve: (list: SetupOverview[]) => void = () => {};
    const api = makeApi();
    (api.getSetupOverviews as unknown as ReturnType<typeof vi.fn>).mockReturnValue(
      new Promise<SetupOverview[]>((done) => {
        resolve = done;
      }),
    );
    await show({ api });
    expect(item("main")).not.toBeNull();
    expect(text(".setups-name")).toBe("Main");
    expect(q("[data-testid='setups-sub']")?.textContent).toContain("Loading");
    expect(q("[data-testid='setups-facts']")?.getAttribute("aria-busy")).toBe("true");
    expect(fact("hud")?.querySelector("dd")?.textContent?.trim()).toBe("");

    await act(async () => resolve(OVERVIEWS));
    expect(q("[data-testid='setups-sub']")?.textContent).not.toContain("Loading");
    expect(q("[data-testid='setups-facts']")?.getAttribute("aria-busy")).toBe("false");
    expect(fact("hud")?.querySelector("dd")?.textContent).toBe("Ray's HUD");
  });

  it("keeps the list working and says so when the details cannot be read", async () => {
    const view = await show({ api: makeApi({ fail: true }) });
    expect(text("[data-testid='setups-sub']")).toBe("Could not read the details.");
    expect(fact("hud")?.querySelector("dd")?.textContent?.trim()).toBe("");
    await click(item("casual"));
    expect(text(".setups-name")).toBe("Casual");
    expect(q("[data-testid='setups-compare']")).toBeNull();
    await click(q("[data-testid='setups-switch']"));
    expect(view.on.onSwitch).toHaveBeenCalledWith("casual");
  });
});
