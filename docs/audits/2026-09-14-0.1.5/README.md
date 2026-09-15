# 0.1.5 repairs on the 0.2.0 development track

[PR #48](https://github.com/rndaom/execs/pull/48) carries the milestone's 22 repair
issues and linked RND-283 into main. All four product versions remain 0.2.0.
The maintenance implementation and final published 0.1.5 evidence are recorded
in [the release record](../../release-0.1.5.md). PRs #47/#48 are merged, and all
23 Linear records are Done. The 0.1.5 release history is retained separately
from the five minor-only Unreleased entries in main's changelog.

| Issues | Research and regression evidence |
| --- | --- |
| RND-239, RND-243, RND-289 | [HUD loading, schema identity and refresh reporting](hud-loading.md) |
| RND-265 | [HUD schema and KeyValues changes](hud-schema.md) |
| RND-266, RND-269, RND-271, RND-272 | [Errors, feedback timers and deferred drafts](feedback.md) |
| RND-268, RND-273 | [Launch recovery and close protection](close-transitions.md) |
| RND-270, RND-279, RND-280, RND-285 | [Mutation outcomes and retained drafts](mutation-drafts.md) |
| RND-275, RND-276 | [Pack identity and cfg-layer detection](pack-identity.md) |
| RND-277, RND-278 | [Import repair and packed-cfg privacy](import-export.md) |
| RND-281, RND-282, RND-283, RND-284 | [Cfg execution, work limits, bind removals and FOV](cfg-execution.md) |
| RND-288 | [Updater download deadline and recovery](updater.md) |

## Minor-track adaptations and independent review

Creator ZIP review and explicit trust remain intact, including exact approved
VPK bytes; exports still refuse packed credentials. Folder repair remaps saved
profile particle selections atomically with their mod records. Installed
projection ownership, rollback and unrelated-profile isolation remain guarded.
Unsafe imported profiles lead to the existing repair review before switching.

Independent review of commits `726c769` and `d62cd16` found no actionable issues
in these adaptations. This review checked persistence and recovery; it does not
establish in-game particle appearance.

## Verification

Local Windows checks passed: 527 desktop, 140 cfglint, 21 release-script and
734 native tests, plus Biome, production TypeScript/Vite build and all-target
workspace clippy. There were three platform-specific script skips and nine
opt-in native skips. The corrected full-workspace `cargo fmt --all --check`
passes; the initial formatting command had omitted core and CI caught it.
[GitHub checks](https://github.com/rndaom/execs/pull/48/checks) pass on both
Windows and Linux. PR #48 is merged into main.

The signed package/updater evidence belongs to the 0.1.5 maintenance candidate.
The owner initially chose Linux CI and deferred the live Steam URI/TF2 handoff,
then confirmed Linux is good and authorized release on September 14. This is
owner-provided runtime acceptance, separate from the automated package evidence.

The [tagged 0.1.5 workflow](https://github.com/rndaom/execs/actions/runs/34915488347)
passed all validation, build, verification and publication jobs. Final
[Windows](windows-package-smoke.json), [Linux](linux-package-smoke.json), and
[anonymous public-download checks](public-verification.json) verify that release.
These package reports identify the maintenance tag; main retains 0.2.0.
