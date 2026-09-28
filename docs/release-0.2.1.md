# 0.2.1 release

0.2.1 is a patch after public [0.2.0](https://github.com/rndaom/execs/releases/tag/v0.2.0).
The owner assigned three issue lists to it on September 27–28, 2026, including
bounded features, as the release policy allows for a named patch:

- [0.2.1 issue list](https://linear.app/rndaom/document/021-issue-list-154e1b4f5037) (9 items)
- [0.2.1 part 2 issue list](https://linear.app/rndaom/document/021-part-2-issue-list-8b5ca34b9603) (14 items)
- [0.2.1 part 3 issue list](https://linear.app/rndaom/document/021-part-3-issue-list-5017f7572887) (21 items)

The Linear workspace is at its free-plan issue limit, so these documents hold the
milestone scope instead of issues. Nothing outside them was added.

## Integration

- Parts 1 and 2 and the part 3 branch were merged into `rndaom/0.2.1-fixes`
  ([#146](https://github.com/rndaom/execs/pull/146), merge `c6b3c0f3`), then into
  `main` ([#145](https://github.com/rndaom/execs/pull/145), merge `7ed6989d`), with
  every check green on both PR heads.
- An independent review of all three lists found two blockers and several smaller
  problems; all were fixed in #146 before merging. Implementation evidence:
  [part 1](audits/2026-09-28-0.2.1/README.md), [part 2](audits/2026-09-28-part2/README.md),
  [part 3](audits/2026-09-28-part3/README.md).
- `rndaom/release-0.2.1` sets the four version files to 0.2.1 and moves the notes
  into `## [0.2.1] - 2026-09-28`. If publication happens on a later day
  (America/New_York), change that date first.

## Compatibility walk

- Profiles and exports from public 0.2.0 still load: new manifest fields
  (`inactivePack`, `comfigRelease`) are additive, and the package smoke tests import
  authentic 0.2.0 exports.
- Absorb classifies packs as before. It now skips re-hashing unchanged ordinary
  custom payloads during automatic absorb only; reviews, switches and writes keep
  full hashes. Valve's shipped cfgs are no longer profile files.
- The write lock refuses live writes while TF2 runs and now also recognises the
  32-bit `tf.exe`.
- TF2 writes stay inside `tf/custom/`, the cfg layer and the Steam Cloud
  `config.cfg` copy. New operations there: disabled packs move to
  `tf/custom/execs-inactive-<id>/`, removed VPKs lose their sound cache, and the
  one-time tidy-up removes orphan sound caches and moves HUD backups out of
  `tf/custom/` into execs data. The preloader exception is unchanged and
  `tf2_misc_*_dir.vpk` is never written.
- execs data gains `logs/activity.log`, `maintenance/tidy-up.json`,
  `hud-backups/`, per-profile `absorb-cache.json` hints, and a `window` entry in
  `settings.json`. Older versions ignore all of them.
- `localconfig.vdf` is now written only through an explicit, reviewed choice.
- Pinned sources are current: `node scripts/pinned-sources.mjs` reports no change
  to the comfig.app hit sound list (`0dd0b076`) or TF2HUD.Editor schemas (`17bccd15`).

## Checks before the tag

- Local on `rndaom/release-0.2.1`: Rust formatting (`--all`), Clippy with warnings
  denied, the Rust, desktop, cfglint and script tests, Biome, the production build
  and the notices check.
- Release PR checks and a private candidate run (`workflow_dispatch` with
  `release_tag=v0.2.1`), which builds signed Windows and Linux installers into a
  private draft and upgrades public 0.2.0 on both platforms with the profile
  library preserved. See Candidate below.

## Not checked automatically

These were outside what fixtures and CI can prove; the owner decides whether any
must be tried before the tag:

- Mouse 4 and Mouse 5 on a physical mouse in the installed app (Windows and Linux).
- Pause, Scroll Lock, Num Lock, the Windows keys and the Menu key on a physical keyboard.
- What Steam shows while Inventory reads the backpack.
- A real Valve Casual match with the preload hook and model/material packs.
- Linux in person (CI covers the Linux builds, the native smoke and packages).

## Candidate

[Candidate run 36491333342](https://github.com/rndaom/execs/actions/runs/36491333342)
on `f5322fd8` passed every gate: validation, signed Windows and Linux builds, the
Windows installer and updater smoke and the Linux package and updater smoke from
public 0.2.0 with the profile library preserved, updater discovery on both
platforms, and feed verification. An earlier run on `244eb172` was cancelled: the
release-history guard required the upgrade fixture to come from the previous
public version, so `scripts/fixtures/package-smoke-v020.json` now holds the
authentic v0.2.0 exports (see `scripts/fixtures/README.md`).

## Publication

Published [0.2.1](https://github.com/rndaom/execs/releases/tag/v0.2.1) on
September 28, 2026 at 23:37:58 UTC (7:37 PM America/New_York) after the owner's go.

- [#147](https://github.com/rndaom/execs/pull/147) merged into `main` as
  `ebb2d507635f314675a481a0c8b5d683fb4502cf`, whose tree equals the candidate's.
  Annotated tag `v0.2.1` ("execs 0.2.1") points to it.
- [Tagged workflow 36495684486](https://github.com/rndaom/execs/actions/runs/36495684486)
  repeated every gate and published.
- Anonymous checks: `/releases/latest` is `v0.2.1` (not a draft or prerelease);
  `latest.json` reports 0.2.1 for `windows-x86_64`, `windows-x86_64-nsis`,
  `linux-x86_64` and `linux-x86_64-appimage`, each signed; the Windows installer,
  AppImage and `.deb` download; `release-commit.json` names the commit and run above.
- Watch GitHub Issues for 48 hours after publication; a broken install or updater
  is a same-day patch.
