# 0.1.6 release preparation

Status: implementation and verification in progress. Preparation is authorized;
publication and a release tag are not. Public latest remains 0.1.5.

## Scope and baseline

The September 18 owner request covers all 14 issues in Linear's 0.1.6 milestone.
The candidate starts at public `v0.1.5` (`9976464`) on
`codex/release-0.1.6`, targeting maintenance `rndaom/release-0.1.3`.
The existing creator-import PR #49 and Windows long-path branch are retained
and integrated. Unrelated 0.2.0 work stays on main. The milestone explicitly
assigns creator cfg/custom ZIP import as a bounded, compatible patch addition.

## Implementation plan

| Workstream | Issues | Implementation and verification |
| --- | --- | --- |
| Sound audition and identity | RND-245, RND-287, RND-293 | Invalidate installed previews by profile/content identity, match source identities, and name clip/slot controls accessibly. Exercise stale requests, replacements, boosts and newer drafts. |
| Creator profile import | RND-201 | Review the existing maintenance backport, single-use trust confirmation and exact-byte cfg/user.scr preservation. Verify native exports and active-profile isolation. |
| HUD installation | RND-303, RND-304 | Retain safe long Windows paths and consistently omit excluded backup files. Test archive/folder imports and transactional preservation. |
| HUD resource editing | RND-305, RND-306, RND-307, RND-310, RND-311 | Preserve legacy encoding; make folder variants reversible; handle conditional base includes, bounded expressions and included resource headers. Verify resource bytes against real pinned HUDs and official Source/editor semantics. |
| HUD schema compatibility | RND-308, RND-309, RND-312 | Match supported schema revisions, reject duplicate identities, correct effective FlawHUD toggles and independent kbnhud size targets. Verify changed resources, not merely successful return values. |

Implementation branches carry focused regressions and user-facing Unreleased
notes. The integrated candidate receives a second review, Windows tests and
GitHub Linux CI. Changes are forward-ported to the unreleased minor track.

## Required release evidence

- [ ] All 14 acceptance criteria mapped to implementation and checks
- [ ] Frontend tests, Biome and production build
- [ ] Windows Rust formatting, clippy and workspace tests
- [ ] GitHub Linux CI and package smoke
- [ ] Previous-public profile import/export compatibility
- [ ] Changed UI interaction, layout and accessible-name checks
- [ ] Real pinned HUD resource semantics and manifest/live-byte integrity
- [ ] Signed private candidate and updater upgrade from public 0.1.5
- [ ] Startup, app-data preservation and no-repeat-update checks
- [ ] Maintenance and forward-port PRs with passing checks
- [ ] Matching four version files, Cargo lockfile and 0.1.6 changelog section

Release tag, publication, public issue closure and milestone completion remain
pending the owner's later release authorization. Any unavailable real-game or
platform validation is recorded explicitly; CI is not a claim of live rendering.
