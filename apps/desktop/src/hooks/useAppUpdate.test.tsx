// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Api } from "../lib/api";
import type { AppUpdateProgress } from "../lib/updater-ui";
import { type AppUpdateState, useAppUpdate } from "./useAppUpdate";

afterEach(() => {
  vi.unstubAllGlobals();
  localStorage.clear();
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
      await act(async () => {
        rejectDownload?.(new Error("The update download timed out. Try Install update again."));
        await attempt;
      });
      expect(state?.progress).toBeNull();
      expect(state?.available?.version).toBe("0.1.5");
      expect(setError).toHaveBeenCalledWith(
        "The update download timed out. Try Install update again.",
      );
      await act(async () => state?.install());
      expect(install).toHaveBeenCalledTimes(2);
      expect(state?.progress).toBe("installing");
    } finally {
      await act(async () => root.unmount());
    }
  });
});
