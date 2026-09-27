// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { StorageReport } from "../lib/app-settings-ui";
import { StorageUsage } from "./StorageUsage";

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

function report(downloads: number, retired: number): StorageReport {
  const groups = [
    { id: "profiles" as const, bytes: 5 * 1024 * 1024, files: 3, unreadable: 0, clearable: false },
    { id: "downloads" as const, bytes: downloads, files: 2, unreadable: 0, clearable: true },
    { id: "retired" as const, bytes: retired, files: 1, unreadable: 0, clearable: true },
    { id: "logs" as const, bytes: 0, files: 0, unreadable: 0, clearable: false },
    { id: "protected" as const, bytes: 2048, files: 1, unreadable: 1, clearable: false },
    { id: "other" as const, bytes: 0, files: 0, unreadable: 0, clearable: false },
  ];
  return {
    groups,
    totalBytes: groups.reduce((sum, group) => sum + group.bytes, 0),
    clearableBytes: downloads + retired,
    partial: true,
  };
}

describe("app data storage", () => {
  it("reports each group, confirms, clears and re-measures", async () => {
    const getStorageUsage = vi
      .fn()
      .mockResolvedValueOnce(report(3 * 1024 * 1024, 1024))
      .mockResolvedValueOnce(report(0, 0));
    const clearDownloadCaches = vi.fn(async () => ({
      freedBytes: 3 * 1024 * 1024 + 1024,
      failed: ["hud-catalog"],
    }));
    await act(async () =>
      root.render(<StorageUsage api={{ getStorageUsage, clearDownloadCaches }} />),
    );
    expect(node.querySelector('[data-testid="storage-profiles"]')?.textContent).toContain("5.0 MB");
    expect(node.querySelector('[data-testid="storage-logs"]')).toBeNull();
    expect(node.querySelector('[data-testid="storage-protected"]')?.textContent).toContain(
      "At least 2 KB",
    );
    const clear = node.querySelector<HTMLButtonElement>('[data-testid="storage-clear"]');
    expect(clear?.textContent).toBe("Clear downloads (3.0 MB)");
    await act(async () => clear?.click());
    expect(clearDownloadCaches).not.toHaveBeenCalled();
    await act(async () =>
      document.querySelector<HTMLButtonElement>('[data-testid="storage-clear-confirm"]')?.click(),
    );
    expect(clearDownloadCaches).toHaveBeenCalledOnce();
    expect(getStorageUsage).toHaveBeenCalledTimes(2);
    expect(node.querySelector('[data-testid="storage-clear-result"]')?.textContent).toBe(
      "Freed 3.0 MB. One item was in use and kept: hud-catalog. Try again later.",
    );
    expect(node.querySelector<HTMLButtonElement>('[data-testid="storage-clear"]')?.disabled).toBe(
      true,
    );
  });

  it("keeps Clear unavailable until the native close listener is ready", async () => {
    const api = {
      getStorageUsage: vi.fn(async () => report(10, 0)),
      clearDownloadCaches: vi.fn(),
    };
    await act(async () => root.render(<StorageUsage api={api} ready={false} />));
    expect(node.querySelector<HTMLButtonElement>('[data-testid="storage-clear"]')?.disabled).toBe(
      true,
    );
  });
});
