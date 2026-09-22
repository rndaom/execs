import {
  acceptCompletion,
  autocompletion,
  completionKeymap,
  pickedCompletion,
} from "@codemirror/autocomplete";
import {
  defaultKeymap,
  history,
  historyKeymap,
  redo,
  redoDepth,
  selectAll,
  undo,
  undoDepth,
} from "@codemirror/commands";
import { HighlightStyle, StreamLanguage, syntaxHighlighting } from "@codemirror/language";
import {
  closeSearchPanel,
  openSearchPanel,
  search,
  searchKeymap,
  searchPanelOpen,
} from "@codemirror/search";
import { Compartment, EditorState, type Extension, StateEffect } from "@codemirror/state";
import {
  drawSelection,
  EditorView,
  highlightActiveLine,
  keymap,
  lineNumbers,
} from "@codemirror/view";
import { tags } from "@lezer/highlight";
import { Component, type ReactNode, useEffect, useRef, useState } from "react";
import { copyToClipboard } from "../lib/copy-ui";
import {
  type CompletionCatalog,
  cfgCompletionContext,
  cfgCompletions,
} from "../lib/files-completion";
import { filesCompletionCatalog } from "../lib/files-completion-catalog";
import { editorTextBytes } from "../lib/files-limits";
import {
  ContextMenu,
  ContextMenuItem,
  type ContextMenuPosition,
  ContextMenuSeparator,
} from "./ui/ContextMenu";

export type FilesEditorProps = {
  profileId: string | null;
  path: string;
  value: string;
  readOnly: boolean;
  active: boolean;
  compact?: boolean;
  statusStart?: ReactNode;
  onChange: (text: string) => void;
  onSave: () => void;
  onSaveAs?: () => void;
  onNewCfg?: () => void;
  canSave?: boolean;
  canSaveShortcut?: boolean;
  canSaveAs?: boolean;
  onShowProblems?: () => void;
  onShowHelp?: () => void;
  onCommandChange?: (command: string | null) => void;
  files?: readonly { path: string; text: string }[];
  catalog?: CompletionCatalog;
  target?: { id: number; from?: number; to?: number; line?: number; focusOnly?: boolean };
  insertion?: { id: number; text: string };
};

const sessions = new Map<
  string,
  {
    state: EditorState;
    top: number;
    left: number;
    scroll: ReturnType<EditorView["scrollSnapshot"]>;
  }
>();

type EditorSessionBoundaryProps = {
  identity: string;
  active: boolean;
  capture: () => void;
};

/** Capture before an ancestor hides or removes the editor's scroll surface. */
class EditorSessionBoundary extends Component<EditorSessionBoundaryProps> {
  getSnapshotBeforeUpdate(previous: EditorSessionBoundaryProps) {
    if (previous.active && (!this.props.active || previous.identity !== this.props.identity)) {
      previous.capture();
    }
    return null;
  }

  componentDidUpdate() {}

  componentWillUnmount() {
    this.props.capture();
  }

  render() {
    return null;
  }
}

