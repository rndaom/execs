// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import { ToastProvider } from "./components/ui/Toast";
import { AppStatusProvider } from "./hooks/useAppStatus";
import type { Api } from "./lib/api";
import { SoundsPane } from "./SoundsPane";

it("retries failed sources while retaining the last usable catalog", async () => {
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
  const index = vi
    .fn()
    .mockResolvedValueOnce([{ hash: "A", name: "Kept sound", kind: "hit" }])
    .mockRejectedValueOnce(new Error("Network unavailable"))
    .mockResolvedValue([{ hash: "B", name: "Fresh sound", kind: "hit" }]);
  const api = {
    listStockHitsounds: stock,
    comfigHitsoundIndex: index,
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
    expect(box.querySelector('[data-testid="sounds-row-comfig:A"]')).not.toBeNull();
    expect(box.textContent).toContain("Game archive unavailable");
    const stockBoost = box.querySelector<HTMLInputElement>('[data-testid="sounds-hit-boost-6"]');
    expect(stockBoost?.disabled).toBe(true);
    expect(box.textContent).toContain("Choose a custom sound from the library to boost it.");
    const retry = () =>
      [...box.querySelectorAll("button")].find((button) =>
        button.textContent?.includes("Retry sources"),
      );
    await act(async () => retry()?.click());
    expect(box.querySelector('[data-testid="sounds-stock-error"]')).toBeNull();
    expect(box.textContent).toContain("Network unavailable");
    expect(box.querySelector('[data-testid="sounds-row-comfig:A"]')).not.toBeNull();
    await act(async () => retry()?.click());
    expect(box.querySelector('[data-testid="sounds-comfig-error"]')).toBeNull();
    expect(box.querySelector('[data-testid="sounds-row-comfig:A"]')).toBeNull();
    expect(box.querySelector('[data-testid="sounds-row-comfig:B"]')).not.toBeNull();
  } finally {
    await act(async () => root.unmount());
    box.remove();
    vi.unstubAllGlobals();
  }
});

it("names clip actions, duplicate sources and slot volumes without changing row focus order", async () => {
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
  const api = {
    listStockHitsounds: async () => ["hitsound"],
    comfigHitsoundIndex: async () => [
      { hash: "A", name: "Bubble Pop", kind: "hit" },
      { hash: "B", name: "Bubble Pop", kind: "hit" },
    ],
    hitsoundBytes: () => new Promise(() => {}),
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
    const first = box.querySelector('[data-testid="sounds-row-comfig:A"]');
    const second = box.querySelector('[data-testid="sounds-row-comfig:B"]');
    if (!first || !second) throw new Error("Sound rows did not load");
    const buttons = [...second.querySelectorAll("button")];
    expect(buttons.map((button) => button.getAttribute("aria-label"))).toEqual([
      "Play Bubble Pop (comfig.app, sound 2)",
      "Assign Bubble Pop (comfig.app, sound 2) as hit sound",
      "Assign Bubble Pop (comfig.app, sound 2) as kill sound",
    ]);
    expect(
      first.querySelector('[data-testid="sounds-assign-hit-comfig:A"]')?.hasAttribute("disabled"),
    ).toBe(true);
    expect(buttons[1].disabled).toBe(false);
    for (const button of buttons) {
      expect(button.tabIndex).toBe(0);
      button.focus();
      expect(document.activeElement).toBe(button);
    }
    await act(async () => buttons[0].click());
    expect(buttons[0].getAttribute("aria-label")).toBe("Stop Bubble Pop (comfig.app, sound 2)");
    expect(box.querySelector("#sounds-hit-volume")?.getAttribute("aria-label")).toBe(
      "Hit sound volume",
    );
    expect(box.querySelector("#sounds-kill-volume")?.getAttribute("aria-label")).toBe(
      "Kill sound volume",
    );
    expect(box.querySelector('[data-testid="sounds-hit-play"]')?.getAttribute("aria-label")).toBe(
      "Play Bubble Pop (hit sound, comfig.app · saved by execs)",
    );
    const customBoost = box.querySelector<HTMLInputElement>('[data-testid="sounds-hit-boost-6"]');
    expect(customBoost?.disabled).toBe(false);
    await act(async () => customBoost?.click());
    expect(customBoost?.checked).toBe(true);
  } finally {
    await act(async () => root.unmount());
    box.remove();
    vi.unstubAllGlobals();
  }
});

it("shows one sound page at a time and resets to the first page when the source changes", async () => {
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
    comfigHitsoundIndex: async () =>
      Array.from({ length: 26 }, (_, index) => ({
        hash: String(index),
        name: `Clip ${String(index + 1).padStart(2, "0")}`,
        kind: "hit",
      })),
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
    await act(async () =>
      (box.querySelector('label[for$="-comfig"]') as HTMLLabelElement)?.click(),
    );
    expect(box.querySelectorAll('[data-testid^="sounds-row-comfig:"]')).toHaveLength(24);
    expect(box.querySelector('[data-testid="sounds-row-comfig:0"]')).not.toBeNull();
    expect(box.querySelector('[data-testid="sounds-row-comfig:24"]')).toBeNull();
    await act(async () =>
      (box.querySelector('[data-testid="sounds-page-next-top"]') as HTMLButtonElement).click(),
    );
    expect(box.querySelectorAll('[data-testid^="sounds-row-comfig:"]')).toHaveLength(2);
    expect(box.querySelector('[data-testid="sounds-row-comfig:0"]')).toBeNull();
    expect(box.querySelector('[data-testid="sounds-row-comfig:24"]')).not.toBeNull();
    await act(async () => (box.querySelector('label[for$="-stock"]') as HTMLLabelElement)?.click());
    await act(async () =>
      (box.querySelector('label[for$="-comfig"]') as HTMLLabelElement)?.click(),
    );
    expect(box.querySelector('[data-testid="sounds-row-comfig:0"]')).not.toBeNull();
    expect(
      box.querySelector('[data-testid="sounds-page-prev-top"]')?.hasAttribute("disabled"),
    ).toBe(true);
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
    comfigHitsoundIndex: async () => [],
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
    comfigHitsoundIndex: async () => [{ hash: "A", name: "Bubble Pop", kind: "hit" }],
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
        .querySelector('[data-testid="sounds-assign-hit-comfig:A"]')
        ?.dispatchEvent(new MouseEvent("click", { bubbles: true })),
    );
    await act(async () => new Promise((resolve) => setTimeout(resolve, 800)));
    expect(onSave).toHaveBeenCalledOnce();
    expect(box.querySelector('[data-testid="sounds-hit-name"]')?.textContent).toBe("Bubble Pop");
  } finally {
    await act(async () => root.unmount());
    box.remove();
    vi.unstubAllGlobals();
  }
});
