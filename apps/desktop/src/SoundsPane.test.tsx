// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import { ToastProvider } from "./components/ui/Toast";
import { AppStatusProvider } from "./hooks/useAppStatus";
import type { Api } from "./lib/api";
import { SoundsPane } from "./SoundsPane";

it("retries a failed stock read and offers comfig.app but not the retired TF2Hitsounds pack", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal(
    "Audio",
    class {
      pause = vi.fn();
      addEventListener = vi.fn();
      removeEventListener = vi.fn();
    },
  );
  const box = document.createElement("div");
  document.body.append(box);
  const root = createRoot(box);
  const stock = vi
    .fn()
    .mockRejectedValueOnce(new Error("Game archive unavailable"))
    .mockResolvedValue(["hitsound"]);
  const api = {
    comfigHitsoundIndex: async () => [
      { name: "Bell", hash: "b".repeat(128), kind: "hit", order: 0 },
    ],
    listStockHitsounds: stock,
    getHitsoundSources: async () => ({ hits: {}, incomplete: [] }),
  } as unknown as Api;
  try {
    await act(async () =>
      root.render(
        <AppStatusProvider value={{ error: null, setError: vi.fn(), busy: false, running: false }}>
          <SoundsPane
            api={api}
            profileId="A"
            record={null}
            layer="vanilla"
            effective={{}}
            managedText=""
            onSave={async () => {}}
            onRemove={() => {}}
          />
        </AppStatusProvider>,
      ),
    );
    expect(
      box.querySelector(`[data-testid="sounds-row-comfig:${"b".repeat(128)}"]`),
    ).not.toBeNull();
    expect(box.querySelector('[data-testid^="sounds-row-community:"]')).toBeNull();
    expect(box.textContent).not.toContain("TF2Hitsounds");
    expect(box.textContent).toContain("Game archive unavailable");
    const stockBoost = box.querySelector<HTMLInputElement>('[data-testid="sounds-hit-boost-6"]');
    expect(stockBoost?.disabled).toBe(true);
    expect(box.textContent).toContain("Choose your own sound file to boost it.");
    const retry = () =>
      [...box.querySelectorAll("button")].find((button) =>
        button.textContent?.includes("Retry sources"),
      );
    await act(async () => retry()?.click());
    expect(box.querySelector('[data-testid="sounds-stock-error"]')).toBeNull();
    expect(stock).toHaveBeenCalledTimes(2);
    expect(box.querySelector('[data-testid="sounds-row-stock:0"]')).not.toBeNull();
  } finally {
    await act(async () => root.unmount());
    box.remove();
    vi.unstubAllGlobals();
  }
});

