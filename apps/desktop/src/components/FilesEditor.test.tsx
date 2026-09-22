// @vitest-environment jsdom

import { acceptCompletion, completionStatus, startCompletion } from "@codemirror/autocomplete";
import { undo } from "@codemirror/commands";
import { searchPanelOpen } from "@codemirror/search";
import { EditorView } from "@codemirror/view";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FilesEditor, type FilesEditorProps } from "./FilesEditor";

let root: Root;
let box: HTMLDivElement;
let props: FilesEditorProps;
beforeEach(() => {
  Range.prototype.getClientRects = () => [] as unknown as DOMRectList;
  Range.prototype.getBoundingClientRect = () => new DOMRect();
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  box = document.createElement("div");
  document.body.append(box);
  root = createRoot(box);
  props = {
    profileId: crypto.randomUUID(),
    path: "cfg/autoexec.cfg",
    value: "echo hi",
    readOnly: false,
    active: true,
    onChange: vi.fn(),
    onSave: vi.fn(),
  };
});
afterEach(() => {
  act(() => root.unmount());
  box.remove();
  vi.unstubAllGlobals();
});
function render() {
  act(() => root.render(<FilesEditor {...props} />));
}
function editor() {
  const element = box.querySelector<HTMLElement>(".cm-editor");
  if (!element) throw new Error("Missing editor");
  return EditorView.findFromDOM(element) as EditorView;
}

