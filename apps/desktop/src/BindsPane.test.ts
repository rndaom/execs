import { JSDOM } from "jsdom";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { BindsPane } from "./BindsPane";

const status = vi.hoisted(() => ({ running: false, busy: false }));
vi.mock("./hooks/useAppStatus", () => ({ useAppStatus: () => status }));

let dom: JSDOM;
let root: Root;

beforeEach(() => {
  vi.useFakeTimers();
  status.running = false;
  status.busy = false;
  dom = new JSDOM("<!doctype html><div id='root'></div>");
  vi.stubGlobal("window", dom.window);
  vi.stubGlobal("document", dom.window.document);
  vi.stubGlobal("HTMLElement", dom.window.HTMLElement);
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  root = createRoot(dom.window.document.getElementById("root") as HTMLElement);
});

afterEach(async () => {
  await act(async () => root.unmount());
  dom.window.close();
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

async function pressKey(key: string, code: string) {
  await act(async () => {
    dom.window.dispatchEvent(
      new dom.window.KeyboardEvent("keydown", { key, code, bubbles: true, cancelable: true }),
    );
  });
}

describe("BindsPane autosave", () => {
  it("records while TF2 runs, writes nothing, then saves the draft on unlock", async () => {
    const save = vi.fn(async (_text: string) => undefined);
    const render = () =>
      root.render(
        createElement(BindsPane, {
          profileId: "profile-a",
          layer: "comfig",
          effectiveBinds: {},
          managedText: "",
          onSave: save,
        }),
      );

    status.running = true;
    await act(async () => render());
    const record = document.querySelector<HTMLButtonElement>('[data-testid="bind-record-jump"]');
    expect(record?.disabled).toBe(false);
    await act(async () => record?.click());
    await pressKey("x", "KeyX");
    expect(document.querySelector('[data-testid="bind-key-jump"]')?.textContent).toBe("x");
    await act(async () => vi.runAllTimersAsync());
    expect(save).not.toHaveBeenCalled();

    status.running = false;
    await act(async () => render());
    await act(async () => Promise.resolve());
    expect(save).toHaveBeenCalledTimes(1);
    expect(save.mock.calls[0][0]).toContain("bind x +jump");
  });

  it("keeps busy safety even though the write lock alone permits drafts", async () => {
    status.running = true;
    status.busy = true;
    await act(async () =>
      root.render(
        createElement(BindsPane, {
          profileId: "profile-a",
          layer: "vanilla",
          effectiveBinds: {},
          managedText: "",
          onSave: async () => undefined,
        }),
      ),
    );

    expect(
      document.querySelector<HTMLButtonElement>('[data-testid="bind-record-jump"]')?.disabled,
    ).toBe(true);
    expect(document.body.textContent).not.toContain("Close TF2 to change binds");
  });

  it("discards one profile's draft when the profile key changes", async () => {
    const save = vi.fn(async (_text: string) => undefined);
    const render = (profileId: string, managedText: string) =>
      root.render(
        createElement(BindsPane, {
          profileId,
          layer: "vanilla",
          effectiveBinds: {},
          managedText,
          onSave: save,
        }),
      );

    status.running = true;
    await act(async () => render("profile-a", ""));
    await act(async () =>
      document.querySelector<HTMLButtonElement>('[data-testid="bind-record-jump"]')?.click(),
    );
    await pressKey("x", "KeyX");
    expect(document.querySelector('[data-testid="bind-key-jump"]')?.textContent).toBe("x");

    await act(async () => render("profile-b", "bind space +jump\n"));
    expect(document.querySelector('[data-testid="bind-key-jump"]')?.textContent).toBe("space");
    expect(save).not.toHaveBeenCalled();
  });
});
