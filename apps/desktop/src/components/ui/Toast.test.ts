// @vitest-environment jsdom
import { act, createElement as h } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TOAST_SAVED_MS, TOAST_SAVING_DELAY_MS, toastLingerMs } from "../../lib/toast-ui";
import { type ToastApi, ToastProvider, useToast } from "./Toast";

let root: Root;
let box: HTMLDivElement;
let toast: ToastApi;
function Capture() {
  toast = useToast();
  return null;
}
function visible() {
  return box.querySelector<HTMLElement>('[data-testid="toast"]');
}
async function advance(ms: number) {
  await act(async () => vi.advanceTimersByTimeAsync(ms));
}
beforeEach(async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.useFakeTimers();
  box = document.createElement("div");
  document.body.append(box);
  root = createRoot(box);
  await act(async () => root.render(h(ToastProvider, null, h(Capture))));
});
afterEach(async () => {
  await act(async () => root.unmount());
  box.remove();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("ToastProvider completion lifetime", () => {
  it.each([
    [undefined, undefined],
    ["HUD installed", "Pack built"],
  ])("renews the full lifetime from %s to %s", async (first, second) => {
    await act(async () => {
      toast.startSave();
      toast.finishSave(first);
    });
    await advance(1500);
    await act(async () => {
      toast.startSave();
      toast.finishSave(second);
    });
    await advance(TOAST_SAVED_MS - 1);
    expect(visible()?.textContent).toBe(second ?? "Saved");
    await advance(1);
    expect(visible()).toBeNull();
  });

  it("never lets an older success timer dismiss a newer failure", async () => {
    await act(async () => toast.finishSave());
    await advance(1500);
    await act(async () =>
      toast.failSave(new Error("file missing"), "Could not save HUD options", "hud"),
    );
    await advance(TOAST_SAVED_MS);
    expect(visible()?.textContent).toBe("Could not save HUD options — file missing");
    await act(async () => window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" })));
    expect(visible()).toBeNull();
  });

  it("fades a failure after its reading time, holding it while the pointer rests on it", async () => {
    await act(async () => toast.failSave("disk full", "Could not save Sounds", "sounds"));
    const linger = toastLingerMs({ kind: "error", message: "Could not save Sounds — disk full" });
    if (linger === null) throw new Error("failures fade");
    const strip = visible()?.parentElement;
    await act(async () => strip?.dispatchEvent(new MouseEvent("mouseover", { bubbles: true })));
    await advance(linger + 1000);
    expect(visible()?.textContent).toBe("Could not save Sounds — disk full");
    await act(async () => strip?.dispatchEvent(new MouseEvent("mouseout", { bubbles: true })));
    await advance(linger - 1);
    expect(visible()).not.toBeNull();
    await advance(1);
    expect(visible()).toBeNull();
  });

  it("keeps all failed sources through unrelated saves, retries and dismissal", async () => {
    await act(async () => {
      toast.failSave("HUD file missing", "Could not save HUD options", "A:hud:save");
      toast.failSave("disk full", "Could not save Sounds", "A:sounds:save");
      toast.finishSave("Gameplay saved", "A:gameplay:save");
    });
    expect(visible()?.textContent).toContain("Could not save Sounds");
    await act(async () => toast.finishSave("Sounds saved", "A:sounds:save"));
    expect(visible()?.textContent).toContain("Could not save HUD options");
    await act(async () => box.querySelector<HTMLElement>('[data-testid="toast-dismiss"]')?.click());
    expect(visible()).toBeNull();
  });

  it("balances cancelled or refused work without stopping another source's saving indicator", async () => {
    await act(async () => {
      toast.startSave("hud");
      toast.startSave("import");
      toast.cancelSave("import");
      toast.failSave("busy", "Could not save Gameplay", "gameplay", false);
      toast.dismiss();
    });
    await advance(TOAST_SAVING_DELAY_MS);
    expect(visible()?.textContent).toBe("Saving…");
    await act(async () => toast.finishSave("HUD options saved", "hud"));
    expect(visible()?.textContent).toBe("HUD options saved");
    await advance(TOAST_SAVED_MS);
    expect(visible()).toBeNull();
  });
});
