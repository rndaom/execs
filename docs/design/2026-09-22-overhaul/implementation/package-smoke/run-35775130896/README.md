# First Linux development package run

[Run 35775130896](https://github.com/rndaom/execs/actions/runs/35775130896) failed at the packaged credits preflight on 2026-09-22. **All 48 harness tests passed on Linux; no package build, installer, application launch or UI round trip occurred.**

- PR head: `c40e2743a88e0d5c29c137ba4ee5e4b2c868cb8e`.
- Actual PR merge checkout: `6a738eebb77de9594219de389667397c509380f0`, merging that head into `0c5aa21e9b16e3bd3c05c1bb4d9d7e9acddfc7be`.
- Job: [106906303143](https://github.com/rndaom/execs/actions/runs/35775130896/job/106906303143), started `2026-09-22T19:39:00Z`, completed with failure at `2026-09-22T19:40:29Z`.
- Setup, dependency installation, pnpm installation and all 48 tests passed. `Verify packaged notices` exited 1 at `2026-09-22T19:40:25Z`.

The exact failure was `Error: Regenerate packaged credits` at `scripts/third-party-notices.mjs:122`. The existing check requires bundled `notices/CREDITS.txt` to match LF-normalized `THIRD_PARTY.md`. The bundled copy lacked the nine-line Jengerer's Item Manager design-inspiration section already added to the source credits by `f439e90`. This is a real packaging-input mismatch: the existing release workflow uses the same check. Neither gate should be removed or weakened.

The corrective command is `node scripts/third-party-notices.mjs`, followed by the same command with `--check` and review of the resulting credit/dependency diff. It runs locked Cargo metadata for both supported targets, reads installed crate/npm license files, and writes the two packaged notice files. Metadata may download missing registry data; it does not compile or launch the application. Parent owns that correction. A later successful regeneration is not a retroactive pass of this run.

The subsequent local correction adds the missing nine credit lines and four complete dependency blocks: `itertools 0.14.0`, `libloading 0.8.9`, `prost 0.13.5` and `prost-derive 0.13.5`. All existing 466 dependency blocks remain byte-identical. The generator's unchanged `--check` passes 470 packages. These generated inputs and one Unreleased note are the only product-distribution changes; the hosted package cases still need execution.

The unsigned configuration, optimized build, native driver installation and all three package cases were skipped. Public package lookup/download and candidate package inspection were never reached, so **this run has no previous/candidate package hashes, installed binary identity, fixture preservation result, screenshot or native runtime result**. The evidence-upload step found no runtime evidence directory; the API confirms zero uploaded artifacts. AppImage upgrade, Debian upgrade and Debian first install all remain unverified.

Retained evidence:

- [Complete workflow log](workflow.log), with terminal formatting removed and LF normalized; no lines filtered.
- [Exact workflow metadata](workflow.gen.json) and [exact artifact listing](artifacts.gen.json), retained byte-for-byte with generated-file suffixes.
- [Source and normalized hashes](provenance.json), including original log hash and the exact checkout identity.

No rerun or duplicate dispatch was requested from this subtask. No release, version, signature, package validator or product code was changed while collecting the evidence. RND-251 remains open.
