// @vitest-environment jsdom
// biome-ignore-all lint/suspicious/noExplicitAny: Fault-injected IPC models disk snapshots without touching player files.
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ToastProvider } from "./components/ui/Toast";
import { AppStatusProvider } from "./hooks/useAppStatus";
import { SettingsHost } from "./SettingsHost";

// Pixel decoding is a browser boundary; the pane, draft, host, queue and toast
// are real. Deterministic pixels make both the PNG and library payload visible.
vi.mock("./crosshair/PngImportField", () => ({
  PngImportField: ({ onImport }: { onImport: (pixels: number[]) => void }) => (
    <button type="button" data-testid="fixture-png" onClick={() => onImport([1, 2, 3, 255])}>
      Import fixture PNG
    </button>
  ),
}));

let root: Root;
let box: HTMLDivElement;
let detail: any;
let comfig: any;
let cfg: string;
let api: any;
let props: any;
const path = "tf/cfg/execs_gameplay.cfg";
const deferred = <T,>() => {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
};

beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal(
    "Audio",
    class {
      pause = vi.fn();
      addEventListener = vi.fn();
      removeEventListener = vi.fn();
    },
  );
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(null);
  localStorage.clear();
  box = document.createElement("div");
  document.body.append(box);
  root = createRoot(box);
  cfg = 'tf_dingaling_volume 0.75\ntf_dingalingaling 1\ncl_crosshair_file ""\n';
  detail = {
    id: "A",
    layer: "vanilla",
    files: [{ path }],
    launchOptions: "",
    crosshair: { id: "execs-crosshairs", shape: "cross", assignments: {} },
    hitsound: { hit: { name: "own.wav", source: "file", token: "a".repeat(32), boost: 0 } },
  };
  comfig = { preset: "medium", modules: {}, addons: [] };
  api = {
    getActiveProfileDetail: vi.fn(async () => detail),
    getFilesContext: vi.fn(async () => ({
      profileId: detail.id,
      root: "fixture",
      layer: detail.layer,
    })),
    readProfileFile: vi.fn(async () => ({ path, text: cfg })),
    getComfigState: vi.fn(async () => comfig),
    getStockCrosshairSprites: vi.fn(async () => ({})),
    getCrosshairContentSources: vi.fn(async () => ({ hits: {}, incomplete: [] })),
    getCrosshairSourceStatus: vi.fn(async () => ({ state: "none" })),
    getPackCrosshairPreviews: vi.fn(async () => ({})),
    listStockHitsounds: vi.fn(async () => []),
    getHitsoundSources: vi.fn(async () => ({ hits: {}, incomplete: [] })),
    pickHitsoundFile: vi.fn(async () => ({
      token: "b".repeat(32),
      name: "Next sound.wav",
      converted: false,
      info: {
        formatTag: 1,
        channels: 1,
        sampleRate: 44100,
        bitsPerSample: 16,
        dataBytes: 2,
        durationMs: 1,
      },
    })),
    writeManagedCfg: vi.fn(async (_path: string, text: string) => {
      cfg = text;
      return detail;
    }),
    applyCrosshairs: vi.fn(async (shape, assignments, _pixels, color, library, design) => {
      detail = {
        ...detail,
        crosshair: {
          id: "execs-crosshairs",
          shape,
          assignments,
          color,
          library: Object.fromEntries(
            Object.entries(library).map(([name, asset]: any) => [name, asset.format]),
          ),
          design,
        },
      };
      return detail;
    }),
    applyHitsounds: vi.fn(async (hit: any) => {
      if (hit.change === "install") {
        detail = {
          ...detail,
          hitsound: {
            hit: {
              ...detail.hitsound.hit,
              boost: hit.boost,
              ...(hit.pick.kind === "file"
                ? { name: hit.pick.name, source: "file", token: hit.pick.token }
                : {}),
            },
          },
        };
      }
      return detail;
    }),
    applyHitsoundsWithSettings: vi.fn(
      async (_path: string, text: string, _id: string, hit: any) => {
        cfg = text;
        const apply = api.applyHitsounds.getMockImplementation();
        return apply(hit);
      },
    ),
    setComfigPreset: vi.fn(async (preset: string) => {
      comfig = { ...comfig, preset };
      return detail;
    }),
    setComfigModules: vi.fn(async (modules: any) => {
      comfig = { ...comfig, modules };
      return detail;
    }),
    setComfigAddons: vi.fn(async (addons: any) => {
      comfig = { ...comfig, addons };
      return detail;
    }),
  };
  props = {
    api,
    tab: "crosshair",
    running: false,
    externalBusy: false,
    refreshKey: 1,
    bindSyncRequest: null,
    onBindSyncHandled: vi.fn(),
    onBusyChange: vi.fn(),
    onPendingChange: vi.fn(),
    onError: vi.fn(),
  };
});
afterEach(async () => {
  await act(async () => root.unmount());
  box.remove();
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
async function render(changes: any = {}) {
  Object.assign(props, changes);
  await act(async () =>
    root.render(
      <ToastProvider>
        <AppStatusProvider
          value={{ running: false, busy: false, error: null, setError: props.onError }}
        >
          <SettingsHost {...props} />
        </AppStatusProvider>
      </ToastProvider>,
    ),
  );
}
function element<T extends HTMLElement = HTMLElement>(selector: string): T {
  const found = document.querySelector<T>(selector);
  if (!found) throw new Error(`Missing ${selector}`);
  return found;
}
async function click(selector: string) {
  await act(async () => element(selector).click());
}
async function input(selector: string, value: string) {
  await act(async () => {
    const field = element<HTMLInputElement>(selector);
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set?.call(field, value);
    field.dispatchEvent(new Event("input", { bubbles: true }));
  });
}
async function elapsed() {
  await act(async () => vi.advanceTimersByTimeAsync(701));
}
async function design() {
  await click('input[value="designs"]');
  await click('[data-testid="crosshair-open-designer"]');
  await click('[data-testid="crosshair-designer-save"]');
}

describe("crosshair writes through the real host outcome contract", () => {
  it.each(["before write", "after write"])(
    "retains PNG and library bytes after failure %s",
    async (phase) => {
      await render();
      await design();
      await click('input[value="import"]');
      await click('[data-testid="fixture-png"]');
      const apply = api.applyCrosshairs.getMockImplementation();
      api.applyCrosshairs.mockImplementationOnce(async (...args: any[]) => {
        if (phase === "after write") await apply(...args);
        throw new Error("injected write failure");
      });
      await click('[data-testid="crosshair-build"]');
      expect(element('[data-testid="toast"]').textContent).toContain("injected write failure");
      expect(props.onPendingChange).toHaveBeenLastCalledWith(true);
      await render({ tab: "gameplay" });
      await render({ tab: "crosshair" });
      await click('[data-testid="crosshair-build"]');
      expect(api.applyCrosshairs).toHaveBeenCalledTimes(2);
      const first = api.applyCrosshairs.mock.calls[0];
      const retry = api.applyCrosshairs.mock.calls[1];
      expect(first[2]).toEqual([1, 2, 3, 255]);
      expect(first[4]["design-my-crosshair"].bytes.length).toBe(64 * 64 * 4);
      expect(retry[2]).toEqual(first[2]);
      expect(retry[4]).toEqual(first[4]);
      expect(props.onPendingChange).toHaveBeenLastCalledWith(false);
    },
  );

  it("retains new bytes when the host refuses before the native command", async () => {
    await render();
    await design();
    api.getActiveProfileDetail.mockResolvedValueOnce({ ...detail, id: "elsewhere" });
    await click('[data-testid="crosshair-build"]');
    expect(api.applyCrosshairs).not.toHaveBeenCalled();
    await click('[data-testid="crosshair-build"]');
    expect(api.applyCrosshairs.mock.calls[0][4]["design-my-crosshair"].bytes.length).toBe(16384);
  });

  it("keeps later asset edits after an older successful build", async () => {
    const pending = deferred<any>();
    const apply = api.applyCrosshairs.getMockImplementation();
    api.applyCrosshairs.mockImplementationOnce(async (...args: any[]) => {
      await pending.promise;
      return apply(...args);
    });
    await render();
    await design();
    await click('[data-testid="crosshair-build"]');
    await click('input[value="import"]');
    await click('[data-testid="fixture-png"]');
    await act(async () => pending.resolve(null));
    await click('[data-testid="crosshair-build"]');
    expect(api.applyCrosshairs.mock.calls[1][2]).toEqual([1, 2, 3, 255]);
  });

  it("does not send one profile's unbuilt pixels from another profile", async () => {
    await render();
    await design();
    detail = { ...detail, id: "B" };
    await render({ refreshKey: 2 });
    expect(
      document.querySelector('[data-testid="crosshair-shape-design-my-crosshair"]'),
    ).toBeNull();
    await click('[data-testid="crosshair-shape-dot"]');
    await click('[data-testid="crosshair-build"]');
    expect(api.applyCrosshairs.mock.calls[0][4]).toEqual({});
    expect(api.applyCrosshairs.mock.calls[0][2]).toBeUndefined();
  });
});

describe("sound acknowledgements through the real host", () => {
  it.each(["volume", "pitch", "boost", "source"])(
    "saves a newer %s edit after an older boost lands",
    async (field) => {
      const pending = deferred<any>();
      const apply = api.applyHitsoundsWithSettings.getMockImplementation();
      api.applyHitsoundsWithSettings.mockImplementationOnce(async (...args: any[]) => {
        await pending.promise;
        return apply(...args);
      });
      if (field === "source") vi.stubGlobal("__TAURI_INTERNALS__", {});
      await render({ tab: "sounds" });
      await click('[data-testid="sounds-hit-boost-6"]');
      await elapsed();
      expect(api.applyHitsoundsWithSettings).toHaveBeenCalledTimes(1);
      if (field === "volume") await input("#sounds-hit-volume", "40");
      if (field === "pitch") {
        await click('[data-testid="sounds-advanced"] summary');
        await input("#sounds-hit-pitch-min", "80");
      }
      if (field === "boost") await click('[data-testid="sounds-hit-boost-12"]');
      if (field === "source") {
        await click('[data-testid="sounds-choose-file"]');
        await click(`[data-testid="sounds-assign-hit-own:${"b".repeat(32)}"]`);
      }
      await act(async () => pending.resolve(null));
      if (field === "volume")
        expect(element<HTMLInputElement>("#sounds-hit-volume").value).toBe("40");
      if (field === "pitch")
        expect(element<HTMLInputElement>("#sounds-hit-pitch-min").value).toBe("80");
      if (field === "boost")
        expect(element<HTMLInputElement>('[data-testid="sounds-hit-boost-12"]').checked).toBe(true);
      if (field === "source")
        expect(element('[data-testid="sounds-hit-name"]').textContent).toBe("Next sound.wav");
      await elapsed();
      expect(api.writeManagedCfg).toHaveBeenCalledTimes(
        field === "volume" || field === "pitch" ? 1 : 0,
      );
      expect(api.applyHitsoundsWithSettings).toHaveBeenCalledTimes(
        field === "volume" || field === "pitch" ? 1 : 2,
      );
      if (field === "volume") expect(cfg).toContain("tf_dingaling_volume 0.4\n");
      if (field === "pitch") expect(cfg).toContain("tf_dingaling_pitchmindmg 80\n");
      if (field === "boost") expect(api.applyHitsoundsWithSettings.mock.calls[1][3].boost).toBe(12);
      if (field === "source")
        expect(api.applyHitsoundsWithSettings.mock.calls[1][3].pick).toEqual({
          kind: "file",
          token: "b".repeat(32),
          name: "Next sound.wav",
        });
      expect(props.onPendingChange).toHaveBeenLastCalledWith(false);
    },
  );

  it("keeps a failed boost retryable and discards its draft on a profile switch", async () => {
    api.applyHitsoundsWithSettings.mockRejectedValueOnce(new Error("pack refused"));
    await render({ tab: "sounds" });
    await click('[data-testid="sounds-hit-boost-6"]');
    await elapsed();
    expect(props.onPendingChange).toHaveBeenLastCalledWith(true);
    await render({ running: true });
    await render({ running: false });
    await elapsed();
    expect(api.applyHitsoundsWithSettings).toHaveBeenCalledTimes(2);
    await render({ running: true });
    await input("#sounds-hit-volume", "40");
    detail = { ...detail, id: "B", hitsound: null };
    cfg = "tf_dingaling_volume 0.9\n";
    await render({ refreshKey: 2 });
    expect(element<HTMLInputElement>("#sounds-hit-volume").value).toBe("90");
    await render({ running: false });
    await elapsed();
    expect(api.writeManagedCfg).not.toHaveBeenCalled();
  });
});

describe("Comfig saved selections", () => {
  it("keeps the saved preset through failure and navigation, then retries the same choice", async () => {
    api.setComfigPreset.mockRejectedValueOnce(new Error("download failed"));
    await render({ tab: "comfig" });
    await click("#comfig-preset-high");
    expect(element<HTMLInputElement>("#comfig-preset-medium").checked).toBe(true);
    expect(element('[aria-label="Selected preset details"] h3').textContent).toBe("Medium");
    await render({ refreshKey: 2, tab: "gameplay" });
    await render({ tab: "comfig" });
    expect(element<HTMLInputElement>("#comfig-preset-medium").checked).toBe(true);
    await click("#comfig-preset-high");
    expect(api.setComfigPreset.mock.calls).toEqual([["high"], ["high"]]);
    expect(element<HTMLInputElement>("#comfig-preset-high").checked).toBe(true);
  });

  it("does not bundle failed module or addon choices into the next write", async () => {
    api.setComfigModules.mockRejectedValueOnce(new Error("cfg write failed"));
    api.setComfigAddons.mockRejectedValueOnce(new Error("addon failed"));
    await render({ tab: "comfig" });
    const modules = [...document.querySelectorAll<HTMLElement>('[data-testid^="comfig-module-"]')];
    const first = modules[0];
    const second = modules[1];
    await act(async () => first.querySelectorAll<HTMLButtonElement>("button")[1].click());
    expect(first.dataset.value).toBe("");
    await act(async () => second.querySelectorAll<HTMLButtonElement>("button")[1].click());
    expect(Object.keys(api.setComfigModules.mock.calls[1][0])).toHaveLength(1);
    expect(api.setComfigModules.mock.calls[1][0]).not.toHaveProperty(
      first.dataset.testid?.replace("comfig-module-", "") ?? "",
    );
    await click('[data-testid="comfig-addon-no-tutorial"]');
    await click('[data-testid="comfig-addon-no-footsteps"]');
    expect(api.setComfigAddons.mock.calls).toEqual([[["no-tutorial"]], [["no-footsteps"]]]);
    detail = { ...detail, id: "B" };
    comfig = { preset: "low", modules: {}, addons: [] };
    await render({ refreshKey: 2 });
    expect(element<HTMLInputElement>("#comfig-preset-low").checked).toBe(true);
  });
});
