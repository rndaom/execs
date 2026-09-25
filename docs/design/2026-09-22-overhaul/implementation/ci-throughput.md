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

Base-branch Rust caches are available to child PRs. They restored in the run above, but a warm cache does not remove the runtime of the full Rust and pinned HUD tests. PR-only concurrency cancels superseded runs of the same PR. Further large gains require reducing the pinned HUD tests' wall time or running them as independent jobs alongside the main Rust tests; that would increase runner usage and needs a measured trial.
