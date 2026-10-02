# Releases

How execs is versioned, built and published. The product rules behind it live in
[ARCHITECTURE.md](ARCHITECTURE.md); what changed in each version is in the
[changelog](../CHANGELOG.md) and on [GitHub Releases](https://github.com/rndaom/execs/releases).

## Where things live

| Surface | Who | What it is |
|---|---|---|
| [GitHub Releases](https://github.com/rndaom/execs/releases) | Everyone | The only supported install. The in-app updater reads `latest.json` from the latest release. |
| [Issues](https://github.com/rndaom/execs/issues) | Everyone | Bug reports and requests. |
| [Discussions](https://github.com/rndaom/execs/discussions) | Everyone | Questions and ideas. Not a commitment to build. |
| `main` | Contributors | Development. CI stays green; it may be ahead of the last release. |
| Draft and `workflow_dispatch` builds | Maintainers | Private test builds. Never a download link. |

There are no nightlies, public prereleases or "try this build" links from `main`.

## Branches

`main` is the default branch. Other branches use the `rndaom/` prefix:

| Branch | Purpose |
| --- | --- |
| `rndaom/release-X.Y.Z` | The candidate for one release. |
| `rndaom/release-0.1` | Maintenance line for 0.1.x patches. |
| `rndaom/forwardport-X.Y.Z` | Carries a release's fixes into `main` when it was cut from elsewhere. |
| `rndaom/<topic>` | Short-lived work, deleted after merging. |

Released versions are kept by their immutable `vX.Y.Z` tags, not by branches.

## Versioning

execs stays on `0.Y.Z` until a yearly review promotes **1.0.0**. Four files always
match the release tag without its `v`:

- `apps/desktop/package.json`
- `apps/desktop/src-tauri/tauri.conf.json`
- `apps/desktop/src-tauri/Cargo.toml`
- `apps/desktop/src-tauri/core/Cargo.toml`

| Bump | When | What it can contain | Data and files written |
|---|---|---|---|
| **Patch** `0.Y.Z+1` | Anytime; the same day if installing, updating, data or the write lock is broken. | Bug fixes, plus any small feature or polish item the maintainer deliberately puts in that patch. | Nothing incompatible and no new write target. Older profiles and exports keep working. |
| **Minor** `0.Y+1.0` | The monthly train (below). Skipped if nothing is ready. | At most **three** planned user-visible features, or one large feature that is the whole release. | Additive only. A 0.1.0 profile still loads. |
| **1.0.0** | When the yearly review says the contracts are stable. | — | Profile format, written files, updater URL and supported systems become promises. |

A user-visible feature is something a player notices in a pane or on first run.
Refactors, tests, copy and process docs aren't features and never wait for a train.
When a feature goes into a patch, record the patch's full scope in its milestone
and ship exactly that.

**Breaking changes** need at least a minor and a `Breaking:` line in the
changelog: changing which files execs writes, a profile or manifest change an
older execs can't read, a new updater URL or signing key, or dropping an
operating system or glibc version. Never in a patch.

### Hotfixes

A hotfix that keeps the product version adds a numeric build revision:
0.1.3 Hotfix 1 is `0.1.3+1` in the four version files, the changelog heading,
the updater feed and a new `v0.1.3+1` tag. Revisions run from 1 to 65535 without
leading zeros. The app shows `v0.1.3`; release notes, update prompts and
diagnostics show the full revision.

The updater's Rust semver comparison orders build metadata, so `0.1.3+1` is
offered to `0.1.3` and never offered twice. The numeric revision also becomes
the Windows installer's fourth version number. Upload paths may keep `+` or turn
it into `.`, so verification reads the actual asset names. The upgrade test
installs the release immediately before it in the changelog, so a second hotfix
tests the upgrade from the first.

Published tags and their files are never replaced. A hotfix is built as its own
draft and published as the latest stable release, on the same feed URL and
signing key.

## Before every release

Walk this list:

- A profile exported from the last public version still imports.
- Absorb still sorts packs the same way.
- The write lock still refuses changes to TF2's files while it runs.
- Nothing new is written outside `tf/custom/`, `tf/cfg/overrides/` (or the
  plain `tf/cfg` user files without mastercomfig) and Steam Cloud's
  `config.cfg` copy, apart from the documented Casual setup exception.
- `tf2_misc_*_dir.vpk` is still never written.
- `latest.json` will list both `windows-x86_64` and `linux-x86_64`.
- `node scripts/pinned-sources.mjs` reports no change to comfig.app's hit
  sound list or TF2HUD.Editor's schemas since their pins. If either changed,
  review it, bump the pin and rerun the tests: new uploads and schema fixes
  reach players only through a release.

## Shipping a minor

The monthly train leaves on the first Thursday. Skip it when `[Unreleased]` has
no user-facing feature and no fixes worth a release; empty months are fine.

1. Freeze the milestone. Anything over the three-feature budget moves to the
   next minor.
2. Walk the list above.
3. Move the changelog's `[Unreleased]` entries into `## [0.Y.0] - YYYY-MM-DD`,
   leaving an empty `[Unreleased]`.
4. Bump the four version files on a `rndaom/release-0.Y.0` branch and open its
   pull request.
5. Run a private candidate (below) and try the installers.
6. Merge, then tag the merge commit `v0.Y.0` and push the tag.
7. The release workflow builds both platforms into a draft, checks everything
   again, and publishes. Watch issues for 48 hours: a broken install or updater
   is a same-day patch.
8. Open the next milestone with a theme and at most three features.

## Shipping a patch

Bump `Z`, write the changelog section, and follow the same steps. Cut the patch
from `main` unless `main` already holds a breaking change or work outside the
patch; then branch from the last public tag and tag from that branch.

## Private candidates

`workflow_dispatch` on `release.yml` with `release_tag=vX.Y.Z` builds that
version's private draft and never publishes. Candidate and tag runs for the same
version share a lock, so they can't change one draft at once. Pushing the tag is
what publishes.

GitHub may give a draft a temporary `untagged-...` address. Verification accepts
it only when it matches the draft's own page and the feed uses the stable asset
URL; the tag, revision, signatures and bytes are always checked. A temporary
address never reaches the published feed.

## Checklist

- [ ] Milestone frozen; leftover issues moved off it
- [ ] "Before every release" list walked, including pinned sources
- [ ] `CHANGELOG.md` has a non-empty `## [X.Y.Z]` section
- [ ] The four version files equal `X.Y.Z`
- [ ] Private candidate passed and its installers were tried
- [ ] Tag `vX.Y.Z` is on the release commit
- [ ] Release published, with both platforms in `latest.json`
- [ ] Issues fixed in the release are commented and closed
- [ ] Next milestone opened

## Issues and requests

1. Reply to a new issue or discussion the same day: reproduce it, ask for
   diagnostics, or close it with a reason.
2. Real work goes on the backlog and into a milestone when it fits that
   release's budget, or into the next patch if it's a fix.
3. When a release containing the fix is published, comment the version on
   the issue and close it.

Issues that won't be done are closed as "not planned" rather than kept as a
wish list. Unsolicited pull requests are welcome as ideas: changes to which
files execs writes, the updater or the profile format are discussed in an
issue first.

## Once a year (first Thursday of September)

1. Review compatibility: profile format, data folder layout, written files,
   updater URL and signing, supported systems (Windows 10 1803+, Linux glibc
   2.35+). Decide what becomes a promise.
2. Promote to **1.0.0** only if those promises can be kept; otherwise say why
   in the next minor's notes.
3. Revisit Windows signing.
4. Run a dependency and advisory pass (`pnpm`, `cargo`).
5. Check that `THIRD_PARTY.md` still matches what execs downloads.
6. Decide what to stop supporting. Dropping a system is a minor, announced in
   the previous minor's notes.

## Changelog

`CHANGELOG.md` becomes the GitHub release text and the updater's notes, so it
holds only what players can see.

Groups, in this order when present: **Added**, **Fixed**, **Changed**,
**Security**. Sentence case; name the pane or file when it helps. Breaking
changes go first under **Changed** and start with `Breaking:`.

Every user-facing pull request adds its line under `[Unreleased]` in the same
commit. The release workflow refuses to publish when the version's section is
missing or empty.
