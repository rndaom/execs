import {
  acceptCompletion,
  autocompletion,
  completionKeymap,
  pickedCompletion,
} from "@codemirror/autocomplete";
import { defaultKeymap, history, historyKeymap } from "@codemirror/commands";
import { HighlightStyle, StreamLanguage, syntaxHighlighting } from "@codemirror/language";
import { gotoLine, openSearchPanel, search, searchKeymap } from "@codemirror/search";
import { Compartment, EditorState, type Extension, StateEffect } from "@codemirror/state";
import {
  drawSelection,
  EditorView,
  highlightActiveLine,
  keymap,
  lineNumbers,
} from "@codemirror/view";
import { tags } from "@lezer/highlight";
import { useEffect, useRef, useState } from "react";
import {
  type CompletionCatalog,
  cfgCompletionContext,
  cfgCompletions,
} from "../lib/files-completion";
import { filesCompletionCatalog } from "../lib/files-completion-catalog";
import { editorTextBytes } from "../lib/files-limits";

export type FilesEditorProps = {
  profileId: string | null;
  path: string;
  value: string;
  readOnly: boolean;
  active: boolean;
  onChange: (text: string) => void;
  onSave: () => void;
  onCommandChange?: (command: string | null) => void;
  files?: readonly { path: string; text: string }[];
  catalog?: CompletionCatalog;
  target?: { id: number; from?: number; to?: number; line?: number };
  insertion?: { id: number; text: string };
};

const sessions = new Map<string, { state: EditorState; top: number; left: number }>();
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
    { tag: tags.number, color: "var(--color-team-blu)" },
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
      color: "var(--color-ink-faint)",
      borderRight: "1px solid var(--color-edge)",
    },
    ".cm-activeLine, .cm-activeLineGutter": { backgroundColor: "var(--color-edge)" },
    "&.cm-focused": { outline: "1px solid var(--color-edge-strong)" },
    ".cm-selectionBackground, &.cm-focused .cm-selectionBackground": {
      backgroundColor: "var(--color-edge-strong)",
    },
    ".cm-cursor": { borderLeftColor: "var(--color-ink)" },
    ".cm-panels, .cm-tooltip": {
      backgroundColor: "var(--color-panel-raised)",
      color: "var(--color-ink)",
      borderColor: "var(--color-edge-strong)",
    },
    ".cm-textfield, .cm-button": {
      background: "var(--color-bg)",
      color: "var(--color-ink)",
      border: "1px solid var(--color-edge-strong)",
    },
    ".cm-tooltip-autocomplete ul li[aria-selected]": {
      background: "var(--color-edge-strong)",
      color: "var(--color-ink)",
    },
    ".cm-searchMatch": {
      backgroundColor: "var(--color-edge-strong)",
      outline: "1px solid var(--color-ink-muted)",
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
  const [position, setPosition] = useState("Ln 1, Col 1");
  const wrapping = useRef(new Compartment());
  const permissions = useRef(new Compartment());
  const configuration = useRef<Extension[]>([]);
  const lastInsertion = useRef<number | null>(null);
  const id = JSON.stringify([props.profileId, props.path]);

  useEffect(() => {
    if (!host.current || !props.active) return;
    const updatePosition = (state: EditorState) => {
      const cursor = state.selection.main.head;
      const line = state.doc.lineAt(cursor);
      setPosition(`Ln ${line.number}, Col ${cursor - line.from + 1}`);
      const context = cfgCompletionContext(state.doc.toString(), cursor);
      const token = context && state.doc.sliceString(context.from, context.to);
      latest.current.onCommandChange?.(context?.command || token || null);
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
        "aria-label": `Contents of ${latest.current.path}`,
        "aria-describedby": "files-editor-keyboard-help",
        spellcheck: "false",
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
          key: "Mod-s",
          preventDefault: true,
          run: () => {
            if (!latest.current.readOnly) latest.current.onSave();
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
      }),
    ];
    configuration.current = extensions;
    const cached = sessions.get(id);
    const state =
      cached?.state.doc.toString() === latest.current.value
        ? cached.state.update({ effects: StateEffect.reconfigure.of(extensions) }).state
        : EditorState.create({ doc: latest.current.value, extensions });
    const editor = new EditorView({ state, parent: host.current });
    view.current = editor;
    if (cached) {
      editor.scrollDOM.scrollTop = cached.top;
      editor.scrollDOM.scrollLeft = cached.left;
    }
    updatePosition(state);
    return () => {
      sessions.set(id, {
        state: editor.state,
        top: editor.scrollDOM.scrollTop,
        left: editor.scrollDOM.scrollLeft,
      });
      editor.destroy();
      view.current = null;
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
    const from = Math.max(
      0,
      Math.min(
        editor.state.doc.length,
        target.from ??
          editor.state.doc.line(Math.max(1, Math.min(editor.state.doc.lines, target.line ?? 1)))
            .from,
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

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex flex-wrap items-center gap-3 border-b border-edge px-3 py-1 text-xs text-ink-muted">
        <button type="button" onClick={() => view.current && openSearchPanel(view.current)}>
          Find / replace
        </button>
        <button type="button" onClick={() => view.current && gotoLine(view.current)}>
          Go to line
        </button>
        <button type="button" aria-pressed={wrap} onClick={() => setWrap(!wrap)}>
          Wrap lines
        </button>
        <span className="ml-auto tabular-nums">{position}</span>
      </div>
      <div
        ref={host}
        className="min-h-0 flex-none overflow-hidden"
        style={{ height: "clamp(274px, calc(100vh - 370px), 600px)" }}
      />
      <p
        id="files-editor-keyboard-help"
        className="border-t border-edge px-3 py-1 text-xs text-ink-muted"
      >
        Ctrl+Space suggests · Tab accepts a suggestion or moves focus · Esc then Tab exits · Ctrl+S
        saves
      </p>
    </div>
  );
}
