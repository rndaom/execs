// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { AppSettingsPane } from "./AppSettingsPane";
import { ToastProvider } from "./components/ui/Toast";
import { useAppPreferences } from "./hooks/useAppPreferences";
import type { AppUpdateState } from "./hooks/useAppUpdate";
import type { Api } from "./lib/api";
import { DEFAULT_APP_PREFERENCES } from "./lib/app-settings-ui";
import { createPreviewApi } from "./lib/preview-bridge";

let container: HTMLDivElement;
let root: Root;
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  localStorage.clear();
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  localStorage.clear();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function button(label: string) {
  const result = [...container.querySelectorAll("button")].find(
    (node) => node.textContent?.trim() === label,
  );
  if (!result) throw Error(`Missing button: ${label}`);
  return result;
}

async function renderSettings({
  api = createPreviewApi("empty"),
  confirmedRoot = null,
  changeInstallDisabled = false,
  ready = true,
}: {
  api?: Api;
  confirmedRoot?: string | null;
  changeInstallDisabled?: boolean;
  ready?: boolean;
} = {}) {
  const changeInstall = vi.fn();
  const update: AppUpdateState = {
    version: "0.1.8",
    available: null,
    dismissed: false,
    checking: false,
    progress: null,
    checkMessage: null,
    check: vi.fn().mockResolvedValue(undefined),
    install: vi.fn().mockResolvedValue(undefined),
    dismiss: vi.fn(),
  };
  function Harness() {
    const settings = useAppPreferences(api);
    return (
      <ToastProvider>
        <AppSettingsPane
          api={api}
          settings={settings}
          update={update}
          confirmedRoot={confirmedRoot}
          onChangeInstall={changeInstall}
          changeInstallDisabled={changeInstallDisabled}
          changeInstallReason={changeInstallDisabled ? "Finish the profile switch first." : null}
          ready={ready}
        />
      </ToastProvider>
    );
  }
  await act(async () => root.render(<Harness />));
  return {
    api,
    update,
    changeInstall,
    async setReady(next: boolean) {
      ready = next;
      await act(async () => root.render(<Harness />));
    },
  };
}

it("waits for close protection before editing preferences while copy and checks stay available", async () => {
  const api = createPreviewApi("empty");
  const save = vi.spyOn(api, "setAppPreferences");
  const copy = vi.fn().mockResolvedValue(undefined);
  vi.stubGlobal("navigator", { clipboard: { writeText: copy } });
  const { update, setReady } = await renderSettings({ api, ready: false });
  const startup = container.querySelector<HTMLButtonElement>('[data-testid="app-startup-updates"]');
  const motion = container.querySelector<HTMLInputElement>('[data-testid="app-motion-reduce"]');
  expect(startup?.disabled).toBe(true);
  expect(motion?.disabled).toBe(true);
  await act(async () => {
    startup?.click();
    motion?.click();
  });
  expect(save).not.toHaveBeenCalled();
  await act(async () => button("Check for updates").click());
  expect(update.check).toHaveBeenCalledOnce();
  await act(async () => button("Copy data location").click());
  expect(copy).toHaveBeenCalledOnce();
  expect(button("Report a bug").disabled).toBe(false);
  await setReady(true);
  expect(startup?.disabled).toBe(false);
  expect(motion?.disabled).toBe(false);
  await act(async () => motion?.click());
  expect(save).toHaveBeenCalledExactlyOnceWith({
    checkForUpdatesOnStartup: true,
    motion: "reduce",
  });
});

it("offers global preferences and manual update checks before a profile exists", async () => {
  const { api, update, changeInstall } = await renderSettings();
  expect(container.textContent).toContain("No TF2 folder confirmed yet.");
  expect(button("Copy install location").disabled).toBe(true);
  await act(async () => button("Find TF2").click());
  expect(changeInstall).toHaveBeenCalledOnce();
  const startup = container.querySelector<HTMLButtonElement>('[data-testid="app-startup-updates"]');
  expect(startup?.getAttribute("aria-checked")).toBe("true");
  await act(async () => startup?.click());
  expect((await api.getAppSettings()).preferences.checkForUpdatesOnStartup).toBe(false);
  await act(async () => button("Check for updates").click());
  expect(update.check).toHaveBeenCalledOnce();
  expect(container.textContent).toContain("App settings saved");
});

it("keeps global preferences usable when changing installs is blocked", async () => {
  const { api, changeInstall } = await renderSettings({
    confirmedRoot: "D:\\Games\\Team Fortress 2",
    changeInstallDisabled: true,
  });
  expect(button("Change install").disabled).toBe(true);
  expect(container.textContent).toContain("Finish the profile switch first.");
  const motion = container.querySelector<HTMLInputElement>('[data-testid="app-motion-reduce"]');
  expect(motion?.disabled).toBe(false);
  await act(async () => motion?.click());
  expect((await api.getAppSettings()).preferences.motion).toBe("reduce");
  expect(document.documentElement.dataset.motion).toBe("reduce");
  expect(changeInstall).not.toHaveBeenCalled();
});

it.each([
  {
    rootPath: "D:\\Steam\\steamapps\\common\\Team Fortress 2",
    dataPath: "C:\\Users\\Player\\AppData\\Roaming\\execs",
  },
  {
    rootPath: "/home/player/.steam/steam/steamapps/common/Team Fortress 2",
    dataPath: "/home/player/.local/share/execs",
  },
])("copies exact platform paths without rewriting them", async ({ rootPath, dataPath }) => {
  const api = createPreviewApi("empty");
  vi.spyOn(api, "getAppSettings").mockResolvedValue({
    preferences: DEFAULT_APP_PREFERENCES,
    dataDirectory: dataPath,
  });
  const copy = vi.fn().mockResolvedValue(undefined);
  vi.stubGlobal("navigator", { clipboard: { writeText: copy } });
  await renderSettings({ api, confirmedRoot: rootPath });
  await act(async () => button("Copy install location").click());
  expect(copy).toHaveBeenLastCalledWith(rootPath);
  await act(async () => button("Copy data location").click());
  expect(copy).toHaveBeenLastCalledWith(dataPath);
});

it("surfaces a failed preference write and retries it without losing the prior saved setting", async () => {
  const api = createPreviewApi("empty");
  const setPreferences = vi.spyOn(api, "setAppPreferences");
  setPreferences.mockRejectedValueOnce(Error("Could not write settings: disk full"));
  await renderSettings({ api });
  const startup = container.querySelector<HTMLButtonElement>('[data-testid="app-startup-updates"]');
  await act(async () => startup?.click());
  expect(container.textContent).toContain("Could not write settings: disk full");
  expect(startup?.getAttribute("aria-checked")).toBe("true");
  await act(async () => button("Retry app settings").click());
  expect(startup?.getAttribute("aria-checked")).toBe("false");
  expect(container.querySelector('[data-testid="app-settings-error"]')).toBeNull();
  expect(container.textContent).toContain("App settings saved");
});

it("does not invent diagnostics after a read failure", async () => {
  const api = createPreviewApi("empty");
  vi.spyOn(api, "getDiagnostics").mockRejectedValue(Error("Diagnostics could not be read"));
  const copy = vi.fn();
  vi.stubGlobal("navigator", { clipboard: { writeText: copy } });
  await renderSettings({ api });
  await act(async () => button("Copy diagnostics").click());
  expect(copy).not.toHaveBeenCalled();
  expect(container.textContent).toContain("Diagnostics could not be read");
});
