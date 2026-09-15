import { JSDOM } from "jsdom";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ToastProvider } from "./components/ui/Toast";
import { AppStatusProvider } from "./hooks/useAppStatus";
import type { Api } from "./lib/api";
import type { HudSchemaView, HudStatePayload } from "./lib/bridge";
import { emptyHudState, PREVIEW_HUD_CATALOG } from "./lib/hud-ui";
import { SettingsHost } from "./SettingsHost";

// Real host, HUD pane, seeded drafts, autosave, toast, and DOM event handlers;
// only the IPC boundary is substituted.

const dom = new JSDOM("<!doctype html><html><body></body></html>", { url: "http://localhost" });
Object.assign(globalThis, {
  window: dom.window,
  document: dom.window.document,
  HTMLElement: dom.window.HTMLElement,
  Element: dom.window.Element,
  IS_REACT_ACT_ENVIRONMENT: true,
});
const deferred = <T,>() => {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
};
const schema = (author: string): HudSchemaView => ({
  author,
  sections: [
    {
      name: "Options",
      controls: [
        {
          name: "enabled",
          label: "Hide outline",
          controlType: "checkbox",
          value: "false",
          choices: [],
        },
      ],
    },
  ],
});
const installed = (id = "rayshud", profileId = "A", supported = true): HudStatePayload => ({
  ...emptyHudState(),
  profileId,
  installed: { id, source: "local", hash: null, options: {} },
  schemaSupported: supported,
  catalogUnavailable: true,
});
let state: HudStatePayload;
let profileId: string;
let api: ReturnType<typeof makeApi>;
let root: Root;
let container: HTMLDivElement;
let refreshKey: number;
let running: boolean;
let onPendingChange: ReturnType<typeof vi.fn>;
function makeApi() {
  return {
    getActiveProfileDetail: vi.fn(async () => ({
      id: profileId,
      layer: "vanilla",
      files: [],
      launchOptions: "",
      hud: state.installed,
    })),
    getComfigState: vi.fn(async () => null),
    getHudCatalog: vi.fn(async (_refresh: boolean) => ({
      entries: PREVIEW_HUD_CATALOG,
      warning: null as string | null,
    })),
    getHudState: vi.fn(async () => state),
    getHudStats: vi.fn(async (_refresh: boolean) => ({
      stats: { rayshud: { views: 12 } },
      warning: null as string | null,
    })),
    getHudSchema: vi.fn(async (_profile: string, id: string) => schema(id)),
    importHudArchive: vi.fn(async () => ({ id: profileId })),
    applyHudOptions: vi.fn(async (options: Record<string, string>) => {
      state = { ...state, installed: state.installed ? { ...state.installed, options } : null };
      return { id: profileId };
    }),
  };
}
async function render() {
  await act(async () =>
    root.render(
      <ToastProvider>
        <AppStatusProvider value={{ error: null, setError: () => {}, busy: false, running }}>
          <SettingsHost
            api={api as unknown as Api}
            tab="hud"
            running={running}
            externalBusy={false}
            refreshKey={refreshKey}
            bindSyncRequest={null}
            onBindSyncHandled={() => {}}
            onBusyChange={() => {}}
            onPendingChange={onPendingChange}
            onError={() => {}}
          />
        </AppStatusProvider>
      </ToastProvider>,
    ),
  );
}
function element(id: string): HTMLElement {
  const result = container.querySelector<HTMLElement>(`[data-testid="${id}"]`);
  if (!result) throw new Error(`Missing ${id}: ${container.textContent}`);
  return result;
}
async function click(id: string) {
  await act(async () => element(id).click());
}
beforeEach(() => {
  vi.clearAllMocks();
  window.localStorage.clear();
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  profileId = "A";
  state = installed();
  running = false;
  refreshKey = 1;
  api = makeApi();
  onPendingChange = vi.fn();
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.useRealTimers();
});