it("keeps a retired TF2Hitsounds sound playable without offering its catalog", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal(
    "Audio",
    class {
      pause = vi.fn();
      play = vi.fn(async () => {});
      addEventListener = vi.fn();
      removeEventListener = vi.fn();
    },
  );
  vi.stubGlobal("__TAURI_INTERNALS__", {});
  const box = document.createElement("div");
  document.body.append(box);
  const root = createRoot(box);
  const hitsoundBytes = vi.fn(() => new Promise<ArrayBuffer>(() => {}));
  const api = {
    comfigHitsoundIndex: async () => [],
    listStockHitsounds: async () => ["hitsound"],
    pickHitsoundFile: async () => ({
      token: "a".repeat(32),
      name: "Own Pop.wav",
      converted: false,
      info: {
        formatTag: 1,
        channels: 1,
        sampleRate: 44100,
        bitsPerSample: 16,
        dataBytes: 2,
        durationMs: 1,
      },
    }),
    hitsoundBytes,
    getHitsoundSources: async () => ({ hits: {}, incomplete: [] }),
  } as unknown as Api;
  try {
    await act(async () =>
      root.render(
        <ToastProvider>
          <AppStatusProvider
            value={{ error: null, setError: vi.fn(), busy: false, running: false }}
          >
            <SoundsPane
              api={api}
              profileId="A"
              record={{ hit: { name: "Bubble Pop", source: "community" } }}
              layer="vanilla"
              effective={{}}
              managedText=""
              onSave={async () => {}}
              onRemove={() => {}}
            />
          </AppStatusProvider>
        </ToastProvider>,
      ),
    );
    expect(box.querySelector('[data-testid="sounds-retired-source"]')?.textContent).toContain(
      "It still plays",
    );
    expect(box.querySelector('[data-testid^="sounds-row-community:"]')).toBeNull();
    await act(async () =>
      box.querySelector<HTMLButtonElement>('[data-testid="sounds-choose-file"]')?.click(),
    );
    const own = box.querySelector(
      '[data-testid="sounds-row-own:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"]',
    );
    if (!own) throw new Error("Own WAV row did not load");
    const buttons = [...own.querySelectorAll("button")];
    expect(buttons.map((button) => button.getAttribute("aria-label"))).toEqual([
      "Preview Own Pop.wav (Your file)",
      "Favorite Own Pop.wav (Your file)",
      "Use Own Pop.wav (Your file) for hits",
    ]);
    expect(buttons[2].disabled).toBe(false);
    for (const button of buttons) {
      expect(button.tabIndex).toBe(0);
      button.focus();
      expect(document.activeElement).toBe(button);
    }
    await act(async () => buttons[0].click());
    expect(buttons[0].getAttribute("aria-label")).toBe("Stop Own Pop.wav (Your file)");
    expect(box.querySelector("#sounds-hit-volume")?.getAttribute("aria-label")).toBe(
      "Hit sound volume",
    );
    expect(box.querySelector("#sounds-kill-volume")?.getAttribute("aria-label")).toBe(
      "Kill sound volume",
    );
    expect(box.querySelector('[data-testid="sounds-hit-play"]')?.getAttribute("aria-label")).toBe(
      "Play Bubble Pop (hit sound, Community pack · saved by execs)",
    );
    await act(async () =>
      box.querySelector<HTMLButtonElement>('[data-testid="sounds-hit-play"]')?.click(),
    );
    expect(hitsoundBytes).toHaveBeenLastCalledWith({ kind: "installed", slot: "hit" });
    const customBoost = box.querySelector<HTMLInputElement>('[data-testid="sounds-hit-boost-6"]');
    expect(customBoost?.disabled).toBe(true);
    expect(box.textContent).toContain("Saved catalog sounds keep their boost.");
  } finally {
    await act(async () => root.unmount());
    box.remove();
    vi.unstubAllGlobals();
  }
});

it("discloses competing mounted sound paths without claiming a playback winner", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal(
    "Audio",
    class {
      pause = vi.fn();
      addEventListener = vi.fn();
      removeEventListener = vi.fn();
    },
  );
  const box = document.createElement("div");
  document.body.append(box);
  const root = createRoot(box);
  const api = {
    comfigHitsoundIndex: async () => [],
    listStockHitsounds: async () => ["hitsound"],
    getHitsoundSources: async () => ({
      hits: {
        "sound/ui/hitsound.wav": [
          { pack: "other-hits.vpk", member: "sound/ui/hitsound.wav", kind: "vpk" },
        ],
        "sound/ui/killsound.wav": [
          { pack: "creator", member: "sound/ui/killsound.wav", kind: "loose" },
        ],
      },
      incomplete: ["Could not inspect unreadable.vpk"],
    }),
  } as unknown as Api;
  try {
    await act(async () =>
      root.render(
        <AppStatusProvider value={{ error: null, setError: vi.fn(), busy: false, running: false }}>
          <SoundsPane
            api={api}
            profileId="A"
            record={{ sourceChanged: true, hit: { name: "my hit", source: "file" } }}
            layer="vanilla"
            effective={{}}
            managedText=""
            onSave={async () => {}}
            onRemove={() => {}}
          />
        </AppStatusProvider>,
      ),
    );
    const panel = box.querySelector('[data-testid="sounds-source-conflicts"]');
    expect(panel?.textContent).toContain("tf/custom/other-hits.vpk → sound/ui/hitsound.wav");
    expect(panel?.textContent).toContain("tf/custom/creator/sound/ui/killsound.wav");
    expect(panel?.textContent).toContain("in-game source depends on TF2's mount order");
    expect(box.querySelector('[data-testid="sounds-source-incomplete"]')?.textContent).toContain(
      "Could not inspect unreadable.vpk",
    );
    expect(box.querySelector('[data-testid="sounds-source-changed"]')?.textContent).toContain(
      "Its saved name and source may no longer describe the installed audio",
    );
    expect(box.querySelector('[data-testid="sounds-hit-name"]')?.textContent).toBe("my hit");
  } finally {
    await act(async () => root.unmount());
    box.remove();
    vi.unstubAllGlobals();
  }
});

