# Development package qualification proposal

2026-09-22. Source inspected at `5bda798115b936d5d6f796d42614a0955f6748bf`. **Proposal only: no workflow, installer, desktop process or release operation was run for this report.** No issue acceptance or status changes. The current package fixture evidence remains [separately recorded](README.md).

Add one development workflow with two disposable GitHub-hosted jobs: Windows NSIS, and Linux AppImage plus Debian. Build ordinary optimized packages without updater signatures, install the actual previous public packages, and exercise the candidate through its installed native UI. This can qualify direct package installation, upgrade preservation and a bounded native profile round trip. Signed self-update and the real updater UI remain separate requirements.

## Why the existing entrypoints are insufficient

- [release.yml](../../../../../.github/workflows/release.yml) is unsuitable even with `workflow_dispatch`: its build action creates or updates a GitHub draft release; verification uploads assets and edits the release. Only its final publication step is tag-only.
- [smoke-packages.mjs](../../../../../scripts/smoke-packages.mjs) requires a candidate `.sig`, invokes the signed updater probe, and accurately leaves `renderedWebviewUsable`, `previousVersionUiReadAndExport` and `candidateUiImportAndSwitch` unverified. A surviving process or window title cannot close those gaps.
- [linux-native-smoke.yml](../../../../../.github/workflows/linux-native-smoke.yml) already supplies a read-only, hosted-runner native automation pattern, but builds with `--no-bundle`. Its harness uses a specific inactive-library fixture and the build-tree executable. Running it unchanged would not establish installed-package behavior.
- [releaseVersion](../../../../../scripts/release-version.mjs) requires an actual candidate changelog heading. Development still has `[Unreleased]`; do not freeze it, bump a version or weaken release validation to run this proposal. The restored published history and [repository-history regression](../../../../../scripts/release-guards.test.mjs) now derive `0.1.8` correctly when that freeze is rehearsed in a temporary copy.

## Smallest implementation

Create `.github/workflows/development-package-smoke.yml`, a dedicated `scripts/smoke-development-packages.mjs`, and a behavioral test file for its new containment, stage validation and artifact selection. Reuse [package-smoke-fixture.mjs](../../../../../scripts/package-smoke-fixture.mjs), release-version/asset helpers and the external [NativeWebDriver client](../../../../../scripts/linux-native-webdriver.mjs). Add small platform dialog helpers only for native Open/Save controls. Do not fork the application or introduce test IPC, mock bridge responses, relaxed CSP, a debug frontend or a replacement updater key.

Keep `smoke-packages.mjs` and its signature requirement intact. Coordinate any shared native-driver refactor with the Linux native owner; the package harness should accept explicit installed application paths rather than repurpose the existing whole Linux scenario.

The workflow should use:

| Setting | Proposed value |
| --- | --- |
| Events | Same-repository `pull_request`, narrowly filtered to the workflow, harness and package inputs; optional `workflow_dispatch` |
| Jobs | `windows-latest` and `ubuntu-22.04`; no self-hosted runner |
| Permissions | `contents: read`; checkout `persist-credentials: false`; no signing secret or write token |
| Concurrency | Its own development-package group per PR/ref; cancel stale runs |
| Limits | 60-minute job and bounded installer/driver/dialog deadlines; fail with retained evidence |
| Artifacts | Fixture-only receipts, hashes, logs, screenshots, exports and result JSON; `if: always()`, seven-day retention |