const cfgLanguage = StreamLanguage.define<{ command: boolean }>({
  startState: () => ({ command: true }),
  token(stream, state) {
    if (stream.sol()) state.command = true;
    if (stream.eatSpace()) return null;
    if (stream.match("//")) {
      stream.skipToEnd();
      return "comment";
    }
    if (stream.eat('"')) {
      while (!stream.eol() && !stream.eat('"')) stream.next();
      state.command = false;
      return "string";
    }
    if (stream.eat(";")) {
      state.command = true;
      return "separator";
    }
    stream.match(/^[^\s;"/]+/) || stream.next();
    const command = state.command;
    state.command = false;
    return command ? "keyword" : /^[-+]?\d/.test(stream.current()) ? "number" : null;
  },
});
const colors = syntaxHighlighting(
  HighlightStyle.define([
    { tag: tags.comment, color: "var(--color-ink-muted)", fontStyle: "italic" },
    { tag: tags.keyword, color: "var(--color-ink)", fontWeight: "600" },
    { tag: tags.string, color: "var(--color-ok)" },
    { tag: tags.number, color: "var(--color-ink-muted)" },
  ]),
);
const theme = EditorView.theme(
  {
    "&": {
      height: "100%",
      color: "var(--color-ink)",
      backgroundColor: "var(--color-panel)",
      fontSize: "13px",
    },
    ".cm-scroller": {
      overflow: "auto",
      fontFamily: "ui-monospace, Consolas, monospace",
      lineHeight: "1.65",
    },
    ".cm-content": { padding: "8px 0", minHeight: "274px", caretColor: "var(--color-ink)" },
    ".cm-gutters": {
      backgroundColor: "var(--color-panel)",
      color: "var(--color-ink-muted)",
      borderRight: "1px solid var(--color-edge)",
    },
    ".cm-activeLine, .cm-activeLineGutter": { backgroundColor: "var(--color-edge)" },
    "&.cm-focused": { outline: "none" },
    ".cm-content:focus-visible": { outline: "none" },
    ".cm-selectionBackground, &.cm-focused .cm-selectionBackground": {
      backgroundColor: "var(--color-edge-strong)",
    },
    ".cm-cursor": { borderLeftColor: "var(--color-ink)" },
    ".cm-panels, .cm-tooltip": {
      backgroundColor: "var(--color-panel-raised)",
      color: "var(--color-ink)",
      borderColor: "var(--color-edge-strong)",
    },
    ".cm-panels-top": {
      borderBottom: "1px solid var(--color-edge)",
    },
    ".cm-panel.cm-search": {
      display: "grid",
      gridTemplateColumns: "minmax(170px, 1fr) repeat(3, auto) repeat(3, auto) 24px",
      alignItems: "center",
      gap: "6px",
      padding: "8px",
      backgroundColor: "var(--color-panel-raised)",
      position: "relative",
    },
    ".cm-panel.cm-search br": { display: "none" },
    ".cm-panel.cm-search [name=search]": { gridColumn: "1", gridRow: "1" },
    ".cm-panel.cm-search [name=next]": { gridColumn: "2", gridRow: "1" },
    ".cm-panel.cm-search [name=prev]": { gridColumn: "3", gridRow: "1" },
    ".cm-panel.cm-search [name=select]": { gridColumn: "4", gridRow: "1" },
    ".cm-panel.cm-search label:nth-of-type(1)": { gridColumn: "5", gridRow: "1" },
    ".cm-panel.cm-search label:nth-of-type(2)": { gridColumn: "6", gridRow: "1" },
    ".cm-panel.cm-search label:nth-of-type(3)": { gridColumn: "7", gridRow: "1" },
    ".cm-panel.cm-search [name=replace].cm-textfield": { gridColumn: "1", gridRow: "2" },
    ".cm-panel.cm-search button[name=replace]": { gridColumn: "2 / span 2", gridRow: "2" },
    ".cm-panel.cm-search [name=replaceAll]": { gridColumn: "4 / span 2", gridRow: "2" },
    ".cm-panel.cm-search [name=close]": {
      gridColumn: "8",
      gridRow: "1",
      position: "static",
      width: "24px",
      height: "24px",
      borderRadius: "6px",
      color: "var(--color-ink-muted)",
      backgroundColor: "transparent",
    },
    ".cm-panel.cm-search [name=close]:hover": {
      color: "var(--color-ink)",
      backgroundColor: "var(--color-edge)",
    },
    ".cm-panel.cm-search label": {
      position: "relative",
      margin: "0",
      border: "1px solid var(--color-edge)",
      borderRadius: "6px",
      padding: "5px 7px",
      color: "var(--color-ink-muted)",
      fontSize: "11px",
      lineHeight: "1",
      cursor: "pointer",
    },
    ".cm-panel.cm-search label:has(input:checked)": {
      color: "var(--color-ink)",
      backgroundColor: "var(--color-edge)",
    },
    ".cm-panel.cm-search input[type=checkbox]": {
      position: "absolute",
      width: "1px",
      height: "1px",
      opacity: "0",
    },
    ".cm-panel.cm-search label:has(input:focus-visible)": {
      outline: "2px solid var(--color-brand)",
      outlineOffset: "2px",
    },
    "@media (max-width: 1100px)": {
      ".cm-panel.cm-search": {
        gridTemplateColumns: "minmax(120px, 1fr) repeat(3, auto) 24px",
      },
      ".cm-panel.cm-search label:nth-of-type(1)": {
        gridColumn: "1",
        gridRow: "2",
        justifySelf: "start",
      },
      ".cm-panel.cm-search label:nth-of-type(2)": { gridColumn: "2", gridRow: "2" },
      ".cm-panel.cm-search label:nth-of-type(3)": { gridColumn: "3 / span 2", gridRow: "2" },
      ".cm-panel.cm-search [name=replace].cm-textfield": { gridRow: "3" },
      ".cm-panel.cm-search button[name=replace]": { gridRow: "3" },
      ".cm-panel.cm-search [name=replaceAll]": { gridRow: "3" },
      ".cm-panel.cm-search [name=close]": { gridColumn: "5" },
    },
    ".cm-textfield, .cm-button": {
      minHeight: "28px",
      margin: "0",
      borderRadius: "6px",
      background: "var(--color-panel)",
      color: "var(--color-ink)",
      border: "1px solid var(--color-edge)",
      padding: "4px 8px",
      fontFamily: "Inter, sans-serif",
      fontSize: "11px",
    },
    ".cm-button": {
      backgroundImage: "none",
      textTransform: "capitalize",
      cursor: "pointer",
    },
    ".cm-button:hover": {
      backgroundColor: "var(--color-edge)",
      borderColor: "var(--color-edge-strong)",
    },
    ".cm-tooltip-autocomplete ul li[aria-selected]": {
      background: "var(--color-edge-strong)",
      color: "var(--color-ink)",
    },
    ".cm-searchMatch": {
      backgroundColor: "var(--color-edge)",
      borderRadius: "4px",
      boxDecorationBreak: "clone",
      WebkitBoxDecorationBreak: "clone",
    },
    ".cm-searchMatch-selected": {
      backgroundColor: "var(--color-edge-strong)",
      boxShadow: "inset 0 0 0 1px var(--color-ink-muted)",
    },
  },
  { dark: true },
);

export function FilesEditor(props: FilesEditorProps) {
  const host = useRef<HTMLDivElement>(null);
  const view = useRef<EditorView | null>(null);
  const latest = useRef(props);
  latest.current = props;
  const [wrap, setWrap] = useState(false);
  const wrapRef = useRef(wrap);
  wrapRef.current = wrap;
  const [findOpen, setFindOpen] = useState(false);
  const [historyAvailable, setHistoryAvailable] = useState({ undo: false, redo: false });
  const [selectionText, setSelectionText] = useState("");
  const [menuPosition, setMenuPosition] = useState<ContextMenuPosition | null>(null);
  const [position, setPosition] = useState("Ln 1, Col 1");
  const wrapping = useRef(new Compartment());
  const permissions = useRef(new Compartment());
  const configuration = useRef<Extension[]>([]);
  const lastInsertion = useRef<number | null>(null);
  const id = JSON.stringify([props.profileId, props.path]);

  useEffect(() => {
    if (!host.current || !props.active) return;
    let keyboardViewport: {
      state: EditorState;
      top: number;
      left: number;
      trigger: KeyboardEvent;
    } | null = null;
    const focusMeasure = {};
    const updatePosition = (state: EditorState) => {
      const cursor = state.selection.main.head;
      const line = state.doc.lineAt(cursor);
      setPosition(`Ln ${line.number}, Col ${cursor - line.from + 1}`);
      const context = cfgCompletionContext(state.doc.toString(), cursor);
      const token = context && state.doc.sliceString(context.from, context.to);
      latest.current.onCommandChange?.(context?.command || token || null);
      setFindOpen(searchPanelOpen(state));
      setHistoryAvailable({ undo: undoDepth(state) > 0, redo: redoDepth(state) > 0 });
      setSelectionText(state.sliceDoc(state.selection.main.from, state.selection.main.to));
    };
    const extensions = [
      // Preserve literal CR bytes in mixed/CRLF inputs instead of normalizing.
      EditorState.lineSeparator.of("\n"),
      lineNumbers(),
      drawSelection(),
      highlightActiveLine(),
      history(),
      cfgLanguage,
      colors,
      theme,
      search({ top: true }),
      wrapping.current.of(wrapRef.current ? EditorView.lineWrapping : []),
      permissions.current.of([
        EditorState.readOnly.of(latest.current.readOnly),
        EditorView.editable.of(!latest.current.readOnly),
      ]),
      EditorView.contentAttributes.of({
        tabindex: "0",
        "aria-label": `Contents of ${latest.current.path}`,
        "aria-describedby": "files-editor-keyboard-help",
        spellcheck: "false",
      }),
      EditorView.domEventHandlers({
        focus: (_event, editor) => {
          const captured = keyboardViewport;
          if (!captured) return false;
          const unchanged = () =>
            keyboardViewport === captured &&
            view.current === editor &&
            editor.hasFocus &&
            !captured.trigger.defaultPrevented &&
            editor.state.doc === captured.state.doc &&
            editor.state.selection.eq(captured.state.selection);
          editor.requestMeasure({
            key: focusMeasure,
            read: unchanged,
            write: (ready) => {
              if (!ready || !unchanged()) {
                if (keyboardViewport === captured) keyboardViewport = null;
                return;
              }
              keyboardViewport = null;
              // WebKit can reset both axes during default keyboard focus.
              // Synchronize CodeMirror's DOM selection before restoring the
              // viewport; moving the caret into view would lose that viewport.
              editor.focus();
              editor.scrollDOM.scrollTop = captured.top;
              editor.scrollDOM.scrollLeft = captured.left;
            },
          });
          return false;
        },
        keydown: (event) => {
          if (
            (event.ctrlKey || event.metaKey) &&
            event.shiftKey &&
            !event.altKey &&
            event.key.toLowerCase() === "s"
          ) {
            event.preventDefault();
            if (latest.current.canSaveAs !== false) latest.current.onSaveAs?.();
            return true;
          }
          return false;
        },
        contextmenu: (event, editor) => {
          event.preventDefault();
          const bounds = editor.dom.getBoundingClientRect();
          setMenuPosition({
            x: event.clientX || bounds.left + 24,
            y: event.clientY || bounds.top + 24,
          });
          return true;
        },
      }),
      EditorState.transactionFilter.of((transaction) => {
        if (
          transaction.docChanged &&
          (latest.current.readOnly || editorTextBytes(transaction.newDoc.toString()) === null)
        )
          return [];
        return transaction;
      }),
      autocompletion({
        defaultKeymap: false,
        override: [
          (context) => {
            if (latest.current.readOnly) return null;
            const result = cfgCompletions(
              context.state.doc.toString(),
              context.pos,
              [
                ...(latest.current.files ?? []).filter((file) => file.path !== latest.current.path),
                { path: latest.current.path, text: context.state.doc.toString() },
              ],
              latest.current.catalog ?? filesCompletionCatalog(),
            );
            if (!result) return null;
            return {
              ...result,
              to: context.pos,
              options: result.options.map((option) => ({
                ...option,
                apply: (editor: EditorView) => {
                  editor.dispatch({
                    changes: { from: result.from, to: result.to, insert: option.label },
                    selection: { anchor: result.from + option.label.length },
                    userEvent: "input.complete",
                    annotations: pickedCompletion.of(option),
                  });
                },
              })),
            };
          },
        ],
      }),
      keymap.of([
        {
          key: "Shift-F10",
          preventDefault: true,
          run: (editor) => {
            const bounds = editor.dom.getBoundingClientRect();
            setMenuPosition({ x: bounds.left + 24, y: bounds.top + 24 });
            return true;
          },
        },
        {
          key: "Mod-s",
          preventDefault: true,
          run: () => {
            if (
              !latest.current.readOnly &&
              (latest.current.canSaveShortcut ?? latest.current.canSave) !== false
            )
              latest.current.onSave();
            return true;
          },
        },
        {
          key: "Mod-n",
          preventDefault: true,
          run: () => {
            latest.current.onNewCfg?.();
            return true;
          },
        },
        {
          key: "Alt-z",
          preventDefault: true,
          run: () => {
            setWrap((value) => !value);
            return true;
          },
        },
        { key: "Tab", run: (editor) => !editor.composing && acceptCompletion(editor) },
        // Enter retains its normal editing meaning; only Tab accepts a suggestion.
        ...completionKeymap.filter((binding) => binding.key !== "Enter"),
        ...searchKeymap,
        ...historyKeymap,
        ...defaultKeymap,
      ]),
      EditorView.updateListener.of((update) => {
        if (update.docChanged) latest.current.onChange(update.state.doc.toString());
        if (update.docChanged || update.selectionSet) updatePosition(update.state);
        else if (searchPanelOpen(update.startState) !== searchPanelOpen(update.state)) {
          setFindOpen(searchPanelOpen(update.state));
        }
      }),
    ];
    configuration.current = extensions;
    const cached = sessions.get(id);
    const matching = cached?.state.doc.toString() === latest.current.value ? cached : undefined;
    const state = matching
      ? matching.state.update({ effects: StateEffect.reconfigure.of(extensions) }).state
      : EditorState.create({ doc: latest.current.value, extensions });
    const editor = new EditorView({ state, parent: host.current, scrollTo: matching?.scroll });
    view.current = editor;
    const owner = editor.dom.ownerDocument;
    const cancelKeyboardViewport = () => {
      keyboardViewport = null;
    };
    const captureKeyboardViewport = (event: KeyboardEvent) => {
      cancelKeyboardViewport();
      if (
        event.key !== "Tab" ||
        event.altKey ||
        event.ctrlKey ||
        event.metaKey ||
        editor.hasFocus ||
        event.defaultPrevented
      )
        return;
      const { scrollTop: top, scrollLeft: left } = editor.scrollDOM;
      if (top || left) keyboardViewport = { state: editor.state, top, left, trigger: event };
    };
    const focusElsewhere = (event: FocusEvent) => {
      if (event.target !== editor.contentDOM) cancelKeyboardViewport();
    };
    // Observe the browser's actual Tab destination without resolving or
    // preventing its focus order, including reverse Tab and the Find panel.
    owner.addEventListener("keydown", captureKeyboardViewport, true);
    owner.addEventListener("focusin", focusElsewhere, true);
    owner.addEventListener("pointerdown", cancelKeyboardViewport, true);
    owner.addEventListener("wheel", cancelKeyboardViewport, { capture: true, passive: true });
    if (matching) {
      // Set the initial pixels; CodeMirror's snapshot keeps the same text in
      // place after virtualized line heights are measured on the next frame.
      editor.scrollDOM.scrollTop = matching.top;
      editor.scrollDOM.scrollLeft = matching.left;
    }
    updatePosition(state);
    return () => {
      cancelKeyboardViewport();
      owner.removeEventListener("keydown", captureKeyboardViewport, true);
      owner.removeEventListener("focusin", focusElsewhere, true);
      owner.removeEventListener("pointerdown", cancelKeyboardViewport, true);
      owner.removeEventListener("wheel", cancelKeyboardViewport, true);
      editor.destroy();
      view.current = null;
      setMenuPosition(null);
    };
    // Mount a view only for this active model. All event callbacks read latest props.
  }, [id, props.active]);

  useEffect(() => {
    const editor = view.current;
    if (!editor) return;
    editor.dispatch({
      effects: permissions.current.reconfigure([
        EditorState.readOnly.of(props.readOnly),
        EditorView.editable.of(!props.readOnly),
      ]),
    });
    if (editor.state.doc.toString() !== props.value) {
      // A disk reload/discard is authoritative. Drop obsolete undo history so
      // discarded contents cannot reappear through Undo or Redo.
      editor.setState(
        EditorState.create({
          doc: props.value,
          selection: { anchor: Math.min(editor.state.selection.main.head, props.value.length) },
          extensions: configuration.current,
        }),
      );
      editor.dispatch({
        effects: permissions.current.reconfigure([
          EditorState.readOnly.of(props.readOnly),
          EditorView.editable.of(!props.readOnly),
        ]),
      });
      editor.dispatch({
        effects: wrapping.current.reconfigure(wrapRef.current ? EditorView.lineWrapping : []),
      });
    }
  }, [props.value, props.readOnly]);

  useEffect(() => {
    view.current?.dispatch({
      effects: wrapping.current.reconfigure(wrap ? EditorView.lineWrapping : []),
    });
  }, [wrap]);
  useEffect(() => {
    const editor = view.current;
    const target = props.target;
    if (!editor || !target) return;
    if (target.focusOnly) {
      editor.contentDOM.focus({ preventScroll: true });
      return;
    }
    const from = Math.max(
      0,
      Math.min(
        editor.state.doc.length,
        target.from ??
          (target.line === undefined
            ? editor.state.selection.main.anchor
            : editor.state.doc.line(Math.max(1, Math.min(editor.state.doc.lines, target.line)))
                .from),
      ),
    );
    const to = Math.max(from, Math.min(editor.state.doc.length, target.to ?? from));
    editor.dispatch({
      selection: { anchor: from, head: to },
      effects: EditorView.scrollIntoView(from, { y: "center" }),
    });
    editor.focus();
  }, [props.target]);
  useEffect(() => {
    const editor = view.current;
    if (
      !editor ||
      !props.insertion ||
      props.readOnly ||
      lastInsertion.current === props.insertion.id
    )
      return;
    lastInsertion.current = props.insertion.id;
    editor.dispatch({
      ...editor.state.replaceSelection(props.insertion.text),
      userEvent: "input.paste",
      scrollIntoView: true,
    });
    editor.focus();
  }, [props.insertion, props.readOnly]);

  function toggleFind() {
    const editor = view.current;
    if (!editor) return;
    const opening = !searchPanelOpen(editor.state);
    (opening ? openSearchPanel : closeSearchPanel)(editor);
    setFindOpen(opening);
  }

  function runEditorCommand(command: (editor: EditorView) => boolean) {
    const editor = view.current;
    if (!editor) return;
    command(editor);
    editor.focus();
    setMenuPosition(null);
  }

  async function copySelection() {
    if (selectionText) await copyToClipboard(selectionText);
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <EditorSessionBoundary
        identity={id}
        active={props.active}
        capture={() => {
          const editor = view.current;
          if (!editor) return;
          // Passive cleanup runs after display:none has already zeroed scroll.
          sessions.set(id, {
            state: editor.state,
            top: editor.scrollDOM.scrollTop,
            left: editor.scrollDOM.scrollLeft,
            scroll: editor.scrollSnapshot(),
          });
        }}
      />
      <div className="flex flex-wrap items-center gap-1 border-b border-edge px-2 py-1 text-xs text-ink-muted">
        <button
          type="button"
          className={`rounded px-2 py-1 transition-colors duration-150 hover:bg-panel-raised hover:text-ink focus-visible:outline ${
            findOpen ? "bg-panel-raised text-ink" : ""
          }`}
          title="Find or replace (Ctrl+F)"
          aria-pressed={findOpen}
          onClick={toggleFind}
        >
          Find
        </button>
        <button
          type="button"
          className={`rounded px-2 py-1 transition-colors duration-150 hover:bg-panel-raised hover:text-ink focus-visible:outline ${
            wrap ? "bg-panel-raised text-ink" : ""
          }`}
          aria-label="Wrap lines"
          aria-pressed={wrap}
          onClick={() => setWrap(!wrap)}
        >
          Wrap
        </button>
      </div>
      <div
        ref={host}
        className="min-h-0 flex-none overflow-hidden"
        style={{
          height: props.compact
            ? "clamp(180px, calc(100vh - 620px), 300px)"
            : "clamp(360px, calc(100vh - 320px), 640px)",
        }}
      />
      <div
        id="files-editor-keyboard-help"
        className="flex min-h-7 items-center justify-between gap-3 border-t border-edge px-3 py-1 text-xs text-ink-muted"
      >
        {props.statusStart ?? <span />}
        <span className="sr-only">
          {props.readOnly
            ? "Read-only · Ctrl+Shift+S Save as · Ctrl+F Find · Alt+Z Wrap"
            : "Ctrl+S Save · Ctrl+Shift+S Save as · Ctrl+F Find · Alt+Z Wrap · Ctrl+Space Complete"}
        </span>
        <span className="shrink-0 tabular-nums">{position}</span>
      </div>
      {menuPosition && (
        <ContextMenu
          label="Editor actions"
          position={menuPosition}
          onClose={() => setMenuPosition(null)}
        >
          <ContextMenuItem
            detail="Ctrl+Z"
            disabled={props.readOnly || !historyAvailable.undo}
            onSelect={() => runEditorCommand(undo)}
          >
            Undo
          </ContextMenuItem>
          <ContextMenuItem
            detail="Ctrl+Y"
            disabled={props.readOnly || !historyAvailable.redo}
            onSelect={() => runEditorCommand(redo)}
          >
            Redo
          </ContextMenuItem>
          <ContextMenuItem
            detail="Ctrl+C"
            disabled={!selectionText}
            onSelect={() => {
              void copySelection();
              setMenuPosition(null);
            }}
          >
            Copy
          </ContextMenuItem>
          <ContextMenuItem onSelect={() => runEditorCommand(selectAll)}>Select all</ContextMenuItem>
          <ContextMenuSeparator />
          <ContextMenuItem
            detail="Ctrl+F"
            onSelect={() => {
              toggleFind();
              setMenuPosition(null);
            }}
          >
            {findOpen ? "Close Find" : "Find and replace"}
          </ContextMenuItem>
          <ContextMenuItem
            checked={wrap}
            detail="Alt+Z"
            onSelect={() => {
              setWrap((value) => !value);
              setMenuPosition(null);
            }}
          >
            Wrap lines
          </ContextMenuItem>
          {!props.readOnly && (
            <>
              <ContextMenuSeparator />
              <ContextMenuItem
                detail="Ctrl+S"
                disabled={props.canSave === false}
                onSelect={() => {
                  props.onSave();
                  setMenuPosition(null);
                }}
              >
                Save
              </ContextMenuItem>
            </>
          )}
          {props.onSaveAs && (
            <ContextMenuItem
              detail="Ctrl+Shift+S"
              disabled={props.canSaveAs === false}
              onSelect={() => {
                props.onSaveAs?.();
                setMenuPosition(null);
              }}
            >
              Save as new cfg…
            </ContextMenuItem>
          )}
          {props.onNewCfg && (
            <ContextMenuItem
              detail="Ctrl+N"
              onSelect={() => {
                props.onNewCfg?.();
                setMenuPosition(null);
              }}
            >
              New cfg…
            </ContextMenuItem>
          )}
          {(props.onShowProblems || props.onShowHelp) && <ContextMenuSeparator />}
          {props.onShowProblems && (
            <ContextMenuItem
              onSelect={() => {
                props.onShowProblems?.();
                setMenuPosition(null);
              }}
            >
              Show problems
            </ContextMenuItem>
          )}
          {props.onShowHelp && (
            <ContextMenuItem
              onSelect={() => {
                props.onShowHelp?.();
                setMenuPosition(null);
              }}
            >
              Show command help
            </ContextMenuItem>
          )}
        </ContextMenu>
      )}
    </div>
  );
}
