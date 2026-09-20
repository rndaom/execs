# 0.1.7 release

The owner authorized release on September 20, 2026. Both prepared PRs passed
their final CI. Merge, immutable tag creation and tagged-workflow publication
are now authorized; their outcomes are recorded after verification.

Implementation, native and signed package qualification are complete within the
recorded limits. Final PR-head CI is required before marking the PRs ready.
The private installers come from [candidate run 35491010492](https://github.com/rndaom/execs/actions/runs/35491010492)
at `6ecbcc0`. Linux package checks passed; Windows installation/updating passed
before its worker probe failed to attach. WebView2 150+ ignores environment
debugging overrides for elevated hosts. The [private Windows recovery workflow](https://github.com/rndaom/execs/actions/workflows/windows-candidate-worker.yml)
must pass the same signed installer with an app-specific disposable-CI policy,
then verify both signed assets/feed and record the original build plus recovery
run in the draft's `release-commit.json`. A failed original run is not described
as successful. The complete recovery [run 35493043167](https://github.com/rndaom/execs/actions/runs/35493043167)
passed both jobs. [Package evidence](audits/2026-09-20-0.1.7/packages/README.md)
records exact hashes and separates the original build from its recovery.
Later preparation commits contain qualification harnesses and evidence only.
The original preparation created no release tag or public release.

## Scope and baseline

The September 19 owner request authorizes all 13 records in Linear's 0.1.7
milestone, parallel implementation, verification and pull requests. The Files
workspace is the bounded, compatible patch addition recorded in that milestone.
The candidate starts from maintenance commit `0f4370b`, which contains public
`v0.1.6` (`871abd751d278ca5105b64e9cfe3ee9e7f3067bb`) and its publication
evidence. Unreleased Inventory and profile-owned preloader work are excluded.

| Workstream | Issues | Required evidence |
| --- | --- | --- |
| Profile reconciliation | RND-247 | Accepted removals, partial removal, Keep/Restore, unreadable inventory, dash peers, export/import and switching |
| Files workspace | RND-228, RND-313 | Editor layout, navigation, document state and standard editing interactions |
| TF2 language support | RND-314, RND-315, RND-316 | Sourced offline catalog, accurate personal/import policy, exact spans and argument diagnostics |
| Draft and save integrity | RND-317, RND-321 | Retained drafts, native conflict guards, safe new cfg creation and transaction recovery |
| Authoring assistance | RND-318, RND-319, RND-320, RND-322 | Revision-bound background analysis, completion, offline reference and ownership/execution context |
| Qualification | RND-323 | Windows/Linux native workflows, accessibility, performance, packaged worker/CSP and previous-public compatibility |

## Release gates

- [x] All issue acceptance criteria mapped to implementation and evidence
- [x] Frontend tests, Biome and production build
- [x] Windows/Linux Rust format, Clippy and workspace tests
- [x] Actual public 0.1.6 export/import and exact-byte round trip
- [x] Supported window sizes, zoom, keyboard, screen-reader observations and Linux IME; limits below
- [x] Novice and experienced Files workflows, separated from native persistence tests
- [x] Lock, external conflict, failed write and transition regressions
- [x] Offline help and measured native responsiveness
- [x] Four version files, Cargo lockfile and 0.1.7 changelog agree

Tagging, merging release PRs and publishing follow the owner's release request.
Passing fixture checks does not imply unperformed native or retail-game checks.

The machine-verifiable gates are the original candidate's Windows/Linux
installer and updater checks, actual packaged worker/CSP including the Windows
recovery, both-platform signature/feed verification, and green CI on both PRs.
Their linked GitHub runs are the authoritative
results; a queued, failed or cancelled run does not satisfy a gate. The publish
job stays skipped; the recovery workflow has no publish job. Product code is unchanged after `4e5fb39` on maintenance
and `9dcb51b` on the forward-port.

## Qualification limits

Both native engine jobs passed [run 35490611803](https://github.com/rndaom/execs/actions/runs/35490611803).
Windows NVDA spoke editor, completion, full numeric warning, selection, save and
read-only state. Linux Orca spoke editor, completion, problem location/selection,
Japanese IME text and read-only instructions. Orca 42 did not speak the full
warning or save status in the bounded follow-ups; its WebKitGTK script lacks
the relevant live-region child-add handler. These observations are explicitly
retained in [the native evidence](audits/2026-09-20-0.1.7/qualification/README.md),
not represented as complete screen-reader certification. Windows Japanese IME
was not exercised. Normal editing and representative analysis meet the proposed
performance targets on both named runners.

The final graph-link correction has focused tests and an independent browser
visual/navigation pass after the native measurements. Generic engine argument
arity/key validation is not claimed beyond the sourced catalog constraints.

## Research

The [Files audit and plan](https://linear.app/rndaom/document/files-workspace-deep-audit-research-and-017-rework-plan-73e3e612b655)
defines acceptance. The existing [release playbook](RELEASE.md) and
[0.1.6 evidence](release-0.1.6.md) define maintenance, forward-port and private
candidate verification. [Tauri's CSP documentation](https://v2.tauri.app/security/csp/)
requires deliberate local asset/worker policy; the editor must not require
remote executable code or disabling production CSP.

## Review branches

[Maintenance PR #54](https://github.com/rndaom/execs/pull/54) targets the 0.1
maintenance line. [Forward-port PR #55](https://github.com/rndaom/execs/pull/55)
targets main and keeps its 0.2.0 version and profile-owned preloader architecture.
PR readiness and Linear review state are updated only after the runtime gates
finish. Final product CI is recorded in the candidate's validation jobs and the
[main forward-port run](https://github.com/rndaom/execs/actions/runs/35490926728).
The PR checks additionally validate the final documentation/harness head.
