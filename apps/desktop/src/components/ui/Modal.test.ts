// @vitest-environment jsdom
import { act, createElement as h } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CrosshairDesigner } from "../../crosshair/CrosshairDesigner";
import { AutosaveActivity } from "../../hooks/useAutosave";
import { useFilesExitGuard } from "../../hooks/useFilesExitGuard";
import { defaultCrosshairDesign } from "../../lib/crosshair-designer";
import { createFilesDraftStore } from "../../lib/files-drafts";
import { Modal } from "./Modal";

let box: HTMLDivElement;
let root: Root;
const closePane = vi.fn();
const closeExit = vi.fn();
const applyPane = vi.fn();
const applyExit = vi.fn();

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  // jsdom has no layout; model visible controls for the focus trap.
  vi.spyOn(HTMLElement.prototype, "offsetParent", "get").mockImplementation(() => document.body);
  vi.clearAllMocks();
  box = document.createElement("div");
  document.body.append(box);
  root = createRoot(box);
});

afterEach(async () => {
  await act(async () => root.unmount());
  box.remove();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function element(id: string): HTMLElement {
  const node = box.querySelector<HTMLElement>(`[data-testid="${id}"]`);
  if (!node) throw new Error(`Missing ${id}`);
  return node;
}

async function render({ exit = false, pane = true, paneActive = true } = {}) {
  await act(async () =>
    root.render(
      h(
        "div",
        null,
        h("button", { type: "button", "data-testid": "opener" }, "Open designer"),
        // App renders the exit guard BEFORE the pane containing its own modal.
        h(
          Modal,
          {
            open: exit,
            title: "Save Files drafts?",
            testId: "exit",
            className: "fixed z-50",
            onClose: closeExit,
            onDefaultAction: applyExit,
          },
          h("button", { type: "button", "data-testid": "exit-save" }, "Save and continue"),
          h("button", { type: "button", "data-testid": "exit-cancel" }, "Cancel"),
        ),
        h(
          AutosaveActivity.Provider,
          { value: paneActive },
          h(
            Modal,
            {
              open: pane,
              title: "Crosshair designer",
              testId: "pane",
              className: "fixed z-50",
              onClose: closePane,
              onDefaultAction: applyPane,
            },
            h("button", { type: "button", "data-testid": "pane-apply" }, "Use crosshair"),
            h("button", { type: "button", "data-testid": "pane-close" }, "Close designer"),
          ),
        ),
      ),
    ),
  );
}

async function key(key: string, shiftKey = false) {
  await act(async () => {
    document.activeElement?.dispatchEvent(
      new KeyboardEvent("keydown", { key, shiftKey, bubbles: true, cancelable: true }),
    );
  });
}

describe("stacked modals", () => {
  it("puts a newly opened exit guard and its scrim above the existing pane modal", async () => {
    await render();
    element("pane-close").focus();
    await render({ exit: true });

    const exit = element("exit");
    const pane = element("pane");
    const exitScrim = exit.previousElementSibling as HTMLElement;
    expect(exit.compareDocumentPosition(pane) & Node.DOCUMENT_POSITION_FOLLOWING).not.toBe(0);
    expect(Number(exitScrim.style.zIndex)).toBeGreaterThan(Number(pane.style.zIndex));
    expect(Number(exit.style.zIndex)).toBeGreaterThan(Number(exitScrim.style.zIndex));
    expect(pane.hasAttribute("inert")).toBe(true);
    expect(pane.getAttribute("aria-modal")).toBe("false");
    expect(exit.hasAttribute("inert")).toBe(false);
    expect(document.activeElement).toBe(element("exit-save"));

    element("exit-cancel").focus();
    await key("Tab");
    expect(document.activeElement).toBe(element("exit-save"));
    await key("Tab", true);
    expect(document.activeElement).toBe(element("exit-cancel"));
    exit.focus();
    await key("Enter");
    expect(applyExit).toHaveBeenCalledOnce();
    expect(applyPane).not.toHaveBeenCalled();
    await key("Escape");
    expect(closeExit).toHaveBeenCalledOnce();
    expect(closePane).not.toHaveBeenCalled();

    await render();
    expect(pane.hasAttribute("inert")).toBe(false);
    expect(pane.getAttribute("aria-modal")).toBe("true");
    expect(document.activeElement).toBe(element("pane-close"));
  });

  it("keeps the exit guard above a retained pane that resumes after loading", async () => {
    await render();
    await render({ exit: true, paneActive: false });
    await render({ exit: true });

    expect(Number(element("exit").style.zIndex)).toBeGreaterThan(
      Number(element("pane").style.zIndex),
    );
    expect(document.activeElement).toBe(element("exit-save"));
    await key("Escape");
    expect(closeExit).toHaveBeenCalledOnce();
    expect(closePane).not.toHaveBeenCalled();
  });

  it("does not steal focus when an underlying modal disappears", async () => {
    await render({ pane: false });
    element("opener").focus();
    await render();
    await render({ exit: true });
    element("exit-cancel").focus();
    await render({ exit: true, pane: false });
    expect(document.activeElement).toBe(element("exit-cancel"));

    await render({ pane: false });
    expect(document.activeElement).toBe(element("opener"));
  });

  it("allows only the upper scrim to dismiss a dialog", async () => {
    await render();
    await render({ exit: true });
    await act(async () => (element("pane").previousElementSibling as HTMLElement).click());
    expect(closePane).not.toHaveBeenCalled();
    await act(async () => (element("exit").previousElementSibling as HTMLElement).click());
    expect(closeExit).toHaveBeenCalledOnce();
  });
});

it("uses current Escape and Enter callbacks without reopening or moving focus", async () => {
  const oldClose = vi.fn();
  const nextClose = vi.fn();
  const oldApply = vi.fn();
  const nextApply = vi.fn();
  async function update(onClose: () => void, onDefaultAction?: () => void) {
    await act(async () =>
      root.render(
        h(
          Modal,
          { open: true, title: "Pack changes", testId: "prompt", onClose, onDefaultAction },
          h("button", { type: "button", "data-testid": "prompt-action" }, "Update"),
        ),
      ),
    );
  }

  await update(oldClose, oldApply);
  element("prompt").focus();
  await update(nextClose, nextApply);
  expect(document.activeElement).toBe(element("prompt"));
  await key("Enter");
  await key("Escape");
  expect(oldClose).not.toHaveBeenCalled();
  expect(oldApply).not.toHaveBeenCalled();
  expect(nextClose).toHaveBeenCalledOnce();
  expect(nextApply).toHaveBeenCalledOnce();

  await update(nextClose);
  await key("Enter");
  expect(nextApply).toHaveBeenCalledOnce();
});

it("cancels the real Files exit guard above the designer without closing either the app or designer", async () => {
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(null);
  const store = createFilesDraftStore();
  store.read("a", "tf/cfg/config.cfg", "old");
  store.edit("a", "tf/cfg/config.cfg", "new");
  const destroy = vi.fn();
  let requestExit = () => {};
  function Harness() {
    const guard = useFilesExitGuard(store, false);
    requestExit = () => guard.request(destroy);
    return h(
      "div",
      null,
      guard.modal,
      h(CrosshairDesigner, {
        open: true,
        initial: defaultCrosshairDesign(),
        color: null,
        onSave: applyPane,
        onClose: closePane,
      }),
    );
  }
  await act(async () => root.render(h(Harness)));
  await act(async () => requestExit());
  expect(Number(element("files-exit-guard").style.zIndex)).toBeGreaterThan(
    Number(element("crosshair-designer").style.zIndex),
  );
  expect(element("crosshair-designer").hasAttribute("inert")).toBe(true);
  await key("Escape");
  expect(box.querySelector('[data-testid="files-exit-guard"]')).toBeNull();
  expect(closePane).not.toHaveBeenCalled();
  expect(destroy).not.toHaveBeenCalled();
  expect(store.dirty()[0].text).toBe("new");
  expect(element("crosshair-designer").hasAttribute("inert")).toBe(false);
});
