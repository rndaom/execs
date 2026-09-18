# 0.1.5 implementation and verification

The release starts from public v0.1.4. Eight parallel workstreams implement the
22 assigned repair issues and linked RND-283. Source fixes and tests are reviewed
again after integration; the 0.2.0 forward-port preserves its existing features.

The workstream notes preserve their individual branch checks. The
[release record](../../release-0.1.5.md) contains the combined commit identities,
PRs, platform CI and signed candidate results.

All automated gates pass. [Candidate verification](candidate-verification.json)
records the exact source commit, all three installer hashes/signatures, Windows
and Linux upgrade results, startup/notices, app-data preservation and no repeat
offer. The owner subsequently confirmed Linux is good and authorized release;
that acceptance supersedes the earlier live-check deferral.

[0.1.5](https://github.com/rndaom/execs/releases/tag/v0.1.5) is published.
The [tagged workflow](https://github.com/rndaom/execs/actions/runs/34915488347)
passes all jobs. Final [Windows](windows-package-smoke.json) and
[Linux](linux-package-smoke.json) upgrade reports and
[anonymous public verification](public-verification.json) confirm the released
artifacts. PRs #47/#48 are merged and all 23 issues are Done.

| Issues | Research, behavior and regression evidence |
| --- | --- |
| RND-239, RND-243, RND-289 | [Independent local HUD loading, schema identity and refresh disclosure](hud-loading.md) |
| RND-265, backend RND-266 | [FlawHUD schema, animation directives and KeyValues](hud-schema.md) |
| RND-266, RND-269, RND-271, RND-272 | [Source-owned errors, completion timers and deferred drafts](feedback.md) |
| RND-268, RND-273 | [Pending-settings launch recovery and native close protection](close-transitions.md) |
| RND-270, RND-279, RND-280, RND-285 | [Picker cancellation and mutation draft preservation](mutation-drafts.md) |
| RND-275, RND-276 | [Literal pack identity, executable cfg layer and nested capture](pack-identity.md) |
| RND-277, RND-278 | [Reserved folder repair, legacy ZIP compatibility and packed credential checks](import-export.md) |
| RND-281, RND-282, RND-283, RND-284 | [Startup execution, total traversal limits, bind removals and FOV](cfg-execution.md) |
| RND-288 | [Payload timeout, exclusive lease recovery and signed retry](updater.md) |

## Integrated browser checks

The real React components and preview API run against isolated fixture data.
These checks do not invoke native IPC or change real profiles.

- Locked Gameplay off → on clears the obsolete notice. Off → on → off then
  Sounds retains the new notice and draft; reopening Gameplay retains the edit.
- The folder-repair preview names the launch blocker. At the app's 960×640
  minimum window size its review fits, Cancel restores focus, and explicit
  repair removes the warning and enables Launch.
- At the app's 1200×800 default size, the HUD fixture preserves installed
  identity, cached catalog/statistics and distinct partial-source warnings.
  Restoring sources and refreshing clears those warnings. A recovered local
  option saves through the real host and displays "HUD options saved".
- With no catalog cache, the installed HUD and Import HUD remain available.
  A schema-source failure exposes Retry loading options without stale controls;
  restoring that source and retrying recovers the correct HUD options.

## Runtime boundaries

The [retail Windows result](retail-pack-names.json) proves fixture mounting and
packed cfg execution with protected original hashes unchanged. It does not
establish every HUD's appearance, a Casual session, or a remote Steam Cloud
round trip. The previous-public-format ZIP fixture exercises unchanged bytes,
repair and export/reimport through production core APIs. An additional
[cross-version probe](public-compat/README.md) uses the actual public 0.1.4
exporter: 0.1.5 imports it without activation and produces a byte-identical
re-export, preserving an existing active profile and all source bytes.

The owner chose Linux CI for package/updater verification, then confirmed Linux
is good and authorized publication on September 14. This is owner-provided
runtime acceptance, separate from automated package evidence. See the
[release record](../../release-0.1.5.md) for combined checks, merged PRs, the
private candidate, tagged publication and final public-download evidence.
