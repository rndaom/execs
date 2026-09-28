// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { BindsPane, type BindsPaneProps } from "./BindsPane";
import { ownedCustomBinds } from "./lib/binds-ui";

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
async function render(overrides: Partial<BindsPaneProps> = {}) {
  await act(async () =>
    root.render(
      <BindsPane
        profileId="A"
        layer="vanilla"
        effectiveBinds={{}}
        managedText=""
        onSave={async () => undefined}
        {...overrides}
      />,
    ),
  );
}
function button(id: string) {
  const found = box.querySelector<HTMLButtonElement>(`[data-testid="${id}"]`);
  if (!found) throw new Error(id);
  return found;
}
async function command(value: string) {
  const input = box.querySelector<HTMLInputElement>('[data-testid="bind-custom-command"]');
  if (!input) throw new Error("command");
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set?.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}
async function record(key: string, code: string) {
  await act(async () => button("bind-record-custom").click());
  await act(async () => vi.advanceTimersByTimeAsync(1));
  await act(async () =>
    window.dispatchEvent(
      new KeyboardEvent("keydown", { key, code, bubbles: true, cancelable: true }),
    ),
  );
}

describe("Custom Binds", () => {
  it("reviews an inherited conflict, saves a custom command, reloads and removes it", async () => {
    const save = vi.fn(async (_text: string) => undefined);
    const props = {
      onSave: save,
      effectiveBinds: { f6: "+jump" },
      bindSources: { f6: { file: "tf/cfg/config.cfg", line: 3 } },
    };
    await render(props);
    await command("say gg; explode");
    await record("F6", "F6");
    expect(box.querySelector('[data-testid="bind-conflict-custom"]')?.textContent).toContain(
      "Jump",
    );
    expect(save).not.toHaveBeenCalled();
    await act(async () =>
      box
        .querySelector<HTMLButtonElement>('[data-testid="bind-conflict-custom"] .btn-primary')
        ?.click(),
    );
    await act(async () => vi.advanceTimersByTimeAsync(701));
    const text = save.mock.calls.at(-1)?.[0] ?? "";
    expect(ownedCustomBinds(text)).toEqual([{ key: "f6", command: "say gg; explode" }]);
    await render({
      ...props,
      managedText: text,
      effectiveBinds: { f6: "say gg; explode" },
      bindSources: { f6: { file: "tf/cfg/execs_binds.cfg", line: 2 } },
    });
    expect(box.querySelector('[data-testid="bind-row-custom-f6"]')?.textContent).toContain(
      "say gg; explode",
    );
    await act(async () => button("bind-remove-custom-f6-f6").click());
    await act(async () => vi.advanceTimersByTimeAsync(701));
    expect(ownedCustomBinds(save.mock.calls.at(-1)?.[0] ?? "")).toEqual([]);
  });
  it("defers custom saves while TF2 runs and resets command text for another profile", async () => {
    const save = vi.fn(async (_text: string) => undefined);
    status.running = true;
    await render({ onSave: save });
    await command("say gg");
    await record("F7", "F7");
    await act(async () => vi.advanceTimersByTimeAsync(701));
    expect(save).not.toHaveBeenCalled();
    status.running = false;
    await render({ onSave: save });
    await act(async () => vi.advanceTimersByTimeAsync(701));
    expect(ownedCustomBinds(save.mock.calls.at(-1)?.[0] ?? "")).toEqual([
      { key: "f7", command: "say gg" },
    ]);
    await render({ profileId: "B", onSave: save });
    expect(box.querySelector<HTMLInputElement>('[data-testid="bind-custom-command"]')?.value).toBe(
      "",
    );
    expect(box.querySelector('[data-testid="bind-row-custom-f7"]')).toBeNull();
  });
  it("refuses cfglint blocks and payload quote escapes before recording", async () => {
    const save = vi.fn(async (_text: string) => undefined);
    await render({ onSave: save });
    for (const text of ['say "gg"', "con_enable 0", "alias bind nope"]) {
      await command(text);
      expect(button("bind-record-custom").disabled).toBe(true);
      expect(box.querySelector('[aria-invalid="true"]')).not.toBeNull();
    }
    await act(async () => vi.advanceTimersByTimeAsync(701));
    expect(save).not.toHaveBeenCalled();
  });
  it("uses the same conflict review when assigning a fixed action over a custom key", async () => {
    const save = vi.fn(async (_text: string) => undefined);
    await render({
      onSave: save,
      managedText: 'bind f6 "say gg" // execs:custom-bind\n',
      effectiveBinds: { f6: "say gg" },
    });
    await act(async () => button("bind-record-jump").click());
    await act(async () =>
      window.dispatchEvent(
        new KeyboardEvent("keydown", { key: "F6", code: "F6", bubbles: true, cancelable: true }),
      ),
    );
    expect(box.querySelector('[data-testid="bind-conflict-jump"]')?.textContent).toContain(
      "say gg",
    );
    await act(async () =>
      box
        .querySelector<HTMLButtonElement>('[data-testid="bind-conflict-jump"] .btn-primary')
        ?.click(),
    );
    await act(async () => vi.advanceTimersByTimeAsync(701));
    expect(save.mock.calls.at(-1)?.[0]).toContain("bind f6 +jump\n");
    expect(save.mock.calls.at(-1)?.[0]).not.toContain("execs:custom-bind");
  });
});
