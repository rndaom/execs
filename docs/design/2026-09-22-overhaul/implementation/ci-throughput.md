# Hosted CI throughput, September 25

The full-path run for [PR #94](https://github.com/rndaom/execs/pull/94) at `debff0a4fd796cc7b42ec014bdf19e98a31b4df3` passed all seven CI checks. It intentionally ran the full suite because the docs-only classifier did not yet exist on its trusted base commit. The [CI run](https://github.com/rndaom/execs/actions/runs/36076367054) is the timing source below.

| Job or step | Hosted elapsed time |
| --- | ---: |
| Linux Rust job | 9m 13s |
| Windows Rust job | 12m 40s |
| Linux Rust cache restore | 23s; base cache restored |
| Windows Rust cache restore | 34s; base cache restored |
| Linux Clippy / tests | 19s / 2m 11s |
| Windows Clippy / tests | 48s / 4m 7s |
| Linux pinned HUD verification | 5m 2s |
| Windows pinned HUD verification | 6m 45s |

The pinned HUD step is now the longest serial part of both Rust jobs. [PR #93](https://github.com/rndaom/execs/pull/93) ran its independent pinned cases concurrently and cut that step by 59 seconds on Linux and 36 seconds on Windows relative to the preceding hosted run. It still retains the pinned archive hashes, exact test set, and failure behavior.

[PR #94](https://github.com/rndaom/execs/pull/94) added a fail-full fast path for pull requests changing only Markdown in `docs/design/`. It keeps existing job names successful with explicit no-op steps and adds an aggregate gate. The classifier runs from the base commit and checks GitHub's exact merge parents, so a PR cannot alter its own skip rule. This document's first [docs-only run](https://github.com/rndaom/execs/actions/runs/36077643517) used that path: all seven checks passed, the Rust job logs show the no-op step, and classifier start to aggregate-gate completion took 27 seconds. Normal code PRs still run the full suite.

Base-branch Rust caches are available to child PRs. They restored in the run above, but a warm cache does not remove the runtime of the full Rust and pinned HUD tests. PR-only concurrency cancels superseded runs of the same PR. The later [PR #96 docs-only run](https://github.com/rndaom/execs/actions/runs/36077747475) passed all seven checks in 22 seconds.

## Parallel pinned HUD jobs

[PR #98](https://github.com/rndaom/execs/pull/98) moved the unchanged pinned HUD verification into independent Linux and Windows jobs, with read-only restores from the corresponding Rust job caches. Its [full CI run](https://github.com/rndaom/execs/actions/runs/36078252092) passed all nine jobs in **8m 48s** from classifier start to aggregate gate. The earlier cached full run above took **12m 57s**, a measured difference of **4m 9s (32%)**. The four Rust/HUD jobs consumed about 2m 40s more aggregate runner time than the earlier two serial jobs. These are separate source revisions and hosted runs, so the difference is an observed result, not a guaranteed per-PR saving.

The same layout on [PR #99](https://github.com/rndaom/execs/pull/99) took [9m 47s](https://github.com/rndaom/execs/actions/runs/36079612809) to the CI gate; its Windows pinned HUD job ended at 9m 32s. Hosted timing and queueing still vary.

## Warm release-package cache

The [PR #95 cold Linux package job](https://github.com/rndaom/execs/actions/runs/36077142394/job/107890781754) took **12m 29s** with no restored release cache. A [package run on the integration branch](https://github.com/rndaom/execs/actions/runs/36078477436) seeded that cache. [PR #99's package job](https://github.com/rndaom/execs/actions/runs/36079612793/job/107898424349) restored an exact full-key cache in 7 seconds and finished in **10m 19s**. Release Rust compilation fell from **6m 37s to 3m 34s**; setup and AppImage bundling varied, leaving a **2m 10s** whole-job improvement. The package job finished 31 seconds after the PR #99 CI gate, so it was the final check on that run.

Keep package qualification on each code PR while the Viewmodels builder changes. Moving it to the draft integration PR would have saved 10m 19s of runner usage but only 31 seconds of PR #99 wall time, and package failures would be found after a child merge. AppImage bundling took about 3m 9s on the warm run. No compression change has a measured safe gain yet; time its deployment and squashfs stages before changing release output.
