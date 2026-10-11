// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { copySettingsBlocked } from "../lib/settings-ui";
import { CopySettings } from "./CopySettings";

let root: Root;
let box: HTMLDivElement;
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

function button(label: string): HTMLButtonElement | undefined {
  return [...document.body.querySelectorAll("button")].find(
    (node) => node.textContent?.trim() === label,
  );
}

it("reviews profiles, preselects the ones that change and copies to the chosen ones", async () => {
  const copy = vi.fn(async () => true);
  const review = vi.fn(async () => [
    { id: "ultra", name: "Ultra", changes: true },
    { id: "wacky", name: "wacky tf2", changes: true },
    { id: "same", name: "Same", changes: false },
    { id: "odd", name: "Odd", changes: false, problem: "A cfg has an unfinished quoted value." },
  ]);
  await act(async () =>
    root.render(<CopySettings scope="binds" source={{ review, copy }} blockedReason={null} />),
  );
  await act(async () => button("Copy to other profiles…")?.click());
  expect(review).toHaveBeenCalledOnce();
  expect(document.body.textContent).toContain("Already has these settings.");
  const switches = [...document.body.querySelectorAll<HTMLButtonElement>('[role="switch"]')];
  expect(switches.map((node) => node.getAttribute("aria-checked"))).toEqual([
    "true",
    "true",
    "false",
    "false",
  ]);
  expect(switches[2].disabled).toBe(true);
  expect(switches[3].disabled).toBe(true);
  expect(document.body.textContent).toContain("A cfg has an unfinished quoted value.");
  await act(async () => switches[1].click());
  await act(async () => button("Copy to 1 profile")?.click());
  expect(copy).toHaveBeenCalledWith(["ultra"]);
  expect(document.body.querySelector('[data-testid="copy-settings-targets"]')).toBeNull();
});

it("explains why copying waits", async () => {
  expect(copySettingsBlocked(true, false, false)).toContain("Close TF2");
  expect(copySettingsBlocked(false, false, true)).toContain("changes to save");
  expect(copySettingsBlocked(false, true, false)).toContain("current change");
  expect(copySettingsBlocked(false, false, false)).toBeNull();
  await act(async () =>
    root.render(
      <CopySettings
        scope="sounds"
        source={{ review: vi.fn(), copy: vi.fn() }}
        blockedReason="Close TF2 to copy settings to other profiles."
      />,
    ),
  );
  const trigger = button("Copy to other profiles…");
  expect(trigger?.disabled).toBe(true);
  expect(trigger?.title).toContain("Close TF2");
});
