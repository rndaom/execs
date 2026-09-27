// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ProfileComparison } from "../lib/switch-compare-ui";
import { SwitchCompareDialog } from "./SwitchCompareDialog";

let node: HTMLDivElement;
let root: Root;

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  node = document.createElement("div");
  document.body.append(node);
  root = createRoot(node);
});
afterEach(async () => {
  await act(async () => root.unmount());
  node.remove();
  vi.unstubAllGlobals();
});

function comparison(revision: string, patch: Partial<ProfileComparison> = {}): ProfileComparison {
  const none = { added: [], removed: [], changed: [] };
  return {
    fromId: "a",
    fromName: "Main",
    toId: "b",
    toName: "Casual",
    revision,
    launchOptions: null,
    hud: { from: "flawhud", to: null },
    hitSound: null,
    killSound: null,
    packs: none,
    cfgFiles: none,
    configCfgChanged: false,
    values: [],
    valuesTruncated: false,
    casual: none,
    blocked: null,
    ...patch,
  };
}

const confirmButton = () =>
  document.querySelector<HTMLButtonElement>('[data-testid="switch-compare-confirm"]');

async function render(
  onCompare: (id: string) => Promise<ProfileComparison>,
  onSwitch = vi.fn(),
  switchDisabled = false,
) {
  const onClose = vi.fn();
  await act(async () =>
    root.render(
      <SwitchCompareDialog
        targetId="b"
        activeId="a"
        switchDisabled={switchDisabled}
        onCompare={onCompare}
        onSwitch={onSwitch}
        onClose={onClose}
      />,
    ),
  );
  return { onSwitch, onClose };
}

describe("switch comparison dialog", () => {
  it("switches only after re-reading an unchanged comparison", async () => {
    const onCompare = vi.fn(async () => comparison("r1"));
    const { onSwitch, onClose } = await render(onCompare);
    expect(document.body.textContent).toContain("Main → Casual");
    expect(document.querySelector('[data-testid="switch-compare-general"]')?.textContent).toContain(
      "flawhud",
    );
    await act(async () => confirmButton()?.click());
    expect(onCompare).toHaveBeenCalledTimes(2);
    expect(onClose).toHaveBeenCalledOnce();
    expect(onSwitch).toHaveBeenCalledWith("b");
  });

  it("shows the new differences instead of switching when a profile changed", async () => {
    const onCompare = vi
      .fn()
      .mockResolvedValueOnce(comparison("r1"))
      .mockResolvedValueOnce(comparison("r2", { hud: { from: "flawhud", to: "toonhud" } }));
    const { onSwitch } = await render(onCompare);
    await act(async () => confirmButton()?.click());
    expect(onSwitch).not.toHaveBeenCalled();
    expect(document.querySelector('[data-testid="switch-compare-stale"]')).not.toBeNull();
    expect(document.body.textContent).toContain("toonhud");
  });

  it("refuses a blocked target and a disabled switch", async () => {
    await render(async () => comparison("r1", { blocked: "Repair folder names first." }));
    expect(confirmButton()?.disabled).toBe(true);
    expect(document.body.textContent).toContain("Switching is not possible yet");
    await act(async () => root.unmount());
    root = createRoot(node);
    await render(async () => comparison("r1"), vi.fn(), true);
    expect(confirmButton()?.disabled).toBe(true);
  });

  it("says when both profiles have the same setup", async () => {
    await render(async () => comparison("r1", { hud: null }));
    expect(document.querySelector('[data-testid="switch-compare-same"]')).not.toBeNull();
  });
});
