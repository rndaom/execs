// @vitest-environment jsdom
// The host, all panes, scheduler, provider, error store and profile hook are real.
// Only the native IPC boundary uses fixture data and injected failures.
import { act, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ReadyPanel } from "./components/ReadyPanel/ReadyPanel";
import { ToastProvider } from "./components/ui/Toast";
import { AppStatusProvider } from "./hooks/useAppStatus";
import { useOperationErrors } from "./hooks/useOperationErrors";
import { type ProfileLibraryState, useProfileLibrary } from "./hooks/useProfileLibrary";
import type { Tf2Install } from "./lib/bridge";
import { createPreviewApi } from "./lib/preview-bridge";
import type { SettingsTab } from "./lib/settings-ui";
import { idleSwitchProgress } from "./lib/switch-progress-ui";
import { SettingsHost } from "./SettingsHost";

let root: Root;
let box: HTMLDivElement;
let api: ReturnType<typeof createPreviewApi>;
let profiles: ProfileLibraryState;
let errors: ReturnType<typeof useOperationErrors>;
let pending: boolean;
let tab: SettingsTab;
let running: boolean;
let revision: number;
let recoveryTargetId: string | null;
const confirmed = { path: "C:/fixture/TF2" } as Tf2Install;
const noop = () => {};
const progress = {
  state: idleSwitchProgress(),
  degraded: null,
  start: noop,
  complete: noop,
  cancel: noop,
};
function Harness() {
  const [busy, setBusy] = useState(false);
  const [settingsBusy, setSettingsBusy] = useState(false);
  const [settingsPending, setSettingsPending] = useState(false);
  pending = settingsPending;
  errors = useOperationErrors();
  profiles = useProfileLibrary(api, {
    confirmed,
    running,
    busy,
    quitNonce: 0,
    progress,
    setError: errors.setError,
    setBusy,
  });
  return (
    <AppStatusProvider
      value={{ ...errors, busy: busy || settingsBusy || settingsPending, running }}
    >
      <ToastProvider>
        <ReadyPanel
          path={confirmed.path}
          profiles={profiles}
          progress={progress}
          draftName=""
          launching={false}
          recoveryTargetId={recoveryTargetId}
          onDraftName={noop}
          onSave={noop}
          onCreateNew={noop}
          onChangeInstall={noop}
          onLaunch={noop}
          onCancelLaunch={noop}
          settings={
            <SettingsHost
              api={api}
              tab={tab}
              running={running}
              externalBusy={busy}
              refreshKey={`${profiles.refreshKey}:${revision}`}
              bindSyncRequest={null}
              onBindSyncHandled={noop}
              onBusyChange={setSettingsBusy}
              onPendingChange={setSettingsPending}
              onError={errors.setError}
            />
          }
        />
      </ToastProvider>
    </AppStatusProvider>
  );
}
async function render() {
  await act(async () => root.render(<Harness />));
}
function element<T extends HTMLElement = HTMLElement>(id: string): T {
  const value = box.querySelector<T>(`[data-testid="${id}"]`);
  if (!value) throw new Error(`Missing ${id}`);
  return value;
}
function toast() {
  return box.querySelector('[data-testid="toast"]')?.textContent ?? null;
}
async function click(id: string) {
  await act(async () => element(id).click());
}
async function advance(ms: number) {
  await act(async () => vi.advanceTimersByTimeAsync(ms));
}
function deferred<T>() {
  let resolve!: (result: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.useFakeTimers();
  vi.spyOn(HTMLMediaElement.prototype, "pause").mockImplementation(() => {});
  localStorage.clear();
  box = document.createElement("div");
  document.body.append(box);
  root = createRoot(box);
  api = createPreviewApi("settings-hud-installed");
  tab = "hud";
  running = false;
  revision = 0;
  recoveryTargetId = null;
});
afterEach(async () => {
  await act(async () => root.unmount());
  box.remove();
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("retained settings feedback", () => {
  it("keeps incomplete startup cfgs blocked through the retained-pane boundary", async () => {
    tab = "gameplay";
    await api.writeOwnedFile("tf/cfg/overrides/autoexec.cfg", "exec overrides/missing\n");
    const save = vi.spyOn(api, "writeManagedCfg");
    await render();
    expect(element("settings-surface-gameplay").hasAttribute("inert")).toBe(true);
    expect(box.textContent).toContain("Startup settings could not be resolved");
    // Fault-inject a queued input despite the inert UI. The write path must
    // still reject an incomplete snapshot, including a retained-pane flush.
    await click("gameplay-draw-viewmodel");
    await advance(700);
    expect(save).not.toHaveBeenCalled();
    expect(toast()).toContain("Startup settings could not be resolved");
    expect(pending).toBe(true);
  });

  it("attributes delayed HUD failures after navigation, keeps them through Sounds success and resolves HUD retry", async () => {
    const first = deferred<Awaited<ReturnType<typeof api.applyHudOptions>>>();
    const save = vi.spyOn(api, "applyHudOptions").mockReturnValueOnce(first.promise);
    await render();
    await click("hud-opt-minmode");
    tab = "sounds";
    await render();
    expect(save).toHaveBeenCalledTimes(1);
    await act(async () =>
      first.reject(
        new Error("Minmode (minmode), scripts/hudanimations_custom.txt: expected VDF string"),
      ),
    );
    expect(toast()).toContain("Could not save HUD options");
    expect(toast()).toContain("scripts/hudanimations_custom.txt");
    expect(element("settings-surface-hud").hidden).toBe(true);
    expect(pending).toBe(true);
    await click("sounds-hit-enabled");
    await advance(700);
    expect(toast()).toContain("Could not save HUD options");
    expect(pending).toBe(true);
    tab = "hud";
    await render();
    tab = "sounds";
    await render();
    expect(save).toHaveBeenCalledTimes(2);
    expect(toast()).toBe("HUD options saved");
    expect(pending).toBe(false);
  });

  it("clears a reverted locked draft and an unlock with no work without writing", async () => {
    tab = "gameplay";
    running = true;
    const save = vi.spyOn(api, "writeManagedCfg");
    await render();
    await click("gameplay-draw-viewmodel");
    expect(toast()).toBe("Draft kept until TF2 closes");
    await click("gameplay-draw-viewmodel");
    expect(toast()).toBeNull();
    expect(pending).toBe(false);
    running = false;
    await render();
    await advance(5000);
    expect(save).not.toHaveBeenCalled();
    expect(toast()).toBeNull();
  });

  it("keeps deferred feedback until every retained pane has reverted its draft", async () => {
    running = true;
    await render();
    await click("hud-opt-minmode");
    tab = "gameplay";
    await render();
    await click("gameplay-draw-viewmodel");
    await click("gameplay-draw-viewmodel");
    expect(toast()).toBe("Draft kept until TF2 closes");
    expect(pending).toBe(true);
    tab = "hud";
    await render();
    await click("hud-opt-minmode");
    expect(toast()).toBeNull();
    expect(pending).toBe(false);
  });

  it("ends the wait-for-TF2 notice on unlock while a failed retry keeps its draft protected", async () => {
    running = true;
    vi.spyOn(api, "applyHudOptions").mockRejectedValue(new Error("HUD file is read-only"));
    await render();
    await click("hud-opt-minmode");
    expect(toast()).toBe("Draft kept until TF2 closes");
    running = false;
    await render();
    expect(toast()).toContain("Could not save HUD options");
    await click("toast");
    expect(toast()).toBeNull();
    expect(pending).toBe(true);
    expect(element<HTMLButtonElement>("launch-tf2").disabled).toBe(true);
  });

  it("does not let a save for another profile resolve the original profile's failure", async () => {
    vi.spyOn(api, "applyHudOptions").mockRejectedValueOnce(new Error("original HUD failed"));
    await render();
    await click("hud-opt-minmode");
    await advance(700);
    expect(toast()).toContain("original HUD failed");
    const originalSource = element("toast").dataset.source;
    const target = (await api.saveCurrentAs("Second profile")).profiles.find(
      (profile) => profile.id !== profiles.library?.activeProfileId,
    );
    if (!target) throw new Error("Fixture needs a second profile");
    await api.switchProfile(target.id);
    revision += 1;
    await render();
    await click("hud-opt-minmode");
    await advance(700);
    expect(toast()).toContain("Could not save HUD options");
    expect(element("toast").dataset.source).toBe(originalSource);
    expect(pending).toBe(false);
  });
});

describe("operation errors across host reloads", () => {
  it("retains export failure through busy release, successful reads and retry cancellation until successful export", async () => {
    const exportCall = vi
      .spyOn(api, "exportProfile")
      .mockRejectedValueOnce(new Error("Export destination is read-only"));
    const reads = vi.spyOn(api, "getActiveProfileDetail");
    await render();
    const id = profiles.library?.activeProfileId;
    if (!id) throw new Error("No fixture profile");
    await act(async () => profiles.exportProfile(id));
    const readsAfterExport = reads.mock.calls.length;
    revision += 1;
    await render();
    expect(reads.mock.calls.length).toBeGreaterThan(readsAfterExport);
    expect(errors.error).toBe("Export destination is read-only");
    await act(async () => profiles.exportProfile(id));
    expect(errors.error).toBe("Export destination is read-only");
    const retry = deferred<string | null>();
    exportCall.mockReturnValueOnce(retry.promise);
    let pendingExport!: Promise<void>;
    await act(async () => {
      pendingExport = profiles.exportProfile(id);
    });
    expect(errors.error).toBe("Export destination is read-only");
    await act(async () => {
      retry.resolve("C:/fixture/export.zip");
      await pendingExport;
    });
    expect(errors.error).toBeNull();
  });

  it("dismisses feedback with a button or Escape while preserving recovery and pending draft guards", async () => {
    await render();
    recoveryTargetId = "pending-profile";
    await render();
    await act(async () => errors.setError("Export destination is read-only", "profiles:export"));
    const dismiss = Array.from(box.querySelectorAll("button")).find(
      (button) => button.textContent === "Dismiss error",
    );
    await act(async () => dismiss?.click());
    expect(errors.error).toBeNull();
    expect(element("switch-recovery-pending").textContent).toContain("interrupted");
    expect(element<HTMLButtonElement>("launch-tf2").disabled).toBe(true);
    recoveryTargetId = null;
    running = true;
    await render();
    await click("hud-opt-minmode");
    await act(async () => errors.setError("Export failed again", "profiles:export"));
    await act(async () => window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" })));
    expect(errors.error).toBeNull();
    expect(pending).toBe(true);
    expect(toast()).toBe("Draft kept until TF2 closes");
  });
});
