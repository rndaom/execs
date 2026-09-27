# Native inactive import, export and reopen

This is a bounded extension of the inactive-library case. Only the root agent operates the native app. Preparation and validation scripts do not launch it. The active-profile/Cloud limitation remains as documented in [active-fixture-analysis.md](../active-fixture-analysis.md).

The separate `InactiveImport` scenario seeds two inactive profiles from retained actual public-v0.1.8 library exports, copies the actual multi-HUD export into the case, and records the exact executable and original file hashes. The source ZIP is SHA-256 `77cc3c6f9ded610e56084f1ef7ddd410defe6f04162303054a0cee274d234727`, emitted by public tag `v0.1.8` at `85aaf6bc0dd28f43351d4cb5cdb62502737688d5`. It contains ten payloads, including the original `fixturehud` record/options, two HUD roots, and managed option CFG bytes. The explicit choice for this case is `secondhud`.

Import confirmation creates a new library profile with activation disabled (`core/src/zip.rs:309`). The accepted CFG bytes and original HUD record remain exact; `hudSelectedRoot: "secondhud"` and `hudReviewPending: true` record the chosen owner and the deferred options review. `launchSyncPending: true` is also expected import metadata. These are inert while `activeProfileId` stays null; no switch, ownership repair, projection or retry is part of this run. Imported preloader selections must be present and empty. Export reads this new inactive profile and writes only the explicitly named private ZIP. On startup, absorb returns before live/Cloud reconciliation when no profile is active (`core/src/absorb.rs:220`), and `SettingsHost` stays unmounted (`src/lib/settings-ui.ts:47`).

PowerShell 7 is required, matching the existing bundled launcher host. Both executable preparation and each pre-launch audit bind the exact binary hash. If the candidate is rebuilt, prepare a fresh case; a previous case cannot be moved to the new executable.

```powershell
& 'G:/Projects/execs/.artifacts/native-isolation/Start-IsolatedExecs.ps1' -Scenario InactiveImport -PrepareOnly
```

The printed case contains `request.json`, `inactive-import-plan.json`, the original library baseline and sources. Validate it before any launch:

```powershell
$fixtureCase = '<printed case directory>'
& 'G:/Projects/execs/.artifacts/native-isolation/Validate-InactiveImport.ps1' -CaseDirectory $fixtureCase -Phase Initial -ReportPath (Join-Path $fixtureCase 'initial-import-integrity.json')
& 'G:/Projects/execs/.artifacts/native-isolation/Start-IsolatedExecs.ps1' -CaseDirectory $fixtureCase -LaunchPrepared
```

The launcher preserves the existing Explorer/unpackaged-process checks, private app-data and WebView2 paths, no-existing-execs check, and normal-policy behavior. It repeats the full initial data audit in the child immediately before launch. Inspect `launch.json` and WebView process paths before UI work.

The native session has these actions only:

1. Open Profiles → Import and choose `<case>/imports/review-multiple-huds-v018.zip`. Inspect the native review, explicitly select `secondhud`, then confirm trust/import. Do not switch to the result.
2. Export only the newly imported **Actual public v0.1.8 export** profile through its existing Actions menu. In the native Save dialog, use exactly `<case>/exports/native-multiple-huds-v018.zip`; the destination must be new.
3. Close the app normally and wait for the helper's `exit.json`. Run:

```powershell
& 'G:/Projects/execs/.artifacts/native-isolation/Validate-InactiveImport.ps1' -CaseDirectory $fixtureCase -Phase Exported -ReportPath (Join-Path $fixtureCase 'post-import-export-integrity.json')
```

The validator requires the exact native executable/session identity and zero exit status. It verifies every pre-existing manifest, payload, blob, setting, input ZIP and synthetic live file. Only the index may change among pre-existing files; its old profile summaries must remain exact and it must add precisely one UUID. The new manifest must match all expected records, both preserved HUDs, empty preloader and the deliberate ownership metadata. Every imported payload is checked against the old export hash; every exported payload is checked against those same source bytes. The directory inventory rejects orphan/recovery/staging directories, with one precise post-import exception: an ordinary, exactly empty `profiles/blobs/sha256/.incoming` container. `core/src/blob.rs:62` leaves that container after removing its staged blob file; files, child directories and reparse points still refuse validation. The only accepted output file is the planned ZIP.

After that report passes, one reopen is allowed:

```powershell
& 'G:/Projects/execs/.artifacts/native-isolation/Start-IsolatedExecs.ps1' -CaseDirectory $fixtureCase -Resume
```

