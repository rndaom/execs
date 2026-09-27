# Active Linux native fixture contract

Source review: `5bda798115b936d5d6f796d42614a0955f6748bf`, 22 September 2026. This extends the [Windows isolation analysis](../native-windows/active-fixture-analysis.md) using the existing GitHub-hosted Linux environment. It records a feasible test contract, not a completed native pass. No application, Steam or game was launched for this review or its data-only validator tests.

**A real active fixture is contained on this runner without a product override.** Linux Steam discovery uses only the child process's `HOME` and `XDG_DATA_HOME`; with all eight candidate paths absent, neither Cloud nor launch-option discovery can select an account. The first native batch should exercise Files with A active and B as an unchanged control. Switching and deletion are feasible separate follow-ups, with different explicit mutation allowances below.

## Isolation and seed

Retain the existing hosted-worker/process preflight and environment allowlist in `scripts/linux-native-smoke.mjs:71` and `scripts/linux-native-fixture.mjs:142`. Use a fresh ordinary direct child of canonical `RUNNER_TEMP`, private absolute `HOME`, `XDG_DATA_HOME`, `XDG_CONFIG_HOME`, `XDG_CACHE_HOME`, `XDG_RUNTIME_DIR` and `TMPDIR`, and the existing Xvfb/private D-Bus/WebKitGTK driver route. Do not inherit runner credentials, host app configuration or sandbox overrides. The production execs directory is exactly `$XDG_DATA_HOME/execs` (`core/src/settings.rs:84`). Resolve and check all fixture roots before each phase; refuse links, special files and out-of-fixture paths.

The eight paths to keep absent are `$XDG_DATA_HOME/{Steam,steam}` and these six children of `HOME`: `.local/share/Steam`, `.local/share/steam`, `.steam/steam`, `.steam/root`, `.var/app/com.valvesoftware.Steam/data/Steam`, and `snap/steam/common/.local/share/Steam`. Check their existing ancestors with `lstat`, including dangling links, before launch and after every phase. Discovery canonicalizes existing candidates (`core/src/finder.rs:218`, `:295`); no registry, system-wide Steam fallback or confirmed-install-derived account is used on Linux. With no candidate root, account selection has no input (`core/src/launch.rs:475`, `:488`, `:510`). No Steam directory or account is needed for this pass.

The new [`linux-native-active-fixture.mjs`](../../../../../scripts/linux-native-active-fixture.mjs) authors two small schema-1 Vanilla profiles and a synthetic confirmed install. A is active; B has distinct config/helper sentinel bytes and stays inactive. It copies no player files, historical profile metadata, Valve data or executable. A named mastercomfig VPK in the previous compatibility fixture is not a loader: current detection inspects its actual contents (`core/src/cfg_layer.rs:154`). Leftover `overrides` files are still preserved by inventory in either layer (`core/src/surface.rs:301`); the authored helper avoids implying that those files execute as mastercomfig settings.

The install contains `tf/steam.inf` with `ProductName=tf` and `appID=440`, a harmless `tf/cfg/config_default.cfg`, an empty `tf/custom` directory, and exact live copies of A's two owned files. Settings use the same canonical `tf2Root` with startup update checking disabled and motion `system`. The index contains both fixed valid UUIDs, names, creation/update timestamps, and `activeProfileId: A`. No interrupted or pending switch exists.

Each manifest has this minimal shape, with lowercase SHA-256 calculated from its exact UTF-8/LF payloads:

```json
{
  "schema": 1,
  "id": "<A or B UUID>",
  "name": "Native Files A",
  "tf2Root": "<canonical private fixture root>",
  "launchOptions": "",
  "launchSyncPending": false,
  "files": [
    { "path": "tf/cfg/config.cfg", "sha256": "<config hash>", "storage": "exclusive" },
    { "path": "tf/cfg/native-fixture.cfg", "sha256": "<helper hash>", "storage": "exclusive" }
  ],
  "hudRoots": [],
  "preloader": { "addons": [], "particleMods": [], "profileParticleMods": [] }
}
```

