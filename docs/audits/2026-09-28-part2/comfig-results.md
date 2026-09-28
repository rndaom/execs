# Comfig issues 3 and 9: implementation and verification

## Result

Issue 3 uses the issue's expressly permitted interim safety gate. It does **not** implement or claim a vanilla-to-mastercomfig cfg migration. The disposable reproduction shows the supported package loader takes priority while the vanilla autoexec remains outside overrides. Native preset/module/addon/package/custom-folder writes now refuse a vanilla profile; download and picker commands preflight before their expensive work. The pane selects no preset and explains why changes are unavailable. Existing autoexec, class cfgs and managed settings remain byte-for-byte intact.

For supported Comfig profiles, the guard checks the saved loader and active live loader, then verifies saved official package bytes and active live package bytes against the manifest. A replacement base with the same loader shape cannot receive an addon selected for the old base.

Issue 9 records an optional release tag and exact official package hashes inside the same profile transaction as wizard creation, package updates and addon changes. Unknown older profiles stay readable and show an unknown version; adding an addon requires an explicit package update first. Removing addons remains possible and retains the release identity for remaining packages. Native ZIP schema 1, schema 2 with locally built Viewmodels, and profile duplication retain valid release records. A changed package hash invalidates its recorded identity.

Addon downloads use the recorded release's tag endpoint, verify the returned tag, exact canonical release URLs, published SHA-256 digests and every retained package identity, then fetch only missing addons from that release. They never silently update the base. Package updates download one complete release and update only the selected profile. The pane displays the recorded version, checks the latest release, indicates a strictly newer stable version and offers retry after failures. Profile/package changes discard late check results; native download commits also recheck the profile and package state.

## Research and review

- Official install instructions: <https://docs.comfig.app/latest/setup/install/>. Startup/class files belong in overrides and moved helper exec paths require adjustments; this supports refusing a partial automatic move.
- Official customization instructions: <https://docs.comfig.app/latest/customization/custom_configs/>. Setup-hook preset selection remains unchanged.
- Existing package fetch protections and journaled profile mutation/creation are reused; core remains network-free.
- Plan approved by the coordinating agent before implementation. Independent reviewer approved the final implementation, metadata portability, tag/hash pinning and native byte guards without blocking findings.

## Verification

- Comfig UI/helper, SettingsHost and import-outcome targeted suites: 52 tests passed.
- MutationDrafts suite: 12 tests passed, including failed Comfig selections remaining retryable without leaking into later payloads. Its Comfig fixture now declares a supported Comfig profile.
- Native core Comfig-filtered final run: 34 unit tests and 1 integration test passed. This includes refusal of a changed live base that still has the same loader shape, the vanilla transition reproduction, blocked writes preserving cfg bytes, wizard release capture, duplicate/native ZIP round trips, schema-2 Viewmodels round trip and existing transaction rollback coverage.
- Host package-fetch suite: 3 passed; the opt-in live-network test remained skipped. Covers exact release/tag matching, retained package hashes, canonical URL checks, published digest requirements and downloaded digest/VPK checks.
- TypeScript no-emit and Biome checks passed during implementation. The coordinating agent owns final combined full-suite/platform checks and visual verification.

Tests use disposable fixture directories. No player setup was mutated, TF2 was not launched, and no release/version/tag/commit/push was performed by this workstream.
