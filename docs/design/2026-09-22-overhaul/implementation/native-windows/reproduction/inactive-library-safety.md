# Native inactive-library scope

Prepared case: `G:/Projects/execs/.artifacts/native-isolation/20260922-120750-inactivelibrary-ff33a080`.

Candidate SHA-256: `E7BC62505EFC1257ACE629EDECB8640EDAEE3860CA2505DED68038FF00D40FAD`.

This scope permits Import review/cancel and deletion of one inactive fixture profile. It does not isolate arbitrary profile operations from the player's Steam account. No native app was launched by the preparing agent.

## Production path proof

| Path | Behavior with this fixture |
| --- | --- |
| `useTf2Install.ts` boot | Reads the private remembered synthetic root. Finder discovery may read actual Steam registry/library metadata; it performs no write. |
| `src-tauri/src/lib.rs:186`, `commands/shared.rs:197` | Library-read gate checks recovery state. With no maintenance, switch, mutation, deletion or preloader state, no recovery operation runs. |
| `core/src/profile.rs:1053` | Loads private index/manifests and inspects local HUD files read-only. It does not initialize or activate a profile. |
| `useProfileLibrary.ts` boot absorb | It can call absorb with no active profile. Production `core/src/absorb.rs:195` first discovers actual Steam/Cloud read-only; `absorb_owned_to` returns at line 221 on `activeProfileId: null`, before interrupted-file repair, drift classification, or Cloud/live writes. |
| `useFirstRun.ts`, `lib/first-run-ui.ts:57` | Two existing profiles suppress first-run classification and select ReadyPanel. Deleting one leaves one, so the wizard remains absent. |
| `lib/settings-ui.ts:47` | No active profile means no settings panes are mounted. There are no pane reads/autosaves or pending launch-option synchronization. |
| `commands/library.rs:264`, `core/src/zip/creator.rs:142` | Import picker/review takes the normal write gate, which has no recovery work here. Inspection hashes the selected ZIP and stages payloads under private `profiles/.import-staging`. This is a temporary app-data write, not a read-only operation. `StagingDir::drop` removes only that bounded staging tree before review is returned. |
| `commands/library.rs:362` | Cancel only discards the backend's in-memory review token. It does not create a profile or touch TF2/Cloud/Steam. |
| `useProfileLibrary.ts:449` | Inactive deletion skips its switch branch, then calls native delete with `keepInstalled: false`. |
| `commands/library.rs:59`, `core/src/profile_delete.rs:192` | Delete checks locks/recovery, commits only the private index/deletion journal, then removes the selected private profile directory. Remaining shared blobs stay referenced. Its optional preload-list cleanup is in private app data; with no preload state it writes nothing. No Cloud or localconfig writer is called. |

## Fixture contents

`InactiveLibraryFixture.ps1` reconstructs two private library records from retained genuine v0.1.8 export ZIPs. Payload bytes and upstream records are preserved. Only recipient UUID/root/name/launch-pending metadata and the index timestamps are supplied locally. No archive is activated or imported through the live app during preparation.

- No-HUD export SHA-256: `3299CF62CB18DA34785C309803ED2D8ABAD427EAB9B95918EA72B1BF9259AC38`.
- Single-HUD export SHA-256: `4B46FB3144B5C9FCD334505672FC8513FA3F9D629F821FBB4AB53B9DA4667EC9`.
- Review ZIP SHA-256: `77CC3C6F9DED610E56084F1EF7DDD410DEFE6F04162303054A0CEE274D234727`.
- Private settings and `profiles/index.json` identify the same synthetic root; index schema is 1, active id is null, and two UUID records exist.
- Synthetic root contains only `tf/steam.inf` declaring app 440, a minimal `config_default.cfg`, and cfg/custom sentinel bytes. No game executable, retail archives or Steam account data is copied.
- `inactive-library-baseline.json` covers every private settings/library/synthetic-root/import file. Every ZIP payload digest is validated during preparation. Launcher validates this complete baseline again before app start and refuses linked paths or unexpected maintenance/preloader/recovery state.

The live Steam account is still discoverable. Null active identity is the decisive guard; maintain it throughout the test.

## Root-controlled sequence

Close the rootless test normally. Then explicitly launch the already reviewed fixture:

```powershell
& 'G:/Projects/execs/.artifacts/native-isolation/Start-IsolatedExecs.ps1' -LaunchPrepared -CaseDirectory 'G:/Projects/execs/.artifacts/native-isolation/20260922-120750-inactivelibrary-ff33a080'
```

1. Confirm all three package codes in `launch.json` equal 15700 and WebView2 command lines point into this case.
2. Open Profiles, then Import. Pick the copied `imports/review-multiple-huds-v018.zip`. Inspect both choices and notes; selection changes are local review state. Cancel the review.
3. Open Profiles and the action dots for **QA inactive - no HUD**. Choose Delete profile, inspect the inactive-only confirmation, and confirm deletion. Preserve the remaining profile.
4. Close normally. Compare the baseline with the fixture. The synthetic root, import ZIP, remaining profile payloads/manifest and shared base must be byte-identical. The deleted UUID tree should be absent, the index should contain one remaining profile with active id null, and no import staging/deletion journal should remain.

Do not click profile names/Switch, Save current, New profile, import confirmation, Launch TF2, update installation, or installation confirmation/change. Activating either fixture profile would reach production Steam/Cloud write paths despite the synthetic root. A changed binary requires a new prepared case; inactive-library cases cannot be replayed after launch.
