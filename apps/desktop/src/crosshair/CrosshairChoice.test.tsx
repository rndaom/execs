// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AutosaveActivity } from "../hooks/useAutosave";
import { CrosshairChoice } from "./CrosshairChoice";

let root: Root;
let box: HTMLDivElement;
const change = vi.fn();

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("innerWidth", 960);
  vi.stubGlobal("innerHeight", 640);
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(null);
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (
    this: HTMLElement,
  ) {
    const menu = this.getAttribute("role") === "listbox";
    return {
      x: 0,
      y: menu ? 0 : 500,
      top: menu ? 0 : 500,
      bottom: menu ? 240 : 540,
      left: 0,
      right: menu ? 352 : 550,
      width: menu ? 352 : 150,
      height: menu ? 240 : 40,
      toJSON: () => ({}),
    };
  });
  change.mockReset();
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

async function render(active = true) {
  await act(async () =>
    root.render(
      <AutosaveActivity.Provider value={active}>
        <CrosshairChoice
          label="Primary crosshair"
          value="cross"
          choices={["dot", "cross", "circle"]}
          color={null}
          customRgba={null}
          previewFor={() => null}
          disabled={false}
          onChange={change}
        />
      </AutosaveActivity.Provider>,
    ),
  );
}

function element<T extends HTMLElement>(selector: string): T {
  const found = document.querySelector<T>(selector);
  if (!found) throw new Error(`Missing ${selector}`);
  return found;
}

describe("weapon crosshair picker", () => {
  it("opens above a low trigger, supports keyboard selection, and returns focus", async () => {
    await render();
    const trigger = element<HTMLButtonElement>("button");
    await act(async () => trigger.click());
    const menu = element('[role="listbox"]');
    expect(menu.style.top).toBe("254px");
    expect(menu.style.left).toBe("198px");
    expect(document.activeElement?.getAttribute("aria-selected")).toBe("true");
    await act(async () =>
      document.activeElement?.dispatchEvent(
        new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true }),
      ),
    );
    expect(document.activeElement?.getAttribute("title")).toBe("circle");
    await act(async () => (document.activeElement as HTMLElement).click());
    expect(change).toHaveBeenCalledWith("circle");
    expect(document.querySelector('[role="listbox"]')).toBeNull();
    expect(document.activeElement).toBe(trigger);
  });

  it("removes the portalled picker when its pane is hidden", async () => {
    await render();
    await act(async () => element("button").click());
    expect(document.querySelector('[role="listbox"]')).not.toBeNull();
    await act(async () => {
      element("button").focus();
      element("button").click();
    });
    expect(document.querySelector('[role="listbox"]')).toBeNull();
    await act(async () => element("button").click());
    await render(false);
    expect(document.querySelector('[role="listbox"]')).toBeNull();
    expect(change).not.toHaveBeenCalled();
  });
});
