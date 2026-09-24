// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import { ToastProvider } from "./components/ui/Toast";
import { AppStatusProvider } from "./hooks/useAppStatus";
import type { Api } from "./lib/api";
import { SoundsPane } from "./SoundsPane";

it("retries a failed stock read and offers only stock and user WAV sources", async () => {
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
    expect(box.querySelector('[data-testid^="sounds-row-comfig:"]')).toBeNull();
    expect(box.querySelector('[data-testid^="sounds-row-community:"]')).toBeNull();
    expect(box.textContent).not.toContain("TF2Hitsounds");
    expect(box.textContent).not.toContain("comfig.app");
    expect(box.textContent).toContain("Game archive unavailable");
    const stockBoost = box.querySelector<HTMLInputElement>('[data-testid="sounds-hit-boost-6"]');
    expect(stockBoost?.disabled).toBe(true);
    expect(box.textContent).toContain("Choose your own WAV to boost it.");
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

it("keeps a legacy saved sound playable while only user files enter the new library", async () => {
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
              record={{ hit: { name: "Bubble Pop", source: "comfig", hash: "A" } }}
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
      "saved WAV remains in the profile",
    );
    expect(box.querySelector('[data-testid^="sounds-row-comfig:"]')).toBeNull();
    await act(async () =>
      box.querySelector<HTMLButtonElement>('[data-testid="sounds-choose-file"]')?.click(),
    );
    const own = box.querySelector(
      '[data-testid="sounds-row-own:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"]',
    );
    if (!own) throw new Error("Own WAV row did not load");
    const buttons = [...own.querySelectorAll("button")];
    expect(buttons.map((button) => button.getAttribute("aria-label"))).toEqual([
      "Play Own Pop.wav (Your file)",
      "Assign Own Pop.wav (Your file) as hit sound",
      "Assign Own Pop.wav (Your file) as kill sound",
    ]);
    expect(buttons[1].disabled).toBe(false);
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
      "Play Bubble Pop (hit sound, comfig.app · saved by execs)",
    );
    await act(async () =>
      box.querySelector<HTMLButtonElement>('[data-testid="sounds-hit-play"]')?.click(),
    );
    expect(hitsoundBytes).toHaveBeenLastCalledWith({ kind: "installed", slot: "hit" });
    const customBoost = box.querySelector<HTMLInputElement>('[data-testid="sounds-hit-boost-6"]');
    expect(customBoost?.disabled).toBe(true);
    expect(box.textContent).toContain("This saved catalog sound keeps its current boost.");
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
