// @vitest-environment jsdom
// biome-ignore-all lint/suspicious/noExplicitAny: Pane stubs expose real host callbacks and controlled IPC cancellation.
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ToastProvider } from "./components/ui/Toast";
import { AppStatusProvider } from "./hooks/useAppStatus";
import { SettingsHost } from "./SettingsHost";

const capture = vi.hoisted(() => ({ panes: {} as Record<string, any> }));
vi.mock("./ComfigPane", () => ({
  ComfigPane: (p: any) => {
    capture.panes.comfig = p;
    return null;
  },
}));
vi.mock("./HudPane", () => ({
  HudPane: (p: any) => {
    capture.panes.hud = p;
    return null;
  },
}));
vi.mock("./ModsPane", () => ({
  ModsPane: (p: any) => {
    capture.panes.mods = p;
    return null;
  },
}));
vi.mock("./ViewmodelPane", () => ({
  ViewmodelPane: (p: any) => {
    capture.panes.viewmodels = p;
    return null;
  },
}));

let root: Root;
let box: HTMLElement;
let api: any;
let props: any;
const detail = { id: "A", layer: "vanilla", files: [], launchOptions: "" };
const cases = [
  ["hud", "onImportArchive", "importHudArchive", "HUD imported"],
  ["hud", "onImportFolder", "importHudFolder", "HUD imported"],
  ["mods", "onImportArchive", "importModArchive", "Mod imported"],
  ["mods", "onImportFolder", "importModFolder", "Mod imported"],
  ["viewmodels", "onImport", "importViewmodels", "Pack imported"],
  ["comfig", "onImportCustom", "importComfigCustom", "comfig-custom imported"],
] as const;

beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  box = document.createElement("div");
  document.body.append(box);
  root = createRoot(box);
  capture.panes = {};
  api = {
    getActiveProfileDetail: vi.fn(async () => detail),
    getComfigState: vi.fn(async () => null),
    getHudCatalog: vi.fn(async () => []),
    getHudStats: vi.fn(async () => ({})),
    getHudState: vi.fn(async () => ({ installed: null, schemaSupported: false })),
    getHudSchema: vi.fn(async () => null),
    getPreloaderStatus: vi.fn(async () => ({})),
    ...Object.fromEntries(cases.map(([, , command]) => [command, vi.fn(async () => detail)])),
  };
  props = {
    api,
    running: false,
    externalBusy: false,
    refreshKey: 1,
    bindSyncRequest: null,
    onBindSyncHandled: vi.fn(),
    onBusyChange: vi.fn(),
    onError: vi.fn(),
  };
});
afterEach(async () => {
  await act(async () => root.unmount());
  box.remove();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("picker cancellation through SettingsHost and ToastProvider", () => {
  it.each(cases)(
    "balances %s %s after cancel, failure and successful retry",
    async (tab, callback, command, message) => {
      await act(async () =>
        root.render(
          <ToastProvider>
            <AppStatusProvider
              value={{ running: false, busy: false, error: null, setError: props.onError }}
            >
              <SettingsHost {...props} tab={tab} />
            </AppStatusProvider>
          </ToastProvider>,
        ),
      );
      let cancel!: (result: null) => void;
      api[command].mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            cancel = resolve;
          }),
      );
      let result!: Promise<boolean>;
      await act(async () => {
        result = capture.panes[tab][callback](false);
      });
      expect(props.onBusyChange).toHaveBeenLastCalledWith(true);
      const reads = api.getComfigState.mock.calls.length;
      await act(async () => vi.advanceTimersByTimeAsync(1000));
      expect(box.querySelector('[data-testid="toast"]')).toBeNull();
      await act(async () => {
        cancel(null);
        expect(await result).toBe(false);
      });
      expect(props.onBusyChange).toHaveBeenLastCalledWith(false);
      expect(api.getComfigState).toHaveBeenCalledTimes(reads);
      expect(box.querySelector('[data-testid="toast"]')).toBeNull();
      await act(async () => vi.advanceTimersByTimeAsync(1000));
      expect(box.querySelector('[data-testid="toast"]')).toBeNull();

      api[command].mockRejectedValueOnce(new Error("injected import failure"));
      await act(async () => expect(capture.panes[tab][callback](false)).resolves.toBe(false));
      expect(props.onBusyChange).toHaveBeenLastCalledWith(false);
      expect(box.querySelector('[data-testid="toast"]')?.textContent).toContain(
        "injected import failure",
      );
      api[command].mockResolvedValueOnce(null);
      await act(async () => expect(capture.panes[tab][callback](false)).resolves.toBe(false));
      expect(props.onBusyChange).toHaveBeenLastCalledWith(false);
      expect(box.querySelector('[data-testid="toast"]')?.textContent).toContain(
        "injected import failure",
      );
      await act(async () => expect(capture.panes[tab][callback](false)).resolves.toBe(true));
      expect(props.onBusyChange).toHaveBeenLastCalledWith(false);
      expect(box.querySelector('[data-testid="toast"]')?.textContent).toBe(message);
      expect(api[command]).toHaveBeenCalledTimes(4);
    },
  );
});
