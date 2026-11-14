// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  CONTROL_PAD,
  readKnockouts,
  TEXT_PAD_X,
  TEXT_PAD_Y,
  watchKnockouts,
} from "./backdrop-knockout";

function box(left: number, top: number, width: number, height: number): DOMRect {
  return {
    left,
    top,
    width,
    height,
    right: left + width,
    bottom: top + height,
    x: left,
    y: top,
    toJSON: () => ({}),
  } as DOMRect;
}

/** Line boxes by text content; anything unlisted has none. */
let lines: Record<string, DOMRect[]> = {};
const original = Range.prototype.getClientRects;

beforeEach(() => {
  Range.prototype.getClientRects = function (this: Range) {
    return (lines[this.startContainer.textContent ?? ""] ?? []) as unknown as DOMRectList;
  };
});

afterEach(() => {
  Range.prototype.getClientRects = original;
  lines = {};
  document.body.innerHTML = "";
});

function mount(html: string) {
  document.body.innerHTML = `<div id="scope"><div id="backdrop" aria-hidden="true"><span>backdrop</span></div>${html}</div>`;
  return {
    scope: document.getElementById("scope") as HTMLElement,
    backdrop: document.getElementById("backdrop") as HTMLElement,
  };
}

const frame = { left: 100, top: 200, width: 800, height: 600 };

describe("readKnockouts", () => {
  it("boxes each visible line of text and each whole control, relative to the frame", () => {
    const { scope, backdrop } = mount(`
      <p>Hello</p>
      <p>   </p>
      <button id="control"><span>Inside</span></button>
    `);
    lines = {
      Hello: [box(110, 220, 40, 18)],
      Inside: [box(320, 405, 20, 12)],
      backdrop: [box(0, 0, 900, 800)],
    };
    const control = document.getElementById("control") as HTMLElement;
    control.getBoundingClientRect = () => box(300, 400, 80, 30);

    expect(readKnockouts(scope, backdrop, frame)).toEqual([
      10 - TEXT_PAD_X,
      20 - TEXT_PAD_Y,
      50 + TEXT_PAD_X,
      38 + TEXT_PAD_Y,
      200 - CONTROL_PAD,
      200 - CONTROL_PAD,
      280 + CONTROL_PAD,
      230 + CONTROL_PAD,
    ]);
  });

  it("skips hidden panes, closed folds and screen-reader-only text", () => {
    const { scope, backdrop } = mount(`
      <div hidden><p>Hidden pane</p></div>
      <details><summary>Fold</summary><p>Folded away</p></details>
      <details open><summary>Open fold</summary><p>Shown</p></details>
      <span class="sr-only">For screen readers</span>
    `);
    lines = {
      "Hidden pane": [box(110, 210, 10, 10)],
      Fold: [box(110, 230, 10, 10)],
      "Folded away": [box(110, 250, 10, 10)],
      "Open fold": [box(110, 270, 10, 10)],
      Shown: [box(110, 290, 10, 10)],
      "For screen readers": [box(110, 310, 10, 10)],
    };
    const tops = readKnockouts(scope, backdrop, frame).filter((_, index) => index % 4 === 1);
    expect(tops).toEqual([30, 70, 90].map((top) => top - TEXT_PAD_Y));
  });

  it("drops boxes that lie wholly outside the frame", () => {
    const { scope, backdrop } = mount("<p>Line</p>");
    lines = {
      Line: [box(110, 100, 40, 18), box(110, 900, 40, 18), box(950, 300, 40, 18)],
    };
    expect(readKnockouts(scope, backdrop, frame)).toEqual([]);
  });
});

describe("watchKnockouts", () => {
  it("reports changes, scrolling and moving transitions until cleaned up", async () => {
    const { scope, backdrop } = mount('<div id="pane"><p>Text</p></div>');
    const changed = vi.fn();
    const stop = watchKnockouts(scope, backdrop, changed);
    const pane = document.getElementById("pane") as HTMLElement;

    pane.append(document.createElement("p"));
    await Promise.resolve();
    expect(changed).toHaveBeenLastCalledWith(false);
    // The backdrop resizing its own layers is not the page moving.
    backdrop.style.width = "10px";
    await Promise.resolve();
    expect(changed).toHaveBeenCalledTimes(1);

    pane.dispatchEvent(new Event("scroll"));
    expect(changed).toHaveBeenCalledTimes(2);

    const transition = (type: string, propertyName: string, target: Element) => {
      const event = new Event(type, { bubbles: true });
      Object.defineProperty(event, "propertyName", { value: propertyName });
      target.dispatchEvent(event);
    };
    transition("transitionrun", "height", pane);
    expect(changed).toHaveBeenLastCalledWith(true);
    // Colour changes and the backdrop's own entrance move no text.
    transition("transitionrun", "background-color", pane);
    transition("transitionend", "color", pane);
    backdrop.dispatchEvent(new Event("animationstart", { bubbles: true }));
    expect(changed).toHaveBeenCalledTimes(3);
    transition("transitionend", "height", pane);
    expect(changed).toHaveBeenLastCalledWith(false);

    stop();
    pane.dispatchEvent(new Event("scroll"));
    pane.append(document.createElement("p"));
    await Promise.resolve();
    expect(changed).toHaveBeenCalledTimes(4);
  });
});