Resume requires the prior normal exit, the successful post-import/export report, the same executable, a fresh complete state audit, and an exact match to the report's byte snapshot. It archives first-session evidence in `import-export-session/` and refuses a second reopen. The child repeats the audit before starting. Inspect the inactive library and its three saved profiles, then close normally without performing another import, export or mutation. Validate persistence:

```powershell
& 'G:/Projects/execs/.artifacts/native-isolation/Validate-InactiveImport.ps1' -CaseDirectory $fixtureCase -Phase Reopened -ReportPath (Join-Path $fixtureCase 'post-reopen-integrity.json')
```

The reopened session must follow the recorded first exit and preserve every post-import/export fixture byte. No app activation, HUD ownership repair, profile deletion, settings change, install change, Save current, new-profile wizard, TF2 launch or update installation is included. Real Steam discovery may still run read-only; these helpers do not claim that Windows `APPDATA` redirects it.

The tracked reproduction files and their `.artifacts/native-isolation/` working copies must match. `Test-InactiveImportFixture.ps1` performs data-only validator tests in a separate directory, clearly named `inactiveimport-validator-selftest`. It authors sample import bytes and uses the retained current-core re-export to test the validator; it never creates a native launch or exit record. Its pass is helper verification, not native import/export/reopen evidence.

Preparation checkpoint: `.artifacts/native-isolation/20260922-131412-inactiveimport-65ffd4ab` was prepared without launch for executable SHA-256 `E09343CC38637D2B99D2FEE1843C3FA15FA73B741218B77EFC2CB0FA9DAA1A65`. Fourteen data-only validator checks passed in `20260922-131619-inactiveimport-validator-selftest-b3c861c8/validator-selftest.json`. Native results are intentionally not claimed by this preparation document.

## Observed export destination and explicit artifact correction

The root-operated first native session (PID 10656, normal exit at `2026-09-22T17:30:15.3568337Z`) imported the profile with the explicit `secondhud` choice. The root reported entering the intended absolute Save path, but the resulting file was actually `<case>/imports/Actual public v0.1.8 export.zip`. Its filesystem creation time was `2026-09-22T17:29:46.5349237Z`, during that session; the original initial snapshot contained no such file. No claim is made that the native picker accepted the intended destination, nor that source inspection establishes the precise UI automation event that failed to commit it.

Read-only inspection verified that actual 3302-byte ZIP, all ten original payload hashes, its portable records and `hudSelectedRoot: "secondhud"` / `hudReviewPending: true`. Its SHA-256 was `BE5F3472308C176CB88F6C604D1592C275EED58B9602AC65F4DAADF57E7AE552`. Pending HUD review does not prevent export: `core/src/zip.rs:185` reads the profile and exports that metadata. The original input ZIP remained `77CC3C6F9DED610E56084F1EF7DDD410DEFE6F04162303054A0CEE274D234727`.

After explicit root authorization, `Relocate-InactiveExport.ps1` verified both resolved endpoints were in this same case, required the intended export destination to be absent, required execs to be closed, verified the recorded native session and actual ZIP, and performed one `Move-Item -LiteralPath` to `<case>/exports/native-multiple-huds-v018.zip`. `export-relocation-before.json` and `export-relocation.json` retain the original path, destination, timestamps, native session and identical before/after SHA-256. The move changed no other fixture file; all other 30 files were exact. It is an artifact-location correction, not evidence of successful selection of the original intended Save destination.

The first native import also created an empty `profiles/blobs/sha256/.incoming` directory, which the original validator incorrectly rejected. Source review of `core/src/blob.rs:62` established this as the normal empty container left after staged-file cleanup. The validator now accepts only that exact ordinary empty container after import; nonempty, non-directory and reparse cases remain refused. Seventeen data-only checks passed in `20260922-133354-inactiveimport-validator-selftest-3f4bcb02/validator-selftest.json`, including empty acceptance and nonempty/non-directory refusal.

After relocation, `post-import-export-integrity.json` passed: 31 files matched the expected state, all 19 pre-existing non-index files were unchanged, the existing index summaries remained exact, one inactive profile was added (`0e68d2e0-eb45-47da-8324-3bbdb5ef411e`), and all imported/exported payloads matched. A separate read-only `Assert-InactiveImportReopen` passed with the same executable and `activeProfileId: null`. This records first-session data qualification and readiness for the root-owned reopen; it does not claim that the reopen has occurred.

The subsequent root-owned reopen completed and exited normally at `2026-09-22T17:37:04.8759279Z`. The completed `post-reopen-integrity.json` passed at `17:37:13.6616093Z`, confirming all 31 post-export files exact and all three profiles inactive. The [six-capture native archive](../import-export-follow-up/README.md) retains both sessions, payload comparisons and relocation provenance for the historical E093 executable. Those completed reports were archived without rerunning a binary-bound validator after rebuilding began.
