// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GameplayPane, type GameplayPaneProps } from "./GameplayPane";

const status = vi.hoisted(() => ({ running: false, busy: false }));
vi.mock("./hooks/useAppStatus", () => ({ useAppStatus: () => status }));

let root: Root;
let box: HTMLDivElement;

beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  status.running = false;
  box = document.createElement("div");
  document.body.append(box);
  root = createRoot(box);
});

afterEach(async () => {
  await act(async () => root.unmount());
  box.remove();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

async function render(overrides: Partial<GameplayPaneProps> = {}) {
  await act(async () =>
    root.render(
      <GameplayPane
        profileId="profile-a"
        layer="comfig"
        effective={{ sensitivity: "2.3456" }}
        managedText=""
        onSave={async () => undefined}
        {...overrides}
      />,
    ),
  );
}

function field(testId: string) {
  const input = box.querySelector<HTMLInputElement>(`[data-testid="${testId}"]`);
  if (!input) throw new Error(`Missing ${testId}`);
  return input;
}

async function type(testId: string, value: string) {
  await act(async () => {
    const input = field(testId);
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set?.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

describe("Gameplay mouse controls", () => {
  it("shows the profile's exact values and autosaves a typed decimal unrounded", async () => {
    const save = vi.fn(async (_text: string) => undefined);
    await render({ onSave: save });
    expect(field("gameplay-sensitivity").value).toBe("2.3456");
    expect(field("gameplay-zoom-sensitivity").value).toBe("1");

    await type("gameplay-sensitivity", "1.875");
    await act(async () => vi.advanceTimersByTimeAsync(701));
    expect(save).toHaveBeenCalledTimes(1);
    expect(save.mock.calls[0][0]).toContain("\nsensitivity 1.875\n");
    expect(save.mock.calls[0][0]).toContain("\nzoom_sensitivity_ratio 1\n");
  });

  it("keeps an invalid entry visible with a reason and never saves it", async () => {
    const save = vi.fn(async (_text: string) => undefined);
    await render({ onSave: save });
    await type("gameplay-zoom-sensitivity", "0");
    expect(field("gameplay-zoom-sensitivity").value).toBe("0");
    expect(field("gameplay-zoom-sensitivity").getAttribute("aria-invalid")).toBe("true");
    expect(box.textContent).toContain("Use a number above 0. The saved value stays 1.");
    await act(async () => vi.advanceTimersByTimeAsync(701));
    expect(save).not.toHaveBeenCalled();
  });

  it("defers the save while TF2 runs and writes it after the game closes", async () => {
    const save = vi.fn(async (_text: string) => undefined);
    status.running = true;
    await render({ onSave: save });
    await type("gameplay-sensitivity", "2.5");
    await act(async () => vi.advanceTimersByTimeAsync(2000));
    expect(save).not.toHaveBeenCalled();
    status.running = false;
    await render({ onSave: save });
    await act(async () => vi.advanceTimersByTimeAsync(701));
    expect(save.mock.calls.at(-1)?.[0]).toContain("\nsensitivity 2.5\n");
  });

  it("replaces typed text with the new profile's value on a switch", async () => {
    await render();
    await type("gameplay-sensitivity", "9");
    await render({ profileId: "profile-b", effective: { sensitivity: "4.2" } });
    expect(field("gameplay-sensitivity").value).toBe("4.2");
  });
});
