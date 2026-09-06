// biome-ignore-all lint/suspicious/noExplicitAny: Fault-injection doubles deliberately expose incomplete IPC payloads and pane props.
// The host and hooks are real; child panes expose their props and IPC is fault-injected.
import { JSDOM } from "jsdom";
import { act, createElement as h } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SettingsHost } from "./SettingsHost";

const capture = vi.hoisted(() => ({
  panes: {} as Record<string, any>,
  toast: { deferDraft: vi.fn(), startSave: vi.fn(), finishSave: vi.fn(), failSave: vi.fn() },
}));
vi.mock("./components/ui/Toast", () => ({ useToast: () => capture.toast }));
vi.mock("./hooks/useAppStatus", () => ({
  useAppStatus: () => ({ error: null }),
  AppStatusProvider: ({ children }: any) => children,
}));
vi.mock("./GameplayPane", () => ({
  GameplayPane: (p: any) => {
    capture.panes.gameplay = p;
    return null;
  },
}));
vi.mock("./LaunchPane", () => ({
  LaunchPane: (p: any) => {
    capture.panes.launch = p;
    return null;
  },
}));
vi.mock("./CrosshairPane", () => ({
  CrosshairPane: (p: any) => {
    capture.panes.crosshair = p;
    return null;
  },
}));
vi.mock("./HudPane", () => ({
  HudPane: (p: any) => {
    capture.panes.hud = p;
    return null;
  },
}));
vi.mock("./ComfigPane", () => ({ ComfigPane: () => null }));
vi.mock("./BindsPane", () => ({
  BindsPane: (p: any) => {
    capture.panes.binds = p;
    return null;
  },
}));
vi.mock("./FilesPane", () => ({ FilesPane: () => null }));
vi.mock("./ModsPane", () => ({ ModsPane: () => null }));
vi.mock("./SoundsPane", () => ({ SoundsPane: () => null }));
vi.mock("./ViewmodelPane", () => ({ ViewmodelPane: () => null }));

const dom = new JSDOM("<!doctype html><html><body></body></html>", { url: "http://localhost" });
Object.assign(globalThis, {
  window: dom.window,
  document: dom.window.document,
  IS_REACT_ACT_ENVIRONMENT: true,
});
let root: Root;
let container: HTMLElement;
const noop = () => {};
const deferred = <T>() => {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((a, b) => {
    resolve = a;
    reject = b;
  });
  return { promise, resolve, reject };
};
let api: any;
let props: any;
function requiredElement(selector: string): HTMLElement {
  const element = container.querySelector<HTMLElement>(selector);
  if (!element) throw new Error(`Missing element: ${selector}`);
  return element;
}
async function render(p: any = {}) {
  Object.assign(props, p);
  await act(async () => root.render(h(SettingsHost, props)));
}
beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  capture.panes = {};
  api = {
    getActiveProfileDetail: vi.fn(async () => ({
      id: "A",
      layer: "vanilla",
      files: [],
      launchOptions: "-novid",
      crosshair: null,
    })),
    readProfileFile: vi.fn(async (path: string) => ({ path, text: "" })),
    getComfigState: vi.fn(async () => null),
    getProfileLaunchOptions: vi.fn(async () => "-novid"),
    getStockCrosshairSprites: vi.fn(async () => ({})),
    getHudCatalog: vi.fn(async () => []),
    getHudState: vi.fn(async () => ({ installed: null, schemaSupported: false })),
    getHudStats: vi.fn(async () => ({})),
    getHudSchema: vi.fn(async () => null),
    writeOwnedFile: vi.fn(async () => ({})),
    writeManagedCfg: vi.fn(async () => ({})),
  };
  props = {
    api,
    tab: "gameplay",
    running: false,
    externalBusy: false,
    refreshKey: 1,
    bindSyncRequest: null,
    onBindSyncHandled: noop,
    onBusyChange: noop,
    onError: noop,
  };
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.useRealTimers();
});