Do not add tag triggers, `pull_request_target`, a release-workflow call, `tauri-action` release arguments, a feed upload or publication step. Read public previous-release metadata/assets using a read-only token. Retain evidence rather than offer these unsigned packages as user downloads. GitHub manual dispatch requires the workflow on the default branch, so the same-repository PR trigger is the initial branch-testing route. Each hosted job receives a fresh VM. [GitHub workflow syntax](https://docs.github.com/en/actions/reference/workflows-and-actions/workflow-syntax), [hosted runners](https://docs.github.com/en/actions/how-tos/write-workflows/choose-where-workflows-run/choose-the-runner-for-a-job).

Use the existing Node 24, pnpm, locked Rust build and Linux build dependencies. Run the existing third-party notice check, Linux notice generation and before-bundle host-library hook. Write this sole config override under `RUNNER_TEMP`:

```json
{"bundle":{"createUpdaterArtifacts":false}}
```

Proposed build commands, with an absolute path to that temporary file:

```text
pnpm --filter @execs/desktop tauri build --ci --bundles nsis --config <temporary-config> -- --locked
pnpm --filter @execs/desktop tauri build --ci --bundles appimage,deb --config <temporary-config> -- --locked
```

Keep the current product version, identifier, production frontend, capabilities, updater endpoint/key, static MSVC CRT and bundled AppImage media configuration. Record the override and effective build inputs; these are unsigned development artifacts, not the eventual signed artifact hashes. Tauri supports additional merged configuration and explicit bundle selection. `--no-sign` is not a substitute for specifying the updater-artifact setting. [Tauri CLI](https://v2.tauri.app/reference/cli/), [bundle configuration](https://v2.tauri.app/reference/config/#bundleconfig).

## Baseline and isolation before any installation

1. Record `git rev-parse HEAD`, event/head/merge identities, run attempt, tool versions and runner image. Attribute evidence to the checked-out commit, including a PR merge commit if that is what was built.
2. Validate all four current version files. In a temporary changelog copy only, replace the Unreleased heading with that version when no current version heading exists, then use `previousReleaseVersion`. Require the result to match `publicProfileFixture.exporterTag`. Also check the latest public release metadata; fail for review if the public baseline has advanced. Never just rename the fixture's exporter tag.
3. The read-only release lookup on 2026-09-22 confirmed published, non-prerelease [v0.1.8](https://github.com/rndaom/execs/releases/tag/v0.1.8), published `2026-09-21T02:26:18Z`. Its actual assets are `execs_0.1.8_x64-setup.exe`, `execs_0.1.8_amd64.AppImage` and `execs_0.1.8_amd64.deb`, each with a `.sig`. Resolve actual asset metadata rather than inventing filenames; extend the existing resolver for the Debian case. Download immutable-tag URLs and verify their signatures with the existing public key before execution. This needs no private signing key.
4. Refuse unless `CI=true`, `GITHUB_ACTIONS=true` and `RUNNER_ENVIRONMENT=github-hosted`. Create a fresh contained child of absolute `RUNNER_TEMP`, refusing reuse, links and redirected roots. Retain the current checks for existing execs/Steam/TF2 processes and every Windows registry/Linux HOME/XDG/Flatpak/Snap Steam-discovery candidate. Refuse an existing product installation before the test creates one. [GitHub runner variables](https://docs.github.com/en/actions/reference/workflows-and-actions/variables).
5. Give every package scenario separate fixture app data and a disposable TF2 tree. Isolate the child application's APPDATA/LOCALAPPDATA or HOME/XDG directories and temporary paths; use an environment allowlist where practical. Check both original and child Steam discovery roots. Changing environment variables alone is not Steam Cloud isolation. There is no Steam account, real install or game launch in these jobs.

Reuse the existing fixture's two profiles, 12 manifest payload references and 11 stored payload files, including shared data, cfgs, a mod and an inactive HUD. Its manifests and payload bytes originate in the actual tagged exporter; its library index, identities, settings and synthetic install are authored. Keep that distinction in result provenance. The existing old/current core fixture pass does not establish an installer-created library.

## Package matrix and exact transitions

| Case | Installation and transition | Required evidence |
| --- | --- | --- |
| Windows NSIS | Install the actual public 0.1.8 NSIS with `/S` and last argument `/D=<owned-install-dir>`. Run its installed `execs.exe`, close it, then execute the candidate NSIS into that same installation. | Both installer hashes and exits; old/new executable version and hash; expected notices; native UI round trip below. Installed candidate bytes must match the packaged build. This is a direct NSIS upgrade. |
| Linux AppImage | Make the actual old AppImage executable at an owned portable path. Run and close it. Replace that path with the complete candidate AppImage, preserving fixture app data, then run and reopen it. | Old/new image hashes, native UI round trip, notices and existing host-Wayland packaging check. This is manual AppImage replacement, not updater self-installation. |
| Linux Debian upgrade | Install the actual old `.deb` with the package manager on the fresh VM; run `/usr/bin/execs`, close, then install the candidate `.deb` over it. | Package-manager versions/exits, installed executable hash, notices, native UI round trip. Record package-manager upgrade separately from AppImage. |
| Linux Debian first install | After stopping owned processes, remove only the tested `execs` package, verify absence, and install the candidate with a new fixture case. | Fresh installation and usable native UI, independent data preservation and restart. The prior upgrade result alone is not first-install evidence. |

The Linux job can perform its cases sequentially; separate app data prevents one case's imports/settings from satisfying another. Package-manager system writes are confined to the disposable VM. Before any removal, verify the exact owned package or contained path. Windows installer-created restarts must be identified by executable path/PID and stopped before starting another automation session.

Use normal AppImage execution with FUSE (`libfuse2` on Ubuntu 22.04) under Xvfb and a D-Bus session. Extraction is appropriate for inspecting package contents; an extract-and-run fallback must be a separately labeled result and cannot silently satisfy the normal AppImage launch row. AppImage is a portable executable rather than a system package. [Tauri AppImage distribution](https://v2.tauri.app/distribute/appimage/), [AppImage FUSE guidance](https://docs.appimage.org/user-guide/troubleshooting/fuse.html).

## Native UI and preservation contract

Install pinned external `tauri-driver` as in the Linux workflow. Linux also needs `WebKitWebDriver`, Xvfb, D-Bus and external dialog input tooling. Windows needs Microsoft Edge Driver matched to the installed **WebView2 runtime**. Record driver/runtime versions and session capabilities. Reuse W3C native interactions against the installed executable, without a browser-preview fallback. These drivers are external to the application. [Tauri manual WebDriver setup](https://v2.tauri.app/develop/tests/webdriver/manual-setup/), [Microsoft WebView2 WebDriver guidance](https://learn.microsoft.com/en-us/microsoft-edge/webview2/how-to/webdriver).

For each upgrade case, require the following sequence:

1. **Before upgrade:** the installed 0.1.8 app renders its real native frontend, reads the fixture's active profile, exposes the saved second profile, and opens a cfg in Files with expected text. Capture the native origin, expected UI and screenshot; merely detecting `__TAURI_INTERNALS__` is insufficient. Use the old app's Export action and its real Save dialog to save an explicit owned path. Verify the actual destination, archive structure, profile metadata and every payload hash independently.
2. Close normally and check the original library, settings and live tree with `assertPackageFixturePreserved`. The export sits outside those trees. Check preservation again after package replacement and after the candidate's first normal close/reopen. Allow only the existing explicitly enumerated additive defaults; never excuse unexpected absorption, dropped files or recovery residue.
3. **After upgrade:** the installed candidate shows both profiles and expected Files text, and responds to keyboard navigation. Import the exact ZIP produced by the old installed UI through the real Open dialog and review/confirm controls. Assert one new profile ID, no activation, empty imported preloader selections, exact payloads and unchanged original profiles/live projection. Do not substitute a core export/import call and label it a UI round trip.
4. Explicitly switch to the imported copy through the application, then close/reopen. Verify the selected ID, exact intended live projection, old profile/shared-payload preservation, Files readability and absence of incomplete journals/part files. This touches only the synthetic install; TF2 is never launched. Assert any expected launch-sync-pending state caused by the deliberately absent Steam account instead of inventing successful Steam synchronization.

Native Open/Save dialogs are outside the web DOM. A small Windows UI Automation helper and a Linux native-dialog helper are required; WebDriver element selection alone does not cover them. Verify dialog ownership, exact chosen path and resulting bytes. Retain requested and actual path evidence; a default-location export must fail the explicit-destination assertion rather than be silently moved to make it pass. Existing [Windows import/export evidence](../native-windows/import-export-follow-up/README.md) supplies useful path and preservation lessons, but its local results cannot be transferred to these installed packages.

The unchanged-preservation validator cannot be reused unchanged after an intentional import or switch. Add stage-specific expected-delta validation: only one imported profile/index addition, followed by the known switch projection and active ID, with unchanged existing payloads and exact source/export hashes. Test these validators with independent corruption, removal, extra files and wrong-ID mutations. Do not broadly whitelist the library or regenerate expected values from the application's mutated output.

A driver/OS-dialog failure is an automation capability failure with the UI row unverified, not a product pass. A genuine application failure after an on-target trusted action is a product failure. Retain the latest screenshot, native input trace, stderr, process exit and fixture comparison on either outcome. Do not relax assertions because the process still exists.

## Signing boundaries and remaining acceptance

| Check | Secrets needed | What this development run establishes |
| --- | --- | --- |
| Old public package authenticity | None; existing public key and public `.sig` | Authentic old package bytes before execution |
| New NSIS direct upgrade, AppImage manual replacement, Debian installation/upgrade | No updater or Windows signing key | Package mechanics, bounded native UI usability and fixture preservation |
| New artifact accepted by the production updater trust key | `TAURI_SIGNING_PRIVATE_KEY`, and password if configured | **Not established by unsigned candidates** |
| Existing signed updater-probe path, replacement hash and no-repeat check | A candidate signed by that production key | Separate future trusted-head qualification; do not call the probe with a fabricated signature |
| Real installed app's update click, dirty-draft/native-close handoff and stalled/failed update behavior | Correctly signed candidate plus a separately designed controlled feed/test route | Still open; example-probe success does not exercise the actual app UI lifecycle |
| Windows Authenticode/SmartScreen behavior | Separate Windows code-signing setup/certificate | Still open; updater Minisign signatures are not Authenticode |

Tauri requires updater signatures; ordinary bundle creation and direct installation are separable from that trust check. An ephemeral test key could test a synthetic chain, but changing the embedded key would not qualify the actual public 0.1.8 update path. Do not expose the production signing key to this new PR workflow. A future signed run can be designed without publishing a release, but needs its own trusted exact-head secret boundary. [Tauri updater signing](https://v2.tauri.app/plugin/updater/).

The existing [updater probe](../../../../../apps/desktop/src-tauri/examples/updater_probe.rs) uses a controlled feed and context overrides rather than driving the old installed app's normal update UI. Preserve that attribution. The Debian feed exclusion in [verify-release.mjs](../../../../../scripts/verify-release.mjs) remains a separate release-feed check; direct Debian upgrade must not be reported as a supported in-app self-update.

On successful execution, result JSON should report each package/scenario and native stage independently, including commit, package/executable hashes, old release provenance, authored-fixture provenance, actual export/import paths, payload counts, expected metadata deltas and reopen receipts. Keep `productionSignedUpdate`, `realUpdaterUiLifecycle`, `authenticode`, `SteamCloud`, `retailEngine`, broader distro/driver coverage and untested media codecs explicitly unverified. Screenshots alone do not qualify bundled media decoding. This bounded run advances RND-251; it does not close the issue or authorize a release.

## Handoff

The next concrete work is implementing this isolated workflow/harness and its mutation tests, then reviewing its exact diff before its first hosted execution. No product feature, version change, release-state mutation or local player-machine installation is needed. This report is the only file changed for this proposal.
