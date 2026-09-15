# 0.1.5 release preparation

Status: implementation and private signed candidate verification complete. All
automated release gates pass. The owner-selected live Linux check remains
outstanding below. Public latest remains 0.1.4; preparation does not publish it.

## Scope and baseline

The owner requested implementation of the complete Linear 0.1.5 milestone on
September 14, 2026: 22 existing repair issues, plus the directly linked RND-283
bind-removal subtask permitted by its acceptance criteria. This patch starts from public
`v0.1.4` (`12bb5a8effb8aebe77c6cfc4d8cd03d9bef45cdd`), preserves older profiles
and exports, and adds no live write targets. Each fix also goes into the
unreleased 0.2.0 track without carrying that track's features into this patch.

## Implementation plan

| Workstream | Issues | Implementation and focused verification |
| --- | --- | --- |
| Pack identity and cfg layer | RND-275, RND-276 | Preserve literal pack identities; detect an executable mastercomfig loader. Exercise absorb, switching and managed saves on disposable installs. |
| Imports and export privacy | RND-277, RND-278 | Avoid Source-reserved loose container names; inspect packed cfg credentials before export. Check archive limits, rejected-input atomicity and older-profile round trips. |
| HUD resource editing | RND-265 | Apply animation directives as line edits and use HUD-specific KeyValues escape behavior. Check real FlawHUD schema and first-party regression fixtures. |
| HUD loading and refresh | RND-239, RND-243, RND-289 | Separate installed HUD from network availability, invalidate stale schemas and report partial refresh failures. Exercise offline, stale-request and cached-data paths. |
| Effective cfg and FOV | RND-281, RND-282, RND-283, RND-284 | Separate safety scanning from execution, bound traversal, apply executed bind removals, and preserve valid viewmodel FOV values. Check dormant/payload/actual execution, mounted search paths and an adversarial small graph. |
| Mutation outcomes and drafts | RND-270, RND-279, RND-280, RND-285 | Honor cancellation/failure, preserve retry asset bytes and newer sound edits, and reconcile failed Comfig choices. Test real host result conventions. |
| Feedback and transitions | RND-266, RND-268, RND-269, RND-271, RND-272, RND-273 | Attribute and retain failures, renew success timers, clear obsolete deferred feedback, recover pending launch blockers and protect pending settings on close. Test concurrent drafts and Files guard integration. |
| Updater deadline | RND-288 | Bound payload download time, release lifecycle ownership and allow retry. Test stalled loopback payloads and signed upgrade behavior. |

Each stream researches the cited primary sources, records an issue-specific
implementation/verification note, and includes its user-facing changelog lines
with its implementation commit. Independent branches are integrated into one
candidate and reviewed after integration.

## Required release evidence

- [x] Original 22 issues and linked RND-283 implemented and reviewed
- [x] Frontend tests, Biome and production build
- [x] Windows Rust format, clippy and workspace tests
- [x] Linux CI, package build and smoke
- [x] Previous-public-profile import/export and integrity checks
- [x] Browser interaction checks for changed flows
- [x] Signed candidate installers and updater upgrade from public 0.1.4
- [x] Startup, app-data preservation and no repeat update offer
- [x] Forward-port PR and maintenance PR prepared with passing checks
- [x] Four product versions, Cargo lockfile and release notes prepared for 0.1.5

## Verification records

- [Maintenance PR #47](https://github.com/rndaom/execs/pull/47) targets
  `rndaom/release-0.1.3`. [Frontend, Windows and Linux CI](https://github.com/rndaom/execs/actions/runs/34912754230)
  passes at `a9646b1119ad76eb98f0279632a4fad7fc3aca2b`.
- [Forward-port PR #48](https://github.com/rndaom/execs/pull/48) targets `main`.
  [All three CI jobs](https://github.com/rndaom/execs/actions/runs/34912773562)
  pass at `45df066fccd449117992f7c4865b856823331dfd`. Its four product versions
  remain 0.2.0; creator trust review and profile preloader behavior are retained.
- [Private candidate workflow](https://github.com/rndaom/execs/actions/runs/34912770058)
  passes validation, both package builds, updater probes, signed upgrades and
  final asset verification at the maintenance commit above. Publication is
  skipped for this private workflow dispatch.

The candidate's Windows NSIS and Linux AppImage upgrades from the actual public
0.1.4 installers pass signature, installation, startup, packaged-notice,
app-data sentinel and no-repeat-offer checks. Linux also installs and starts the
Debian package. Independent downloaded-artifact verification confirms all three
production signatures, sizes and SHA-256 hashes; exact version, source commit
and run identity; matching updater signature sidecars; changelog notes; and no
Debian updater entry. [Machine-readable evidence](audits/2026-09-14-0.1.5/candidate-verification.json).

The signed candidate is built from `a9646b1`. Later evidence/documentation
commits do not change application code; the PRs carry their own final checks.

The combined release branch passes 521 desktop, 140 cfglint, 21 release-script
and 720 Windows native/integration tests. Three platform-specific script checks
and eight opt-in native cases are excluded from the default Windows run; the
published mastercomfig asset fixture also passed its explicit opt-in run.
Biome, production TypeScript/Vite build, Rust formatting and workspace clippy
pass. [Local check summary](audits/2026-09-14-0.1.5/local-verification.json).

The [audit index](audits/2026-09-14-0.1.5/README.md) links each workstream's
primary-source research, implementation plan, regression tests and limitations.
All work is isolated from the original checkout's untracked audit files and
the owner's real profile library.

The actual public 0.1.4 exporter produced an 11-file synthetic profile ZIP.
The 0.1.5 core imported it into empty and existing-active libraries without
activation, preserved every byte/hash and HUD/mod record, and re-exported an
identical ZIP. The subsequent re-import also passed. See
[the compatibility report and reproducible helper](audits/2026-09-14-0.1.5/public-compat/README.md).

Windows retail TF2 mounted the generated mod/HUD fixture and executed its VPK
cfg, then exited successfully. Hashes of the protected original install files
were unchanged. See [the recorded result](audits/2026-09-14-0.1.5/retail-pack-names.json).

The owner selected Linux CI and explicitly left the live Linux Steam URI
handoff/native TF2 check outstanding. It is a remaining RND-268 runtime check;
CI package/updater results do not substitute for it.

## Publication

The 23 Linear records remain In Review with implementation and verification
links. Merge/tag/publication remain separate from this preparation and follow
`docs/RELEASE.md`. No 0.1.5 tag or public release was created. The broader
Steam Cloud/Casual matrix remains RND-251; these automated fixtures and the
Windows mount check do not establish that live coverage.
