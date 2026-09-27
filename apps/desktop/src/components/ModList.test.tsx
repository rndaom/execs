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
    expect(document.activeElement?.textContent).toBe("Cancel");
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

  it("reviews even a small local pack and focuses Cancel before any destructive action", async () => {
    const onRemove = vi.fn();
    await act(async () =>
      root.render(
        <ModList
          mods={[mod]}
          locked={false}
          running={false}
          onImportArchive={vi.fn()}
          onImportFolder={vi.fn()}
          onRemove={onRemove}
        />,
      ),
    );
    const opener = box.querySelector<HTMLButtonElement>('[data-testid="mods-remove-long-mod"]');
    opener?.focus();
    await act(async () => opener?.click());
    const cancel = box.querySelector<HTMLButtonElement>('[data-testid="mods-remove-confirm-no"]');
    expect(document.activeElement).toBe(cancel);
    expect(onRemove).not.toHaveBeenCalled();
    expect(box.querySelector('[data-testid="mods-remove-confirm"]')?.textContent).toContain(
      "Keep the original file",
    );
    await act(async () => cancel?.click());
    expect(onRemove).not.toHaveBeenCalled();
    expect(document.activeElement).toBe(opener);
    await act(async () => opener?.click());
    await act(async () =>
      box.querySelector<HTMLButtonElement>('[data-testid="mods-remove-confirm-yes"]')?.click(),
    );
    expect(onRemove).toHaveBeenCalledExactlyOnceWith(mod.id);
  });

  it("refuses removal when a refreshed status selects the pack for Casual", async () => {
    const onRemove = vi.fn();
    const onManageParticles = vi.fn();
    const render = (selectedParticleMods: string[]) =>
      root.render(
        <ModList
          mods={[mod]}
          locked={false}
          running={false}
          selectedParticleMods={selectedParticleMods}
          onManageParticles={onManageParticles}
          onImportArchive={vi.fn()}
          onImportFolder={vi.fn()}
          onRemove={onRemove}
        />,
      );
    await act(async () => render([]));
    await act(async () =>
      box.querySelector<HTMLButtonElement>('[data-testid="mods-remove-long-mod"]')?.click(),
    );
    await act(async () => render([mod.id]));
    const confirm = box.querySelector<HTMLButtonElement>('[data-testid="mods-remove-confirm-yes"]');
    expect(confirm?.disabled).toBe(true);
    await act(async () => confirm?.click());
    expect(onRemove).not.toHaveBeenCalled();
    await act(async () =>
      box.querySelector<HTMLButtonElement>('[data-testid="mods-remove-confirm-no"]')?.click(),
    );
    expect(
      box.querySelector<HTMLButtonElement>('[data-testid="mods-remove-long-mod"]')?.disabled,
    ).toBe(true);
    const manage = [...box.querySelectorAll<HTMLButtonElement>("button")].find(
      (button) => button.textContent === "Change selection",
    );
    await act(async () => manage?.click());
    expect(onManageParticles).toHaveBeenCalledOnce();
  });

  it("releases an open removal dialog when the retained Installed task becomes hidden", async () => {
    const onRemove = vi.fn();
    const render = (active: boolean) =>
      root.render(
        <ModList
          active={active}
          mods={[mod]}
          locked={false}
          running={false}
          onImportArchive={vi.fn()}
          onImportFolder={vi.fn()}
          onRemove={onRemove}
        />,
      );
    await act(async () => render(true));
    await act(async () =>
      box.querySelector<HTMLButtonElement>('[data-testid="mods-remove-long-mod"]')?.click(),
    );
    expect(box.querySelector('[role="alertdialog"]')).not.toBeNull();
    await act(async () => render(false));
    expect(box.querySelector('[role="alertdialog"]')).toBeNull();
    await act(async () => render(true));
    expect(box.querySelector('[role="alertdialog"]')).toBeNull();
    expect(onRemove).not.toHaveBeenCalled();
  });
});
