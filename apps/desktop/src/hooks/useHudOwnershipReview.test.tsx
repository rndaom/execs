// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { Api } from "../lib/api";
import { BridgeError, type HudOwnershipReview, type ProfileDetail } from "../lib/bridge";
import { useHudOwnershipReview } from "./useHudOwnershipReview";

const cleanups: (() => Promise<void>)[] = [];
beforeEach(() => vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true));
afterEach(async () => {
  for (const cleanup of cleanups.splice(0)) await cleanup();
  vi.unstubAllGlobals();
});

function review(profileId = "profile-a", fingerprint = "review-1"): HudOwnershipReview {
  return {
    profileId,
    fingerprint,
    selectedHud: "rayshud",
    reviewRequired: true,
    managedOptionFiles: [],
    resetOptions: false,
    candidates: [
      { folder: "rayshud", source: "profile", files: 45 },
      { folder: "toonhud", source: "live", files: 62 },
    ],
  };
}

function detail(id = "profile-a"): ProfileDetail {
  return { id, name: id, launchOptions: "", layer: "comfig", files: [] };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}

async function renderReview(api: Api) {
  const root = createRoot(document.createElement("div"));
  let state!: ReturnType<typeof useHudOwnershipReview>;
  let props = { profileId: "profile-a", running: false, busy: false };
  function Harness() {
    state = useHudOwnershipReview(api, props.profileId, props);
    return null;
  }
  await act(async () => root.render(<Harness />));
  cleanups.push(async () => act(async () => root.unmount()));
  return {
    get state() {
      return state;
    },
    async update(next: Partial<typeof props>) {
      props = { ...props, ...next };
      await act(async () => root.render(<Harness />));
    },
  };
}

it("requires an explicit candidate and applies the reviewed profile and fingerprint once", async () => {
  const pending = deferred<ProfileDetail>();
  const api = {
    getHudOwnership: vi.fn().mockResolvedValue(review()),
    selectProfileHud: vi.fn().mockReturnValue(pending.promise),
  } as unknown as Api;
  const hook = await renderReview(api);
  expect(api.getHudOwnership).toHaveBeenCalledWith("profile-a");
  expect(hook.state.selectedFolder).toBeNull();
  expect(hook.state.canApply).toBe(false);
  await act(async () => hook.state.select("unknown-folder"));
  expect(hook.state.selectedFolder).toBeNull();
  await act(async () => hook.state.select("toonhud"));
  expect(hook.state.canApply).toBe(true);
  let first!: Promise<ProfileDetail | null>;
  let duplicate!: Promise<ProfileDetail | null>;
  await act(async () => {
    first = hook.state.apply();
    duplicate = hook.state.apply();
  });
  expect(await duplicate).toBeNull();
  expect(api.selectProfileHud).toHaveBeenCalledExactlyOnceWith("profile-a", "toonhud", "review-1");
  expect(hook.state.applying).toBe(true);
  await act(async () => {
    pending.resolve(detail());
    expect(await first).toEqual(detail());
  });
  expect(hook.state.applying).toBe(false);
  expect(hook.state.applied).toEqual(detail());
  expect(hook.state.canApply).toBe(false);
});

it("rejects late check responses for the previous profile and clears its selection", async () => {
  const previous = deferred<HudOwnershipReview>();
  const next = deferred<HudOwnershipReview>();
  const api = {
    getHudOwnership: vi
      .fn()
      .mockReturnValueOnce(previous.promise)
      .mockReturnValueOnce(next.promise),
    selectProfileHud: vi.fn(),
  } as unknown as Api;
  const hook = await renderReview(api);
  await hook.update({ profileId: "profile-b" });
  await act(async () => next.resolve(review("profile-b", "review-b")));
  await act(async () => hook.state.select("toonhud"));
  await act(async () => previous.resolve(review()));
  expect(hook.state.review?.profileId).toBe("profile-b");
  expect(hook.state.review?.fingerprint).toBe("review-b");
  expect(hook.state.selectedFolder).toBe("toonhud");
  expect(hook.state.error).toBeNull();
});

it("refuses a returned review for the wrong profile", async () => {
  const api = {
    getHudOwnership: vi.fn().mockResolvedValue(review("profile-b")),
    selectProfileHud: vi.fn(),
  } as unknown as Api;
  const hook = await renderReview(api);
  expect(hook.state.review).toBeNull();
  expect(hook.state.error).toContain("The profile changed");
  expect(hook.state.canApply).toBe(false);
  await act(async () => hook.state.apply());
  expect(api.selectProfileHud).not.toHaveBeenCalled();
});

it.each(["running", "busy"] as const)(
  "guards an old apply callback when %s becomes true",
  async (guard) => {
    const api = {
      getHudOwnership: vi.fn().mockResolvedValue(review()),
      selectProfileHud: vi.fn(),
    } as unknown as Api;
    const hook = await renderReview(api);
    await act(async () => hook.state.select("rayshud"));
    const oldApply = hook.state.apply;
    await hook.update({ [guard]: true });
    expect(hook.state.canApply).toBe(false);
    await act(async () => expect(await oldApply()).toBeNull());
    expect(api.selectProfileHud).not.toHaveBeenCalled();
  },
);

it("removes a failed review and requires a fresh fingerprint and explicit choice before retry", async () => {
  const api = {
    getHudOwnership: vi
      .fn()
      .mockResolvedValueOnce(review())
      .mockResolvedValueOnce(review("profile-a", "review-2")),
    selectProfileHud: vi
      .fn()
      .mockRejectedValueOnce(new BridgeError("HUD files changed", "HudReviewStale"))
      .mockResolvedValueOnce(detail()),
  } as unknown as Api;
  const hook = await renderReview(api);
  await act(async () => hook.state.select("rayshud"));
  await act(async () => {
    await expect(hook.state.apply()).rejects.toThrow("HUD files changed");
  });
  expect(hook.state.review).toBeNull();
  expect(hook.state.selectedFolder).toBeNull();
  expect(hook.state.canApply).toBe(false);
  expect(hook.state.error).toBe("HUD files changed");
  await act(async () => hook.state.apply());
  expect(api.selectProfileHud).toHaveBeenCalledTimes(1);
  await act(async () => hook.state.reload());
  expect(hook.state.selectedFolder).toBeNull();
  expect(hook.state.error).toBeNull();
  await act(async () => hook.state.select("toonhud"));
  await act(async () => hook.state.apply());
  expect(api.selectProfileHud).toHaveBeenLastCalledWith("profile-a", "toonhud", "review-2");
});

it("clears old candidates on a failed refresh and never treats failure as an empty review", async () => {
  const api = {
    getHudOwnership: vi
      .fn()
      .mockResolvedValueOnce(review())
      .mockRejectedValueOnce(Error("Folder is unreadable")),
    selectProfileHud: vi.fn(),
  } as unknown as Api;
  const hook = await renderReview(api);
  await act(async () => hook.state.select("rayshud"));
  await act(async () => hook.state.reload());
  expect(hook.state.review).toBeNull();
  expect(hook.state.selectedFolder).toBeNull();
  expect(hook.state.error).toBe("Folder is unreadable");
  expect(hook.state.loading).toBe(false);
  expect(hook.state.canApply).toBe(false);
});