describe("Files editor model isolation", () => {
  it("preserves CRLF bytes, scopes Save, and leaves ordinary Tab to focus navigation", () => {
    props = { ...props, value: "echo hi\r\necho bye\r\n" };
    render();
    act(() => editor().dispatch({ changes: { from: 0, insert: "// title\r\n" } }));
    expect(props.onChange).toHaveBeenLastCalledWith("// title\r\necho hi\r\necho bye\r\n");
    const tab = new KeyboardEvent("keydown", { key: "Tab", bubbles: true, cancelable: true });
    editor().contentDOM.dispatchEvent(tab);
    expect(tab.defaultPrevented).toBe(false);
    editor().contentDOM.dispatchEvent(
      new KeyboardEvent("keydown", { key: "s", ctrlKey: true, bubbles: true, cancelable: true }),
    );
    expect(props.onSave).toHaveBeenCalledOnce();
  });
  it("honors disabled Save and toggles line wrapping from the keyboard", () => {
    props = { ...props, canSave: false };
    render();
    const view = editor();
    view.contentDOM.dispatchEvent(
      new KeyboardEvent("keydown", { key: "s", ctrlKey: true, bubbles: true, cancelable: true }),
    );
    expect(props.onSave).not.toHaveBeenCalled();

    const wrap = box.querySelector('[aria-label="Wrap lines"]');
    expect(wrap?.getAttribute("aria-pressed")).toBe("false");
    act(() => {
      view.contentDOM.dispatchEvent(
        new KeyboardEvent("keydown", { key: "z", altKey: true, bubbles: true, cancelable: true }),
      );
    });
    expect(wrap?.getAttribute("aria-pressed")).toBe("true");
  });
  it("opens Save as and New cfg from editor shortcuts", () => {
    const onSaveAs = vi.fn();
    const onNewCfg = vi.fn();
    props = { ...props, onSaveAs, onNewCfg };
    render();
    const view = editor();
    const saveAsEvent = new KeyboardEvent("keydown", {
      key: "S",
      ctrlKey: true,
      shiftKey: true,
      bubbles: true,
      cancelable: true,
    });
    view.contentDOM.dispatchEvent(saveAsEvent);
    expect(saveAsEvent.defaultPrevented).toBe(true);
    expect(onSaveAs).toHaveBeenCalledOnce();
    view.contentDOM.dispatchEvent(
      new KeyboardEvent("keydown", { key: "n", ctrlKey: true, bubbles: true, cancelable: true }),
    );
    expect(onNewCfg).toHaveBeenCalledOnce();
  });
  it("replaces only the command token as a single undoable completion", async () => {
    props = {
      ...props,
      value: "cl_inZZ 0",
      catalog: { commands: [{ label: "cl_interp", type: "variable" }], keys: [], arguments: {} },
    };
    render();
    act(() => {
      editor().focus();
      editor().dispatch({ selection: { anchor: 5 } });
      startCompletion(editor());
    });
    await act(async () => {
      await vi.waitFor(() => expect(completionStatus(editor().state)).toBe("active"));
    });
    await act(async () => {
      await vi.waitFor(() => expect(acceptCompletion(editor())).toBe(true));
    });
    expect(editor().state.doc.toString()).toBe("cl_interp 0");
    act(() => {
      undo(editor());
    });
    expect(editor().state.doc.toString()).toBe("cl_inZZ 0");
    expect(props.onSave).not.toHaveBeenCalled();
  });
  it("keeps undo and selection per path across unmount and does not leak callbacks", () => {
    render();
    act(() =>
      editor().dispatch({ changes: { from: 7, insert: " there" }, selection: { anchor: 13 } }),
    );
    expect(props.onChange).toHaveBeenLastCalledWith("echo hi there");
    props = { ...props, value: "echo hi there" };
    render();
    props = { ...props, path: "cfg/other.cfg", value: "other" };
    render();
    expect(editor().state.doc.toString()).toBe("other");
    props = { ...props, path: "cfg/autoexec.cfg", value: "echo hi there" };
    render();
    expect(editor().state.selection.main.head).toBe(13);
    act(() => {
      undo(editor());
    });
    expect(editor().state.doc.toString()).toBe("echo hi");
    expect(props.onChange).toHaveBeenLastCalledWith("echo hi");
  });
  it("restores document scroll before hiding can erase layout, together with draft history and selection", () => {
    const renderPane = () =>
      act(() =>
        root.render(
          <div hidden={!props.active}>
            <FilesEditor {...props} />
          </div>,
        ),
      );
    renderPane();
    const first = editor();
    act(() =>
      first.dispatch({
        changes: { from: 7, insert: " there" },
        selection: { anchor: 13, head: 8 },
      }),
    );
    props = { ...props, value: "echo hi there" };
    renderPane();
    // Browsers report zero after display:none or removal. jsdom has no layout,
    // so model that browser behavior while keeping visible scroll observable.
    const emulateBrowserLayout = (view: EditorView) => {
      for (const [axis, value] of [
        ["scrollTop", 380],
        ["scrollLeft", 48],
      ] as const) {
        Object.defineProperty(view.scrollDOM, axis, {
          configurable: true,
          get: () => (view.dom.isConnected && !view.dom.closest("[hidden]") ? value : 0),
        });
      }
    };
    emulateBrowserLayout(first);
    props = { ...props, active: false };
    renderPane();
    expect(box.querySelector(".cm-editor")).toBeNull();
    props = { ...props, active: true };
    renderPane();
    expect(editor().scrollDOM.scrollTop).toBe(380);
    expect(editor().scrollDOM.scrollLeft).toBe(48);
    expect(editor().state.doc.toString()).toBe("echo hi there");
    expect(editor().state.selection.main.anchor).toBe(13);
    expect(editor().state.selection.main.head).toBe(8);

    props = { ...props, path: "cfg/other.cfg", value: "other" };
    renderPane();
    expect(editor().scrollDOM.scrollTop).toBe(0);
    props = { ...props, path: "cfg/autoexec.cfg", value: "echo hi there" };
    renderPane();
    expect(editor().scrollDOM.scrollTop).toBe(380);
    expect(editor().scrollDOM.scrollLeft).toBe(48);
    emulateBrowserLayout(editor());
    act(() => root.render(null));
    renderPane();
    expect(editor().scrollDOM.scrollTop).toBe(380);
    expect(editor().scrollDOM.scrollLeft).toBe(48);
    expect(editor().state.selection.main.anchor).toBe(13);
    expect(editor().state.selection.main.head).toBe(8);
    act(() => {
      undo(editor());
    });
    expect(editor().state.doc.toString()).toBe("echo hi");
    expect(props.onSave).not.toHaveBeenCalled();
  });
  it("blocks programmatic edits in read-only files and destroys hidden views", () => {
    props = { ...props, readOnly: true };
    render();
    act(() => editor().dispatch({ changes: { from: 0, insert: "bad" } }));
    expect(editor().state.doc.toString()).toBe("echo hi");
    expect(props.onChange).not.toHaveBeenCalled();
    props = { ...props, active: false };
    render();
    expect(box.querySelector(".cm-editor")).toBeNull();
  });
  it("keeps provided content keyboard-focusable without permitting edits or Save", () => {
    props = { ...props, readOnly: true, target: { id: 1, focusOnly: true } };
    render();
    const view = editor();
    expect(document.activeElement).toBe(view.contentDOM);
    expect(view.contentDOM.getAttribute("tabindex")).toBe("0");
    expect(box.textContent).toContain("Read-only · Ctrl+Shift+S Save as · Ctrl+F Find");
    expect(box.textContent).not.toContain("Ctrl+S saves");
    act(() => view.dispatch({ changes: { from: 0, insert: "bad" } }));
    view.contentDOM.dispatchEvent(
      new KeyboardEvent("keydown", { key: "s", ctrlKey: true, bubbles: true, cancelable: true }),
    );
    expect(view.state.doc.toString()).toBe("echo hi");
    expect(props.onChange).not.toHaveBeenCalled();
    expect(props.onSave).not.toHaveBeenCalled();
    const tab = new KeyboardEvent("keydown", { key: "Tab", bubbles: true, cancelable: true });
    view.contentDOM.dispatchEvent(tab);
    expect(tab.defaultPrevented).toBe(false);
  });
  it("external discard removes obsolete undo history and applies insertion as one edit", () => {
    render();
    props = { ...props, insertion: { id: 1, text: "hello" } };
    render();
    expect(editor().state.doc.toString()).toBe("helloecho hi");
    props = { ...props, value: "discarded", insertion: undefined };
    render();
    expect(editor().state.doc.toString()).toBe("discarded");
    expect(undo(editor())).toBe(false);
  });
  it("toggles Find from the same button and exposes editor actions on right-click", () => {
    render();
    const find = [...box.querySelectorAll<HTMLButtonElement>("button")].find(
      (item) => item.textContent === "Find",
    );
    expect(find).toBeDefined();
    act(() => find?.click());
    expect(searchPanelOpen(editor().state)).toBe(true);
    expect(find?.getAttribute("aria-pressed")).toBe("true");
    expect(box.querySelector(".cm-panel.cm-search")).not.toBeNull();
    const search = box.querySelector<HTMLInputElement>('.cm-panel.cm-search [name="search"]');
    if (!search) throw new Error("Missing search input");
    act(() => {
      search.value = "echo";
      search.dispatchEvent(new KeyboardEvent("keyup", { key: "o", bubbles: true }));
      box.querySelector<HTMLButtonElement>('.cm-panel.cm-search [name="next"]')?.click();
    });
    const match = box.querySelector<HTMLElement>(".cm-searchMatch");
    const currentMatch = box.querySelector<HTMLElement>(".cm-searchMatch-selected");
    expect(match).not.toBeNull();
    expect(currentMatch).not.toBeNull();
    expect(getComputedStyle(match as HTMLElement).borderRadius).toBe("4px");
    expect(getComputedStyle(currentMatch as HTMLElement).boxShadow).toContain("inset");
    act(() => find?.click());
    expect(searchPanelOpen(editor().state)).toBe(false);
    expect(find?.getAttribute("aria-pressed")).toBe("false");

    act(() => find?.click());
    act(() => box.querySelector<HTMLButtonElement>('.cm-panel.cm-search [name="close"]')?.click());
    expect(searchPanelOpen(editor().state)).toBe(false);
    expect(find?.getAttribute("aria-pressed")).toBe("false");

    act(() => {
      editor().contentDOM.dispatchEvent(
        new MouseEvent("contextmenu", {
          bubbles: true,
          cancelable: true,
          clientX: 24,
          clientY: 24,
        }),
      );
    });
    const menu = document.querySelector('[role="menu"][aria-label="Editor actions"]');
    expect(menu?.textContent).toContain("Find and replace");
    expect(menu?.textContent).toContain("Wrap lines");
    expect(menu?.textContent).toContain("Save");
    const wrap = menu?.querySelector<HTMLButtonElement>('[role="menuitemcheckbox"]');
    act(() => wrap?.click());
    expect(box.querySelector('[aria-label="Wrap lines"]')?.getAttribute("aria-pressed")).toBe(
      "true",
    );
    expect(document.querySelector('[role="menu"][aria-label="Editor actions"]')).toBeNull();

    act(() => {
      editor().contentDOM.dispatchEvent(
        new KeyboardEvent("keydown", {
          key: "F10",
          shiftKey: true,
          bubbles: true,
          cancelable: true,
        }),
      );
    });
    expect(document.querySelector('[role="menu"][aria-label="Editor actions"]')).not.toBeNull();
  });
});
