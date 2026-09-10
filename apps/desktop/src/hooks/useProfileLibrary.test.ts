// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { AbsorbOwnedResult, Tf2Install } from "../lib/bridge";
import { emptyAbsorbDelta, previewPackDelta } from "../lib/library-ui";
import { createPreviewApi } from "../lib/preview-bridge";
import { idleSwitchProgress } from "../lib/switch-progress-ui";
import { type ProfileLibraryState, useProfileLibrary } from "./useProfileLibrary";

let root: Root;
let box: HTMLDivElement;
let api: ReturnType<typeof createPreviewApi>;
let state: ProfileLibraryState;
let busy: boolean;
let running: boolean;
let quitNonce: number;
const confirmed = { path: "C:/TF2" } as Tf2Install;
const setError = vi.fn();
const setBusy = vi.fn();
const progress = {
  state: idleSwitchProgress(),
  degraded: null,
  start: vi.fn(),
  complete: vi.fn(),
  cancel: vi.fn(),
};
function Harness() {
  state = useProfileLibrary(api, {
    confirmed,
    busy,
    running,
    quitNonce,
    progress,
    setError,
    setBusy,
  });
  return null;
}
async function render() {
  await act(async () => root.render(createElement(Harness)));
}
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  box = document.createElement("div");
  document.body.append(box);
  root = createRoot(box);
  api = createPreviewApi("settings-hud");
  busy = false;
  running = false;
  quitNonce = 1;
  vi.clearAllMocks();
});
afterEach(async () => {
  await act(async () => root.unmount());
  box.remove();
  vi.unstubAllGlobals();
});

it("absorbs once at boot without reloading panes after ordinary settings saves", async () => {
  const absorb = vi.spyOn(api, "absorbOwned");
  await render();
  expect(absorb).toHaveBeenCalledTimes(1);
  const key = state.refreshKey;
  for (let i = 0; i < 3; i++) {
    busy = true;
    await render();
    busy = false;
    await render();
  }
  expect(absorb).toHaveBeenCalledTimes(1);
  expect(state.refreshKey).toBe(key);
});

it("defers a new quit until writes finish, then consumes it exactly once", async () => {
  const absorb = vi.spyOn(api, "absorbOwned");
  await render();
  running = true;
  await render();
  running = false;
  busy = true;
  quitNonce += 1;
  await render();
  expect(absorb).toHaveBeenCalledTimes(1);
  busy = false;
  await render();
  expect(absorb).toHaveBeenCalledTimes(2);
  busy = true;
  await render();
  busy = false;
  await render();
  expect(absorb).toHaveBeenCalledTimes(2);
});

it("replaces a stale deferred pack question with the next complete snapshot", async () => {
  const library = await api.getProfileLibrary();
  vi.spyOn(api, "absorbOwned")
    .mockResolvedValueOnce({ library, delta: previewPackDelta(), configCfgAbsorbed: false })
    .mockResolvedValue({ library, delta: emptyAbsorbDelta(), configCfgAbsorbed: false });
  await render();
  expect(state.packPrompt?.packsAdded).toEqual(["toonhud"]);
  await act(async () => state.deferPackPrompt());
  expect(state.packPromptDeferred).toBe(true);
  quitNonce += 1;
  await render();
  expect(state.packPrompt).toBeNull();
});

it("never offers or answers the previous profile's pack delta on the target", async () => {
  const library = await api.getProfileLibrary();
  const target = { ...library, activeProfileId: "second" };
  let finishTarget!: (result: AbsorbOwnedResult) => void;
  vi.spyOn(api, "switchProfile").mockResolvedValue(target);
  vi.spyOn(api, "absorbOwned")
    .mockResolvedValueOnce({ library, delta: previewPackDelta(), configCfgAbsorbed: false })
    .mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finishTarget = resolve;
        }),
    );
  const answer = vi.spyOn(api, "absorbPacks");
  await render();
  expect(state.packPrompt).not.toBeNull();
  await act(async () => state.switchProfile("second"));
  expect(state.packPrompt).toBeNull();
  await act(async () => state.answerPackPrompt("restore"));
  expect(answer).not.toHaveBeenCalled();
  await act(async () =>
    finishTarget({ library: target, delta: emptyAbsorbDelta(), configCfgAbsorbed: false }),
  );
  expect(state.packPrompt).toBeNull();
});

it("refreshes settings after answering a pack choice without another absorb", async () => {
  const library = await api.getProfileLibrary();
  const absorb = vi.spyOn(api, "absorbOwned").mockResolvedValue({
    library,
    delta: previewPackDelta(),
    configCfgAbsorbed: false,
  });
  const answer = vi.spyOn(api, "absorbPacks");
  await render();
  const key = state.refreshKey;
  await act(async () => state.answerPackPrompt("update"));
  expect(answer).toHaveBeenCalledWith("update");
  expect(state.refreshKey).not.toBe(key);
  expect(state.packPrompt).toBeNull();
  expect(absorb).toHaveBeenCalledTimes(1);
});

it("retains consumed cfg drift but rejects a snapshot interrupted by a HUD save", async () => {
  const library = await api.getProfileLibrary();
  let finish!: (result: AbsorbOwnedResult) => void;
  const absorb = vi
    .spyOn(api, "absorbOwned")
    .mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    )
    .mockResolvedValue({ library, delta: emptyAbsorbDelta(), configCfgAbsorbed: false });
  await render();
  const key = state.refreshKey;
  busy = true;
  await render();
  busy = false;
  await render();
  expect(absorb).toHaveBeenCalledTimes(1);
  expect(state.refreshKey).toBe(key);
  await act(async () => finish({ library, delta: previewPackDelta(), configCfgAbsorbed: true }));
  expect(absorb).toHaveBeenCalledTimes(2);
  expect(state.packPrompt).toBeNull();
  expect(state.bindSyncRequest).toBe(1);
});

it("keeps the consumed drift signal through a failed refresh retry", async () => {
  const library = await api.getProfileLibrary();
  let finish!: (result: AbsorbOwnedResult) => void;
  const absorb = vi
    .spyOn(api, "absorbOwned")
    .mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    )
    .mockRejectedValueOnce(Error("read refused"))
    .mockResolvedValue({ library, delta: emptyAbsorbDelta(), configCfgAbsorbed: false });
  await render();
  busy = true;
  await render();
  await act(async () => finish({ library, delta: emptyAbsorbDelta(), configCfgAbsorbed: true }));
  expect(state.bindSyncRequest).toBeNull();
  busy = false;
  await render();
  expect(setError).toHaveBeenCalledWith("read refused");
  expect(absorb).toHaveBeenCalledTimes(2);
  busy = true;
  await render();
  busy = false;
  await render();
  expect(absorb).toHaveBeenCalledTimes(3);
  expect(state.bindSyncRequest).toBe(1);
});

it("rejects a stale result even after the original profile is selected again", async () => {
  const library = await api.getProfileLibrary();
  let finish!: (result: AbsorbOwnedResult) => void;
  const absorb = vi
    .spyOn(api, "absorbOwned")
    .mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    )
    .mockResolvedValue({ library, delta: emptyAbsorbDelta(), configCfgAbsorbed: false });
  await render();
  await act(async () => state.setLibrary({ ...library, activeProfileId: "second" }));
  await act(async () => state.setLibrary(library));
  expect(absorb).toHaveBeenCalledTimes(1);
  await act(async () => finish({ library, delta: previewPackDelta(), configCfgAbsorbed: true }));
  expect(absorb).toHaveBeenCalledTimes(2);
  expect(state.bindSyncRequest).toBeNull();
  expect(state.packPrompt).toBeNull();
});
