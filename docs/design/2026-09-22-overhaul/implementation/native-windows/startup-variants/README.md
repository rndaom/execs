# Windows startup failure variants — RND-290

All four remaining Windows startup failure variants passed on September 22, 2026. Each showed the native error dialog before the main window opened, copied its complete diagnostic with Ctrl+C, and exited normally with OK. The root operator observed no main window or console; every recorded WebView2 process snapshot was empty. An independent read-only check confirmed that all private settings and marker bytes were unchanged and no profile library appeared.

This is a bounded native Windows result. It does not qualify the installer, Linux dialog, screen-reader speech, or other application flows. These four captures are separate from the earlier 24 native captures and the 11 [zoom and preferences follow-up captures](../zoom-follow-up/README.md).

## Exact build and launch context

- Executable: `apps/desktop/src-tauri/target/release/execs.exe`, product version `0.2.0`, 23,442,432 bytes.
- SHA-256: `7D3BBA6B25B6FEAD1EB0CD1E63E34EFA93BE5E2F46974F355987F847BC53817D`.
- Built at `2026-09-22T17:41:00.2757363Z` from commit `6ff64004c4366084d997dba25a9076f61f46fb71`. Later frontend commits were not in this executable.
- Launches used the existing Explorer desktop's `Document.Application.ShellExecute`, then the bundled PowerShell 7.6.5 host under its normal `RemoteSigned` policy. Explorer PID 30156, all four helpers, and all four app processes returned `GetPackageFullName = 15700` (unpackaged).
- The executed [launcher snapshot](reproduction/Start-IsolatedExecs.ps1) has SHA-256 `C4198DAB6ED06553788BA0FB49A70D205007BC5DFBB1B000D284A6BB5EACA242`. It adds only disposable fixture variants to the earlier [local QA launcher](../reproduction/Start-IsolatedExecs.ps1); no product hook or execution-policy override was added.

## Native outcomes

| Variant and capture | Private marker bytes | Expected and observed reason | App / helper PID | Normal exit UTC |
| --- | --- | --- | --- | --- |
| [01 Unset APPDATA](01-unset-appdata.jpg) | None | `%APPDATA% is unset or relative`; state location explicitly unavailable | 9136 / 16028 | `18:12:18.3533003Z` |
| [02 Mismatched token](02-mismatched-token.jpg) | `launching-tf2`: `1026\n` | `found mismatched maintenance state at` the complete private marker path | 24480 / 416 | `18:13:41.8081392Z` |
| [03 Multiple markers](03-multiple-markers.jpg) | `launching-tf2`: `1281\n`; `steam-verification`: `1538\n` | `found more than one active maintenance operation` | 17484 / 600 | `18:15:11.1998320Z` |
| [04 Unreadable marker](04-unreadable-marker.jpg) | `launching-tf2`: `1281\n`, held with `FileShare.None` | `could not read the maintenance state at` the complete path, followed by Windows error 32 | 35736 / 4076 | `18:16:40.4057367Z` |

Every exit code was 0. The version, full state location where available, exact failure reason, issue-report URL, and instruction to retain recovery files were present in the native clipboard copies: [01](01-unset-appdata.clipboard.txt), [02](02-mismatched-token.clipboard.txt), [03](03-multiple-markers.clipboard.txt), [04](04-unreadable-marker.clipboard.txt). The OS dialog visually ellipsizes some long paths; Ctrl+C retained them in full. Matching `.uia.txt` files retain the accessible text observed by the operator; no speech output was tested. The first pre-activation screen was stale and was not archived; the accepted screenshots show the activated native dialogs.

The unreadable marker was locked at `18:15:39.2585624Z`, before the `18:15:39.272` launch. The helper held the private read handle until the app exited, then released it at `18:16:40.3972036Z` before writing the exit receipt. Its retained marker remained readable after release with its original hash. No ACL was changed.

## Isolation and retained bytes

Every case began with an empty confirmed TF2 root, startup update checks disabled, system motion, and no profile library or active profile. The child helper isolated APPDATA, LOCALAPPDATA, XDG paths, TEMP/TMP and `WEBVIEW2_USER_DATA_FOLDER` under its own case. No real player library, confirmed install, Steam registry setting or Cloud file was used as a fixture.

The unset-APPDATA case removed that key only from the unstarted execs `ProcessStartInfo.Environment`. The helper retained its private APPDATA; the caller and Explorer environment were unchanged. The [Windows data-directory resolver](../../../../../../apps/desktop/src-tauri/core/src/settings.rs) refuses missing APPDATA without a KnownFolder or working-directory fallback. The [startup guard](../../../../../../apps/desktop/src-tauri/src/lib.rs) returns before constructing Tauri, discovering Steam, starting pollers or reading profiles. Installing the panic hook performs no disk write; its callback also skips disk logging when the directory cannot be resolved. The [native error reporter](../../../../../../apps/desktop/src-tauri/src/startup_error.rs) uses the OS dialog and stderr. These boundaries made this variant safe to run; its launch record confirms `appDataEnvironmentPresent: false` and `appData: null`.