it("keeps the selected sound visible after an autosave failure", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal(
    "Audio",
    class {
      pause = vi.fn();
      addEventListener = vi.fn();
      removeEventListener = vi.fn();
    },
  );
  const box = document.createElement("div");
  document.body.append(box);
  const root = createRoot(box);
  const onSave = vi.fn(async () => false);
  const api = {
    comfigHitsoundIndex: async () => [],
    listStockHitsounds: async () => ["hitsound"],
    getHitsoundSources: async () => ({ hits: {}, incomplete: [] }),
  } as unknown as Api;
  try {
    await act(async () =>
      root.render(
        <AppStatusProvider value={{ error: null, setError: vi.fn(), busy: false, running: false }}>
          <SoundsPane
            api={api}
            profileId="A"
            record={null}
            layer="vanilla"
            effective={{}}
            managedText=""
            onSave={onSave}
            onRemove={() => {}}
          />
        </AppStatusProvider>,
      ),
    );
    await act(async () =>
      box
        .querySelector('[data-testid="sounds-assign-hit-stock:1"]')
        ?.dispatchEvent(new MouseEvent("click", { bubbles: true })),
    );
    await act(async () => new Promise((resolve) => setTimeout(resolve, 800)));
    expect(onSave).toHaveBeenCalledOnce();
    expect(box.querySelector('[data-testid="sounds-hit-name"]')?.textContent).toBe("Electro");
  } finally {
    await act(async () => root.unmount());
    box.remove();
    vi.unstubAllGlobals();
  }
});

it("shows a dormant saved WAV and restores it without rewriting the sound pack", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal(
    "Audio",
    class {
      pause = vi.fn();
      addEventListener = vi.fn();
      removeEventListener = vi.fn();
    },
  );
  const box = document.createElement("div");
  document.body.append(box);
  const root = createRoot(box);
  const onSave = vi.fn(async (_text: string, _pack: unknown) => true);
  const api = {
    comfigHitsoundIndex: async () => [],
    listStockHitsounds: async () => ["hitsound"],
    getHitsoundSources: async () => ({ hits: {}, incomplete: [] }),
  } as unknown as Api;
  try {
    await act(async () =>
      root.render(
        <AppStatusProvider value={{ error: null, setError: vi.fn(), busy: false, running: false }}>
          <SoundsPane
            api={api}
            profileId="A"
            record={{ hit: { name: "quack", source: "community" } }}
            layer="vanilla"
            effective={{ tf_dingalingaling_effect: "2" }}
            managedText=""
            onSave={onSave}
            onRemove={() => {}}
          />
        </AppStatusProvider>,
      ),
    );
    expect(box.querySelector('[data-testid="sounds-saved-inactive"]')?.textContent).toContain(
      "Saved custom sound files stay in this profile",
    );
    expect(box.querySelector('[data-testid="sounds-hit-name"]')?.textContent).toBe("Notes");
    expect(onSave).not.toHaveBeenCalled();

    await act(async () =>
      box.querySelector<HTMLButtonElement>('[data-testid="sounds-use-saved-hit"]')?.click(),
    );
    expect(box.querySelector('[data-testid="sounds-hit-name"]')?.textContent).toBe("Quack");
    expect(box.querySelector('[data-testid="sounds-saved-inactive"]')).toBeNull();
    await act(async () => new Promise((resolve) => setTimeout(resolve, 800)));
    expect(onSave).toHaveBeenCalledOnce();
    expect(onSave.mock.calls[0]?.[1]).toBeNull();
    expect(onSave.mock.calls[0]?.[0]).toContain("tf_dingalingaling_effect 0");
  } finally {
    await act(async () => root.unmount());
    box.remove();
    vi.unstubAllGlobals();
  }
});

