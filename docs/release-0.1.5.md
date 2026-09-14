# 0.1.5 release preparation

Status: implementation and verification in progress. Public latest remains
0.1.4. No 0.1.5 tag or public release is authorized by preparation alone.

## Scope and baseline

The owner requested implementation of the complete Linear 0.1.5 milestone on
September 14, 2026: 22 existing repair issues. This patch starts from public
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
| Effective cfg and FOV | RND-281, RND-282, RND-284 | Separate safety scanning from execution, bound traversal, preserve valid viewmodel FOV values. Check dormant/payload/actual execution and an adversarial small graph. |
| Mutation outcomes and drafts | RND-270, RND-279, RND-280, RND-285 | Honor cancellation/failure, preserve retry asset bytes and newer sound edits, and reconcile failed Comfig choices. Test real host result conventions. |
| Feedback and transitions | RND-266, RND-268, RND-269, RND-271, RND-272, RND-273 | Attribute and retain failures, renew success timers, clear obsolete deferred feedback, recover pending launch blockers and protect pending settings on close. Test concurrent drafts and Files guard integration. |
| Updater deadline | RND-288 | Bound payload download time, release lifecycle ownership and allow retry. Test stalled loopback payloads and signed upgrade behavior. |

Each stream researches the cited primary sources, records an issue-specific
implementation/verification note, and includes its user-facing changelog lines
with its implementation commit. Independent branches are integrated into one
candidate and reviewed after integration.

## Required release evidence

- [ ] All 22 issue acceptance criteria implemented and reviewed
- [ ] Frontend tests, Biome and production build
- [ ] Windows Rust format, clippy and workspace tests
- [ ] Linux CI, package build and smoke
- [ ] Previous-public-profile import/export and integrity checks
- [ ] Browser interaction checks for changed flows
- [ ] Signed candidate installers and updater upgrade from public 0.1.4
- [ ] Startup, app-data preservation and no repeat update offer
- [ ] Forward-port PR and maintenance PR prepared with passing checks
- [ ] Four product versions and release notes prepared for 0.1.5

## Publication

Tagging and publication remain separate from this preparation. Record remaining
live-platform or game-specific evidence honestly; automated fixtures do not
establish a real Steam Cloud server round trip or Casual session.
