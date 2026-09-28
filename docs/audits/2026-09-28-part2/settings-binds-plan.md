# Settings and Binds plan (part 2, items 2, 11, 13)

## Audit and sources

- Settings loading only synchronizes the Gameplay subset after a completed absorb reporting config.cfg drift. It uses the checked Files source write path; keep that trigger, source identity and lock guard.
- The current line-wide replacement can discard comments or a second command after a semicolon. Replace only parsed value token spans in existing managed assignments.
- Read Valve's installed `tf2_misc_dir.vpk` / referenced archive read-only on September 28: `cfg/user_default.scr` defines viewmodel FOV 54–70, flip/min-viewmodel booleans, hit and kill enable booleans, volumes 0–1, four pitches 1–255 and both effect enums 0–8. The issue's `tf_dingaling_pitch` and `tf_dingaling_lasthit` names are shorthand, not the actual managed cvars. `scripts/voicecommands.txt` has eight ordinary choices in each of three menus plus Pass to me in menus 1/2 (24 ordinary voice commands, rather than 21). No assets are copied.
- Valve source confirms [sound bounds](https://github.com/ValveSoftware/source-sdk-2013/blob/master/src/game/client/tf/tf_hud_account.cpp), [world FOV clamped to 75–MAX_FOV](https://github.com/ValveSoftware/source-sdk-2013/blob/master/src/game/shared/tf/tf_gamerules.cpp), and [separate viewmodel range](https://github.com/ValveSoftware/source-sdk-2013/blob/master/src/game/client/view.cpp).
- [Valve Engineer command parsing](https://github.com/ValveSoftware/source-sdk-2013/blob/master/src/game/server/tf/tf_player.cpp) accepts build/destroy object and mode. [Spy menu](https://github.com/ValveSoftware/source-sdk-2013/blob/master/src/game/client/tf/tf_hud_menu_spy_disguise.cpp) supplies class and explicit RED/BLU team. Use correctly labeled explicit teams instead of implying team-relative commands.
- cfglint tokenization deliberately does not support escaped nested quotes. Custom command input will refuse quotes/newlines/control bytes with a specific explanation; ordinary single-line sequences (`say gg`, `kill`, `build 2 0`) work, and multi-command payloads can be checked without becoming top-level startup commands.

## Implementation

1. Add explicit per-scope menu-sync rules and validators. Keep GAME_SYNCED_CVARS for Gameplay ownership; do not accidentally give Gameplay the other scopes. Sync only existing parsed scalar commands, replacing only value bytes, preserving quotes, whitespace, comments, unrelated commands, invalid values and missing values. Scope tests ensure no cross-scope rewrites. Viewmodel sync accepts menu range 54–70 while authored values outside it stay valid. Sounds sync excludes repeat delay (not a menu option). Verify crosshair menu evidence before adding bounded stock style/color/size rules.
2. Make the World FOV slider 75–90 and display a clamped effective value with a short note for lower cfg values. Preserve the original numeric draft through reads, serialization and unrelated edits. A direct slider change writes the selected supported value.
3. Extend the existing action catalog with kill/explode, explicit Spy RED/BLU disguises, Engineer build/destroy choices, all ordinary voice commands and Pass to me. Keep existing categories, search, recording, key caps and conflict review.
4. Add a Custom category with a command field, cfglint findings, Record key, and the existing BindRow component for effective custom commands. Custom assignment reuses capture and conflict review. Only an explicitly marked custom line is newly pane-owned; existing user-authored custom cfg lines stay byte-preserved. Remove uses the existing inherited-key unbind logic. Invalid/blocked or incomplete analysis cannot create a draft write; warnings remain visible. Escape, category/pane/profile changes cancel capture. Custom command editor state resets on profile switch.
5. Custom managed lines remain recognizable after reload and config sync; sync must not silently replace them with fixed actions or re-add old overrides after game changes. No new IPC, schema, disk surface, release/version change or live game write is expected.

## Verification

- Unit cases for all added rule boundaries, absent/invalid values, no inserted cvars, quoted tokens, inline comments, semicolon siblings, case and CRLF preservation, exact decimals and each scope.
- Settings loading tests for completed absorb trigger, source-checked write and failed/incomplete load refusal.
- Component regression for FOV 60 displaying 75, unchanged on open and unrelated toggles, then explicit slider update.
- Binds unit/component coverage: catalog completeness, correct class commands, custom chat/multi-command validation, syntax and block refusal, injection prevention, custom persistence, fixed/custom/inherited conflicts, removal, repeated key assignment, profile change and lock-deferred save.
- Targeted Vitest and TypeScript/Biome checks; combined full suite and visual verification at 1200×800 and 960×640 coordinated with root. Existing theme/components/motion retained.

Status: root approved implementation; independent reviewer approved the plan and implementation. Completed evidence is in settings-binds-evidence.md.
