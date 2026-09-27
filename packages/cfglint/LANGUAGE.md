# Files cfg analysis contract

The analyzer reads source; it never executes it or rewrites it. Offsets (`from`, `to`)
use UTF-16 code units, zero-based and end-exclusive, matching browser editors. Lines
and columns are one-based UTF-16 positions; a tab is one source column. Original
CRLF, Unicode, whitespace, comments and backslashes remain intact. Payload findings
point into the defining file, and `via` names the containing bind/alias chain.

Supported lexical model: spaces and tabs separate tokens; LF and semicolons separate
commands; CR is whitespace, including CRLF; `//` starts a comment outside quotes;
double quotes contain literal text including semicolons and backslashes. A backslash
does not introduce JavaScript escaping. An unclosed quote recovers at CR/LF or EOF
and produces a warning. Recovery is an analyzer convention, not a claim about every
retail engine build. Empty, closed quoted command names are ignored. Quoted and
unquoted bind/alias payloads map back to original token spans after joining arguments.

Public SDK `CCommand::Tokenize` and `CUtlBuffer` are evidence for the published SDK,
not the complete retail engine command-buffer implementation. Punctuation break-set,
embedded control characters, malformed quoting recovery and native key-release
dispatch still require isolated retail verification. No inaccessible wiki assertion
was adopted as fact. No game was launched for these changes.

The catalog now recognizes known `+` and `-` actions individually. An arbitrary
`+forwad` is not silently accepted; local aliases are recognized, and unknown names
produce nonblocking catalog-availability information. Declaring an alias or bind
does not execute its payload. Safety scans inspect dormant payloads, whereas startup
inference follows only resolved startup commands and definitions available in order.
Unknown startup implementations invalidate effective settings rather than pretending
to know plugin effects. An unevenly quoted alias definition remains an advisory
finding, but it does not invalidate unrelated startup settings until the alias is
invoked. Catalogued comfig aliases require an inspected definition for startup
inference. A supported builtin has no modeled setting effect.

`safetyComplete` describes inspection of the supplied source set and deferred
payloads. Missing exec sources (even allowlisted engine files), cycles, ambiguous
search paths, malformed quotes and work/depth limits make it false.
`executionComplete` separately describes the supported startup evaluation. It clears
partial effective maps when an unresolved/unsupported operation or budget stops it.
Neither flag establishes completeness of the whole TF2 install, VPKs, class events,
key releases, server state or current runtime values. Deferred payloads may make the
safety scan incomplete while startup inference remains complete.

Argument diagnostics use only explicit catalog metadata, never defaults as types.
The first supported schemas are the SDK voice-menu integer arguments and the SDK
`fov_desired` numeric 20–90 bounds. Invalid numbers warn about coercion; out-of-bound
values warn about possible clamping. Queries do not receive assignment warnings.
Unverified engine command arity and incomplete key-name sets are not treated as
exhaustive constraints. SDK/Windows evidence is labeled in the reference, not claimed
as current Linux/retail coverage. Cheat flags describe server/runtime restrictions,
never VAC safety or multiplayer compatibility.

Primary evidence (reviewed September 20, 2026):

