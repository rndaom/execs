import { JSDOM } from "jsdom";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { BindsPane } from "./BindsPane";
import { AutosaveActivity } from "./hooks/useAutosave";

const native = vi.hoisted(() => ({
  capture: vi.fn(async (_enabled: boolean, _sequence: number) => {}),
}));
vi.mock("./lib/bridge", async (original) => ({
  ...(await original<typeof import("./lib/bridge")>()),
  isTauri: () => true,
  setBindMouseCapture: native.capture,
}));
vi.mock("./hooks/useAppStatus", () => ({ useAppStatus: () => ({ running: false, busy: false }) }));

let dom: JSDOM;
let root: Root;
beforeEach(() => {
  native.capture.mockReset();
  native.capture.mockResolvedValue(undefined);
  dom = new JSDOM("<!doctype html><div id='root'></div>");
  vi.stubGlobal("window", dom.window);
  vi.stubGlobal("document", dom.window.document);
  vi.stubGlobal("HTMLElement", dom.window.HTMLElement);
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  root = createRoot(document.getElementById("root") as HTMLElement);
});
afterEach(async () => {
  await act(async () => root.unmount());
  dom.window.close();
  vi.unstubAllGlobals();
});

const save = async () => {};
function render(profileId = "a", active = true) {
  root.render(
    createElement(
      AutosaveActivity.Provider,
      { value: active },
      createElement(BindsPane, {
        profileId,
        layer: "vanilla",
        effectiveBinds: {},
        managedText: "",
        onSave: save,
      }),
    ),
  );
}
async function record() {
  await act(async () =>
    document.querySelector<HTMLButtonElement>('[data-testid="bind-record-jump"]')?.click(),
  );
}

it.each(["hidden", "profile", "blur", "unmount"])(
  "disables native capture after %s, even when enable resolves late",
  async (reason) => {
    let resolveEnable: (() => void) | undefined;
    native.capture.mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          resolveEnable = resolve;
        }),
    );
    await act(async () => render());
    await record();
    expect(native.capture.mock.calls[0][0]).toBe(true);
    await act(async () => {
      if (reason === "hidden") render("a", false);
      if (reason === "profile") render("b");
      if (reason === "blur") dom.window.dispatchEvent(new dom.window.Event("blur"));
      if (reason === "unmount") root.render(null);
    });
    const calls = native.capture.mock.calls;
    expect(calls.at(-1)?.[0]).toBe(false);
    expect(calls.at(-1)?.[1]).toBeGreaterThan(calls[0][1]);
    await act(async () => resolveEnable?.());
    expect(native.capture.mock.calls.at(-1)?.[0]).toBe(false);
  },
);

it("shows native capture failure next to the action after recording closes", async () => {
  native.capture.mockRejectedValueOnce(new Error("native failure"));
  await act(async () => render());
  await record();
  expect(document.querySelector('[data-testid="bind-key-notice-jump"]')?.textContent).toContain(
    "Mouse capture could not start",
  );
  expect(native.capture.mock.calls.at(-1)?.[0]).toBe(false);
});
