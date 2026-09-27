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

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: Error) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}

function offer(version: string) {
  return { version, body: "Notes", close: vi.fn().mockResolvedValue(undefined) };
}

it("clears the install identity after an authoritative no-update check", async () => {
  native.check.mockResolvedValueOnce(offer("0.2.0")).mockResolvedValueOnce(null);
  await checkAppUpdate();
  await checkAppUpdate();
  await expect(installAppUpdate(vi.fn())).rejects.toMatchObject({ code: "NoUpdate" });
  expect(native.invoke).not.toHaveBeenCalled();
});

it("closes an older resource without restoring its identity after a newer no-update check", async () => {
  const older = deferred<ReturnType<typeof offer> | null>();
  const oldOffer = offer("0.1.9");
  native.check.mockReturnValueOnce(older.promise).mockResolvedValueOnce(null);
  const first = checkAppUpdate();
  await vi.waitFor(() => expect(native.check).toHaveBeenCalledTimes(1));
  await checkAppUpdate();
  older.resolve(oldOffer);
  await first;
  expect(oldOffer.close).toHaveBeenCalledTimes(1);
  await expect(installAppUpdate(vi.fn())).rejects.toMatchObject({ code: "NoUpdate" });
  expect(native.invoke).not.toHaveBeenCalled();
});

it("installs the newer exact version when checks finish in reverse order", async () => {
  const older = deferred<ReturnType<typeof offer> | null>();
  const oldOffer = offer("0.1.9");
  const currentOffer = offer("0.2.0");
  native.check.mockReturnValueOnce(older.promise).mockResolvedValueOnce(currentOffer);
  const first = checkAppUpdate();
  await vi.waitFor(() => expect(native.check).toHaveBeenCalledTimes(1));
  await checkAppUpdate();
  older.resolve(oldOffer);
  await first;
  expect(oldOffer.close).toHaveBeenCalledOnce();
  expect(currentOffer.close).toHaveBeenCalledOnce();
  await installAppUpdate(vi.fn());
  expect(native.invoke).toHaveBeenCalledWith("install_app_update", { expectedVersion: "0.2.0" });
});

it("retains the last successful identity on failure and ignores a stale offer after that failure", async () => {
  const older = deferred<ReturnType<typeof offer> | null>();
  native.check.mockResolvedValueOnce(offer("0.2.0"));
  await checkAppUpdate();
  native.check.mockReturnValueOnce(older.promise).mockRejectedValueOnce(Error("offline"));
  const first = checkAppUpdate();
  await vi.waitFor(() => expect(native.check).toHaveBeenCalledTimes(2));
  await expect(checkAppUpdate()).rejects.toThrow("offline");
  older.resolve(offer("0.1.9"));
  await first;
  await installAppUpdate(vi.fn());
  expect(native.invoke).toHaveBeenCalledWith("install_app_update", { expectedVersion: "0.2.0" });
});

it("does not publish an offer that becomes stale while its resource is closing", async () => {
  native.check.mockResolvedValueOnce(offer("0.2.0"));
  await checkAppUpdate();
  const closing = deferred<void>();
  const older = { ...offer("0.2.1"), close: vi.fn().mockReturnValueOnce(closing.promise) };
  native.check.mockResolvedValueOnce(older).mockRejectedValueOnce(Error("offline"));
  const first = checkAppUpdate();
  await vi.waitFor(() => expect(older.close).toHaveBeenCalledOnce());
  await expect(checkAppUpdate()).rejects.toThrow("offline");
  closing.resolve();
  await first;
  await installAppUpdate(vi.fn());
  expect(native.invoke).toHaveBeenCalledWith("install_app_update", { expectedVersion: "0.2.0" });
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