- [Valve command/ConVar API](https://github.com/ValveSoftware/source-sdk-2013/blob/b8cfb12c0e083a2ef5b2f9f9b50f3902fa034474/src/public/tier1/convar.h)
- [Valve conversion and clamping](https://github.com/ValveSoftware/source-sdk-2013/blob/b8cfb12c0e083a2ef5b2f9f9b50f3902fa034474/src/tier1/convar.cpp)
- [Valve flags](https://github.com/ValveSoftware/source-sdk-2013/blob/b8cfb12c0e083a2ef5b2f9f9b50f3902fa034474/src/public/tier1/iconvar.h)
- The offline [catalog provenance and generation contract](CATALOG.md).

## Rule inventory and policy decisions

Block means an explicit execs Save/import-review restriction, not a syntax judgment.
Advisory provided files demote blocks to warnings without changing the category.
Credentials in cfg source are saved unchanged and get a line-specific sharing
warning without exposing their values through findings or summaries. `self` means personal authoring;
`provided` means untrusted imported/review content. Syntax/argument findings do not
strip source or offer an automatic Fix all.

| Rule | Purpose/evidence | Self / provided | Example and counterexample |
|---|---|---|---|
| connect-redirect | execs imported redirection policy; engine connect command | warn / block | `connect host` joins when run; personal copy no longer accuses another author |
| rcon-password | local credential sharing advice | warn / warn | `password secret`, `rcon_password secret`; unset `password`, empty, or `0` is quiet; messages never include values |
| console-lockout | execs recoverability policy, engine default binds | block / block | `unbind escape`, `con_enable 0`, compound/alias ESCAPE payload; engine-managed con_enable and exact menu restore are exempt |
| alias-shadow | execs reviewed-command identity policy | block / block | `alias exec ...`, `alias +attack ...`; a new local alias or redefining a comfig alias is allowed |
| unbindall | bind-table reset vs deferred destructive payload | top-level warn; deferred self warn / provided block | `unbindall; bind w +forward` is normal reset; engine-managed prologue exempt |
| exec-external | bounded resolver cannot inspect target | warn / block | `exec absent`; resolved cfg has no finding; allowlisted file suppresses finding but still means incomplete coverage |
| disruptive-bind | session-ending command on key press | gameplay self warn / provided block; other keys warn; dormant personal aliases quiet | `bind w quit`; `alias q "quit"` is only a definition; server `restart` is not classified as client disruption |
| disruptive-immediate | command runs when its containing cfg executes | warn / warn | top-level quit; a dormant file is not claimed to execute at startup |
| chat-bind | imported chat disclosure | none / warn | personal `bind f "say hello"` is routine; imported payload remains disclosed |
| kill-bind | gameplay key effect, not a ban | warn / warn | `bind mouse4 kill`; non-gameplay `bind f9 kill` is quiet |
| mouse-tamper | imported mouse-setting disclosure | none / warn | personal sensitivity 2 is quiet; imported sensitivity still disclosed; engine-managed archived settings exempt |
| con-logfile | engine console file-output effect | warn / warn | `con_logfile capture.txt` redirects output |
| host-writeconfig | upstream command help: serialize runtime settings | warn / warn | no argument names config.cfg; `host_writeconfig backup` names backup.cfg; source comments/aliases are not promised preserved |
| net-extreme (removed) | former unsourced tuning opinion | none / none | cl_interp 2 and cl_cmdrate 1 no longer claim a “sane” engine range |
| unknown-command | absent from pinned catalog/local symbols | info / info | +forwad; known +forward is recognized; plugins remain possible |
| syntax-quote | malformed quote/recovery concern | warn / warn | unterminated payload; quoted semicolon and literal backslash are valid model tokens |
| argument-count/number/range/choice | sourced schema only | warn / warn | voicemenu arity, fov_desired banana/999; fov_desired query is quiet |
| runtime-restriction | pinned cheat flag, runtime context | info / info | cheat-gated assignment; no VAC claim |
| exec-cycle/depth, alias-depth/budget | bounded traversal, incomplete inspection | warn / warn | active exec recursion or depth/fanout cap; a deferred `alias ali "exec overrides/alias.cfg"` is not itself an exec cycle |
| analysis-budget | total command/exec work cap | warn / block | very wide fanout; imported incomplete scans remain refused |
| execution-search-path | ambiguous mounted path identity | warn / warn | case-colliding roots prevent inference |
| execution-incomplete/unsupported | startup source/state unavailable | warn / warn | missing exec, unknown implementation, toggle needing engine state; clear effective maps |

Changes to severity are deliberately narrow: routine self mouse/chat advice is removed;
exact self menu restoration is allowed; the unsourced net-extreme rule is removed.
Credential source remains inspectable and saveable, with explicit sharing advice.

Read-only installed evidence for the exact menu restore: app 440, ClientVersion
10828683, `tf/cfg/config_default.cfg` line 51 binds ESCAPE to `escape`; file SHA-256
`3589f50d3ddaa63187b1476a80f29fe622091b23e146875944669d0d5ab0b5af`.
`cancelselect` retains the existing engine-managed menu exception and pinned command
recognition. Retail interaction was not observed; compound payloads and aliases are
not exempt. Installed files and Steam Cloud were not written.

Validation: focused tokenizer, authoring, adversarial, trust, execution, catalog and
generator tests; all app-generated bind actions; deterministic pinned regeneration.
Native export/import suites and UI visual qualification are separate release checks.