it("browses for the slot that asked and keeps focus on the chosen sound", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal(
    "Audio",
    class {
      pause = vi.fn();
      addEventListener = vi.fn();
      removeEventListener = vi.fn();
    },
  );
  const box = document.createElement("div");
  document.body.append(box);
  const root = createRoot(box);
  const api = {
    comfigHitsoundIndex: async () => [],
    listStockHitsounds: async () => ["hitsound"],
    getHitsoundSources: async () => ({ hits: {}, incomplete: [] }),
  } as unknown as Api;
  const button = (testId: string) => {
    const found = box.querySelector<HTMLButtonElement>(`[data-testid="${testId}"]`);
    if (!found) throw new Error(`Missing ${testId}`);
    return found;
  };
  try {
    await act(async () =>
      root.render(
        <AppStatusProvider value={{ error: null, setError: vi.fn(), busy: false, running: false }}>
          <SoundsPane
            api={api}
            profileId="A"
            record={null}
            layer="vanilla"
            effective={{}}
            managedText=""
            onSave={async () => true}
            onRemove={() => {}}
          />
        </AppStatusProvider>,
      ),
    );
    // One source filter and one sort sit under the role and search.
    expect(box.querySelector('[data-testid="sounds-sort-suggested"]')).not.toBeNull();
    expect(box.querySelector('[data-testid="sounds-filter-all"]')).not.toBeNull();
    expect(button("sounds-hit-browse").getAttribute("aria-label")).toBe("Browse sounds for hits");

    await act(async () => button("sounds-kill-browse").click());
    expect(document.activeElement).toBe(box.querySelector('[data-testid="sounds-search"]'));
    expect(box.querySelector('[data-testid="sounds-assign-hit-stock:1"]')).toBeNull();
    const use = button("sounds-assign-kill-stock:1");
    expect(use.getAttribute("aria-label")).toBe("Use Electro (Built into TF2) for kills");
    use.focus();
    await act(async () => use.click());
    expect(box.querySelector('[data-testid="sounds-kill-name"]')?.textContent).toBe("Electro");
    expect(use.getAttribute("aria-pressed")).toBe("true");
    expect(use.textContent).toBe("Selected");
    // Choosing does not disable the button, so keyboard focus stays in place.
    expect(document.activeElement).toBe(use);
    expect(box.querySelector('[data-testid="sounds-hit-name"]')?.textContent).not.toBe("Electro");

    // The other slot's choice is named on its row.
    await act(async () => button("sounds-target-hit").click());
    expect(box.querySelector('[data-testid="sounds-row-stock:1"]')?.textContent).toContain(
      "Kill sound",
    );

    const search = box.querySelector<HTMLInputElement>('[data-testid="sounds-search"]');
    if (!search) throw new Error("Missing search");
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set?.call(
        search,
        "zzz",
      );
      search.dispatchEvent(new Event("input", { bubbles: true }));
    });
    expect(box.textContent).toContain("No sounds match “zzz”.");
  } finally {
    await act(async () => root.unmount());
    box.remove();
    vi.unstubAllGlobals();
  }
});

it("stars comfig.app sounds into Favorites and filters by source", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  window.localStorage.removeItem("execs.sounds.favorites");
  const box = document.createElement("div");
  document.body.append(box);
  const root = createRoot(box);
  const bell = `comfig:${"b".repeat(128)}`;
  const api = {
    comfigHitsoundIndex: async () => [
      { name: "Bell", hash: "b".repeat(128), kind: "hit", order: 0 },
      { name: "Horn", hash: "c".repeat(128), kind: "kill", order: 1 },
    ],
    listStockHitsounds: async () => ["hitsound"],
    getHitsoundSources: async () => ({ hits: {}, incomplete: [] }),
  } as unknown as Api;
  const click = async (testId: string) =>
    act(async () => box.querySelector<HTMLElement>(`[data-testid="${testId}"]`)?.click());
  const rows = () =>
    [...box.querySelectorAll('[data-testid="sounds-library"] > li[data-testid]')].map((row) =>
      row.getAttribute("data-testid"),
    );
  try {
    await act(async () =>
      root.render(
        <AppStatusProvider value={{ error: null, setError: vi.fn(), busy: false, running: false }}>
          <SoundsPane
            api={api}
            profileId="A"
            record={null}
            layer="vanilla"
            effective={{}}
            managedText=""
            onSave={async () => true}
            onRemove={() => {}}
          />
        </AppStatusProvider>,
      ),
    );
    expect(
      box.querySelector(`[data-testid="sounds-row-comfig:${"c".repeat(128)}"]`)?.textContent,
    ).toContain("uploaded as a kill sound");
    await click(`sounds-favorite-${bell}`);
    expect(JSON.parse(window.localStorage.getItem("execs.sounds.favorites") ?? "[]")).toEqual([
      bell,
    ]);
    await click("sounds-filter-favorites");
    expect(rows()).toEqual([`sounds-row-${bell}`]);
    await click("sounds-filter-comfig");
    expect(rows()).toHaveLength(2);
    await click("sounds-filter-stock");
    expect(rows().every((id) => id?.startsWith("sounds-row-stock:"))).toBe(true);
  } finally {
    await act(async () => root.unmount());
    box.remove();
    window.localStorage.removeItem("execs.sounds.favorites");
    vi.unstubAllGlobals();
  }
});

