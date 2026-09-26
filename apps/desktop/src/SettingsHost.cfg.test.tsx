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
// The Viewmodels builder is out of scope; its real in-game cvar controls are not.
vi.mock("./ViewmodelPane", async () => {
  const { ViewmodelSettings } = await import("./ViewmodelSettings");
  return {
    ViewmodelPane: ({
      profileId,
      settings,
    }: {
      profileId: string | null;
      settings?: Omit<import("./ViewmodelSettings").ViewmodelSettingsProps, "profileId">;
    }) => (settings ? <ViewmodelSettings profileId={profileId} {...settings} /> : null),
  };
});

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

function fixture(
  files: Record<string, string>,
  layer: "vanilla" | "comfig" = "vanilla",
  launchOptions = "-novid",
) {
  const onNavigate = vi.fn();
  const writeManagedCfg = vi.fn(async (path: string, text: string) => {
    files[path] = text;
  });
  const api = {
    getFilesContext: vi.fn(async () => ({ profileId: "A", root: "fixture", layer })),
    getActiveProfileDetail: vi.fn(async () => ({
      id: "A",
      layer,
      files: Object.keys(files).map((path) => ({ path })),
      launchOptions,
    })),
    readProfileFile: vi.fn(async (path: string) => ({ path, text: files[path] })),
    getComfigState: vi.fn(async () => null),
    getProfileLaunchOptions: vi.fn(async () => launchOptions),
    getHudCatalog: vi.fn(async () => ({ entries: [], warning: null })),
    getHudState: vi.fn(async () => ({ profileId: "A", installed: null, schemaSupported: false })),
    getHudStats: vi.fn(async () => ({ stats: {}, warning: null })),
    getHudSchema: vi.fn(async () => null),
    getPreloaderStatus: vi.fn(async () => null),
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
              onNavigate={onNavigate}
            />
          </AppStatusProvider>
        </ToastProvider>,
      ),
    );
  };
  return { writeManagedCfg, onNavigate, render };
}

function control<T extends HTMLElement>(selector: string): T {
  const element = node.querySelector<T>(selector);
  if (!element) throw new Error(`Missing control: ${selector}`);
  return element;
}

