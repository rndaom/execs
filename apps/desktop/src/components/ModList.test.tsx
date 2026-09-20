// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ModRecord } from "../lib/bridge";
import { ModList } from "./ModList";

const mod: ModRecord = {
  id: "long-mod",
  name: "A long installed mod name that must remain available to every user",
  source: { kind: "local" },
  pack: "long-mod.vpk",
  files: 2,
  bytes: 100,
  installedAt: "2026-09-01T00:00:00Z",
};

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
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("ModList", () => {
  it("uses one accessible import choice for archive, VPK, and folder paths", async () => {
    const onImportArchive = vi.fn();
    const onImportFolder = vi.fn();
    await act(async () =>
      root.render(
        <ModList
          mods={[mod]}
          locked={false}
          running={false}
          onImportArchive={onImportArchive}
          onImportFolder={onImportFolder}
          onRemove={vi.fn()}
        />,
      ),
    );

    await act(async () =>
      box.querySelector<HTMLButtonElement>('[data-testid="mods-import"]')?.click(),
    );
    const modal = box.querySelector('[data-testid="mods-import-modal"]');
    expect(modal?.getAttribute("role")).toBe("dialog");
    expect(modal?.textContent).toContain("archive, VPK, or extracted mod folder");
    await act(async () =>
      box.querySelector<HTMLButtonElement>('[data-testid="mods-import-archive"]')?.click(),
    );
    expect(onImportArchive).toHaveBeenCalledTimes(1);

    await act(async () =>
      box.querySelector<HTMLButtonElement>('[data-testid="mods-import"]')?.click(),
    );
    await act(async () =>
      box.querySelector<HTMLButtonElement>('[data-testid="mods-import-folder"]')?.click(),
    );
    expect(onImportFolder).toHaveBeenCalledTimes(1);
  });

  it("keeps full names in the row and gives remove a mod-specific name", async () => {
    await act(async () =>
      root.render(
        <ModList
          mods={[mod]}
          locked={false}
          running={false}
          onImportArchive={vi.fn()}
          onImportFolder={vi.fn()}
          onRemove={vi.fn()}
        />,
      ),
    );
    expect(box.textContent).toContain(mod.name);
    expect(
      box.querySelector(
        '[aria-label="Remove A long installed mod name that must remain available to every user"]',
      ),
    ).not.toBeNull();
  });
});
