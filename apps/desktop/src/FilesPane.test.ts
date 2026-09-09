// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FilesPane } from "./FilesPane";
import { AppStatusProvider } from "./hooks/useAppStatus";
import { createFilesDraftStore } from "./lib/files-drafts";

const first = "tf/cfg/a.cfg";
const second = "tf/cfg/b.cfg";
const original = "fov_desired 90\n";
const changed = "fov_desired 75\n";
const newer = "fov_desired 80\n";
let container: HTMLDivElement;
let root: Root;
let store: ReturnType<typeof createFilesDraftStore>;
let onSave: ReturnType<typeof vi.fn<(...args: [string, string]) => Promise<boolean>>>;
let setError: ReturnType<typeof vi.fn>;
let files: { path: string; text: string }[];

async function render(profileId = "a", visible = true) {
  await act(async () =>
    root.render(
      createElement(
        AppStatusProvider,
        {
          value: { error: null, setError, running: false, busy: false },
        },
        visible
          ? createElement(FilesPane, { profileId, files, hudId: null, draftStore: store, onSave })
          : null,
      ),
    ),
  );
}
function editor() {
  const field = container.querySelector<HTMLTextAreaElement>("textarea");
  if (!field) throw new Error("Missing editor");
  return field;
}
async function edit(text: string) {
  await act(async () => {
    const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")?.set;
    if (!setter) throw new Error("Missing textarea setter");
    setter.call(editor(), text);
    editor().dispatchEvent(new Event("input", { bubbles: true }));
  });
}
async function click(selector: string) {
  await act(async () => {
    const button = container.querySelector<HTMLButtonElement>(selector);
    if (!button) throw new Error(`Missing button ${selector}`);
    button.click();
  });
}
async function switchRequest() {
  await click(`[data-path="${second}"]`);
  await click('[data-testid="files-switch-save"]');
}
function deferred() {
  let resolve!: (result: boolean) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<boolean>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}

beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  store = createFilesDraftStore();
  onSave = vi.fn(async () => true);
  setError = vi.fn();
  files = [
    { path: first, text: original },
    { path: second, text: original },
  ];
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
});

describe("Files draft navigation", () => {
  it("retains drafts and selected file across pane exit and profile switches", async () => {
    await render();
    await click(`[data-path="${second}"]`);
    await edit(changed);
    await render("a", false);
    await render();
    expect(editor().value).toBe(changed);
    expect(editor().getAttribute("id")).toBe("files-editor");
    await render("b");
    expect(editor().value).toBe(original);
    await edit(newer);
    await render("a");
    expect(editor().value).toBe(changed);
    await render("b");
    expect(editor().value).toBe(newer);
    expect(onSave).not.toHaveBeenCalled();
  });
  it("waits for a successful save before switching", async () => {
    const save = deferred();
    onSave.mockReturnValue(save.promise);
    await render();
    await edit(changed);
    await switchRequest();
    expect(editor().value).toBe(changed);
    expect(
      container.querySelector('[data-testid="files-switch-save"]')?.hasAttribute("disabled"),
    ).toBe(true);
    await act(async () => save.resolve(true));
    expect(container.querySelector('[data-active="true"]')?.getAttribute("data-path")).toBe(second);
    expect(onSave).toHaveBeenCalledWith(first, changed);
  });
  it.each(["refused", "rejected"])(
    "keeps the draft and navigation choice after a %s save",
    async (kind) => {
      const save = deferred();
      onSave.mockReturnValue(save.promise);
      await render();
      await edit(changed);
      await switchRequest();
      await act(async () =>
        kind === "refused" ? save.resolve(false) : save.reject(new Error("Disk unavailable")),
      );
      expect(editor().value).toBe(changed);
      expect(container.querySelector('[data-testid="files-switch-guard"]')).not.toBeNull();
      expect(
        container.querySelector('[data-testid="files-switch-save"]')?.hasAttribute("disabled"),
      ).toBe(false);
      if (kind === "rejected") expect(setError).toHaveBeenCalledWith("Disk unavailable");
    },
  );
  it("keeps newer edits when the submitted revision completes", async () => {
    const save = deferred();
    onSave.mockReturnValue(save.promise);
    await render();
    await edit(changed);
    await switchRequest();
    await edit(newer);
    files = [
      { path: first, text: changed },
      { path: second, text: original },
    ];
    await render();
    await act(async () => save.resolve(true));
    expect(editor().value).toBe(newer);
    expect(container.querySelector('[data-active="true"]')?.getAttribute("data-path")).toBe(first);
    await render("a", false);
    await render();
    expect(editor().value).toBe(newer);
  });
  it("does not navigate the new profile after an old profile save completes", async () => {
    const save = deferred();
    onSave.mockReturnValue(save.promise);
    await render();
    await edit(changed);
    await switchRequest();
    await render("b");
    await edit(newer);
    await act(async () => save.resolve(true));
    expect(editor().value).toBe(newer);
    expect(container.querySelector('[data-active="true"]')?.getAttribute("data-path")).toBe(first);
    expect(onSave).toHaveBeenCalledTimes(1);
  });
  it("discards only the selected profile file", async () => {
    await render();
    await edit(changed);
    await click(`[data-path="${second}"]`);
    await click('[data-testid="files-switch-discard"]');
    await click(`[data-path="${first}"]`);
    expect(editor().value).toBe(original);
    await render("a", false);
    await render();
    expect(editor().value).toBe(original);
  });
});
