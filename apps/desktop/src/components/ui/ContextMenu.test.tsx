// @vitest-environment jsdom
import { act, StrictMode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ContextMenu, ContextMenuItem } from "./ContextMenu";

let root: Root;
let box: HTMLDivElement;
let menuHeight: number;
let notifyResize: () => void;
let frames: FrameRequestCallback[];
const observe = vi.fn();
const disconnect = vi.fn();
const close = vi.fn();
const originalViewport = { width: window.innerWidth, height: window.innerHeight };

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  frames = [];
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => frames.push(callback));
  vi.stubGlobal(
    "ResizeObserver",
    class {
      constructor(callback: () => void) {
        notifyResize = callback;
      }
      observe = observe;
      disconnect = disconnect;
    },
  );
  vi.clearAllMocks();
  menuHeight = 260;
  Object.defineProperty(window, "innerWidth", { configurable: true, value: 480 });
  Object.defineProperty(window, "innerHeight", { configurable: true, value: 320 });
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (
    this: HTMLElement,
  ) {
    return new DOMRect(0, 0, 256, this.getAttribute("role") === "menu" ? menuHeight : 32);
  });
  box = document.createElement("div");
  document.body.append(box);
  root = createRoot(box);
});

afterEach(async () => {
  await act(async () => root.unmount());
  box.remove();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  Object.defineProperty(window, "innerWidth", {
    configurable: true,
    value: originalViewport.width,
  });
  Object.defineProperty(window, "innerHeight", {
    configurable: true,
    value: originalViewport.height,
  });
});

async function render() {
  await act(async () => {
    root.render(
      <ContextMenu label="File actions" position={{ x: 450, y: 200 }} onClose={close}>
        <ContextMenuItem onSelect={() => {}}>Focus editor</ContextMenuItem>
        <ContextMenuItem disabled onSelect={() => {}}>
          Save
        </ContextMenuItem>
        <ContextMenuItem onSelect={() => {}}>New cfg</ContextMenuItem>
      </ContextMenu>,
    );
  });
  return document.querySelector<HTMLElement>('[role="menu"]') as HTMLElement;
}

async function key(value: string) {
  await act(async () => {
    document.activeElement?.dispatchEvent(
      new KeyboardEvent("keydown", { key: value, bubbles: true, cancelable: true }),
    );
  });
}

describe("ContextMenu reflow", () => {
  it("repositions after late content growth and viewport resizing without moving focus", async () => {
    const menu = await render();
    expect(menu.style.left).toBe("216px");
    expect(menu.style.top).toBe("52px");
    expect(observe).toHaveBeenCalledWith(menu);
    await key("End");
    const focused = document.activeElement;

    menuHeight = 304;
    await act(async () => notifyResize());
    expect(menu.style.top).toBe("8px");
    expect(document.activeElement).toBe(focused);

    Object.defineProperty(window, "innerWidth", { configurable: true, value: 600 });
    Object.defineProperty(window, "innerHeight", { configurable: true, value: 400 });
    await act(async () => window.dispatchEvent(new Event("resize")));
    expect(menu.style.left).toBe("336px");
    expect(menu.style.top).toBe("88px");
    expect(document.activeElement).toBe(focused);

    const removeListener = vi.spyOn(window, "removeEventListener");
    await act(async () => root.render(null));
    expect(disconnect).toHaveBeenCalledOnce();
    expect(removeListener).toHaveBeenCalledWith("resize", expect.any(Function));
  });

  it("keeps keyboard navigation and Escape available in the bounded menu", async () => {
    await render();
    expect(document.activeElement?.textContent).toBe("Focus editor");
    await key("ArrowDown");
    expect(document.activeElement?.textContent).toBe("New cfg");
    await key("Home");
    expect(document.activeElement?.textContent).toBe("Focus editor");
    await key("End");
    expect(document.activeElement?.textContent).toBe("New cfg");
    await key("Escape");
    expect(close).toHaveBeenCalledOnce();
  });

  it("returns to the opener after StrictMode repeats the focus effect", async () => {
    const opener = document.createElement("button");
    box.before(opener);
    opener.focus();
    await act(async () => {
      root.render(
        <StrictMode>
          <ContextMenu label="File actions" position={{ x: 40, y: 40 }} onClose={close}>
            <ContextMenuItem onSelect={() => {}}>Focus editor</ContextMenuItem>
          </ContextMenu>
        </StrictMode>,
      );
    });
    expect(document.activeElement?.textContent).toBe("Focus editor");
    await act(async () => root.render(null));
    await act(async () => {
      for (const callback of frames) callback(0);
    });
    expect(document.activeElement).toBe(opener);
    opener.remove();
  });
});
