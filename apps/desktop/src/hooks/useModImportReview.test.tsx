// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { Api } from "../lib/api";
import type { ModImportReview } from "../lib/bridge";
import { useModImportReview } from "./useModImportReview";

const review: ModImportReview = { token: "review-a", choices: [], readmes: [] };
let root: Root;
let box: HTMLDivElement;
let hook: ReturnType<typeof useModImportReview>;
let api: Api;
const cancel = vi.fn(async () => {});
const confirm = vi.fn(async () => ({}));
function Harness({ profile = "A", active = true }) {
  hook = useModImportReview(api, profile, active);
  return null;
}
beforeEach(async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  cancel.mockClear();
  confirm.mockClear();
  api = { cancelModImport: cancel, confirmModImport: confirm } as unknown as Api;
  box = document.createElement("div");
  document.body.append(box);
  root = createRoot(box);
  await act(async () => root.render(<Harness />));
});
afterEach(async () => {
  await act(async () => root.unmount());
  box.remove();
  vi.unstubAllGlobals();
});

it("never confirms cancellation and releases the waiting operation", async () => {
  let result!: Promise<boolean | null>;
  await act(async () => {
    result = hook.prepare(async () => review);
  });
  expect(hook.review).toEqual(review);
  await act(async () => hook.cancel());
  await expect(result).resolves.toBeNull();
  expect(cancel).toHaveBeenCalledWith(review.token);
  expect(confirm).not.toHaveBeenCalled();
});

it("confirms only the selected IDs and awaits native success", async () => {
  let result!: Promise<boolean | null>;
  await act(async () => {
    result = hook.prepare(async () => review);
  });
  await act(async () => hook.confirm(["0:2"]));
  await expect(result).resolves.toBe(true);
  expect(confirm).toHaveBeenCalledExactlyOnceWith(review.token, ["0:2"]);
  expect(hook.review).toBeNull();
});

it.each(["profile", "navigation", "unmount"])("cancels a late prepare after %s", async (change) => {
  let deliver!: (value: ModImportReview) => void;
  const request = new Promise<ModImportReview>((resolve) => {
    deliver = resolve;
  });
  let result!: Promise<boolean | null>;
  await act(async () => {
    result = hook.prepare(() => request);
  });
  await act(async () => {
    root.render(
      change === "unmount" ? null : (
        <Harness profile={change === "profile" ? "B" : "A"} active={change !== "navigation"} />
      ),
    );
  });
  if (change === "navigation") await act(async () => root.render(<Harness />));
  await act(async () => deliver(review));
  await expect(result).resolves.toBeNull();
  expect(cancel).toHaveBeenCalledExactlyOnceWith(review.token);
  expect(confirm).not.toHaveBeenCalled();
});

it("releases an open review when the profile changes", async () => {
  let result!: Promise<boolean | null>;
  await act(async () => {
    result = hook.prepare(async () => review);
  });
  await act(async () => root.render(<Harness profile="B" />));
  await expect(result).resolves.toBeNull();
  expect(hook.review).toBeNull();
  expect(confirm).not.toHaveBeenCalled();
});
