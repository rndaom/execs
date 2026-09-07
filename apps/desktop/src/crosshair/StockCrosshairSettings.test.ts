// @vitest-environment jsdom
import { act, createElement as h } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AppStatusProvider } from "../hooks/useAppStatus";
import { AutosaveDiscard, AutosavePending } from "../hooks/useAutosave";
import { StockCrosshairSettings } from "../StockCrosshairSettings";

let box: HTMLDivElement;
let root: Root;
let discard: { current: boolean };
const pending = vi.fn();
const save = vi.fn<(text: string) => Promise<unknown>>();
const managed = (scale: number) =>
  `cl_crosshair_file crosshair3\ncl_crosshair_scale ${scale}\ncl_crosshair_red 10\n`;

beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  save.mockReset().mockResolvedValue(true);
  pending.mockReset();
  discard = { current: false };
  box = document.createElement("div");
  document.body.append(box);
  root = createRoot(box);
});

afterEach(async () => {
  discard.current = true;
  await act(async () => root.unmount());
  box.remove();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

async function render(scale: number, running = false, profileId = "profile-a") {
  await act(async () =>
    root.render(
      h(
        AppStatusProvider,
        { value: { error: null, setError: () => {}, busy: running, running } },
        h(
          AutosaveDiscard.Provider,
          { value: discard },
          h(
            AutosavePending.Provider,
            { value: pending },
            h(StockCrosshairSettings, {
              profileId,
              effective: {},
              managedText: managed(scale),
              onSave: save,
            }),
          ),
        ),
      ),
    ),
  );
}

function slider() {
  const input = box.querySelector<HTMLInputElement>("#stock-crosshair-scale");
  if (!input) throw new Error("The crosshair scale slider is missing.");
  return input;
}

async function setScale(value: number) {
  await act(async () => {
    const input = slider();
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set?.call(
      input,
      String(value),
    );
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

async function debounce() {
  await act(async () => vi.advanceTimersByTimeAsync(700));
}

describe("stock crosshair refreshes", () => {
  it("does not autosave old sliders when a reload publishes values and unlocks together", async () => {
    await render(32);
    await render(32, true);
    await render(33);
    await debounce();

    expect(slider().value).toBe("33");
    expect(save).not.toHaveBeenCalled();
    expect(pending.mock.calls.some(([, value]) => value)).toBe(false);
  });

  it("never reports clean incoming settings as unsaved edits", async () => {
    await render(32);
    await render(33);
    await render(34);
    await debounce();

    expect(slider().value).toBe("34");
    expect(save).not.toHaveBeenCalled();
    expect(pending.mock.calls.some(([, value]) => value)).toBe(false);
  });

  it("keeps real slider edits through equal-content refreshes and saves once", async () => {
    await render(32, true);
    await setScale(40);
    expect(slider().value).toBe("40");
    await render(32, true);
    await debounce();
    expect(save).not.toHaveBeenCalled();

    await render(32);
    await render(40);
    await debounce();
    expect(slider().value).toBe("40");
    expect(save).toHaveBeenCalledTimes(1);
    expect(save.mock.calls[0][0]).toContain("cl_crosshair_scale 40\n");
    expect(pending.mock.calls.at(-1)?.[1]).toBe(false);
  });

  it("preserves a newer slider edit when an earlier save reloads and unlocks", async () => {
    let settle!: (result: boolean) => void;
    save.mockImplementationOnce(
      () =>
        new Promise<boolean>((resolve) => {
          settle = resolve;
        }),
    );
    await render(32);
    await setScale(40);
    await debounce();
    expect(save).toHaveBeenCalledTimes(1);

    await render(32, true);
    await setScale(41);
    await render(40);
    expect(slider().value).toBe("41");
    await act(async () => settle(true));
    await debounce();
    expect(save).toHaveBeenCalledTimes(2);
    expect(save.mock.calls[1][0]).toContain("cl_crosshair_scale 41\n");

    await render(41);
    await debounce();
    expect(slider().value).toBe("41");
    expect(save).toHaveBeenCalledTimes(2);
    expect(pending.mock.calls.at(-1)?.[1]).toBe(false);
  });

  it("never sends an old profile's draft when its replacement arrives on unlock", async () => {
    await render(32, true);
    await setScale(40);
    await render(33, false, "profile-b");
    await debounce();

    expect(slider().value).toBe("33");
    expect(save).not.toHaveBeenCalled();
    expect(pending.mock.calls.at(-1)?.[1]).toBe(false);
  });
});
