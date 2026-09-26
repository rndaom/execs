// @vitest-environment jsdom
import { act, StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Api } from "../lib/api";
import type { AppUpdateInfo, AppUpdateProgress } from "../lib/updater-ui";
import { type AppUpdateState, useAppUpdate } from "./useAppUpdate";

const cleanups: (() => Promise<void>)[] = [];

afterEach(async () => {
  for (const cleanup of cleanups.splice(0)) await cleanup();
  vi.unstubAllGlobals();
  localStorage.clear();
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

async function renderUpdate(
  checkAppUpdate: () => Promise<AppUpdateInfo | null>,
  initialPreference: boolean | null = true,
  strict = false,
) {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const container = document.createElement("div");
  const root = createRoot(container);
  const install = vi.fn().mockResolvedValue(undefined);
  const api = {
    getAppVersion: async () => "0.1.8",
    checkAppUpdate,
    installAppUpdate: install,
  } as unknown as Api;
  const setError = vi.fn();
  let state!: AppUpdateState;
  function Harness({ preference }: { preference: boolean | null }) {
    state = useAppUpdate(api, { setError, checkOnStartup: preference });
    return null;
  }
  async function render(preference: boolean | null) {
    await act(async () =>
      root.render(
        strict ? (
          <StrictMode>
            <Harness preference={preference} />
          </StrictMode>
        ) : (
          <Harness preference={preference} />
        ),
      ),
    );
  }
  cleanups.push(async () => act(async () => root.unmount()));
  await render(initialPreference);
  return {
    get state() {
      return state;
    },
    render,
    install,
  };
}

describe("authoritative update checks", () => {
  const offered = { version: "0.2.0", notes: "Overhaul" };

  it("clears a previous offer and dismissed state when a manual check reports none", async () => {
    const check = vi.fn().mockResolvedValueOnce(offered).mockResolvedValueOnce(null);
    const hook = await renderUpdate(check);
    await act(async () => hook.state.dismiss());
    expect(hook.state.dismissed).toBe(true);
    await act(async () => hook.state.check());
    expect(hook.state.available).toBeNull();
    expect(hook.state.dismissed).toBe(false);
    expect(hook.state.checkMessage).toBe("You're on the latest version.");
    await act(async () => hook.state.install());
    expect(hook.install).not.toHaveBeenCalled();
  });

  it("replaces a dismissed offer with a newer manual result", async () => {
    const newer = { version: "0.2.1", notes: "Next" };
    const check = vi.fn().mockResolvedValueOnce(offered).mockResolvedValueOnce(newer);
    const hook = await renderUpdate(check);
    await act(async () => hook.state.dismiss());
    await act(async () => hook.state.check());
    expect(hook.state.available).toEqual(newer);
    expect(hook.state.dismissed).toBe(false);
    expect(hook.state.checkMessage).toBeNull();
  });

  it("retains a dismissed successful offer when a later check fails", async () => {
    const check = vi.fn().mockResolvedValueOnce(offered).mockRejectedValueOnce(Error("offline"));
    const hook = await renderUpdate(check);
    await act(async () => hook.state.dismiss());
    await act(async () => hook.state.check());
    expect(hook.state.available).toEqual(offered);
    expect(hook.state.dismissed).toBe(true);
    expect(hook.state.checkMessage).toBe("Could not check for updates.");
    expect(hook.state.checking).toBe(false);
  });

  it("does not restore an old launch offer after a newer manual no-update response", async () => {
    const launch = deferred<AppUpdateInfo | null>();
    const manual = deferred<AppUpdateInfo | null>();
    const check = vi.fn().mockReturnValueOnce(launch.promise).mockReturnValueOnce(manual.promise);
    const hook = await renderUpdate(check);
    let checking!: Promise<void>;
    await act(async () => {
      checking = hook.state.check();
    });
    await act(async () => {
      manual.resolve(null);
      await checking;
    });
    await act(async () => launch.resolve(offered));
    expect(hook.state.available).toBeNull();
    expect(hook.state.checkMessage).toBe("You're on the latest version.");
    expect(hook.state.checking).toBe(false);
  });

  it("does not replace a newer offer or feedback with an older manual failure", async () => {
    const older = deferred<AppUpdateInfo | null>();
    const newer = deferred<AppUpdateInfo | null>();
    const check = vi.fn().mockReturnValueOnce(older.promise).mockReturnValueOnce(newer.promise);
    const hook = await renderUpdate(check, false);
    let first!: Promise<void>;
    let second!: Promise<void>;
    await act(async () => {
      first = hook.state.check();
      second = hook.state.check();
    });
    await act(async () => {
      newer.resolve(offered);
      await second;
    });
    await act(async () => {
      older.reject(Error("obsolete failure"));
      await first;
    });
    expect(hook.state.available).toEqual(offered);
    expect(hook.state.checkMessage).toBeNull();
    expect(hook.state.checking).toBe(false);
  });

  it("waits for preferences, supports manual checks when startup is disabled, and reads version", async () => {
    const check = vi.fn().mockResolvedValue(null);
    const hook = await renderUpdate(check, null);
    expect(check).not.toHaveBeenCalled();
    expect(hook.state.version).toBe("0.1.8");
    await hook.render(false);
    expect(check).not.toHaveBeenCalled();
    await act(async () => hook.state.check());
    expect(check).toHaveBeenCalledTimes(1);
  });

  it("does not start an automatic check after a manual check while preferences were loading", async () => {
    const check = vi.fn().mockResolvedValue(null);
    const hook = await renderUpdate(check, null);
    await act(async () => hook.state.check());
    await hook.render(true);
    expect(check).toHaveBeenCalledTimes(1);
  });

  it("still checks on startup under the Strict Mode effect remount", async () => {
    const check = vi.fn().mockResolvedValue(offered);
    const hook = await renderUpdate(check, true, true);
    expect(hook.state.available).toEqual(offered);
    expect(hook.state.checking).toBe(false);
  });

  it("does not install a prior offer while a new check is pending", async () => {
    const pending = deferred<AppUpdateInfo | null>();
    const check = vi.fn().mockResolvedValueOnce(offered).mockReturnValueOnce(pending.promise);
    const hook = await renderUpdate(check);
    let checking!: Promise<void>;
    await act(async () => {
      checking = hook.state.check();
    });
    await act(async () => hook.state.install());
    expect(hook.install).not.toHaveBeenCalled();
    await act(async () => {
      pending.resolve(null);
      await checking;
    });
  });

  it("holds the install guard across renders before the first progress callback", async () => {
    const check = vi.fn().mockResolvedValue(offered);
    const hook = await renderUpdate(check);
    const pending = deferred<void>();
    hook.install.mockReturnValueOnce(pending.promise);
    let installing!: Promise<void>;
    await act(async () => {
      installing = hook.state.install();
    });
    // A parent rerender must not reset the in-flight guard from null progress.
    await hook.render(true);
    await act(async () => {
      await hook.state.install();
      await hook.state.check();
    });
    expect(hook.install).toHaveBeenCalledTimes(1);
    expect(check).toHaveBeenCalledTimes(1);
    expect(hook.state.progress).toBeNull();
    await act(async () => {
      pending.reject(Error("Could not start the update"));
      await installing;
    });
    await act(async () => hook.state.install());
    expect(hook.install).toHaveBeenCalledTimes(2);
  });
});

describe("update download failure recovery", () => {
  it("releases download progress and keeps the offered update available for retry", async () => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    const container = document.createElement("div");
    const root = createRoot(container);
    const setError = vi.fn();
    let state: AppUpdateState | undefined;
    let rejectDownload: ((error: Error) => void) | undefined;
    const install = vi
      .fn<(progress: (step: AppUpdateProgress) => void) => Promise<void>>()
      .mockImplementationOnce((progress) => {
        progress("downloading");
        return new Promise((_, reject) => {
          rejectDownload = reject;
        });
      })
      .mockImplementationOnce(async (progress) => {
        progress("installing");
      });
    const api = {
      getAppVersion: async () => "0.1.4",
      checkAppUpdate: async () => ({ version: "0.1.5", notes: "Repair update" }),
      installAppUpdate: install,
    } as unknown as Api;
    function Harness() {
      state = useAppUpdate(api, { setError });
      return null;
    }
    try {
      await act(async () => root.render(<Harness />));
      let attempt: Promise<void> | undefined;
      await act(async () => {
        attempt = state?.install();
      });
      expect(state?.progress).toBe("downloading");
      expect(localStorage.getItem("execs:pending-release-notes")).toContain('"version":"0.1.5"');
      await act(async () => {
        rejectDownload?.(new Error("The update download timed out. Try Install update again."));
        await attempt;
      });
      expect(state?.progress).toBeNull();
      expect(state?.available?.version).toBe("0.1.5");
      expect(localStorage.getItem("execs:pending-release-notes")).toBeNull();
      expect(setError).toHaveBeenCalledWith(
        "The update download timed out. Try Install update again.",
        "update:install",
      );
      await act(async () => state?.install());
      expect(install).toHaveBeenCalledTimes(2);
      expect(state?.progress).toBe("installing");
      expect(setError).toHaveBeenLastCalledWith(null, "update:install");
      expect(JSON.parse(localStorage.getItem("execs:pending-release-notes") ?? "null")).toEqual({
        version: "0.1.5",
        notes: "Repair update",
      });
    } finally {
      await act(async () => root.unmount());
    }
  });
});
