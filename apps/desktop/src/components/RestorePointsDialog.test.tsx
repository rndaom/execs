// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ProfileLibrary } from "../lib/bridge";
import type { RestorePoint } from "../lib/restore-points-ui";
import { RestorePointsDialog } from "./RestorePointsDialog";

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

const library = {
  initialized: true,
  usable: true,
  rootMismatch: false,
  tf2Root: "C:/TF2",
  confirmedRoot: "C:/TF2",
  activeProfileId: "main",
  profiles: [{ id: "main", name: "Main", createdAt: "", updatedAt: "" }],
} as unknown as ProfileLibrary;

const saved: RestorePoint = {
  id: "1".padStart(32, "0"),
  profileId: "main",
  profileName: "Main",
  label: "Before HUD",
  createdAt: Date.UTC(2026, 8, 26, 12),
  bytes: 2048,
};

function fakeApi(points: RestorePoint[] = [saved]) {
  const none = { added: [], removed: [], changed: [] };
  return {
    listRestorePoints: vi.fn(async () => ({ points, keepPerProfile: 5 })),
    createRestorePoint: vi.fn(async () => saved),
    deleteRestorePoint: vi.fn(async () => ({ points: [], keepPerProfile: 5 })),
    setRestorePointRetention: vi.fn(async (keep: number) => ({ points, keepPerProfile: keep })),
    compareRestorePoint: vi.fn(async () => ({
      fromId: "main",
      fromName: "Main",
      toId: saved.id,
      toName: "Main",
      revision: "r",
      launchOptions: null,
      hud: { from: "toonhud", to: "flawhud" },
      hitSound: null,
      killSound: null,
      packs: none,
      cfgFiles: none,
      configCfgChanged: false,
      values: [],
      valuesTruncated: false,
      casual: none,
      blocked: null,
    })),
    restoreRestorePoint: vi.fn(async () => library),
  };
}

const button = (text: string) =>
  [...document.querySelectorAll<HTMLButtonElement>('[data-testid="restore-points"] button')].find(
    (entry) => entry.textContent?.includes(text),
  );

async function render(api: ReturnType<typeof fakeApi>, running = false) {
  const onRestored = vi.fn();
  await act(async () =>
    root.render(
      <RestorePointsDialog
        api={api}
        profileId="main"
        library={library}
        running={running}
        busy={false}
        onRestored={onRestored}
        onClose={vi.fn()}
      />,
    ),
  );
  return onRestored;
}

describe("restore points dialog", () => {
  it("saves a named restore point and lists it", async () => {
    const api = fakeApi([]);
    await render(api);
    expect(document.body.textContent).toContain("No restore points yet.");
    const input = document.querySelector<HTMLInputElement>("#restore-point-label");
    const setValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
    await act(async () => {
      setValue?.call(input, "Before HUD");
      input?.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await act(async () => button("Save restore point of Main")?.click());
    expect(api.createRestorePoint).toHaveBeenCalledWith("main", "Before HUD");
    expect(document.body.textContent).toContain("Saved Before HUD.");
  });

  it("compares, then restores as a new profile", async () => {
    const api = fakeApi();
    const onRestored = await render(api);
    await act(async () => button("Compare")?.click());
    expect(document.querySelector('[data-testid="restore-point-compare"]')?.textContent).toContain(
      "flawhud",
    );
    await act(async () => button("Restore…")?.click());
    await act(async () =>
      document.querySelector<HTMLButtonElement>('[data-testid="restore-point-confirm"]')?.click(),
    );
    expect(api.restoreRestorePoint).toHaveBeenCalledWith(
      saved.id,
      expect.stringMatching(/^Main \(restored /),
    );
    expect(onRestored).toHaveBeenCalledWith(library);
  });

  it("keeps Restore unavailable while TF2 runs and deletes after confirmation", async () => {
    const api = fakeApi();
    await render(api, true);
    expect(button("Restore…")?.disabled).toBe(true);
    await act(async () => button("Delete…")?.click());
    expect(api.deleteRestorePoint).not.toHaveBeenCalled();
    await act(async () =>
      document.querySelector<HTMLButtonElement>('[data-testid="restore-point-delete"]')?.click(),
    );
    expect(api.deleteRestorePoint).toHaveBeenCalledWith(saved.id);
  });
});