it("keeps a remembered preview level and mute in the dock", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  window.localStorage.removeItem("execs.sounds.preview");
  const box = document.createElement("div");
  document.body.append(box);
  const root = createRoot(box);
  const api = {
    comfigHitsoundIndex: async () => [],
    listStockHitsounds: async () => ["hitsound"],
    getHitsoundSources: async () => ({ hits: {}, incomplete: [] }),
  } as unknown as Api;
  const render = () =>
    act(async () =>
      root.render(
        <AppStatusProvider value={{ error: null, setError: vi.fn(), busy: false, running: false }}>
          <SoundsPane
            api={api}
            profileId="A"
            record={null}
            layer="vanilla"
            effective={{}}
            managedText=""
            onSave={async () => true}
            onRemove={() => {}}
          />
        </AppStatusProvider>,
      ),
    );
  const output = () => box.querySelector('output[for="sounds-preview-volume"]')?.textContent;
  try {
    await render();
    expect(output()).toBe("50%");
    expect(
      box.querySelector<HTMLButtonElement>('[data-testid="sounds-preview-stop"]')?.disabled,
    ).toBe(true);
    const slider = box.querySelector<HTMLInputElement>('[data-testid="sounds-preview-volume"]');
    if (!slider) throw new Error("Missing preview volume");
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set?.call(slider, "20");
      slider.dispatchEvent(new Event("input", { bubbles: true }));
    });
    expect(output()).toBe("20%");
    await act(async () =>
      box.querySelector<HTMLButtonElement>('[data-testid="sounds-preview-mute"]')?.click(),
    );
    expect(output()).toBe("0%");
    expect(JSON.parse(window.localStorage.getItem("execs.sounds.preview") ?? "{}")).toEqual({
      volume: 20,
      muted: true,
    });
    await act(async () => root.unmount());
    const again = createRoot(box);
    await act(async () =>
      again.render(
        <AppStatusProvider value={{ error: null, setError: vi.fn(), busy: false, running: false }}>
          <SoundsPane
            api={api}
            profileId="A"
            record={null}
            layer="vanilla"
            effective={{}}
            managedText=""
            onSave={async () => true}
            onRemove={() => {}}
          />
        </AppStatusProvider>,
      ),
    );
    expect(output()).toBe("0%");
    await act(async () => again.unmount());
  } finally {
    box.remove();
    window.localStorage.removeItem("execs.sounds.preview");
    vi.unstubAllGlobals();
  }
});

