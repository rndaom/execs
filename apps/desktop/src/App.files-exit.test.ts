// @vitest-environment jsdom
import { EditorView } from "@codemirror/view";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { App } from "./App";
import { createPreviewApi } from "./lib/preview-bridge";

vi.mock("./lib/files-analysis", async (load) => {
  const actual = await load<typeof import("./lib/files-analysis")>();
  return {
    ...actual,
    analyzeFilesSnapshot: vi.fn(async (snapshot, signal) => {
      await Promise.resolve();
      if (signal?.aborted) throw Error("Analysis cancelled.");
      return actual.runFilesAnalysis(snapshot);
    }),
  };
});
let root: Root;
let box: HTMLDivElement;
let runningChanged: (running: boolean) => void;
let api: ReturnType<typeof createPreviewApi>;
async function click(label: string) {
  await act(async () => {
    const button = [...box.querySelectorAll("button")].find((b) => b.textContent?.trim() === label);
    if (!button) throw Error(`Missing ${label}`);
    button.click();
  });
}
function editor() {
  const element = box.querySelector<HTMLElement>(".cm-editor");
  if (!element) throw Error("Missing editor");
  return EditorView.findFromDOM(element) as EditorView;
}
async function edit(text = "fov_desired 79\n") {
  await act(async () =>
    editor().dispatch({ changes: { from: 0, to: editor().state.doc.length, insert: text } }),
  );
}
beforeEach(async () => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  Range.prototype.getClientRects = () => [] as unknown as DOMRectList;
  Range.prototype.getBoundingClientRect = () => new DOMRect();
  window.matchMedia = vi
    .fn()
    .mockReturnValue({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() });
  box = document.createElement("div");
  document.body.append(box);
  root = createRoot(box);
  api = createPreviewApi("settings-files");
  api.onTf2Running = async (callback) => {
    runningChanged = callback;
    return () => {};
  };
  const library = await api.getProfileLibrary();
  vi.spyOn(api, "getProfileLibrary").mockResolvedValue({
    ...library,
    profiles: [...library.profiles, { ...library.profiles[0], id: "second", name: "Second" }],
  });
  const absorb = api.absorbOwned;
  api.absorbOwned = async () => ({ ...(await absorb()), library: await api.getProfileLibrary() });
  await act(async () => root.render(createElement(App, { api, preview: "settings-files" })));
});
afterEach(async () => {
  await act(async () => root.unmount());
  box.remove();
});
it("retains edits when changing install is cancelled, and discards only explicitly", async () => {
  await edit();
  await click("Change install");
  expect(box.querySelector('[data-testid="files-exit-guard"]')).not.toBeNull();
  await click("Cancel");
  expect(editor().state.doc.toString()).toContain("79");
  await click("Change install");
  await click("Discard and continue");
  expect(box.querySelector(".cm-editor")).toBeNull();
});
it("saves before changing install", async () => {
  const write = vi.spyOn(api, "writeOwnedFile");
  await edit();
  await click("Change install");
  await click("Save and continue");
  expect(write).toHaveBeenCalled();
  expect(box.querySelector(".cm-editor")).toBeNull();
});
it("keeps the host and draft after a failed exit save", async () => {
  vi.spyOn(api, "writeOwnedFile").mockRejectedValue(Error("disk full"));
  await edit();
  await click("Change install");
  await click("Save and continue");
  expect(box.querySelector('[data-testid="files-exit-guard"]')).not.toBeNull();
  expect(editor().state.doc.toString()).toContain("79");
});
it("keeps blocking cfg commands unsaved when using the exit dialog", async () => {
  const write = vi.spyOn(api, "writeOwnedFile");
  await edit("unbind escape\n");
  await click("Change install");
  await click("Save and continue");
  expect(write).not.toHaveBeenCalled();
  expect(box.querySelector('[data-testid="files-exit-guard"]')).not.toBeNull();
  await click("Cancel");
  expect(editor().state.doc.toString()).toBe("unbind escape\n");
});
it("guards new profile before the settings host unmounts", async () => {
  await edit();
  await click("New profile");
  expect(box.querySelector('[data-testid="files-exit-guard"]')).not.toBeNull();
  await click("Cancel");
  expect(editor().state.doc.toString()).toContain("79");
  await click("New profile");
  await click("Discard and continue");
  expect(box.querySelector(".cm-editor")).toBeNull();
});

it("guards a profile switch before invoking native switch", async () => {
  const change = vi.spyOn(api, "switchProfile");
  await edit();
  const target = box.querySelector<HTMLButtonElement>(
    '[data-testid="profile-name"]:not([disabled])',
  );
  expect(target).not.toBeNull();
  await act(async () => target?.click());
  expect(change).not.toHaveBeenCalled();
  await click("Cancel");
  expect(editor().state.doc.toString()).toContain("79");
  await act(async () => target?.click());
  await click("Discard and continue");
  expect(change).toHaveBeenCalledTimes(1);
});

it("refuses save after TF2 starts while the exit decision is open", async () => {
  const write = vi.spyOn(api, "writeOwnedFile");
  await edit();
  await click("Change install");
  await act(async () => runningChanged(true));
  await click("Save and continue");
  expect(write).not.toHaveBeenCalled();
  expect(box.querySelector('[data-testid="files-exit-guard"]')).not.toBeNull();
  await click("Cancel");
  expect(editor().state.doc.toString()).toContain("79");
});
