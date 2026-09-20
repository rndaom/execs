# Tagged release package checks

Release run [35493975892](https://github.com/rndaom/execs/actions/runs/35493975892)
at immutable `v0.1.7`, commit `1a81bcfbb8ea2dee2fbddf2a409180296adac4c0`,
passed every job and published September 20, 2026 at 06:55:58 UTC.

[Windows](windows-installer.json) and [Linux](linux-installer.json) installed
the signed update from public 0.1.6, retained user data, started successfully,
contained notices and offered no repeat update. Disposable CI fixtures were
used; no real player data, Steam Cloud or game launch was involved.

The actual packaged Files worker executed in
[Windows WebView2](windows-worker-result.json) and
[Linux WebKit](linux-worker-result.json), returning the expected diagnostic
without policy violations. Fetch records bind each response to its compiled
asset hash. These are functional smoke timings, not performance benchmarks.

[Anonymous post-publication verification](../public-verification.json) checks
all three public installer signatures/hashes, both updater downloads, release
notes and exact tag/commit/run identity. It does not execute the downloads.