describe("HUD loading through the real settings host and pane", () => {
  it("loads an installed local HUD and its controls with a cold offline catalog", async () => {
    api.getHudCatalog.mockRejectedValue(new Error("Catalog offline"));
    await render();
    expect(api.getHudState).toHaveBeenCalled();
    expect(element("hud-installed").textContent).toContain("rayshud");
    expect(element("hud-options").textContent).toContain("Schema by rayshud");
    expect(element("hud-state-catalog-unavailable").textContent).toContain(
      "update status could not be checked",
    );
    expect((element("hud-import") as HTMLButtonElement).disabled).toBe(false);
    expect(element("hud-catalog-error").textContent).toContain("Catalog offline");
    expect(api.getHudStats).toHaveBeenCalled();
  });

  it("does not wait for a slow catalog before showing installed HUD options", async () => {
    const catalog = deferred<Awaited<ReturnType<typeof api.getHudCatalog>>>();
    api.getHudCatalog.mockReturnValue(catalog.promise);
    await render();
    expect(element("hud-options").textContent).toContain("Schema by rayshud");
    expect(element("hud-catalog-loading")).toBeDefined();
    await act(async () => catalog.resolve({ entries: PREVIEW_HUD_CATALOG, warning: null }));
  });

  it("replaces the schema when installed identity changes during a catalog request", async () => {
    const catalog = deferred<Awaited<ReturnType<typeof api.getHudCatalog>>>();
    api.getHudCatalog.mockReturnValue(catalog.promise);
    await render();
    expect(element("hud-options").textContent).toContain("Schema by rayshud");
    state = installed("budhud");
    await act(async () => catalog.resolve({ entries: PREVIEW_HUD_CATALOG, warning: null }));
    expect(element("hud-options").textContent).toContain("Schema by budhud");
    expect(container.textContent).not.toContain("Schema by rayshud");
  });

  it("reports a local read failure separately and keeps previous controls unavailable until retry", async () => {
    await render();
    api.getHudState.mockRejectedValue(new Error("Profile read failed"));
    await click("hud-refresh");
    expect(element("hud-state-error").textContent).toContain("Profile read failed");
    expect(container.querySelector('[data-testid="hud-options"]')).toBeNull();
    expect(container.querySelector('[data-testid="hud-catalog-error"]')).toBeNull();
    api.getHudState.mockResolvedValue(state);
    const retry = Array.from(container.querySelectorAll("button")).find(
      (button) => button.textContent === "Retry loading HUD",
    );
    await act(async () => retry?.click());
    expect(element("hud-options").textContent).toContain("Schema by rayshud");
  });

  it("preserves warm catalog and stats values while disclosing failed and partial refreshes, then recovers", async () => {
    await render();
    api.getHudCatalog.mockRejectedValueOnce(new Error("Catalog timed out"));
    api.getHudStats.mockResolvedValueOnce({
      stats: { rayshud: { views: 12 } },
      warning: "Update dates from comfig.app could not be refreshed.",
    });
    await click("hud-refresh");
    expect(element("hud-card-rayshud")).toBeDefined();
    expect(element("hud-catalog-error").textContent).toContain("Catalog timed out");
    expect(element("hud-stats-error").textContent).toContain("comfig.app");
    await click("hud-sort-views");
    expect(element("hud-card-rayshud").textContent).toContain("12");
    api.getHudCatalog.mockResolvedValueOnce({
      entries: PREVIEW_HUD_CATALOG,
      warning: "The catalog is incomplete: 1 HUD document could not be refreshed.",
    });
    await click("hud-refresh");
    expect(element("hud-catalog-warning").textContent).toContain("incomplete");
    await click("hud-refresh");
    expect(container.querySelector('[data-testid="hud-catalog-error"]')).toBeNull();
    expect(container.querySelector('[data-testid="hud-catalog-warning"]')).toBeNull();
    expect(container.querySelector('[data-testid="hud-stats-error"]')).toBeNull();
  });

  it.each(["success", "failure"])(
    "clears HUD A's schema before a slow HUD B %s",
    async (outcome) => {
      await render();
      state = installed("budhud");
      const next = deferred<HudSchemaView>();
      api.getHudSchema.mockReturnValueOnce(next.promise);
      refreshKey += 1;
      await render();
      expect(element("hud-installed").textContent).toContain("budhud");
      expect(container.querySelector('[data-testid="hud-options"]')).toBeNull();
      await act(async () =>
        outcome === "success"
          ? next.resolve(schema("B"))
          : next.reject(new Error("B schema offline")),
      );
      if (outcome === "success")
        expect(element("hud-options").textContent).toContain("Schema by B");
      else expect(element("hud-schema-error").textContent).toContain("B schema offline");
      expect(container.textContent).not.toContain("Schema by rayshud");
      expect(api.getHudSchema).toHaveBeenLastCalledWith("A", "budhud");
    },
  );

  it("ignores a late schema success from another HUD and clears controls for a no-schema HUD", async () => {
    const old = deferred<HudSchemaView>();
    api.getHudSchema.mockReturnValueOnce(old.promise);
    await render();
    state = installed("budhud");
    refreshKey += 1;
    await render();
    await act(async () => old.resolve(schema("obsolete")));
    expect(element("hud-options").textContent).toContain("Schema by budhud");
    expect(container.textContent).not.toContain("obsolete");
    state = installed("custom-hud", "A", false);
    refreshKey += 1;
    await render();
    expect(element("hud-options-notes").textContent).toContain("No in-app options");
    expect(container.querySelector('[data-testid="hud-options"]')).toBeNull();
  });

  it("ignores late local state and schema completions across profiles", async () => {
    const oldState = deferred<HudStatePayload>();
    const slowCatalog = deferred<Awaited<ReturnType<typeof api.getHudCatalog>>>();
    api.getHudState.mockReturnValueOnce(oldState.promise);
    api.getHudCatalog.mockReturnValueOnce(slowCatalog.promise);
    await render();
    profileId = "B";
    state = installed("budhud", "B");
    refreshKey += 1;
    await render();
    expect(element("hud-options").textContent).toContain("budhud");
    await act(async () => oldState.resolve(installed()));
    await act(async () => slowCatalog.resolve({ entries: PREVIEW_HUD_CATALOG, warning: null }));
    expect(element("hud-options").textContent).toContain("budhud");
    expect(container.textContent).not.toContain("Schema by rayshud");
  });

  it("keeps a successful local import successful when its schema and catalog are offline", async () => {
    api.getHudCatalog.mockRejectedValue(new Error("offline"));
    await render();
    api.importHudArchive.mockImplementationOnce(async () => {
      state = installed("budhud");
      return { id: "A" };
    });
    api.getHudSchema.mockRejectedValueOnce(new Error("Schema offline"));
    await click("hud-import");
    await click("hud-import-archive");
    expect(element("hud-installed").textContent).toContain("budhud");
    expect(element("hud-schema-error").textContent).toContain("Schema offline");
    expect(element("toast").textContent).toBe("HUD imported");
    expect(element("toast").getAttribute("data-kind")).toBe("saved");
  });

  it("retains a same-HUD dirty draft through schema failure and retry without saving unavailable controls", async () => {
    vi.useFakeTimers();
    running = true;
    await render();
    await click("hud-opt-enabled");
    expect(element("hud-opt-enabled").getAttribute("aria-checked")).toBe("true");
    api.getHudSchema.mockRejectedValueOnce(new Error("Schema offline"));
    await click("hud-refresh");
    expect(element("hud-schema-error")).toBeDefined();
    running = false;
    await render();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000);
    });
    expect(api.applyHudOptions).not.toHaveBeenCalled();
    expect(onPendingChange).toHaveBeenLastCalledWith(true);
    const retry = Array.from(container.querySelectorAll("button")).find(
      (button) => button.textContent === "Retry loading options",
    );
    await act(async () => retry?.click());
    expect(element("hud-opt-enabled").getAttribute("aria-checked")).toBe("true");
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000);
    });
    expect(api.applyHudOptions).toHaveBeenCalledWith({ enabled: "true" }, "A", "rayshud");
    expect(onPendingChange).toHaveBeenLastCalledWith(false);
  });
});