These fields follow `core/src/profile.rs:337`. Omit optional null/empty/false fields rather than creating unrelated serializer changes; `launchSyncPending: false` is required because an omitted legacy value defaults to true. A's config is `// owned native A config\nsensitivity 2.5\n`; B uses B/3.5. Each helper has 128 comment lines and a final sentinel. Line 80 contains a long comment and `SELECTION-A`/`SELECTION-B` for real horizontal scrolling and selection; every helper line is a harmless comment. No autoexec line references it.

There are **12 protected product files**: settings, index, two manifests, four library payloads, two live owned payloads, `steam.inf`, and `config_default.cfg`. There are no blobs, HUD/mod records, installed preloader, snapshots, journals, `.execs-part` files, orphan staging or game binaries. Browser/cache/runtime output may exist only in the already private environment; it is distinct from the exact execs and synthetic-install audit.

## Startup and Files expectations

The renderer really calls absorb on boot (`hooks/useProfileLibrary.ts:176`, `:210`). An active profile enters repair/classification (`core/src/absorb.rs:208`, `:230`), so matching library/live hashes are a prerequisite, not an optional convenience. Missing owned files, stray part files, ignored-pack records, old invalid ownership, live config drift and recovery journals can cause legitimate mutations (`:475`). Do not seed them for the clean Files pass. `cloudSyncPending` must be absent/false; no HUD review or preload selection is pending. With this seed, absorb has an empty changed/missing batch and returns without mutation (`:854`, `:880`); all 12 baseline file hashes must remain exact after the UI settles. Do not accept unexplained startup normalization as a new baseline.

SettingsHost loads the complete owned CFG snapshot and verifies profile identity before editing (`SettingsHost.tsx:217`). Wait for an editable native Files workspace and successful worker analysis; no synthetic IPC invocation, DOM-dispatched close event or forced Save enablement qualifies this flow. The ordinary Save command holds `WriteGate` and supplies current source identity (`src/commands/files.rs:68`). Core checks active profile, confirmed root, live/manifest cfg layer, exact library/live hashes and destination again before publication (`core/src/files_workspace.rs:170`, `:262`). The write uses the existing journaled mirror transaction (`core/src/apply.rs:202`).

| Phase | Exact allowed product change |
| --- | --- |
| Idle boot, unsaved typing, document/pane navigation, scroll/selection, close Cancel | None. All 12 file hashes remain at the latest accepted checkpoint. The draft exists only in the session. |
| Explicit Save | Only A's helper live/library bytes become the exact initial text plus `EXPLICIT_APPEND`; its manifest helper SHA changes; only A's summary `updatedAt` changes to current native-format UTC. All paths, counts, IDs, other manifest/index fields, config bytes, B and settings stay exact. |
| Dirty close Discard, then restart | No product changes from the explicit-save checkpoint. `DISCARD_APPEND` must never occur in any protected file. The new process loads the previously saved helper. |
| Dirty close Save and continue | Same four-file allowance as explicit Save, with the exact explicit-save text plus `CLOSE_SAVE_APPEND`. The native continuation must wait for Save before process exit. Restart must retain that checkpoint exactly. |

The native close listener intercepts the actual Tauri close request only after registration (`hooks/useNativeCloseGuard.ts:35`); editing is gated on that registration. Use the existing window's normal OS close request, preserve evidence that Cancel keeps the same native process open, and distinguish graceful guarded exit from driver cleanup/termination. Save/Discard/Cancel handling is in `hooks/useFilesExitGuard.tsx:29`, `:60`. Pane/document return should verify draft text, undo history, selection and both scroll axes without writing a settings control. No settings draft belongs in this Files-only batch.

Core may leave an **exactly empty ordinary** A `.mutation-data` container after Save (`core/src/profile.rs:677`); the later sweep may remove it (`:699`). This one optional directory is allowed only after a save. Contents, child directories, links, journals, part files or other added product paths are refused. A helper Save does not enter config's Cloud branch (`core/src/apply.rs:224`), does not add startup execs, and must not change either pending-sync flag.

