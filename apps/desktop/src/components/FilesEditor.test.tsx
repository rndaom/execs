// @vitest-environment jsdom

import { acceptCompletion, completionStatus, startCompletion } from "@codemirror/autocomplete";
import { undo } from "@codemirror/commands";
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
});
