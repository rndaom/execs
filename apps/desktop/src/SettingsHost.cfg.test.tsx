// @vitest-environment jsdom
// The host, Gameplay controls, cfg evaluator and autosave hooks are real.
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ToastProvider } from "./components/ui/Toast";
import { AppStatusProvider } from "./hooks/useAppStatus";
import type { Api } from "./lib/api";
import type { SettingsTab } from "./lib/settings-ui";
import { SettingsHost } from "./SettingsHost";

vi.mock("./LaunchPane", () => ({ LaunchPane: () => null }));
vi.mock("./CrosshairPane", () => ({ CrosshairPane: () => null }));
vi.mock("./HudPane", () => ({ HudPane: () => null }));
vi.mock("./ComfigPane", () => ({ ComfigPane: () => null }));
vi.mock("./BindsPane", () => ({ BindsPane: () => null }));
vi.mock("./FilesPane", () => ({ FilesPane: () => <p>Files remain available</p> }));
vi.mock("./ModsPane", () => ({ ModsPane: () => null }));
vi.mock("./SoundsPane", () => ({ SoundsPane: () => null }));
vi.mock("./ViewmodelPane", () => ({ ViewmodelPane: () => null }));

let node: HTMLDivElement;
let root: Root;
const noop = () => {};

beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  node = document.createElement("div");
  document.body.append(node);
  root = createRoot(node);
});
afterEach(async () => {
  await act(async () => root.unmount());
  node.remove();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

function fixture(files: Record<string, string>, layer: "vanilla" | "comfig" = "vanilla") {
  const writeManagedCfg = vi.fn(async (path: string, text: string) => {
    files[path] = text;
  });
  const api = {
    getActiveProfileDetail: vi.fn(async () => ({
      id: "A",
      layer,
      files: Object.keys(files).map((path) => ({ path })),
      launchOptions: "-novid",
    })),
    readProfileFile: vi.fn(async (path: string) => ({ path, text: files[path] })),
    getComfigState: vi.fn(async () => null),
    getProfileLaunchOptions: vi.fn(async () => "-novid"),
    getHudCatalog: vi.fn(async () => []),
    getHudState: vi.fn(async () => ({ installed: null, schemaSupported: false })),
    getHudStats: vi.fn(async () => ({})),
    getHudSchema: vi.fn(async () => null),
    writeManagedCfg,
  } as unknown as Api;
  const render = async (tab: SettingsTab = "gameplay") => {
    await act(async () =>
      root.render(
        <ToastProvider>
          <AppStatusProvider value={{ error: null, setError: noop, running: false, busy: false }}>
            <SettingsHost
              api={api}
              tab={tab}
              running={false}
              externalBusy={false}
              refreshKey={1}
              bindSyncRequest={null}
              onBindSyncHandled={noop}
              onBusyChange={noop}
              onError={noop}
            />
          </AppStatusProvider>
        </ToastProvider>,
      ),
    );
  };
  return { writeManagedCfg, render };
}

function control<T extends HTMLElement>(selector: string): T {
  const element = node.querySelector<T>(selector);
  if (!element) throw new Error(`Missing control: ${selector}`);
  return element;
}

describe("real Gameplay save preserves cfg settings", () => {
  it.each([
    'bind f "r_drawviewmodel 0"',
    'alias hidehands "r_drawviewmodel 0"',
    'alias hidehands "exec optional"\nbind f hidehands',
    "",
  ])(
    "keeps startup viewmodels after an unrelated toggle with deferred commands: %s",
    async (payload) => {
      const { render, writeManagedCfg } = fixture({
        "tf/cfg/config.cfg": "r_drawviewmodel 0\n",
        "tf/cfg/autoexec.cfg": `r_drawviewmodel 1\n${payload}\n`,
        "tf/cfg/optional.cfg": "r_drawviewmodel 0\n",
        "tf/cfg/medic.cfg": "r_drawviewmodel 0\n",
      });
      await render();
      expect(control('[data-testid="gameplay-draw-viewmodel"]').getAttribute("aria-checked")).toBe(
        "true",
      );
      await act(async () => vi.advanceTimersByTimeAsync(701));
      expect(writeManagedCfg).not.toHaveBeenCalled();
      await act(async () => control('[data-testid="gameplay-min-viewmodels"]').click());
      await act(async () => vi.advanceTimersByTimeAsync(701));
      expect(writeManagedCfg).toHaveBeenCalledTimes(1);
      expect(writeManagedCfg.mock.calls[0][1]).toContain("r_drawviewmodel 1\n");
      expect(writeManagedCfg.mock.calls[0][1]).toContain("tf_use_min_viewmodels 1\n");
    },
  );

  it.each(
    [0.1, 45, 54.12345, 100, 179.9].flatMap((value) =>
      ["tf/cfg/config.cfg", "tf/cfg/execs_gameplay.cfg"].map((path) => ({ value, path })),
    ),
  )(
    "preserves viewmodel FOV $value from $path in the real control and save",
    async ({ value, path }) => {
      const { render, writeManagedCfg } = fixture({
        [path]: `viewmodel_fov ${value}\n`,
      });
      await render();
      const fov = control<HTMLInputElement>("#gameplay-viewmodel-fov");
      expect(fov.min).toBe("0.1");
      expect(fov.max).toBe("179.9");
      expect(fov.closest("div")?.textContent).toContain(`${value}°`);
      await act(async () => control('[data-testid="gameplay-min-viewmodels"]').click());
      await act(async () => vi.advanceTimersByTimeAsync(701));
      expect(writeManagedCfg.mock.calls[0][1]).toContain(`viewmodel_fov ${value}\n`);
    },
  );

  it("allows an intentional fractional viewmodel FOV edit", async () => {
    const { render, writeManagedCfg } = fixture({ "tf/cfg/config.cfg": "viewmodel_fov 45\n" });
    await render();
    const fov = control<HTMLInputElement>("#gameplay-viewmodel-fov");
    const setValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
    if (!setValue) throw new Error("Input value setter is unavailable");
    await act(async () => {
      setValue.call(fov, "100.5");
      fov.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await act(async () => vi.advanceTimersByTimeAsync(701));
    expect(writeManagedCfg.mock.calls[0][1]).toContain("viewmodel_fov 100.5\n");
  });

  it.each(["vanilla", "comfig"] as const)(
    "uses override autoexec only for the %s layer",
    async (layer) => {
      const { render, writeManagedCfg } = fixture(
        {
          "tf/cfg/config.cfg": "r_drawviewmodel 0\n",
          "tf/cfg/autoexec.cfg": "r_drawviewmodel 1\n",
          "tf/cfg/overrides/autoexec.cfg": "exec overrides/selected\n",
          "tf/cfg/overrides/selected.cfg": "r_drawviewmodel 0\n",
        },
        layer,
      );
      await render();
      await act(async () => control('[data-testid="gameplay-min-viewmodels"]').click());
      await act(async () => vi.advanceTimersByTimeAsync(701));
      expect(writeManagedCfg.mock.calls[0][1]).toContain(
        `r_drawviewmodel ${layer === "comfig" ? 0 : 1}\n`,
      );
    },
  );

  it("blocks derived settings after incomplete execution while keeping Files available", async () => {
    const { render, writeManagedCfg } = fixture({
      "tf/cfg/autoexec.cfg": "r_drawviewmodel 1\nexec missing\n",
    });
    await render();
    expect(control('[data-testid="settings-surface-gameplay"]').hasAttribute("inert")).toBe(true);
    expect(node.textContent).toContain("Startup settings could not be resolved");
    // Even a dispatched event that bypasses native inert cannot write partial maps.
    await act(async () => control('[data-testid="gameplay-min-viewmodels"]').click());
    await act(async () => vi.advanceTimersByTimeAsync(701));
    expect(writeManagedCfg).not.toHaveBeenCalled();
    await render("files");
    expect(control('[data-testid="settings-surface-files"]').hasAttribute("inert")).toBe(false);
    expect(node.textContent).toContain("Files remain available");
  });
});
