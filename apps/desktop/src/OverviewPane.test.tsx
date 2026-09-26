// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { OverviewPane } from "./OverviewPane";

let box: HTMLDivElement;
let root: Root;

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  box = document.createElement("div");
  document.body.append(box);
  root = createRoot(box);
});

afterEach(async () => {
  await act(async () => root.unmount());
  box.remove();
  vi.unstubAllGlobals();
});

describe("OverviewPane", () => {
  it("opens the pane behind a row and runs a notice's own action", async () => {
    const onOpen = vi.fn();
    const onAction = vi.fn();
    await act(async () =>
      root.render(
        <OverviewPane
          rows={[
            { tab: "comfig", label: "Graphics", value: "Medium preset" },
            { tab: "hud", label: "HUD", value: "rayshud" },
          ]}
          notices={[
            {
              id: "cfg",
              message: "Startup cfg needs review.",
              action: "Review in Files",
              onAction,
            },
          ]}
          onOpen={onOpen}
        />,
      ),
    );
    expect(box.querySelector('[data-testid="overview-hud"]')?.textContent).toBe("HUDrayshud");
    await act(async () =>
      box.querySelector<HTMLButtonElement>('[data-testid="overview-hud"]')?.click(),
    );
    expect(onOpen).toHaveBeenCalledWith("hud");
    const notice = box.querySelector('[aria-label="Needs attention"]');
    expect(notice?.textContent).toContain("Startup cfg needs review.");
    await act(async () => notice?.querySelector("button")?.click());
    expect(onAction).toHaveBeenCalledOnce();
  });

  it("shows no attention list when nothing needs it", async () => {
    await act(async () =>
      root.render(<OverviewPane rows={[]} notices={[]} onOpen={() => undefined} />),
    );
    expect(box.querySelector('[aria-label="Needs attention"]')).toBeNull();
  });
});
