// @vitest-environment jsdom
import { EditorView } from "@codemirror/view";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FilesPane } from "./FilesPane";
import { AppStatusProvider } from "./hooks/useAppStatus";
import { analyzeFilesSnapshot } from "./lib/files-analysis";
import { createFilesDraftStore } from "./lib/files-drafts";

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
const first = "tf/cfg/a.cfg";
const second = "tf/cfg/b.cfg";
const original = "fov_desired 90\n";
const changed = "fov_desired 75\n";
const newer = "fov_desired 80\n";
let container: HTMLDivElement;
let root: Root;
let store: ReturnType<typeof createFilesDraftStore>;
let onSave: ReturnType<typeof vi.fn<(...args: [string, string, unknown?]) => Promise<boolean>>>;
let setError: ReturnType<typeof vi.fn>;
let files: { path: string; text: string }[];
let running: boolean;

async function render(profileId = "a", visible = true) {
  await act(async () =>
    root.render(
      createElement(
        AppStatusProvider,
        {
          value: { error: null, setError, running, busy: false },
        },
        visible
          ? createElement(FilesPane, {
              profileId,
              files,
              context: { profileId, root: "G:/TF2", layer: "vanilla" },
              hudId: null,
              draftStore: store,
              onSave,
            })
          : null,
      ),
    ),
  );
}
function editor() {
  const element = container.querySelector<HTMLElement>(".cm-editor");
  if (!element) throw new Error("Missing editor");
  return EditorView.findFromDOM(element) as EditorView;
}
async function edit(text: string) {
  await act(async () =>
    editor().dispatch({ changes: { from: 0, to: editor().state.doc.length, insert: text } }),
  );
}
async function click(selector: string) {
  await act(async () => {
    const button =
      container.querySelector<HTMLButtonElement>(selector) ??
      document.querySelector<HTMLButtonElement>(selector);
    if (!button) throw new Error(`Missing button ${selector}`);
    button.click();
  });
}
async function contextMenu(selector: string) {
  await act(async () => {
    const target = container.querySelector<HTMLElement>(selector);
    if (!target) throw new Error(`Missing context-menu target ${selector}`);
    target.dispatchEvent(
      new MouseEvent("contextmenu", {
        bubbles: true,
        cancelable: true,
        clientX: 20,
        clientY: 20,
      }),
    );
  });
}
async function button(label: string) {
  await act(async () => {
    const found = [...container.querySelectorAll("button")].find(
      (item) => item.textContent === label,
    );
    if (!found) throw Error(`Missing ${label}`);
    found.click();
  });
}
async function pick(path: string) {
  await click(`[data-path="${path}"]`);
}
async function checked() {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 210));
  });
}
async function save() {
  await checked();
  await click('[data-testid="files-save"]');
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
  Range.prototype.getClientRects = () => [] as unknown as DOMRectList;
  Range.prototype.getBoundingClientRect = () => new DOMRect();
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  store = createFilesDraftStore();
  onSave = vi.fn(async () => true);
  setError = vi.fn();
  running = false;
  files = [
    { path: first, text: original },
    { path: second, text: original },
  ];
  vi.mocked(analyzeFilesSnapshot).mockClear();
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
});

