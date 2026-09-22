// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { AbsorbOwnedResult, Tf2Install } from "../lib/bridge";
import { BridgeError } from "../lib/bridge";
import { emptyAbsorbDelta, previewPackDelta, previewSavedProfile } from "../lib/library-ui";
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
const onHudReviewRequired = vi.fn();
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
    onHudReviewRequired,
  });
  return null;
}
function must<T>(value: T | null | undefined): T {
  if (value == null) throw new Error("Required test fixture is missing");
  return value;
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

it("cancelled profile deletion never calls the native delete or switch", async () => {
  const remove = vi.spyOn(api, "deleteProfile");
  const change = vi.spyOn(api, "switchProfile");
  await render();
  await act(async () => state.reviewDelete(must(must(state.library).activeProfileId)));
  expect(state.deleteTarget).not.toBeNull();
  await act(async () => state.cancelDelete());
  expect(state.deleteTarget).toBeNull();
  expect(remove).not.toHaveBeenCalled();
  expect(change).not.toHaveBeenCalled();
});

it("active and last profile deletion requires the explicit keep-installed choice", async () => {
  const remove = vi.spyOn(api, "deleteProfile");
  await render();
  const id = must(must(state.library).activeProfileId);
  await act(async () => state.reviewDelete(id));
  await act(async () => state.confirmDelete(false));
  expect(remove).not.toHaveBeenCalled();
  expect(state.deleteError).toContain("Choose another profile");
  await act(async () => state.confirmDelete(true));
  expect(remove).toHaveBeenCalledWith(id, true);
  expect(must(state.library).activeProfileId).toBeNull();
  expect(must(state.library).profiles).toHaveLength(0);
  expect(state.deleteTarget).toBeNull();
});

it("switch-first deletion waits for a verified replacement and keeps the target on failure", async () => {
  await render();
  const before = must(state.library);
  const replacement = previewSavedProfile("Other", 9);
  await act(async () =>
    state.setLibrary({ ...before, profiles: [...before.profiles, replacement] }),
  );
  const change = vi
    .spyOn(api, "switchProfile")
    .mockRejectedValueOnce(new Error("Switch failed; re-apply"));
  const remove = vi.spyOn(api, "deleteProfile");
  await act(async () => state.reviewDelete(must(before.activeProfileId)));
  await act(async () => state.confirmDelete(false, replacement.id));
  expect(change).toHaveBeenCalledWith(replacement.id);
  expect(remove).not.toHaveBeenCalled();
  expect(state.deleteTarget?.id).toBe(before.activeProfileId);
  expect(state.deleteError).toContain("Switch failed");
  expect(progress.cancel).toHaveBeenCalled();
});

it("switch-first deletion publishes the replacement before deleting the outgoing library", async () => {
  await render();
  const before = must(state.library);
  const replacement = previewSavedProfile("Other", 9);
  const library = { ...before, profiles: [...before.profiles, replacement] };
  await act(async () => state.setLibrary(library));
  vi.spyOn(api, "absorbOwned").mockResolvedValue({
    library: { ...library, activeProfileId: replacement.id, profiles: [replacement] },
    delta: emptyAbsorbDelta(),
    configCfgAbsorbed: false,
  });
  const calls: string[] = [];
  vi.spyOn(api, "switchProfile").mockImplementation(async (id) => {
    calls.push(`switch:${id}`);
    return { ...library, activeProfileId: id };
  });
  const remove = vi.spyOn(api, "deleteProfile").mockImplementation(async (id) => {
    calls.push(`delete:${id}`);
    return { ...library, activeProfileId: replacement.id, profiles: [replacement] };
  });
  await act(async () => state.reviewDelete(must(before.activeProfileId)));
  await act(async () => state.confirmDelete(false, replacement.id));
  expect(calls).toEqual([`switch:${replacement.id}`, `delete:${before.activeProfileId}`]);
  expect(remove).toHaveBeenCalledWith(before.activeProfileId, false);
  expect(must(state.library).activeProfileId).toBe(replacement.id);
  expect(state.deleteTarget).toBeNull();
});

it("keeps a reviewed deletion harmless when TF2 starts before confirmation", async () => {
  const remove = vi.spyOn(api, "deleteProfile");
  await render();
  await act(async () => state.reviewDelete(must(must(state.library).activeProfileId)));
  running = true;
  await render();
  await act(async () => state.confirmDelete(true));
  expect(remove).not.toHaveBeenCalled();
  expect(state.deleteTarget).not.toBeNull();
});

it("keeps multi-HUD import review unconfirmed until a valid explicit choice", async () => {
  vi.spyOn(api, "importProfile").mockResolvedValue({
    token: "hud-review",
    name: "Two HUDs",
    files: 32,
    skippedFiles: 0,
    creator: false,
    warnings: [],
    notes: [],
    huds: ["toonhud", "rayshud"],
    selectedHud: "toonhud",
  });
  await render();
  const confirm = vi.spyOn(api, "confirmProfileImport").mockResolvedValue(must(state.library));
  await act(async () => state.importProfile());
  expect(state.importReview?.selectedHud).toBeNull();
  await act(async () => state.confirmImport());
  expect(confirm).not.toHaveBeenCalled();
  await act(async () => state.selectImportHud("unknown"));
  expect(state.importReview?.selectedHud).toBeNull();
  await act(async () => state.selectImportHud("rayshud"));
  expect(state.importReview?.selectedHud).toBe("rayshud");
  await act(async () => state.confirmImport());
  expect(confirm).toHaveBeenCalledWith("hud-review", "rayshud");
});

it.each([
  ["HudReviewRequired", "target"],
  ["HudLiveReviewRequired", "active"],
])(
  "routes %s from switching to the correct profile after clearing the write gate",
  async (code, owner) => {
    await render();
    const active = must(state.library).activeProfileId;
    vi.spyOn(api, "switchProfile").mockRejectedValue(new BridgeError("Choose one HUD", code));
    await act(async () => state.switchProfile("target"));
    expect(onHudReviewRequired).toHaveBeenCalledWith(owner === "target" ? "target" : active);
    expect(setBusy).toHaveBeenLastCalledWith(false);
    expect(setBusy.mock.invocationCallOrder.at(-1)).toBeLessThan(
      must(onHudReviewRequired.mock.invocationCallOrder.at(-1)),
    );
    expect(progress.cancel).toHaveBeenCalled();
  },
);

it("routes active HUD conflicts from absorb without turning them into a generic failure", async () => {
  const library = await api.getProfileLibrary();
  vi.spyOn(api, "absorbOwned").mockRejectedValue(
    new BridgeError("Choose one HUD", "HudLiveReviewRequired"),
  );
  await render();
  expect(onHudReviewRequired).toHaveBeenCalledWith(library.activeProfileId);
  expect(setError).toHaveBeenLastCalledWith(null, "profiles:absorb");
});

it("preserves a profile when switch-first deletion needs a HUD review", async () => {
  await render();
  const before = must(state.library);
  const replacement = previewSavedProfile("Two HUDs", 9);
  await act(async () =>
    state.setLibrary({ ...before, profiles: [...before.profiles, replacement] }),
  );
  vi.spyOn(api, "switchProfile").mockRejectedValue(
    new BridgeError("Choose one HUD", "HudReviewRequired"),
  );
  const remove = vi.spyOn(api, "deleteProfile");
  await act(async () => state.reviewDelete(must(before.activeProfileId)));
  await act(async () => state.confirmDelete(false, replacement.id));
  expect(remove).not.toHaveBeenCalled();
  expect(state.deleteTarget).toBeNull();
  expect(onHudReviewRequired).toHaveBeenCalledWith(replacement.id);
  expect(
    must(state.library).profiles.some((profile) => profile.id === before.activeProfileId),
  ).toBe(true);
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
  expect(setError).toHaveBeenCalledWith("read refused", "profiles:absorb");
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

it("reviews folder repair without writing, retains failed review, and refreshes after repair", async () => {
  await render();
  const id = state.library?.profiles[0].id;
  if (!id) throw new Error("missing fixture profile");
  const plan = [{ from: "materials", to: "custom-materials-2" }];
  const review = vi.spyOn(api, "planCustomFolderRepair").mockResolvedValue(plan);
  const repair = vi
    .spyOn(api, "repairCustomFolders")
    .mockRejectedValueOnce(Error("Source changed"));
  const before = state.refreshKey;
  await act(async () => state.reviewFolderRepair(id));
  expect(review).toHaveBeenCalledWith(id);
  expect(repair).not.toHaveBeenCalled();
  expect(state.folderRepair?.plan).toEqual(plan);
  await act(async () => state.repairFolders());
  expect(state.folderRepair?.error).toBe("Source changed");
  expect(setError).toHaveBeenLastCalledWith(null, `profiles:folder-review:${id}`);
  expect(state.folderRepair?.plan).toEqual(plan);
  expect(state.refreshKey).toBe(before);
  if (!state.library) throw new Error("missing fixture library");
  repair.mockResolvedValueOnce(state.library);
  await act(async () => state.repairFolders());
  expect(repair).toHaveBeenLastCalledWith(id, plan);
  expect(state.folderRepair).toBeNull();
  expect(state.refreshKey).not.toBe(before);
});

it("cancelling a folder review and the game lock never run the repair", async () => {
  await render();
  const id = state.library?.profiles[0].id;
  if (!id) throw new Error("missing fixture profile");
  vi.spyOn(api, "planCustomFolderRepair").mockResolvedValue([
    { from: "resource", to: "custom-resource" },
  ]);
  const repair = vi.spyOn(api, "repairCustomFolders");
  await act(async () => state.reviewFolderRepair(id));
  await act(async () => state.cancelFolderRepair());
  await act(async () => state.repairFolders());
  expect(repair).not.toHaveBeenCalled();
  await act(async () => state.reviewFolderRepair(id));
  running = true;
  await render();
  await act(async () => state.repairFolders());
  expect(repair).not.toHaveBeenCalled();
  expect(state.folderRepair).not.toBeNull();
});