it("lists a GameBanana kill sound once, aimed at its slot, without saving anything", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal(
    "Audio",
    class {
      pause = vi.fn();
      addEventListener = vi.fn();
      removeEventListener = vi.fn();
    },
  );
  const box = document.createElement("div");
  document.body.append(box);
  const root = createRoot(box);
  const api = {
    comfigHitsoundIndex: async () => [],
    listStockHitsounds: async () => ["hitsound"],
    getHitsoundSources: async () => ({ hits: {}, incomplete: [] }),
  } as unknown as Api;
  const info = {
    formatTag: 2,
    channels: 1,
    sampleRate: 22050,
    bitsPerSample: 4,
    dataBytes: 2048,
    durationMs: 200,
  };
  const incoming = {
    key: 1,
    slot: "kill" as const,
    title: "Oof pack",
    sounds: [
      { token: "t1", name: "Oof pack · oof.wav", info, converted: false },
      { token: "t2", name: "Oof pack · loud/oof.wav", info, converted: true },
    ],
    skipped: 1,
    truncated: false,
  };
  const onSave = vi.fn(async () => true);
  const handled = vi.fn();
  const pane = (value: typeof incoming | null) => (
    <AppStatusProvider value={{ error: null, setError: vi.fn(), busy: false, running: false }}>
      <SoundsPane
        api={api}
        profileId="A"
        record={null}
        layer="vanilla"
        effective={{}}
        managedText=""
        onSave={onSave}
        onRemove={() => {}}
        incoming={value}
        onIncomingHandled={handled}
      />
    </AppStatusProvider>
  );
  try {
    await act(async () => root.render(pane(incoming)));
    expect(handled).toHaveBeenCalledWith(1);
    expect(box.querySelector<HTMLInputElement>('[data-testid="sounds-target-kill"]')?.checked).toBe(
      true,
    );
    const note = box.querySelector('[data-testid="sounds-gamebanana-added"]')?.textContent;
    expect(note).toContain("Added 2 sounds from “Oof pack” on GameBanana, made for kills.");
    expect(note).toContain("1 other file in the download could not be used.");
    const row = box.querySelector('[data-testid="sounds-row-own:t2"]');
    expect(row?.textContent).toContain("From GameBanana");
    expect(row?.textContent).not.toContain("Your file");
    expect(box.querySelector('[data-testid="sounds-assign-kill-own:t1"]')).not.toBeNull();
    // Arriving in the library is not a choice: nothing is saved.
    expect(onSave).not.toHaveBeenCalled();

    // The same handoff does not replace a file added since.
    await act(async () => root.render(pane({ ...incoming })));
    expect(box.querySelectorAll('[data-testid^="sounds-row-own:"]')).toHaveLength(2);
  } finally {
    await act(async () => root.unmount());
    box.remove();
    vi.unstubAllGlobals();
  }
});

it("saves game and music volume with the profile and keeps an exact saved level", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal(
    "Audio",
    class {
      pause = vi.fn();
      addEventListener = vi.fn();
      removeEventListener = vi.fn();
    },
  );
  const box = document.createElement("div");
  document.body.append(box);
  const root = createRoot(box);
  const onSave = vi.fn(async (_text: string, _pack: unknown) => true);
  const api = {
    comfigHitsoundIndex: async () => [],
    listStockHitsounds: async () => ["hitsound"],
    getHitsoundSources: async () => ({ hits: {}, incomplete: [] }),
  } as unknown as Api;
  const slider = (id: string) => box.querySelector<HTMLInputElement>(`[data-testid="${id}"]`);
  try {
    await act(async () =>
      root.render(
        <AppStatusProvider value={{ error: null, setError: vi.fn(), busy: false, running: false }}>
          <SoundsPane
            api={api}
            profileId="A"
            record={null}
            layer="vanilla"
            // What TF2's own options saved into config.cfg.
            effective={{ volume: "0.015000", snd_musicvolume: "0.300000" }}
            managedText=""
            onSave={onSave}
            onRemove={() => {}}
          />
        </AppStatusProvider>,
      ),
    );
    expect(slider("sounds-game-volume")?.value).toBe("2");
    expect(slider("sounds-music-volume")?.value).toBe("30");
    expect(onSave).not.toHaveBeenCalled();

    const music = slider("sounds-music-volume");
    if (!music) throw new Error("music volume slider missing");
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set?.call(music, "10");
      music.dispatchEvent(new Event("input", { bubbles: true }));
    });
    expect(box.querySelector('[data-testid="sounds-volume"]')?.textContent).toContain("10%");
    await act(async () => new Promise((resolve) => setTimeout(resolve, 800)));
    expect(onSave).toHaveBeenCalledOnce();
    const [text, pack] = onSave.mock.calls[0] ?? [];
    expect(pack).toBeNull();
    // The untouched game volume keeps TF2's exact level; music takes the slider.
    expect(text).toContain("volume 0.015\n");
    expect(text).toContain("snd_musicvolume 0.1\n");
  } finally {
    await act(async () => root.unmount());
    box.remove();
    vi.unstubAllGlobals();
  }
});
