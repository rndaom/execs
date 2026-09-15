# 0.1.5 cfg execution and viewmodel FOV fixes

Scope: RND-281, RND-282, RND-283 and RND-284. Implemented from maintenance baseline
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
- The desktop resolves `config.cfg` followed by the selected layer's startup
  files. Vanilla uses `autoexec.cfg`; mastercomfig uses its
  `overrides/pre_init.cfg`, `overrides/setup_hook.cfg` and
  `overrides/autoexec.cfg` hooks in order. Optional/class files are included
  only through an actual startup invocation. The generic linter defaults to
  config and autoexec targets through the supported mounts and accepts exact
  entry paths. Startup and nested execs share one resolver: immediate,
  non-dot custom children in ASCII case-insensitive mount-name order, then
  `tf/cfg`. The resolver never confuses editor priority with mount priority.
  Nested inactive/backup cfg folders do not become mounts. Portable path
  collisions and unsupported non-ASCII mount ordering refuse inference.
- A provided custom autoexec or managed cfg can shadow the files native saves
  update. Derived controls stay blocked in that situation with a specific
  explanation. This change does not rewrite provided packs or claim that
  saving an unexecuted root file applied a setting.
- Legacy profiles can retain multiple HUD trees while native switching only
  projects the selected HUD. The host passes the complete manifest inventory
  so the adapter recognizes those uncertain cfg sources via native HUD marker
  rules (`info.vdf` or `resource/ui/`). It refuses derived saves with a
  **Save current as…** recovery path and leaves Files available. It does not
  duplicate native HUD selection rules or silently mount a preserved copy.
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
- [Valve wildcard search-path expansion](https://github.com/ValveSoftware/source-sdk-2013/blob/b8cfb12c0e083a2ef5b2f9f9b50f3902fa034474/src/public/filesystem_init.cpp#L743):
  immediate non-dot children are sorted by `SortStricmp` before mounting.
  The helper appends them with `PATH_ADD_TO_TAIL`; names with leading dashes
  remain distinct mounted roots. Sorting uses the mount name before appending
  `cfg/`, preserving short-name precedence such as `alpha` before `alpha-beta`.
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

The native loader returns profile manifest files (`detail_from_manifest` and
`read_profile_file_from` in `apply.rs`). SettingsHost reads its loose `.cfg`
entries, including cfg files in custom packs. It does not extract VPK cfg
entries or read stock game cfg files. An explicit startup call to an unavailable
file therefore blocks derived settings, including `config_default` and
`undo360controller`: allowing those names in the safety review does not make
their unknown execution a no-op. Resolving them needs actual bounded file
reads and Source search-path precedence; that native extension is outside
this change. Normal mastercomfig user hooks are evaluated directly and do not
require the omitted packaged core autoexec to be loaded.

The browser review caught legacy bare exec paths in the shared preview seed.
Those paths now use `overrides/execs_binds` and `overrides/execs_gameplay`.
An adapter regression loads the locked preview through its real profile API
and confirms complete inferred settings. Additional adapter checks cover an
invoked loose custom cfg and incomplete stock/VPK-only targets.
Follow-up verification passed: 443 desktop tests, TypeScript with `--noEmit`,
`pnpm check` (220 files), and `git diff --check`.

The mounted-source review reproduced root `personal/settings.cfg` (FOV 45)
being incorrectly selected over `tf/custom/-alpha/cfg/personal/settings.cfg`
(FOV 100), plus a custom autoexec being ignored and nested inactive/dot-root
cfg files being resolved as mounted. The final regressions cover those paths,
literal `-alpha`/`alpha` and prefix mount ordering, both editor enumeration
directions, case collisions, and real Gameplay autosaves for vanilla and
mastercomfig. The real host preserves FOV 100 on an unrelated toggle; a
shadowed managed route or uncertain legacy HUD projection cannot write.
The routing run passed 140 cfglint tests, 451 desktop tests, 21 release tests
(three Windows skips), production build and Biome (221 files). The final
legacy-HUD guard added one real-host case; its focused adapter/host run has
34 passing cases, the final full desktop run passes all 452 tests, and
TypeScript passes. The existing large-bundle advisory
remains. No native production code, profile library or live game files were
changed by this routing follow-up.

Local git hooks are `.githooks`; the repository identity is Random. No Cloud
Agent co-author hook was found in the accessible managed-hook locations.
Commits contain no co-author trailers.

## Deterministic alias-budget CI regression

Forward-port CI's existing single-run 50 ms assertion failed at 51.81567 ms
(`G:/Projects/execs-015-evidence/forward-port-ci-frontend.log`). The production
scanner still caps alias expansion at 5,000; the failure does not demonstrate
unbounded traversal. This follow-up changes only tests and audit evidence.

The adversarial regression now spies on the real corpus lookup, which every
alias declaration and invocation reaches before the expansion guard. It
requires the fixture to reach the cap, then limits inspections to 5,092:
5,000 expansions, at most 6 × 8 pending stack siblings, 6 × 6 remaining
declaration-payload commands, seven declarations and the final bind. It also
requires exactly one alias-budget finding, a retained unbindall finding, and
no fallback to the larger shared command budget. Thus exponential traversal
fails deterministically without depending on the runner's scheduling.

The unit test and [child-process benchmark](cfg-exec-budget.mjs) now share the
same seven-level alias fixture. The benchmark retains its 2.5-second child
timeout and records five fresh-process alias samples rather than asserting a
hardware-wide 50 ms latency target. This Windows run measured 20.2–32.0 ms
(median 20.8 ms); exec fanout 10 / 30 / 100 measured 5.1 / 5.9 / 12.8 ms.
Every child completed and reported its respective expansion/work limit.
[Raw measurements](cfg-work-budget-results.jsonl) retain all samples.

Verification: `pnpm --filter @execs/cfglint test` passed all 140 tests;
`node docs/audits/2026-09-14-0.1.5/cfg-exec-budget.mjs` completed all eight
children; `pnpm check` passed 222 files; `git diff --check` passed.