describe("settings snapshot integrity", () => {
  it("publishes the new profile identity only with its complete cfg seed", async () => {
    const path = "tf/cfg/execs_gameplay.cfg";
    api.getActiveProfileDetail.mockResolvedValue({
      id: "A",
      layer: "vanilla",
      files: [{ path }],
      launchOptions: "-novid",
    });
    api.readProfileFile.mockResolvedValue({ path, text: "fov_desired 75\n" });
    await render();
    const file = deferred<any>();
    api.getActiveProfileDetail.mockResolvedValue({
      id: "B",
      layer: "vanilla",
      files: [{ path }],
      launchOptions: "-novid",
    });
    api.readProfileFile.mockReturnValue(file.promise);
    await render({ refreshKey: 2 });
    expect(capture.panes.gameplay.profileId).toBe("A");
    expect(capture.panes.gameplay.managedText).toBe("fov_desired 75\n");
    await act(async () => file.resolve({ path, text: "fov_desired 90\n" }));
    expect(capture.panes.gameplay.profileId).toBe("B");
    expect(capture.panes.gameplay.managedText).toBe("fov_desired 90\n");
  });
  it("preserves newer launch typing through a save response and reload", async () => {
    const pending = deferred<any>();
    api.setProfileLaunchOptions = vi.fn(() => pending.promise);
    await render({ tab: "launch" });
    await act(async () => capture.panes.launch.onChange("-novid -nojoy"));
    let saving!: Promise<any>;
    await act(async () => {
      saving = capture.panes.launch.onSave();
    });
    await act(async () => capture.panes.launch.onChange("-novid -nojoy -console"));
    expect(capture.panes.launch.value).toContain("-console");
    api.getActiveProfileDetail.mockResolvedValue({
      id: "A",
      layer: "vanilla",
      files: [],
      launchOptions: "-novid -nojoy",
    });
    await act(async () => {
      pending.resolve({ launchOptions: "-novid -nojoy", steamWrite: "steam-running" });
      await saving;
    });
    expect(capture.panes.launch.value).toBe("-novid -nojoy -console");
    expect(capture.panes.launch.saved).toBe("-novid -nojoy");
  });

  it.each(["Io", "FileTooLarge", "InvalidPath", "NotFound"])(
    "retains the last complete snapshot after %s and blocks saves until recovery",
    async (code) => {
      const path = "tf/cfg/execs_gameplay.cfg";
      api.getActiveProfileDetail.mockResolvedValue({
        id: "A",
        layer: "vanilla",
        files: [{ path }],
        launchOptions: "-novid",
      });
      api.readProfileFile.mockResolvedValue({ path, text: "fov_desired 75\n" });
      await render();
      api.readProfileFile.mockRejectedValue({ code, message: "unreadable" });
      await render({ refreshKey: 2, bindSyncRequest: 1 });
      expect(capture.panes.gameplay.managedText).toBe("fov_desired 75\n");
      expect(container.textContent).toContain(path);
      await act(async () =>
        expect(capture.panes.gameplay.onSave("fov_desired 90\n")).resolves.toBe(false),
      );
      expect(api.writeOwnedFile).not.toHaveBeenCalled();
      expect(api.writeManagedCfg).not.toHaveBeenCalled();
      api.readProfileFile.mockResolvedValue({ path, text: "fov_desired 80\n" });
      await render({ refreshKey: 3, bindSyncRequest: null });
      expect(capture.panes.gameplay.managedText).toBe("fov_desired 80\n");
      expect(container.textContent).not.toContain("Could not read settings");
    },
  );
  it("refuses unknown initial cfg bytes instead of mounting default controls", async () => {
    api.getActiveProfileDetail.mockResolvedValue({
      id: "A",
      layer: "vanilla",
      files: [{ path: "tf/cfg/config.cfg" }],
      launchOptions: "",
    });
    api.readProfileFile.mockResolvedValue({ path: "tf/cfg/config.cfg", text: null });
    await render();
    expect(capture.panes.gameplay).toBeUndefined();
    expect(container.textContent).toContain("Retry loading settings");
  });
  it("ignores a late superseded profile read", async () => {
    await render();
    const pending = deferred<any>();
    api.getActiveProfileDetail.mockResolvedValue({
      id: "B",
      layer: "vanilla",
      files: [{ path: "tf/cfg/config.cfg" }],
      launchOptions: "",
    });
    api.readProfileFile.mockReturnValue(pending.promise);
    await render({ refreshKey: 2 });
    api.getActiveProfileDetail.mockResolvedValue({
      id: "C",
      layer: "vanilla",
      files: [],
      launchOptions: "",
    });
    await render({ refreshKey: 3 });
    await act(async () => pending.resolve({ path: "tf/cfg/config.cfg", text: "fov_desired 75" }));
    expect(capture.panes.gameplay.profileId).toBe("C");
    expect(capture.panes.gameplay.managedText).toBe("");
  });
  it("serializes managed writes and sends profile identity to the atomic backend operation", async () => {
    await render({ tab: "binds" });
    const pending = deferred<any>();
    api.writeManagedCfg.mockReturnValueOnce(pending.promise).mockResolvedValue({});
    let first!: Promise<boolean>;
    await act(async () => {
      first = capture.panes.binds.onSave("bind space +jump");
    });
    await render({ tab: "gameplay" });
    let second!: Promise<boolean>;
    await act(async () => {
      second = capture.panes.gameplay.onSave("fov_desired 75");
    });
    expect(api.writeManagedCfg).toHaveBeenCalledTimes(1);
    await act(async () => {
      pending.resolve({});
      await first;
      await second;
    });
    expect(api.writeManagedCfg.mock.calls).toEqual([
      ["tf/cfg/execs_binds.cfg", "bind space +jump", "A", undefined],
      ["tf/cfg/execs_gameplay.cfg", "fov_desired 75", "A", "gameplay"],
    ]);
    expect(api.writeOwnedFile).not.toHaveBeenCalled();
  });
  it("does not publish cfg seeds when later comfig loading fails", async () => {
    await render();
    api.getActiveProfileDetail.mockResolvedValue({
      id: "B",
      layer: "vanilla",
      files: [],
      launchOptions: "-nojoy",
    });
    api.getComfigState.mockRejectedValue(new Error("comfig unavailable"));
    await render({ refreshKey: 2 });
    expect(capture.panes.gameplay.profileId).toBe("A");
    expect(container.textContent).toContain("comfig unavailable");
  });
  it("rejects a retained save callback after active profile identity changes", async () => {
    await render();
    const oldSave = capture.panes.gameplay.onSave;
    api.getActiveProfileDetail.mockResolvedValue({
      id: "B",
      layer: "vanilla",
      files: [],
      launchOptions: "",
    });
    await render({ refreshKey: 2 });
    await act(async () => expect(oldSave("fov_desired 75")).resolves.toBe(false));
    expect(api.writeManagedCfg).not.toHaveBeenCalled();
  });
  it("blocks the old pane throughout a profile transition and releases the complete replacement", async () => {
    await render();
    const surface = () => requiredElement('[data-testid="settings-surface-gameplay"]');
    expect(surface().hasAttribute("inert")).toBe(false);
    await render({ externalBusy: true });
    expect(surface().hasAttribute("inert")).toBe(true);
    const pending = deferred<any>();
    api.getActiveProfileDetail.mockResolvedValue({
      id: "B",
      layer: "vanilla",
      files: [{ path: "tf/cfg/config.cfg" }],
      launchOptions: "",
    });
    api.readProfileFile.mockReturnValue(pending.promise);
    await render({ externalBusy: false, refreshKey: 2 });
    expect(capture.panes.gameplay.profileId).toBe("A");
    expect(surface().hasAttribute("inert")).toBe(true);
    await act(async () => pending.resolve({ path: "tf/cfg/config.cfg", text: "fov_desired 80" }));
    expect(capture.panes.gameplay.profileId).toBe("B");
    expect(surface().hasAttribute("inert")).toBe(false);
  });
  it("keeps controls live during an own save and its reload, and after a running-state reload", async () => {
    await render({ tab: "launch" });
    const surface = () => requiredElement('[data-testid="settings-surface-launch"]');
    const saving = deferred<any>();
    const reloading = deferred<any>();
    api.setProfileLaunchOptions = vi.fn(() => saving.promise);
    await act(async () => capture.panes.launch.onChange("-nojoy"));
    let result!: Promise<boolean>;
    await act(async () => {
      result = capture.panes.launch.onSave();
    });
    expect(surface().hasAttribute("inert")).toBe(false);
    api.getComfigState.mockReturnValueOnce(reloading.promise);
    await act(async () => saving.resolve({ launchOptions: "-nojoy", steamWrite: "steam-running" }));
    expect(surface().hasAttribute("inert")).toBe(false);
    await act(async () => {
      reloading.resolve(null);
      await result;
    });
    await render({ running: true });
    expect(surface().hasAttribute("inert")).toBe(false);
  });
  it("keeps a failed replacement snapshot inaccessible until retry succeeds", async () => {
    await render();
    api.getActiveProfileDetail.mockResolvedValue({
      id: "B",
      layer: "vanilla",
      files: [],
      launchOptions: "",
    });
    api.getComfigState.mockRejectedValueOnce(new Error("temporarily unavailable"));
    await render({ refreshKey: 2 });
    expect(capture.panes.gameplay.profileId).toBe("A");
    expect(requiredElement('[data-testid="settings-surface-gameplay"]').hasAttribute("inert")).toBe(
      true,
    );
    const retry = Array.from(container.querySelectorAll("button")).find(
      (button) => button.textContent === "Retry loading settings",
    );
    if (!retry) throw new Error("Retry button was not rendered");
    expect(retry.closest("[inert]")).toBeNull();
    await act(async () => retry.click());
    expect(capture.panes.gameplay.profileId).toBe("B");
    expect(requiredElement('[data-testid="settings-surface-gameplay"]').hasAttribute("inert")).toBe(
      false,
    );
  });
});