describe("Files draft navigation", () => {
  it("opens incoming callers at their source line and identifies deferred payloads without losing drafts", async () => {
    files = [
      { path: first, text: 'echo start\nexec b\nbind f "helper_alias"\n' },
      { path: second, text: 'alias helper_alias "echo helper"\n' },
    ];
    await render();
    const retained = `${files[0].text}echo unsaved\n`;
    await edit(retained);
    await checked();
    expect(container.querySelector('[aria-label="File info"]')).toBeNull();
    await contextMenu(`[data-path="${first}"]`);
    const outgoing =
      '[data-testid="files-source-link"][data-direction="outgoing"][data-deferred="false"]';
    expect(document.querySelector(outgoing)?.textContent).toContain(`${second}:1`);
    await click(outgoing);
    expect(editor().contentDOM.getAttribute("aria-label")).toBe(`Contents of ${second}`);
    await contextMenu(`[data-path="${second}"]`);
    const incoming =
      '[data-testid="files-source-link"][data-direction="incoming"][data-deferred="false"]';
    expect(document.querySelector(incoming)?.textContent).toContain(`Referenced by: ${first}:2`);
    await click(incoming);
    expect(editor().contentDOM.getAttribute("aria-label")).toBe(`Contents of ${first}`);
    expect(editor().state.doc.lineAt(editor().state.selection.main.head).number).toBe(2);
    expect(editor().state.doc.toString()).toBe(retained);
    await pick(second);
    await contextMenu(`[data-path="${second}"]`);
    const deferredCaller =
      '[data-testid="files-source-link"][data-direction="incoming"][data-deferred="true"]';
    expect(document.querySelector(deferredCaller)?.textContent).toContain(`${first}:3`);
    expect(document.querySelector(deferredCaller)?.textContent).toContain("Deferred");
    await click(deferredCaller);
    expect(editor().state.doc.lineAt(editor().state.selection.main.head).number).toBe(3);
    expect(editor().state.doc.toString()).toBe(retained);
    expect(onSave).not.toHaveBeenCalled();
  });
  it("keeps the Explorer visible while file switching restores the current draft", async () => {
    await render();
    await edit(Array.from({ length: 80 }, (_, i) => `echo line${i}`).join("\n"));
    const view = editor();
    await act(async () => view.dispatch({ selection: { anchor: 20, head: 26 } }));
    view.scrollDOM.scrollTop = 120;
    view.scrollDOM.scrollLeft = 30;
    const before = view.state.doc.toString();
    expect(container.querySelector('[aria-label="Profile files"]')).not.toBeNull();
    await pick(second);
    await pick(first);
    const restored = editor();
    expect(restored.state.doc.toString()).toBe(before);
    expect(onSave).not.toHaveBeenCalled();
  });
  it("retains drafts and selected file across pane exit, file navigation and profile switches without saving", async () => {
    await render();
    await pick(second);
    await edit(changed);
    await pick(first);
    await edit(newer);
    await pick(second);
    expect(editor().state.doc.toString()).toBe(changed);
    await render("a", false);
    await render();
    expect(editor().state.doc.toString()).toBe(changed);
    expect(editor().contentDOM.getAttribute("aria-label")).toBe(`Contents of ${second}`);
    await render("b");
    expect(editor().state.doc.toString()).toBe(original);
    await edit(newer);
    await render("a");
    expect(editor().state.doc.toString()).toBe(changed);
    await render("b");
    expect(editor().state.doc.toString()).toBe(newer);
    expect(onSave).not.toHaveBeenCalled();
  });
  it("keeps explicit saves pending without preventing file navigation", async () => {
    const pending = deferred();
    onSave.mockReturnValue(pending.promise);
    await render();
    await edit(changed);
    await save();
    expect(container.querySelector<HTMLButtonElement>('[data-testid="files-save"]')?.disabled).toBe(
      true,
    );
    await pick(second);
    expect(editor().state.doc.toString()).toBe(original);
    await act(async () => pending.resolve(true));
    expect(editor().contentDOM.getAttribute("aria-label")).toBe(`Contents of ${second}`);
    expect(onSave).toHaveBeenCalledWith(
      first,
      changed,
      expect.objectContaining({ profile: "a", path: first, text: changed }),
    );
  });
  it.each(["refused", "rejected"])("retains the draft after a %s explicit save", async (kind) => {
    const pending = deferred();
    onSave.mockReturnValue(pending.promise);
    await render();
    await edit(changed);
    await save();
    await act(async () =>
      kind === "refused" ? pending.resolve(false) : pending.reject(Error("Disk unavailable")),
    );
    expect(editor().state.doc.toString()).toBe(changed);
    expect(store.dirty().some((item) => item.path === first && item.text === changed)).toBe(true);
    if (kind === "rejected") expect(setError).toHaveBeenCalledWith("Disk unavailable");
  });
  it("keeps newer edits when the submitted revision completes", async () => {
    const pending = deferred();
    onSave.mockReturnValue(pending.promise);
    await render();
    await edit(changed);
    await save();
    await edit(newer);
    files = [
      { path: first, text: changed },
      { path: second, text: original },
    ];
    await render();
    await act(async () => pending.resolve(true));
    expect(editor().state.doc.toString()).toBe(newer);
    await render("a", false);
    await render();
    expect(editor().state.doc.toString()).toBe(newer);
  });
  it("does not navigate or acknowledge another profile after an old profile save completes", async () => {
    const pending = deferred();
    onSave.mockReturnValue(pending.promise);
    await render();
    await edit(changed);
    await save();
    await render("b");
    await edit(newer);
    await act(async () => pending.resolve(true));
    expect(editor().state.doc.toString()).toBe(newer);
    expect(store.dirty().some((item) => item.profile === "b" && item.text === newer)).toBe(true);
    expect(onSave).toHaveBeenCalledTimes(1);
  });
  it("discards only the selected profile file", async () => {
    await render();
    await edit(changed);
    await pick(second);
    await edit(newer);
    await button("Discard");
    expect(editor().state.doc.toString()).toBe(original);
    await pick(first);
    expect(editor().state.doc.toString()).toBe(changed);
    await render("a", false);
    await render();
    expect(editor().state.doc.toString()).toBe(changed);
  });
  it("allows in-memory editing while TF2 runs but never saves automatically when it closes", async () => {
    running = true;
    await render();
    await edit(changed);
    await checked();
    expect(editor().state.doc.toString()).toBe(changed);
    expect(container.querySelector<HTMLButtonElement>('[data-testid="files-save"]')?.disabled).toBe(
      true,
    );
    await act(async () => {
      editor().contentDOM.dispatchEvent(
        new KeyboardEvent("keydown", {
          key: "S",
          ctrlKey: true,
          shiftKey: true,
          bubbles: true,
          cancelable: true,
        }),
      );
    });
    expect(container.querySelector("#save-as-name")).not.toBeNull();
    expect(
      container.querySelector<HTMLButtonElement>('[data-testid="files-save-as-confirm"]')?.disabled,
    ).toBe(true);
    running = false;
    await render();
    await checked();
    expect(onSave).not.toHaveBeenCalled();
    await save();
    expect(onSave).toHaveBeenCalledOnce();
  });
  it("opens provided sources as read-only without dropping a user draft", async () => {
    const provided = "tf/custom/hud/scripts/test.cfg";
    files.push({ path: provided, text: "echo provided" });
    await render();
    await edit(changed);
    await pick(provided);
    await edit("bad");
    expect(editor().state.doc.toString()).toBe("echo provided");
    expect(container.querySelector('[data-testid="files-save"]')).toBeNull();
    await pick(first);
    expect(editor().state.doc.toString()).toBe(changed);
  });
  it("refuses Save after worker failure and permits an explicit retry", async () => {
    vi.mocked(analyzeFilesSnapshot).mockRejectedValueOnce(
      Error("Background analysis failed. Retry before saving."),
    );
    await render();
    await edit(changed);
    await checked();
    expect(container.textContent).toContain("Background analysis failed.");
    expect(container.querySelector<HTMLButtonElement>('[data-testid="files-save"]')?.disabled).toBe(
      true,
    );
    await button("Retry analysis");
    await checked();
    expect(container.querySelector<HTMLButtonElement>('[data-testid="files-save"]')?.disabled).toBe(
      false,
    );
    expect(onSave).not.toHaveBeenCalled();
  });

  it("creates helper drafts in a chosen safe folder and labels collisions as Open", async () => {
    await render();
    await click('[data-testid="files-new"]');
    await button("Helper");
    const input = container.querySelector<HTMLInputElement>("#new-cfg-name");
    if (!input) throw Error("Missing cfg name");
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set?.call(
        input,
        "practice",
      );
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await button("helpers");
    expect(container.textContent).toContain("tf/cfg/helpers/practice.cfg");
    await button("Start editing");
    expect(store.state("a", "tf/cfg/helpers/practice.cfg")).toMatchObject({
      created: true,
      dirty: true,
    });

    await click('[data-testid="files-new"]');
    await button("Helper");
    const nextInput = container.querySelector<HTMLInputElement>("#new-cfg-name");
    if (!nextInput) throw Error("Missing cfg name");
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set?.call(
        nextInput,
        "a",
      );
      nextInput.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await button("Root");
    expect(container.textContent).toContain(`Already exists: ${first}`);
    expect(container.textContent).toContain("Open a.cfg");
  });

  it("offers Save as for read-only cfgs, blocks collisions, and keeps the source after failure", async () => {
    const provided = "tf/custom/hud/scripts/provided.cfg";
    files.push({ path: provided, text: "echo provided\n" });
    onSave.mockResolvedValue(false);
    await render();
    await pick(provided);
    await checked();
    await act(async () => {
      editor().contentDOM.dispatchEvent(
        new KeyboardEvent("keydown", {
          key: "S",
          ctrlKey: true,
          shiftKey: true,
          bubbles: true,
          cancelable: true,
        }),
      );
    });
    const input = container.querySelector<HTMLInputElement>("#save-as-name");
    if (!input) throw Error("Missing Save as name");
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set?.call(input, "b");
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    expect(container.textContent).toContain(`Already exists: ${second}`);
    expect(container.textContent).toContain("Open existing");
    expect(onSave).not.toHaveBeenCalled();
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set?.call(
        input,
        "provided_copy",
      );
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await click('[data-testid="files-save-as-confirm"]');
    expect(onSave).toHaveBeenCalledWith(
      "tf/cfg/provided_copy.cfg",
      "echo provided\n",
      expect.objectContaining({
        path: "tf/cfg/provided_copy.cfg",
        expected: expect.objectContaining({ sha256: null, librarySha256: null }),
      }),
    );
    expect(store.state("a", provided)?.text).toBe("echo provided\n");
    expect(store.state("a", "tf/cfg/provided_copy.cfg")).toBeNull();
  });

  it("disambiguates duplicate file names and moves through files with arrow keys", async () => {
    files.push({ path: "tf/cfg/helpers/a.cfg", text: "echo nested\n" });
    await render();
    const duplicateRows = [
      ...container.querySelectorAll<HTMLButtonElement>('[data-testid="files-item"]'),
    ].filter((item) => item.textContent?.includes("a.cfg"));
    expect(duplicateRows.map((row) => row.textContent)).toEqual(
      expect.arrayContaining([expect.stringContaining("CFG"), expect.stringContaining("helpers")]),
    );
    duplicateRows[0]?.focus();
    await act(async () => {
      duplicateRows[0]?.dispatchEvent(
        new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true, cancelable: true }),
      );
      await new Promise((resolve) => requestAnimationFrame(resolve));
    });
    expect(document.activeElement).not.toBe(duplicateRows[0]);
  });
});
