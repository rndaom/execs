# Files editor engine, 0.1.7

CodeMirror 6 is the chosen editor. Its modular state/view model gives each profile
and file its own undo history and selection; destroyed views remove their DOM
handlers while the session retains the state and scroll position. An external
reload or explicit discard replaces obsolete history. The Files draft registry
remains authoritative and owns save transitions.

The editor alone uses a system monospace font and internal scrolling. These are
scoped exceptions to Inter and the no-inner-scroll rule: fixed column alignment
and independently scrollable source are necessary for editing long cfg files.
The surrounding UI retains the existing typography and theme tokens.

## Evaluation

* CodeMirror ships ordinary bundled JavaScript and needs no worker, remote code,
  or new CSP permission for this cfg language. Its injected theme styles fit the
  existing `style-src 'unsafe-inline'` policy. Monaco's ESM integration requires
  deliberate worker configuration; that added integration is unnecessary here.
* Both projects use MIT licenses. CodeMirror's separately imported packages let
  this implementation include only state, view, commands, search, completion and
  the small stream grammar. No Monaco-sized language-service distribution is
  needed. Production Vite output is the evidence for actual bundle size; no
  unmeasured startup-time claim is made.
* CodeMirror provides accessible editor and completion semantics. Tab accepts
  an active suggestion and otherwise leaves the editor. Escape then Tab is the
  documented unconditional keyboard exit. Enter is not a completion shortcut.
  Composition events remain under the engine's handling. Ctrl+Space is optional;
  typed completion also works when an OS/input method reserves that shortcut.
* There is no WebKitGTK-specific code or worker dependency. Browser testing does
  not establish packaged WebKitGTK or NVDA/Orca compatibility: those release
  checks must be recorded separately, including IME and non-US keyboard use.
* Search highlights current-file matches before replacement, supports ordinary
  undo, and obeys engine read-only state. Completion is an offline draft edit;
  it neither executes Source commands nor saves the file. Unknown cvar values
  and server capabilities are not inferred.

## Primary documentation consulted

* [CodeMirror completion](https://codemirror.net/examples/autocompletion/)
* [CodeMirror keyboard exit contract](https://codemirror.net/examples/tab/)
* [CodeMirror state configuration](https://codemirror.net/examples/config/)
* [Monaco integration and support](https://github.com/microsoft/monaco-editor)
* [Monaco ESM workers](https://github.com/microsoft/monaco-editor/blob/main/docs/integrate-esm.md)
* [Tauri CSP](https://v2.tauri.app/security/csp/)

## Component contract

`FilesEditor` is controlled by profile, path and value. `active=false` destroys
the view without dropping its model. Callback refs always address the current
file. A new `target` object selects a UTF-16 range or one-based line; a new
`insertion` object replaces the current selection as one undoable edit. The
parent supplies a distinct action id so repeating an action is observable.
`readOnly` blocks DOM editing and document transactions. The existing file byte
limit rejects oversized edits before they enter the draft. No formatting,
command reordering, file writing or global keyboard listener is installed.
