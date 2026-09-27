// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { BindsPane } from "./BindsPane";

vi.mock("./hooks/useAppStatus", () => ({ useAppStatus: () => ({ running: false, busy: false }) }));

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

function rows(): string[] {
  return [...box.querySelectorAll<HTMLElement>('[data-testid^="bind-row-"]')].map(
    (row) => row.dataset.testid?.replace("bind-row-", "") ?? "",
  );
}

async function search(value: string) {
  const input = box.querySelector<HTMLInputElement>('[data-testid="bind-search"]');
  if (!input) throw new Error("Missing search");
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set?.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

describe("Binds search", () => {
  it("finds actions by name, hint and bound key across every category", async () => {
    await act(async () =>
      root.render(
        <BindsPane
          profileId="profile-a"
          layer="vanilla"
          effectiveBinds={{ mouse4: "voicemenu 1 1" }}
          managedText=""
          onSave={async () => undefined}
        />,
      ),
    );
    expect(rows()).toContain("forward");
    expect(rows()).toContain("loadout3");

    await search("spy");
    expect(rows().sort()).toEqual(["lastdisguise", "spy"]);
    await search("mouse 4");
    expect(rows()).toEqual(["spy"]);
    expect(box.querySelector('[data-testid="bind-cap-spy-mouse4"]')?.textContent).toBe("Mouse 4");
    await search("no such action");
    expect(rows()).toEqual([]);
    expect(box.querySelector('[data-testid="bind-search-empty"]')?.textContent).toContain(
      "No actions match",
    );

    await act(async () => document.getElementById("bind-category-menus")?.click());
    expect(box.querySelector<HTMLInputElement>('[data-testid="bind-search"]')?.value).toBe("");
    expect(rows()).toContain("showscores");
    expect(rows()).not.toContain("forward");
  });
});
