// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { emptyAbsorbDelta } from "../../lib/library-ui";
import { PackPrompt } from "./PackPrompt";

let root: Root;
let box: HTMLDivElement;
const onChoice = vi.fn();
const onDefer = vi.fn();
const onRefresh = vi.fn();
const delta = { ...emptyAbsorbDelta(), packsAdded: ["new.vpk"], packsRemoved: ["missing.vpk"] };
async function render(busy = false, current = delta, name = "Tournament") {
  await act(async () =>
    root.render(
      <PackPrompt
        delta={current}
        profileName={name}
        busy={busy}
        onChoice={onChoice}
        onDefer={onDefer}
        onRefresh={onRefresh}
      />,
    ),
  );
}
beforeEach(() => {
  vi.clearAllMocks();
  box = document.createElement("div");
  document.body.append(box);
  root = createRoot(box);
});
afterEach(async () => {
  await act(async () => root.unmount());
  box.remove();
});
it("names the profile and submits independent mixed pack choices", async () => {
  await render();
  expect(box.textContent).toContain("Tournament");
  await act(async () =>
    box.querySelector<HTMLInputElement>('[data-testid="pack-choice-1-restore"]')?.click(),
  );
  await act(async () =>
    box.querySelector<HTMLButtonElement>('[data-testid="absorb-pack-update"]')?.click(),
  );
  expect(onChoice).toHaveBeenCalledWith([
    { pack: "new.vpk", choice: "add" },
    { pack: "missing.vpk", choice: "restore" },
  ]);
});
it("explains both Keep choices and the next-switch restriction", async () => {
  await render();
  await act(async () =>
    box.querySelector<HTMLInputElement>('[data-testid="pack-choice-0-keep"]')?.click(),
  );
  await act(async () =>
    box.querySelector<HTMLInputElement>('[data-testid="pack-choice-1-keep"]')?.click(),
  );
  expect(box.textContent).toContain("Switching profiles is blocked");
  expect(box.textContent).toContain("Switching away and back restores it");
});
it("resets choices for a new complete snapshot and wraps long pack names", async () => {
  await render();
  await act(async () =>
    box.querySelector<HTMLInputElement>('[data-testid="pack-choice-0-keep"]')?.click(),
  );
  const long = "a-very-long-custom-pack-name".repeat(8);
  await render(false, { ...delta, packsAdded: [long] }, "Practice");
  expect(box.querySelector<HTMLInputElement>('[data-testid="pack-choice-0-add"]')?.checked).toBe(
    true,
  );
  expect([...box.querySelectorAll("p")].find((p) => p.textContent === long)?.className).toContain(
    "break-words",
  );
  expect(box.textContent).toContain("Practice");
});
it("blocks submission, deferral and editing while applying", async () => {
  await render(true);
  await act(async () => {
    box.querySelector<HTMLButtonElement>('[data-testid="absorb-pack-update"]')?.click();
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
  });
  expect(onChoice).not.toHaveBeenCalled();
  expect(onDefer).not.toHaveBeenCalled();
  expect(
    [...box.querySelectorAll<HTMLInputElement>("input")].every((input) => input.disabled),
  ).toBe(true);
});
