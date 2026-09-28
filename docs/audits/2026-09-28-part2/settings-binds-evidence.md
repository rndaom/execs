# Settings and Binds implementation evidence

Covers part 2 items 2, 11 and 13. Implementation approved by the root coordinator; independent reviewer approved the plan and final settings/Binds diff with no blocking finding. The combined task owns release notes, repository-wide checks and browser visual verification. No release/version operation, real game launch or live player-file write was performed here.

## Behavior

- After a completed absorb reporting `config.cfg` drift, managed Gameplay, Viewmodels, Sounds and Crosshair menu values follow that snapshot. Missing settings are not inserted. Existing checked-source Files writes still bind the root/profile/layer and source hashes. Menu sync changes only scalar value-token spans, retaining comments, quotes, case, separators, newlines and other commands. Ordinary pane scope ownership remains separate.
- Viewmodels accepts menu FOV 54–70 and boolean flip/minimal viewmodels. Sounds accepts hit/kill toggles, volumes 0–1, four integer pitches 1–255 and effect choices 0–8. It does not infer nonexistent shorthand cvars or synchronize the repeat-delay control. Crosshair accepts the existing stock styles, RGB integers 0–255 and size 16–64. World FOV menu values use 75–90. Values outside supported menu domains remain untouched.
- World FOV displays TF2's effective 75–90 range. A saved lower value has a short explanation and remains in the draft through reads and unrelated saves. Only moving its slider replaces it. Fractional authored values also retain their precision.
- Binds now offers kill/explode, explicit RED/BLU Spy disguises, Engineer building/destroy choices, all 24 ordinary voice-menu actions and Pass to me. It uses the existing category tabs, rows, key caps, capture, source notices, conflict review and deferred autosave.
- Custom commands use the same capture and review flow. cfglint uses the same personal-config trust policy as Files; block findings/incomplete safety checks refuse assignment. Single-line command sequences are supported. Nested quotes/control bytes are refused because Source does not provide an escape syntax for a quote nested inside a quoted bind payload. The recorder checks the actual key as well as the editor's provisional key.
- An exact trailing `// execs:custom-bind` marker identifies new custom assignments. Unmarked author commands and near-matching comments retain their bytes. Removal clears an inherited key with a standalone unbind when needed; later startup overrides retain the existing notice. After-game removal/rebinding retires the old custom override. Profile changes clear the editor/capture; game-running drafts wait for unlock.

## Source check

Valve's installed `cfg/user_default.scr`, `scripts/voicecommands.txt` and `resource/optionssubmultiplayer.res` were read directly from the installed VPK without writing or copying Valve assets. The multiplayer resource explicitly exposes style, RGB and scale controls; its SHA-256 was `40cacfeaff5f0304edbbdfe03a970dddb786a6c4ad8c9492edafae556a00c19e`.

The source links and limits are in [the plan](settings-binds-plan.md). A combined test found that the offline command corpus omitted `build` and `destroy`; those entries are now generated from the [existing pinned Valve SDK revision's player handler](https://github.com/ValveSoftware/source-sdk-2013/blob/b8cfb12c0e083a2ef5b2f9f9b50f3902fa034474/src/game/server/tf/tf_player.cpp). Generation requires the expected handlers and argument parsing to exist. Metadata is independently described, and no strict arity is claimed because Valve accepts legacy one-argument binds. `kill`, `explode` and `disguise` already had pinned catalog entries.

## Checks completed

- Focused desktop verification: **11 files / 209 tests passed**: `BindsPane.custom`, `BindsPane`, `BindsPane.search`, `BindsPane.mouse-native`, `lib/settings-part2`, `lib/binds-ui`, `lib/gameplay-ui`, `GameplayPane`, `GameplayPane.mouse`, `SettingsHost`, `SettingsHost.cfg`.
- After the catalog addition: **10 cfglint files / 171 tests passed**, including app-generated action coverage and new Engineer provenance assertions. The 39 custom Binds/menu-sync tests also passed again against the regenerated catalog.
- `pnpm --filter @execs/desktop exec tsc --noEmit`: passed. Targeted Biome checks passed for the changed frontend and catalog files.
- Independent reviewer separately ran the menu/custom tests and integration suites, reporting 47 tests passed and no blocking finding.

The tests prove parser preservation, bounded menu-domain acceptance, ownership isolation, custom command persistence/rebinding, conflict review and deferred draft behavior. They do not prove retail TF2 runtime behavior or physical mouse delivery on either native platform. Browser layout/motion and the combined full suite belong to the root task's final verification.
