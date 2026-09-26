// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { HomePane } from "./HomePane";

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

function render(props: Partial<Parameters<typeof HomePane>[0]> = {}) {
  return act(async () =>
    root.render(
      <HomePane
        profileId="p1"
        profileName="Main"
        highlights="Medium preset · rayshud HUD · 2 keys bound"
        rows={[
          { tab: "comfig", label: "Graphics", value: "Medium preset" },
          { tab: "hud", label: "HUD", value: "rayshud" },
        ]}
        notices={[]}
        active={false}
        onOpen={() => undefined}
        {...props}
      />,
    ),
  );
}

describe("HomePane", () => {
  it("leads with the profile and folds the full setup away", async () => {
    await render();
    expect(box.querySelector("h1")?.textContent).toBe("Main");
    expect(box.textContent).toContain("Medium preset · rayshud HUD · 2 keys bound");
    const details = box.querySelector<HTMLDetailsElement>('[data-testid="home-details"]');
    expect(details?.open).toBe(false);
    expect(box.querySelector('[aria-label="Needs attention"]')).toBeNull();
  });

  it("opens the pane behind a detail row and runs a notice's own action", async () => {
    const onOpen = vi.fn();
    const onAction = vi.fn();
    await render({
      onOpen,
      notices: [
        { id: "cfg", message: "Startup cfg needs review.", action: "Review in Files", onAction },
      ],
    });
    await act(async () =>
      box.querySelector<HTMLButtonElement>('[data-testid="home-hud"]')?.click(),
    );
    expect(onOpen).toHaveBeenCalledWith("hud");
    const notice = box.querySelector('[aria-label="Needs attention"]');
    expect(notice?.textContent).toContain("Startup cfg needs review.");
    await act(async () => notice?.querySelector("button")?.click());
    expect(onAction).toHaveBeenCalledOnce();
  });
});
