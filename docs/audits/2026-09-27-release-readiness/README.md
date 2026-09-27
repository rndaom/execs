# 0.2.0 repository and release audit — September 27, 2026

## Verdict

**Not ready to publish the expanded 0.2.0 candidate.** The audit repairs concrete
local defects and preserves earlier accepted qualification. Inventory remains
development-only, hosted checks need to pass on the repaired revision, and the
signed draft predates the latest product changes. No release, tag, live Steam
mutation or game-data change was performed.

The baseline inspected is main `7353b7260b89ab0375679f5a919172226297b916` and
release PR #136 head `0ab52ed0a17487dedd438863f30a5e802984b2f9`. Six independent
review tracks covered release infrastructure, repository/history hygiene,
native code, frontend code, Linear, and fixture UI behavior. This report records
the local repairs on top of that baseline; it does not attest to a subsequent
hosted build.

## Findings and repairs

| Priority | Finding | Disposition |
| --- | --- | --- |
| Release blocker | Linux storage symlink test expected 1,380 download bytes after the comfig cache added 20 bytes. | Replaced the fragile total with equality of the complete storage report before/after adding a symlink. Runtime storage behavior is unchanged; Linux execution remains pending. |
| Release blocker | Packaged credits omitted the new Steam artwork disclosure. | Regenerated credits and dependency notices. Added an ordinary-CI regression comparing credits with `THIRD_PARTY.md`, and included credit/supplemental changes in Linux package workflow triggers. |
| Security | Updater TLS transitively used rustls 0.23.43, affected by RUSTSEC-2026-0285. | Updated only rustls to 0.23.45 in Cargo.lock and regenerated notices. Fresh audit reports zero vulnerability findings. |
| Development security | Vitest 3 and its mocker had GHSA-82fw-gwwq-j7x9. | Updated both workspaces to patched Vitest 4.1.11; clarified two callback mock types. Tests, build, frozen install and audit pass. |
| UX | Escape in profile actions also closed the parent Profiles popover. | Consumed Escape at the context menu. Regression fails before the fix and passes after it; browser verification confirms first Escape restores the action button and second Escape closes Profiles. |
| Public hygiene | The public product specification was embedded in a tracked assistant instruction file. | Kept `AGENTS.md` locally, removed it from tracking, moved the public specification to `docs/ARCHITECTURE.md`, and updated active references. Local assistant state and environment files are ignored; example/template env files remain eligible for tracking. |
| Documentation | Readiness named an old release head and omitted the production Sounds/control delta; README support location was outdated. | Updated release readiness/playbook and support instructions. Dated audit evidence remains unchanged. |

