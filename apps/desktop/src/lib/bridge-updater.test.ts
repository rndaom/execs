import { beforeEach, expect, it, vi } from "vitest";
import { checkAppUpdate, getAppVersion, installAppUpdate } from "./bridge";

const native = vi.hoisted(() => ({
  getVersion: vi.fn(),
  check: vi.fn(),
  invoke: vi.fn(),
  listen: vi.fn(),
}));
vi.mock("@tauri-apps/api/app", () => ({ getVersion: native.getVersion }));
vi.mock("@tauri-apps/plugin-updater", () => ({ check: native.check }));
vi.mock("@tauri-apps/api/core", () => ({ invoke: native.invoke }));
vi.mock("@tauri-apps/api/event", () => ({ listen: native.listen }));

beforeEach(() => {
  vi.clearAllMocks();
  native.invoke.mockResolvedValue(undefined);
  native.listen.mockResolvedValue(() => {});
});

it.each(["0.1.3+1", "0.1.3+2"])(
  "keeps %s intact from native version reads through exact install matching",
  async (version) => {
    native.getVersion.mockResolvedValue(version);
    native.check.mockResolvedValue({
      version,
      body: "Hotfix notes",
      close: vi.fn().mockResolvedValue(undefined),
    });
    expect(await getAppVersion()).toBe(version);
    expect(await checkAppUpdate()).toEqual({ version, notes: "Hotfix notes" });
    await installAppUpdate(vi.fn());
    expect(native.invoke).toHaveBeenCalledWith("install_app_update", { expectedVersion: version });
  },
);