The fixture exports `seedLinuxNativeActiveFixture(parent)`, `expectedActiveText(fixture, phase)`, `assertLinuxNativeActiveFixture(fixture, phase, stage)`, and `assertLinuxNativeActiveCheckpoint(fixture, checkpoint, stage)`. The three allowed phases are `original`, `explicit-saved`, `close-saved`; the result records all protected hashes. After each accepted save, use the returned checkpoint for subsequent no-op/Cancel/Discard/restart assertions so even semantically identical metadata rewrites fail. The focused [validator tests](../../../../../scripts/linux-native-active-fixture.test.mjs) model allowed output only in temporary directories: **11 passed on Windows**, including wrong-profile changes, partial publication, extra recovery state, nonempty staging, all eight Steam candidates and dangling discovery ancestors. These are validator tests, not Linux/native evidence.

## Feasible follow-ups with their own assertions

**Config Save:** the same absent-Steam boundary safely permits an explicit `config.cfg` save in a separate phase. It changes that config's two copies/hash and A's update timestamp. Core temporarily sets `cloudSyncPending`, rewrites the contained live config, finds no account, and clears the marker on success (`core/src/apply.rs:224–260`, `core/src/absorb.rs:162`). Final marker must be absent/false. This establishes the no-account local branch, not Cloud synchronization.

**Profile switch isolation:** use the same clean two-profile seed in a fresh case or after a fully checked saved checkpoint. First make a draft on A and cancel the switch guard: A stays active, the draft remains visible and every product byte stays exact. Then deliberately Save or Discard through the guard and switch to B. B's live config/helper must exactly match B's library; A's library must retain the chosen saved state, with no A draft/text in B. A later switch back must restore A's bytes. Startup absorb should find no drift at either endpoint. Native switch validates target sources and empty preloader before remove/write (`core/src/switch.rs:176`); the empty selection/state returns no preloader work and needs no misc VPK (`core/src/preloader/profiles.rs:185`). Index active id becomes B only after projection; `pendingSwitch`/`interruptedProfileId` are absent after completion (`core/src/profile.rs:3213`).

An actual switch **does** set B's `launchSyncPending: true` and may update B's summary timestamp even with empty launch options (`core/src/switch.rs:299`, `core/src/profile.rs:4347`). With no Steam account, the native launch writer returns `NoAccount` before preparation/backup/write (`core/src/launch.rs:167`); the pending bit remains because only `Written` clears it (`core/src/switch.rs:331`). This is expected inert metadata, not a reason to create Steam data or to call the switch failed. On switching back, the same allowance applies to A; no payloads other than live projection or deliberately saved drafts may change. This is outside the first-batch helper validator's allowlist.

**Active/last deletion:** these need no Steam account or real install. In a fresh two-profile case, verify active-delete Cancel focuses safely and writes nothing; then choose **Keep the installed TF2 files** explicitly and confirm. Only A's index entry and its three library files disappear; `activeProfileId` becomes null, B/settings/all live files stay exact, and the deletion journal is absent after cleanup (`core/src/profile_delete.rs:188`). No preloader state is created when its list was empty (`core/src/preloader/apply.rs:1447`). For the sole-active-profile case, first delete inactive B, validate that only B's entry/tree disappeared, then delete the remaining active A with Keep. The initialized index remains with an empty profiles list and null active id; both live files and protected install files remain exact. Restart must not recreate either saved profile. Alternatively, the switch-first delete option combines the switch allowances above with removal of the now-inactive target; it is a separate case, not equivalent to Keep.

These follow-ups are source-derived feasible actions, not claims of coverage. Native screenshots, native origin/PID/binary hash and source revision, actual guarded exits, phase receipts and restart comparisons must be recorded before marking any corresponding qualification complete. The fixture does not qualify real TF2 execution, Steam Cloud, mods/preloader projection, Windows behavior, installer/updater paths or a later binary.
