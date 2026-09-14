# 0.1.5 cfg execution and viewmodel FOV fixes

Scope: RND-281, RND-282 and RND-284. Implemented from maintenance baseline
`fae34cf` in `codex/0.1.5-cfg-execution`. No game files or profile libraries were
read or written; UI tests use in-memory IPC doubles.

## Behavior

- Safety scanning still reviews every supplied cfg, including optional/class
  files, overwritten alias definitions and uninvoked bind/alias payloads. That
  pass no longer changes the settings or bind maps.
- Startup evaluation has its own sequential alias table. Defining a bind or
  alias only stores its payload. An invoked alias or `exec` executes in order;
  a later alias definition cannot affect an earlier invocation. Repeated execs
  retain their effect within the work budget. Executed `unbind`, `unbindall`
  and explicitly empty binds remove bindings; a bare `bind key` is a query.
- The desktop evaluates `tf/cfg/config.cfg` followed by the selected layer's
  startup files. Vanilla uses `tf/cfg/autoexec.cfg`; mastercomfig uses its
  `overrides/pre_init.cfg`, `overrides/setup_hook.cfg` and
  `overrides/autoexec.cfg` hooks in order. Optional/class files are included
  only through an actual startup invocation. The generic linter defaults to
  root/`tf/cfg` config and autoexec paths and accepts explicit entry paths.
- Both passes share ceilings of 25,000 command visits and 5,000 cfg visits,
  including alias/bind payloads. The existing exec depth 4, alias depth 8 and
  scan expansion 5,000 limits remain. Repeated payloads and exec resolution
  reuse parsed/resolved data. Exhaustion emits one `analysis-budget` finding;
  untrusted incomplete scanning blocks approval. Self-authored cfgs receive a
  warning so Files can still repair them.
- Unresolved startup execs, cycles, depth limits and unsupported dynamic
  setting operations mark execution incomplete. Incomplete results expose
  empty maps. SettingsHost prevents derived settings saves and leaves Files
  available. It never treats the evaluated prefix as a final value.
- Gameplay uses separate viewmodel FOV limits, 0.1–179.9. Incoming finite
  decimals are retained without rounding, including through managed-text
  seeds, effective-state seeds and unrelated autosaves. The slider supports
  intentional 0.1-degree changes; its output displays the full saved value.
  World FOV retains the existing 54–90 integer control.

## Primary sources checked

- [Valve TF2 viewmodel FOV declaration](https://github.com/ValveSoftware/source-sdk-2013/blob/master/src/game/client/view.cpp#L100-L104):
  the accepted ConVar range is 0.1–179.9. Separate menu-limit arguments do not
  narrow that range.
- [Valve selected-class cfg execution](https://github.com/ValveSoftware/source-sdk-2013/blob/master/src/game/client/tf/clientmode_tf.cpp#L630-L639):
  a class-change event executes the selected class file. Other class files do
  not execute simply because they exist.
- [Valve button event handling](https://github.com/ValveSoftware/source-sdk-2013/blob/master/src/game/client/in_main.cpp#L89-L97):
  key events issue their bound button commands. Storing the binding is a
  distinct operation.
- [mastercomfig customization documentation](https://github.com/mastercomfig/mastercomfig/blob/develop/docs/customization/custom_configs.md):
  launch autoexec, class-switch cfgs, local-server cfgs and game override hooks
  have different triggers; user files belong in `overrides`.
- [mastercomfig 9.100.1 startup generation](https://github.com/mastercomfig/mastercomfig/blob/9.100.1/dev/presets/package.sh#L14-L24):
  the packaged autoexec runs pre-init, setup, then user autoexec hooks, with
  mastercomfig's own core/modules/addons between them. The desktop models the
  user hook order rather than sweeping every file as a root.

The Valve Developer Community autoexec page could not be fetched; it is not
used as evidence. The sources were read on 2026-09-14.

## Verification

- `pnpm install --frozen-lockfile`: passed without lockfile changes.
- `pnpm test`: passed, 129 cfglint tests, 438 desktop tests and 21 release-script
  checks; three existing Linux-only script checks were skipped on Windows.
  The final credential-exclusion regression increases the focused cfglint run
  to 130 passing tests. Desktop coverage includes 20 tests of the startup
  adapter and real SettingsHost/Gameplay workflow.
- `pnpm build`: TypeScript and Vite passed. The existing large-chunk warning
  remains; the main bundle was about 900 kB, 259 kB gzip.
- `pnpm check`: passed, 220 files checked without fixes.
- `git diff --check`: passed.
- [Execution regressions](../../../packages/cfglint/test/execution.test.ts)
  cover deferred/direct invocation, sequential alias definitions, executed
  removals, startup ordering, dormant/class/pack cfgs, actual repeated execs,
  untrusted safety scanning, ordinary and payload fanout, a wide command list,
  shared evaluation work limits and incomplete-result handling.
- [UI regressions](../../../apps/desktop/src/SettingsHost.cfg.test.tsx) use the
  real host, Gameplay controls and autosave hooks. They verify that viewing
  settings does not write, an unrelated toggle preserves the startup value,
  both cfg and managed-file FOV values survive, explicit decimal FOV edits
  save, and incomplete inference cannot write while Files remains reachable.

The [bounded child-process probe](cfg-exec-budget.mjs) repeats the audit's five
file graph. Its children have a 2.5-second hard timeout. The first post-fix
measurement was 6.6 ms / 6.2 ms / 7.3 ms for fanout 10 / 30 / 100, compared with
the original audit's 8.2 ms / 565.2 ms / timeout. All post-fix cases returned an
explicit limit finding. These are local measurements, not a hardware-wide
latency guarantee. [Raw results](cfg-exec-budget-results.jsonl).

## Limits

This is a bounded startup resolver, not a running Source-engine emulator.
Class changes, key events, server state, arbitrary engine commands, launch
options and mastercomfig's compiled core/module behavior are not simulated.
Known dynamic setting commands (`toggle`, `incrementvar`, `multvar`,
`bindtoggle`, `execifexists`, `stuffcmds`) refuse derived inference instead of
guessing. An unknown command has no modeled state effect; the scanner still
reports it unless it recognizes a definition in the supplied files.

Only available user cfg bytes contribute to the maps. Existing input-size
limits still bound initial parsing; the new visit ceilings specifically bound
expansion/traversal after parsing. No worker, live game test, native write,
profile migration or new write surface is introduced. Native/Rust release
checks belong to the parent 0.1.5 integration run because this change edits
only TypeScript, UI tests and documentation.

Local git hooks are `.githooks`; the repository identity is Random. No Cloud
Agent co-author hook was found in the accessible managed-hook locations.
Commits contain no co-author trailers.