describe("real Gameplay save preserves cfg settings", () => {
  it("discloses Launch and class CFG overrides without blocking Viewmodels edits", async () => {
    const { render, onNavigate, writeManagedCfg } = fixture(
      {
        "tf/cfg/config.cfg": "viewmodel_fov 70\n",
        "tf/cfg/scout.cfg": "viewmodel_fov 120\n",
      },
      "vanilla",
      "+exec personal +viewmodel_fov 110",
    );
    await render("viewmodels");
    const notice = control<HTMLElement>('[data-testid="conditional-cfg-sources"]');
    expect(notice.textContent).toContain("Launch +exec personal");
    expect(notice.textContent).toContain("Launch +viewmodel_fov");
    expect(notice.textContent).toContain("tf/cfg/scout.cfg:1 — viewmodel_fov");
    const buttons = [...notice.querySelectorAll<HTMLButtonElement>("button")];
    await act(async () =>
      buttons.find((button) => button.textContent?.includes("scout.cfg"))?.click(),
    );
    expect(onNavigate).toHaveBeenCalledWith("files");
    await act(async () => buttons.find((button) => button.textContent?.includes("+exec"))?.click());
    expect(onNavigate).toHaveBeenCalledWith("launch");
    expect(control('[data-testid="settings-surface-viewmodels"]').hasAttribute("inert")).toBe(
      false,
    );
    await act(async () => control('[data-testid="viewmodel-min"]').click());
    await act(async () => vi.advanceTimersByTimeAsync(701));
    expect(writeManagedCfg).toHaveBeenCalledOnce();
  });

  it("clears a quiet autosave failure after its next successful Gameplay write", async () => {
    const { render, writeManagedCfg } = fixture({ "tf/cfg/config.cfg": "viewmodel_fov 70\n" });
    writeManagedCfg.mockRejectedValueOnce(new Error("Disk read only"));
    await render("viewmodels");
    await act(async () => control('[data-testid="viewmodel-min"]').click());
    await act(async () => vi.advanceTimersByTimeAsync(701));
    expect(node.textContent).toContain("Disk read only");

    const fov = control<HTMLInputElement>("#viewmodel-fov");
    const setValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
    if (!setValue) throw new Error("Input value setter is unavailable");
    await act(async () => {
      setValue.call(fov, "71");
      fov.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await act(async () => vi.advanceTimersByTimeAsync(701));
    expect(writeManagedCfg).toHaveBeenCalledTimes(2);
    expect(node.textContent).not.toContain("Disk read only");
    expect(node.querySelector('[data-testid="toast"]')).toBeNull();
  });

  it.each(["vanilla", "comfig"] as const)(
    "preserves mounted custom cfg precedence through an unrelated %s Gameplay save",
    async (layer) => {
      const prefix = layer === "comfig" ? "overrides/" : "";
      const { render, writeManagedCfg } = fixture(
        {
          "tf/cfg/config.cfg": "viewmodel_fov 54\n",
          [`tf/cfg/${prefix}autoexec.cfg`]: "exec personal/settings\n",
          "tf/cfg/personal/settings.cfg": "viewmodel_fov 45\n",
          "tf/custom/alpha/cfg/personal/settings.cfg": "viewmodel_fov 120\n",
          "tf/custom/-alpha/cfg/personal/settings.cfg": "viewmodel_fov 100\n",
          "tf/custom/.disabled/cfg/personal/settings.cfg": "viewmodel_fov 20\n",
        },
        layer,
      );
      await render("viewmodels");
      expect(control<HTMLInputElement>("#viewmodel-fov").value).toBe("100");
      await act(async () => control('[data-testid="viewmodel-min"]').click());
      await act(async () => vi.advanceTimersByTimeAsync(701));
      expect(writeManagedCfg).toHaveBeenCalledOnce();
      expect(writeManagedCfg.mock.calls[0][0]).toBe(`tf/cfg/${prefix}execs_gameplay.cfg`);
      expect(writeManagedCfg.mock.calls[0][1]).toContain("viewmodel_fov 100\n");
      expect(writeManagedCfg.mock.calls[0][1]).toContain("tf_use_min_viewmodels 1\n");
    },
  );

  it.each(["vanilla", "comfig"] as const)(
    "blocks saving when a custom autoexec shadows the %s managed startup route",
    async (layer) => {
      const { render, writeManagedCfg } = fixture(
        {
          "tf/cfg/config.cfg": "viewmodel_fov 54\n",
          "tf/cfg/autoexec.cfg": "viewmodel_fov 45\n",
          "tf/cfg/overrides/autoexec.cfg": "viewmodel_fov 70\n",
          "tf/custom/-alpha/cfg/autoexec.cfg": "viewmodel_fov 100\n",
        },
        layer,
      );
      await render();
      expect(control('[data-testid="settings-surface-gameplay"]').hasAttribute("inert")).toBe(true);
      expect(node.textContent).toContain("custom pack overrides");
      await act(async () => control('[data-testid="gameplay-autoreload"]').click());
      await act(async () => vi.advanceTimersByTimeAsync(701));
      expect(writeManagedCfg).not.toHaveBeenCalled();
    },
  );

  it("refuses uncertain legacy HUD projection and keeps Files available for review", async () => {
    const { render, writeManagedCfg } = fixture({
      "tf/cfg/config.cfg": "viewmodel_fov 54\n",
      "tf/cfg/autoexec.cfg": "exec hud_settings\n",
      "tf/custom/a_old/info.vdf": "HUD marker",
      "tf/custom/a_old/cfg/hud_settings.cfg": "viewmodel_fov 45\n",
      "tf/custom/z_new/Resource/UI/main.res": "HUD marker",
      "tf/custom/z_new/cfg/hud_settings.cfg": "viewmodel_fov 100\n",
    });
    await render();
    expect(control('[data-testid="settings-surface-gameplay"]').hasAttribute("inert")).toBe(true);
    expect(node.textContent).toContain("Save current as…");
    await act(async () => control('[data-testid="gameplay-autoreload"]').click());
    await act(async () => vi.advanceTimersByTimeAsync(701));
    expect(writeManagedCfg).not.toHaveBeenCalled();
    await render("files");
    expect(control('[data-testid="settings-surface-files"]').hasAttribute("inert")).toBe(false);
  });

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
      await render("viewmodels");
      expect(control('[data-testid="viewmodel-draw"]').getAttribute("aria-checked")).toBe("true");
      await act(async () => vi.advanceTimersByTimeAsync(701));
      expect(writeManagedCfg).not.toHaveBeenCalled();
      await act(async () => control('[data-testid="viewmodel-min"]').click());
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
      await render("viewmodels");
      const fov = control<HTMLInputElement>("#viewmodel-fov");
      expect(fov.min).toBe("1");
      expect(fov.max).toBe("179");
      expect(fov.step).toBe("1");
      expect(fov.value).toBe(String(Math.min(179, Math.max(1, Math.round(value)))));
      expect(fov.closest("div")?.textContent).toContain(`${value}°`);
      await act(async () => control('[data-testid="viewmodel-min"]').click());
      await act(async () => vi.advanceTimersByTimeAsync(701));
      expect(writeManagedCfg.mock.calls[0][1]).toContain(`viewmodel_fov ${value}\n`);
    },
  );

  it.each([
    ["70", 70],
    ["71", 71],
    ["1", 1],
    ["179", 179],
  ])(
    "selects whole viewmodel FOV values when the slider moves to %s",
    async (selected, expected) => {
      const { render, writeManagedCfg } = fixture({ "tf/cfg/config.cfg": "viewmodel_fov 45\n" });
      await render("viewmodels");
      const fov = control<HTMLInputElement>("#viewmodel-fov");
      expect(fov.step).toBe("1");
      const setValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
      if (!setValue) throw new Error("Input value setter is unavailable");
      await act(async () => {
        setValue.call(fov, selected);
        fov.dispatchEvent(new Event("input", { bubbles: true }));
      });
      expect(fov.closest("div")?.textContent).toContain(`${expected}°`);
      await act(async () => vi.advanceTimersByTimeAsync(701));
      expect(writeManagedCfg.mock.calls[0][1]).toContain(`viewmodel_fov ${expected}\n`);
    },
  );

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
      await render("viewmodels");
      await act(async () => control('[data-testid="viewmodel-min"]').click());
      await act(async () => vi.advanceTimersByTimeAsync(701));
      expect(writeManagedCfg.mock.calls[0][1]).toContain(
        `r_drawviewmodel ${layer === "comfig" ? 0 : 1}\n`,
      );
    },
  );

  it("blocks derived settings after incomplete execution while keeping Files available", async () => {
    const { render, writeManagedCfg, onNavigate } = fixture({
      "tf/cfg/autoexec.cfg": "r_drawviewmodel 1\nexec missing\n",
    });
    await render();
    expect(control('[data-testid="settings-surface-gameplay"]').hasAttribute("inert")).toBe(true);
    expect(node.textContent).toContain(
      "Cannot derive startup settings after tf/cfg/autoexec.cfg:2",
    );
    await act(async () => control<HTMLButtonElement>('[data-testid="review-startup-cfg"]').click());
    expect(onNavigate).toHaveBeenCalledWith("files");
    // Even a dispatched event that bypasses native inert cannot write partial maps.
    await act(async () => control('[data-testid="gameplay-autoreload"]').click());
    await act(async () => vi.advanceTimersByTimeAsync(701));
    expect(writeManagedCfg).not.toHaveBeenCalled();
    await render("files");
    expect(control('[data-testid="settings-surface-files"]').hasAttribute("inert")).toBe(false);
    expect(node.textContent).toContain("Files remain available");
  });
});
