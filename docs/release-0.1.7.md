# 0.1.7 release candidate

Status: implementation complete; native and package qualification in progress. Publication is not
authorized. No release tag is created by this preparation.

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

- [ ] All issue acceptance criteria mapped to implementation and evidence
- [x] Frontend tests, Biome and production build
- [ ] Windows/Linux Rust format, Clippy and workspace tests
- [x] Actual public 0.1.6 export/import and exact-byte round trip
- [ ] Supported window sizes, zoom, keyboard, screen readers and IME
- [ ] Novice and experienced Files workflows
- [x] Lock, external conflict, failed write and transition regressions
- [ ] Offline help, packaged worker/CSP and measured responsiveness
- [ ] Signed private installer/updater candidate from public 0.1.6
- [ ] Maintenance and forward-port PRs pass CI
- [x] Four version files, Cargo lockfile and 0.1.7 changelog agree

Tagging, merging release PRs and publishing remain separate owner actions.
Passing fixture checks does not imply unperformed native or retail-game checks.

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
Both remain drafts until the runtime gates finish. Implemented child issues are
In Review; RND-323 and its parent remain in progress while qualification runs.
