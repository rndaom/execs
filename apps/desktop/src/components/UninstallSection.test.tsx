// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { UninstallInfo } from "../lib/uninstall-ui";
import { UninstallSection } from "./UninstallSection";

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

function api(casual: UninstallInfo["casual"]) {
  let current = casual;
  return {
    getUninstallInfo: vi.fn(async () => ({
      install: { kind: "windowsInstaller" as const, uninstaller: "C:/execs/uninstall.exe" },
      dataDirectory: "C:/data/execs",
      casual: current,
    })),
    revertPreloader: vi.fn(async () => {
      current = { patchedFiles: 0, gameinfoBypassed: false };
      return { restoredFiles: [], failures: [], gameinfoRestored: true, customVpkRemoved: true };
    }),
  };
}

const q = <T extends HTMLElement>(selector: string) => document.querySelector<T>(selector);

describe("uninstall section", () => {
  it("keeps data deletion unavailable until Casual changes are restored", async () => {
    const fake = api({ patchedFiles: 3, gameinfoBypassed: true });
    const onUninstall = vi.fn();
    await act(async () =>
      root.render(<UninstallSection api={fake} blockedReason={null} onUninstall={onUninstall} />),
    );
    expect(q('[data-testid="uninstall-casual"]')?.textContent).toContain("3 particle files");
    expect(q<HTMLButtonElement>('[data-testid="uninstall-delete-data"]')?.disabled).toBe(true);
    const restore = [...document.querySelectorAll("button")].find(
      (button) => button.textContent === "Restore stock files",
    );
    await act(async () => restore?.click());
    expect(fake.revertPreloader).toHaveBeenCalledOnce();
    expect(q<HTMLButtonElement>('[data-testid="uninstall-delete-data"]')?.disabled).toBe(false);
  });

  it("confirms, keeps data by default and reports a failure", async () => {
    const fake = api({ patchedFiles: 0, gameinfoBypassed: false });
    const onUninstall = vi.fn((_: boolean, onError: (message: string) => void) =>
      onError("Close TF2 first."),
    );
    await act(async () =>
      root.render(<UninstallSection api={fake} blockedReason={null} onUninstall={onUninstall} />),
    );
    await act(async () => q<HTMLButtonElement>('[data-testid="uninstall-start"]')?.click());
    expect(onUninstall).not.toHaveBeenCalled();
    expect(q('[data-testid="uninstall-review"]')?.textContent).toContain("stay on this computer");
    await act(async () => q<HTMLButtonElement>('[data-testid="uninstall-confirm"]')?.click());
    expect(onUninstall).toHaveBeenCalledWith(false, expect.any(Function));
    expect(document.body.textContent).toContain("Close TF2 first.");
  });

  it("disables uninstalling while blocked", async () => {
    await act(async () =>
      root.render(
        <UninstallSection
          api={api({ patchedFiles: 0, gameinfoBypassed: false })}
          blockedReason="Close TF2 before uninstalling."
          onUninstall={vi.fn()}
        />,
      ),
    );
    expect(q<HTMLButtonElement>('[data-testid="uninstall-start"]')?.disabled).toBe(true);
    expect(document.body.textContent).toContain("Close TF2 before uninstalling.");
  });
});
