// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { Api } from "../lib/api";
import {
  type AppPreferences,
  type AppSettingsPayload,
  DEFAULT_APP_PREFERENCES,
} from "../lib/app-settings-ui";
import { type AppPreferencesState, useAppPreferences } from "./useAppPreferences";

let cleanups: (() => Promise<void>)[] = [];
beforeEach(() => vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true));
afterEach(async () => {
  for (const cleanup of cleanups) await cleanup();
  cleanups = [];
  delete document.documentElement.dataset.motion;
  vi.unstubAllGlobals();
});

function payload(preferences = DEFAULT_APP_PREFERENCES): AppSettingsPayload {
  return {
    preferences: { ...preferences },
    dataDirectory: "C:\\Users\\Player\\AppData\\Roaming\\execs",
  };
}

async function renderPreferences(api: Api) {
  const root = createRoot(document.createElement("div"));
  let state!: AppPreferencesState;
  function Harness() {
    state = useAppPreferences(api);
    return null;
  }
  await act(async () => root.render(<Harness />));
  const unmount = async () => act(async () => root.unmount());
  cleanups.push(unmount);
  return {
    get state() {
      return state;
    },
    unmount,
  };
}

it("loads global preferences without consulting a profile or the TF2 write lock", async () => {
  const api = {
    getAppSettings: vi.fn().mockResolvedValue(payload()),
    setAppPreferences: vi.fn(async (preferences: AppPreferences) => payload(preferences)),
  } as unknown as Api;
  const hook = await renderPreferences(api);
  expect(hook.state.loading).toBe(false);
  expect(hook.state.data).toEqual(payload());
  await act(async () => hook.state.save({ motion: "reduce" }));
  expect(api.setAppPreferences).toHaveBeenCalledWith({
    checkForUpdatesOnStartup: true,
    motion: "reduce",
  });
  expect(document.documentElement.dataset.motion).toBe("reduce");
  await act(async () => hook.state.save({ motion: "system" }));
  // Removing the app override leaves the OS media query in control.
  expect(document.documentElement.dataset.motion).toBeUndefined();
});

it("loads persisted preferences on a new app mount", async () => {
  let persisted = payload();
  const api = {
    getAppSettings: vi.fn(async () => persisted),
    setAppPreferences: vi.fn(async (preferences: AppPreferences) => {
      persisted = payload(preferences);
      return persisted;
    }),
  } as unknown as Api;
  const first = await renderPreferences(api);
  await act(async () => first.state.save({ motion: "reduce", checkForUpdatesOnStartup: false }));
  await first.unmount();
  const restarted = await renderPreferences(api);
  expect(restarted.state.data?.preferences).toEqual({
    motion: "reduce",
    checkForUpdatesOnStartup: false,
  });
  expect(document.documentElement.dataset.motion).toBe("reduce");
});

it("does not treat failed reads as defaults or allow writes until Retry succeeds", async () => {
  const api = {
    getAppSettings: vi
      .fn()
      .mockRejectedValueOnce(Error("settings are unreadable"))
      .mockResolvedValueOnce(payload()),
    setAppPreferences: vi.fn(),
  } as unknown as Api;
  const hook = await renderPreferences(api);
  expect(hook.state.data).toBeNull();
  expect(hook.state.error).toBe("settings are unreadable");
  await act(async () => hook.state.save({ motion: "reduce" }));
  expect(api.setAppPreferences).not.toHaveBeenCalled();
  await act(async () => hook.state.retry());
  expect(hook.state.data?.preferences).toEqual(DEFAULT_APP_PREFERENCES);
  expect(hook.state.error).toBeNull();
});

it("keeps committed preferences on a failed write and retries the exact attempted values", async () => {
  const api = {
    getAppSettings: vi.fn().mockResolvedValue(payload()),
    setAppPreferences: vi
      .fn()
      .mockRejectedValueOnce(Error("disk full"))
      .mockImplementationOnce(async (preferences: AppPreferences) => payload(preferences)),
  } as unknown as Api;
  const hook = await renderPreferences(api);
  await act(async () => {
    await expect(hook.state.save({ checkForUpdatesOnStartup: false })).rejects.toThrow("disk full");
  });
  expect(hook.state.error).toBe("disk full");
  expect(hook.state.saving).toBe(false);
  expect(hook.state.data?.preferences.checkForUpdatesOnStartup).toBe(true);
  await act(async () => hook.state.retry());
  expect(api.setAppPreferences).toHaveBeenLastCalledWith({
    checkForUpdatesOnStartup: false,
    motion: "system",
  });
  expect(hook.state.data?.preferences.checkForUpdatesOnStartup).toBe(false);
  expect(hook.state.error).toBeNull();
});

it("shows rapid edits immediately and serializes the latest combined values", async () => {
  let completeFirst!: (value: AppSettingsPayload) => void;
  const firstWrite = new Promise<AppSettingsPayload>((resolve) => {
    completeFirst = resolve;
  });
  const api = {
    getAppSettings: vi.fn().mockResolvedValue(payload()),
    setAppPreferences: vi
      .fn()
      .mockReturnValueOnce(firstWrite)
      .mockImplementation(async (preferences: AppPreferences) => payload(preferences)),
  } as unknown as Api;
  const hook = await renderPreferences(api);
  let first!: Promise<void>;
  let second!: Promise<void>;
  await act(async () => {
    first = hook.state.save({ motion: "reduce" });
  });
  expect(hook.state.saving).toBe(true);
  expect(hook.state.data?.preferences.motion).toBe("reduce");
  await act(async () => {
    second = hook.state.save({ checkForUpdatesOnStartup: false });
  });
  expect(api.setAppPreferences).toHaveBeenCalledTimes(1);
  expect(hook.state.data?.preferences).toEqual({
    motion: "reduce",
    checkForUpdatesOnStartup: false,
  });
  await act(async () => {
    completeFirst(payload({ motion: "reduce", checkForUpdatesOnStartup: true }));
    await Promise.all([first, second]);
  });
  expect(api.setAppPreferences).toHaveBeenCalledTimes(2);
  expect(api.setAppPreferences).toHaveBeenLastCalledWith({
    motion: "reduce",
    checkForUpdatesOnStartup: false,
  });
  expect(hook.state.data?.preferences).toEqual({
    motion: "reduce",
    checkForUpdatesOnStartup: false,
  });
  expect(hook.state.saving).toBe(false);
});