The other three variants use the private APPDATA. Marker reads are bounded and validate the operation byte before any main-window setup. `1026` names Steam verification in the launching marker; `1281` and `1538` are individually valid tokens for the two different operations. Reading either failed state does not clear recovery markers.

The [independent post-run validation](metadata/native-validation.json) checked exact app-data inventory, settings hashes, every original/current/exit-record marker hash, absence of a profile library, package identity, normal exits, and equality between stderr's full diagnostic and each native clipboard copy. It did not infer window visibility from file records. The earlier [preparation validation](metadata/preparation-validation.json) also checked the child-only environment removal and a private read-denial probe before any product launch.

| Retained fixture content | Exact source SHA-256 |
| --- | --- |
| Rootless `settings.json`, all four cases | `DE8265F69E31FB253021A652776040F041000BB1BA6C7F75EE66F8BD1CD08A85` |
| Mismatched `launching-tf2` | `9C79ABE04F020B049757B7C73B30AC90D4C487EB536C4BFEB8FDDCEB6AB1361B` |
| Valid `launching-tf2`, multiple and unreadable cases | `ED399C832CEBED03A0A000C60140D0A463016EF928B4ADFB8915C3385C83459E` |
| Multiple case `steam-verification` | `09A844541B3F307BD54A74C6326A6401B131EFA25018388B3E6A60DE3B4C40F4` |

## Executed local fixtures and reproduction

These are completed, disposable local fixtures beneath `G:\Projects\execs\.artifacts\native-isolation\`. The launcher refuses replaying an already launched prepared case.

| Variant | Case directory and archived request |
| --- | --- |
| UnsetAppData | [20260922-140805-startup-unsetappdata-a342d11b](metadata/20260922-140805-startup-unsetappdata-a342d11b/request.json) |
| MismatchedToken | [20260922-140806-startup-mismatchedtoken-2256bd28](metadata/20260922-140806-startup-mismatchedtoken-2256bd28/request.json) |
| MultipleMarkers | [20260922-140806-startup-multiplemarkers-69512509](metadata/20260922-140806-startup-multiplemarkers-69512509/request.json) |
| UnreadableMarker | [20260922-140806-startup-unreadablemarker-569b15f9](metadata/20260922-140806-startup-unreadablemarker-569b15f9/request.json) |

For a future explicitly requested rerun, first prepare a fresh case with the current helper and selected variant. Preparation does not launch the application. Review the printed case path and pinned binary hash, then launch that one case:

```powershell
& 'G:/Projects/execs/.artifacts/native-isolation/Start-IsolatedExecs.ps1' -Scenario StartupError -StartupVariant UnsetAppData -PrepareOnly
& 'G:/Projects/execs/.artifacts/native-isolation/Start-IsolatedExecs.ps1' -LaunchPrepared -CaseDirectory '<fresh absolute case path printed by preparation>'
```

Use `MismatchedToken`, `MultipleMarkers`, or `UnreadableMarker` for the other variants. Run one at a time with no other execs process. Activate the native dialog before capture, copy the full message, verify no main window/console, then dismiss with OK and wait for `exit.json`. The unreadable variant manages its own private handle; do not add another lock or terminate that helper before closing its recorded app normally. Normal completion and the helper's `finally` path release the handle after app exit. Keep all original markers in place.

The [read-only validator](reproduction/Validate-StartupVariants.ps1) reproduces the retained-record and byte comparisons for these four completed fixtures:

```powershell
& 'G:/Projects/execs/docs/design/2026-09-22-overhaul/implementation/native-windows/startup-variants/reproduction/Validate-StartupVariants.ps1'
```

## Archive provenance

[Archive provenance](metadata/archive-copies.json) distinguishes each original source hash from its archived hash. Executed requests, bootstrap/launch/exit records, stderr, empty stdout, WebView process snapshots, lock receipts and capture text are retained. JSON and text are normalized to UTF-8 without BOM, LF and a final newline when nonempty; JSON is formatted with Biome. Normalized text is not claimed byte-identical to its source. Raw marker copies and accepted JPEGs remain byte-identical. The original source settings bytes remain in each local `fixture-originals` directory; the archived JSON settings copy is formatted and retains its separately recorded source hash. No runtime cache, executable or real player data is included.
