import { JSDOM } from "jsdom";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { createFilesDraftStore } from "../lib/files-drafts";
import { useNativeCloseGuard } from "./useNativeCloseGuard";

const native = vi.hoisted(() => ({
  enabled: true,
  listen: vi.fn(),
  destroy: vi.fn(async () => {}),
}));
vi.mock("../lib/bridge", () => ({ isTauri: () => native.enabled }));
vi.mock("@tauri-apps/api/window", () => ({
  getCurrentWindow: () => ({ onCloseRequested: native.listen, destroy: native.destroy }),
}));

let dom: JSDOM;
let root: Root;
let store: ReturnType<typeof createFilesDraftStore>;
let state: ReturnType<typeof useNativeCloseGuard>;
let close: (event: { preventDefault: () => void }) => void;
let resolveListen: (stop: () => void) => void;
let rejectListen: (error: Error) => void;
let busy = false;
const request = vi.fn();

beforeEach(() => {
  dom = new JSDOM("<!doctype html><div id='root'></div>");
  vi.stubGlobal("window", dom.window);
  vi.stubGlobal("document", dom.window.document);
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  root = createRoot(document.getElementById("root") as HTMLElement);
  store = createFilesDraftStore();
  native.enabled = true;
  busy = false;
  request.mockReset();
  native.destroy.mockClear();
  native.listen.mockReset().mockImplementation((handler) => {
    close = handler;
    return new Promise<() => void>((resolve, reject) => {
      resolveListen = resolve;
      rejectListen = reject;
    });
  });
});
afterEach(async () => {
  await act(async () => root.unmount());
  dom.window.close();
  vi.unstubAllGlobals();
});
function Harness() {
  state = useNativeCloseGuard(store, request, busy);
  return null;
}
async function mount() {
  await act(async () => root.render(createElement(Harness)));
  await act(async () => vi.dynamicImportSettled());
}
function edit() {
  store.read("a", "tf/cfg/config.cfg", "original");
  store.edit("a", "tf/cfg/config.cfg", "exact draft");
}

it("does not enable Files editing until the native listener is registered", async () => {
  await mount();
  expect(state.ready).toBe(false);
  await act(async () => resolveListen(vi.fn()));
  expect(state.ready).toBe(true);
});

it("intercepts dirty native close synchronously and destroys only through the approved action", async () => {
  await mount();
  await act(async () => resolveListen(vi.fn()));
  edit();
  const event = { preventDefault: vi.fn() };
  close(event);
  expect(event.preventDefault).toHaveBeenCalledOnce();
  expect(request).toHaveBeenCalledOnce();
  expect(native.destroy).not.toHaveBeenCalled();
  expect(store.dirty()[0].text).toBe("exact draft");
  await request.mock.calls[0][0]();
  expect(native.destroy).toHaveBeenCalledOnce();
});

it("allows a clean native close without a draft prompt", async () => {
  await mount();
  await act(async () => resolveListen(vi.fn()));
  const event = { preventDefault: vi.fn() };
  close(event);
  expect(event.preventDefault).not.toHaveBeenCalled();
  expect(request).not.toHaveBeenCalled();
});

it("intercepts close during an active write even after the draft has been acknowledged", async () => {
  await mount();
  await act(async () => resolveListen(vi.fn()));
  busy = true;
  await act(async () => root.render(createElement(Harness)));
  const event = { preventDefault: vi.fn() };
  close(event);
  expect(event.preventDefault).toHaveBeenCalledOnce();
  expect(request).toHaveBeenCalledOnce();
  expect(native.destroy).not.toHaveBeenCalled();
});

it("keeps editing unavailable and exposes a subscription failure", async () => {
  await mount();
  await act(async () => rejectListen(new Error("listen refused")));
  expect(state.ready).toBe(false);
  expect(state.error).toContain("close protection could not start");
});

it("cleans up a late subscription and suppresses stale close callbacks", async () => {
  await mount();
  await act(async () => root.render(null));
  const stop = vi.fn();
  await act(async () => resolveListen(stop));
  expect(stop).toHaveBeenCalledOnce();
  edit();
  const event = { preventDefault: vi.fn() };
  close(event);
  expect(event.preventDefault).toHaveBeenCalledOnce();
  expect(request).not.toHaveBeenCalled();
});

it("protects browser unload only while drafts exist and removes the listener on cleanup", async () => {
  native.enabled = false;
  await mount();
  expect(state.ready).toBe(true);
  expect(native.listen).not.toHaveBeenCalled();
  const clean = new dom.window.Event("beforeunload", { cancelable: true });
  window.dispatchEvent(clean);
  expect(clean.defaultPrevented).toBe(false);
  edit();
  const dirty = new dom.window.Event("beforeunload", { cancelable: true });
  window.dispatchEvent(dirty);
  expect(dirty.defaultPrevented).toBe(true);
  await act(async () => root.render(null));
  const after = new dom.window.Event("beforeunload", { cancelable: true });
  window.dispatchEvent(after);
  expect(after.defaultPrevented).toBe(false);
});