Security sources: [rustls advisory](https://github.com/rustls/rustls/security/advisories/GHSA-2mjx-qc3c-rqvc),
[Vitest advisory](https://github.com/advisories/GHSA-82fw-gwwq-j7x9).

## Repository, history and local files

- Initial main and the separate release checkout were clean. The release checkout
  is on `rndaom/release-0.2.0`; it was inspected without changing its files.
- Reviewed 243 commits since public v0.1.8, 3,568 distinct introduced blobs,
  2,476 tracked files, and 23 tracked ZIPs containing 168 members for recognizable
  token/private-key signatures. No matches were found. This is a bounded pattern
  scan, not proof that every possible secret is absent.
- Those commits use the repository owner's identity and contain no co-author
  trailers. No history was rewritten. Untracking AGENTS does not erase its
  historical versions.
- No tracked installed dependencies, executable libraries, private-key files or
  editor state were identified. About 71 MB of design records and 6.8 MB of audit
  records are intentional evidence; deleting them would remove provenance.
- Checked active documentation links and updated source comments that relied on
  the formerly tracked agent file. Historical references remain dated records.
- Local build outputs are ignored and stale: the existing NSIS installer was
  written September 26 at 13:07 UTC, the release executable September 27 at
  11:30 UTC, and the development executable at 15:03 UTC. Timestamps are not
  source provenance and none proves these audit repairs were packaged.
- App-data directories were inventoried read-only. Profiles, Steam state,
  recovery data and caches were neither purged nor reorganized. Audit tooling,
  JSON logs and UI screenshots remain under ignored `.artifacts/release-audit/`.

## GitHub and candidate evidence

- Public latest remains [v0.1.8](https://github.com/rndaom/execs/releases/tag/v0.1.8).
  0.2.0 remains a private draft; [PR #136](https://github.com/rndaom/execs/pull/136)
  is the only open PR. The public issue inbox had no open issues at inspection.
- [Main CI](https://github.com/rndaom/execs/actions/runs/36331656478) and
  [release CI](https://github.com/rndaom/execs/actions/runs/36331793659) failed the
  Linux fixture above. [Linux packaging](https://github.com/rndaom/execs/actions/runs/36331793662)
  failed credits verification. Local repairs do not change those historical results.
- Independently downloaded the draft NSIS, AppImage and deb and verified all
  three Minisign signatures and GitHub SHA-256 digests. Four updater entries
  passed the repository verifier. No downloaded installer was executed.
- Candidate provenance is `8e77a2219683e0a4450f21d1aaf9ed7cef95c0b0`,
  [run 36313433526](https://github.com/rndaom/execs/actions/runs/36313433526).
  This predates Inventory and the restored production comfig.app Sounds/shared
  controls. Its prior accepted platform results cannot qualify that delta.
- Product versions agree on 0.2.0. The release checkout passes the version and
  changelog guard; main intentionally retains Unreleased notes.

## Linear reconciliation

All 171 execs issues were enumerated. The 0.2.0 milestone has 37 issues:
36 Done and [RND-208](https://linear.app/rndaom/issue/RND-208/validate-and-publish-the-combined-020-overhaul-and-profile-management)
In Progress. All 19 dependencies on RND-208 are Done. RND-191 and RND-267 are
the only other open project issues and remain in Later studios. Milestones,
rather than a separate Linear Release entity, track this release.

The audit initially identified the following outdated descriptions. They were
corrected later on September 27 at the owner's request, as recorded below:

1. The [project overview](https://linear.app/rndaom/project/execs-a89f9a30e95c)
   says ready to publish/waiting only for approval. Replace that summary with:
   "0.2.0 implementation is integrated; audit repairs, Inventory qualification
   and a refreshed signed candidate remain before publication."
2. RND-208 and the milestone still describe `9020dffb` as local/unpushed.
   Record merged PR #137, later art/batch/random-hat work, the owner's reported
   live-crafting result, and the production Sounds/control delta.
3. The [combined plan](https://linear.app/rndaom/document/020-overhaul-implementation-and-combined-release-plan-1fe7c93751c6)
   retains the September 24 scope and open D7 status. Mark it historical and
   point to the current readiness document instead of reopening accepted work.
4. RND-191's body still says selected for 0.2.0 although the owner's later
   decision defers Authenticode. RND-267 describes an old compiler gap; the
   remaining gap is native Linux in-game qualification of the existing builder.
5. Replace references to nonexistent `docs/STATUS.md` with
   `docs/release-0.2.0-readiness.md`. PR #136's description also needs the current
   scope and check results when these repairs are integrated.

RND-251's scoped owner acceptance remains valid. Its stated limits include no
actual Steam Cloud server round trip or in-game hitsound playback evidence.
Nothing in this audit invents those results or reopens that accepted issue.

### Description corrections completed

At the owner's request, updated the Linear project summary/description, 0.2.0
milestone, combined plan, and RND-208, RND-191, RND-267 and RND-251. Current text
explains the remaining work in plain English; older plans are marked historical.
Also replaced the broken `docs/STATUS.md` reference in 21 other issue descriptions.

[PR #136](https://github.com/rndaom/execs/pull/136) now describes the merged
Inventory/Sounds changes, current failing GitHub checks, locally repaired but
uncommitted audit changes, and the older signed installers accurately. It no
longer says packaged credits pass or that publication is the only remaining step.

Read back all updated descriptions and verified the PR body against the saved
text. All 171 project issues retain their prior status and milestone; no issue
was reopened or marked complete. No comments were posted, code pushed, or
release published. The PR remains open at `0ab52ed0`.

## Validation and limits

- Frontend full suite, script checks, Biome, TypeScript and production Vite build
  pass. Exact final counts are in the linked readiness document. The build
  retains its existing approximately 1.57 MB main-chunk warning.
- Windows Rust workspace: 1,041 tests passed, 33 ignored; helper: 27 passed.
  After the rustls patch, strict workspace Clippy and 145 application tests
  passed (8 ignored). Formatting passes. Core code was unaffected by that patch.
- Fresh pnpm audits of both the application workspace and separate promo project
  report zero vulnerabilities. Cargo audits report zero vulnerabilities in both
  lockfiles; the helper has no advisory warnings.
- Desktop Cargo retains six inherited unmaintained-package warnings and the
  known Linux GLib `VariantStrIter` unsoundness warning. The existing disposition
  check passes: no affected API references outside GLib in the 404-package Linux
  source graph. This is a textual source check, not a formal reachability proof.
  Maintenance warnings originate in GTK macros and Tauri's urlpattern/Unicode
  dependencies; replacing them requires upstream migration.
- Queried newer npm versions. Security fixes were applied; unrelated framework,
  compiler and build-tool major migrations were not swept into this candidate.
  "Verified locked dependencies" does not mean every dependency is latest.
- No Linux runtime is installed on this computer. Linux-only tests and refreshed
  signed Windows/Linux packages require hosted execution on the final revision.
- Native review found no additional confirmed runtime defect in the inspected
  Inventory/helper/journal/reconciliation, art, restore-point or uninstall paths.
  This is scoped code review, not proof that every execution path is defect-free.

## Fixture visual checks

The focused browser check covered Comfig, Sounds controls, sound-library
search/filter, Profiles menus, and development Inventory/Inspect at 1200×800
and 960×640. All five steps fit without observed document-width overflow;
Profiles' two-stage Escape and focus return passed. Screenshots and step notes
are kept in the ignored local visual report. Artwork, audio, native operations,
screen readers and full accessibility were not qualified by those fixtures.

## Follow-up after the owner reported failed GitHub checks

The first audit left fixes on the local computer. Updating descriptions did not
change the code GitHub tested, so PR #136 still showed the original failures.
The follow-up reviewed both failed logs again, committed the audit fixes, and
integrated them into the release branch. Credits were regenerated from the
release branch's own third-party text, preserving its additional promo credits.
The public architecture document retains the release media descriptions;
AGENTS.md remains local and ignored.

The combined release tree passes its local notice/version checks, lint, tests
and frontend build. Hosted Windows/Linux results must be read from the updated
[PR checks](https://github.com/rndaom/execs/pull/136/checks), not inferred from
those local passes. This step does not publish the release or enable Inventory.

## Required before publication

1. Integrate these repairs and refresh hosted Windows/Linux checks and package
   checks on that exact revision.
2. Complete the [Inventory acceptance checklist](../2026-09-27-inventory-usability/LIVE-TESTING.md)
   before enabling its production UI/native entry points. Keep unknown-outcome
   recovery and no-replay boundaries intact.
3. Rebuild and verify the private signed candidate, including the production
   Sounds/control changes and updater TLS patch, with upgrades from v0.1.8.
4. Reconcile release notes, PR and Linear summaries against the final evidence.
5. Obtain the owner's separate publication instruction. No publication is
   authorized by this audit request.
