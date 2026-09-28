// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { HudBackupStorage } from "./HudBackupStorage";

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
const backup = {
  id: "live/token/My HUD",
  name: "My HUD",
  location: "TF2 folder",
  modifiedAt: 1790467200,
  bytes: 12000,
  files: 3,
  revision: "exact-original",
};
function fixture() {
  return {
    getHudBackups: vi.fn(async () => ({ backups: [backup], unreadable: [] })),
    deleteHudBackup: vi.fn(async () => {}),
    restoreHudBackup: vi.fn(async (): Promise<string | null> => "/Documents/recovered"),
  };
}
async function click(label: string) {
  await act(async () => node.querySelector<HTMLButtonElement>(`[aria-label="${label}"]`)?.click());
}
async function confirm() {
  await act(async () =>
    document.querySelector<HTMLButtonElement>('[data-testid="hud-backup-confirm"]')?.click(),
  );
}
describe("HUD backup storage", () => {
  it("shows names, location and dates and requires confirmation before exact-revision deletion", async () => {
    const api = fixture();
    const onChanged = vi.fn();
    await act(async () => root.render(<HudBackupStorage api={api} ready onChanged={onChanged} />));
    expect(node.textContent).toContain("My HUD");
    expect(node.textContent).toContain("TF2 folder");
    expect(node.textContent).toContain(new Date(backup.modifiedAt * 1000).toLocaleDateString());
    await click("Delete My HUD backup");
    expect(api.deleteHudBackup).not.toHaveBeenCalled();
    expect(document.body.textContent).toContain("cannot be undone");
    await confirm();
    expect(api.deleteHudBackup).toHaveBeenCalledWith(backup.id, backup.revision);
    expect(onChanged).toHaveBeenCalledOnce();
  });
  it("explains exact external recovery and does not report cancelled pickers as success", async () => {
    const api = fixture();
    api.restoreHudBackup.mockResolvedValueOnce(null);
    await act(async () => root.render(<HudBackupStorage api={api} ready onChanged={vi.fn()} />));
    await click("Restore My HUD files");
    expect(document.body.textContent).toContain("new folder in a location you choose");
    await confirm();
    expect(node.querySelector('[role="status"]')).toBeNull();
    await click("Restore My HUD files");
    await confirm();
    expect(node.textContent).toContain("Recovered files to /Documents/recovered");
    expect(api.deleteHudBackup).not.toHaveBeenCalled();
  });
  it("retains the backup and shows a native drift refusal", async () => {
    const api = fixture();
    api.deleteHudBackup.mockRejectedValueOnce(new Error("Backup changed"));
    await act(async () => root.render(<HudBackupStorage api={api} ready onChanged={vi.fn()} />));
    await click("Delete My HUD backup");
    await confirm();
    expect(node.querySelector('[role="alert"]')?.textContent).toContain("Backup changed");
    expect(node.textContent).toContain("My HUD");
  });
});
