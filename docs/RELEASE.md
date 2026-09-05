# Releases

Users install published GitHub Releases. Development stays on Linear and
`main`. This file is the playbook; `AGENTS.md` keeps the durable rules.

Current public version: **0.1.0** (2026-09-03).
Next minor: **0.2.0**, first Thursday of the month, skipped if the budget is empty.

## Who sees what

| Surface | Who | What it is |
|---|---|---|
| [GitHub Releases](https://github.com/rndaom/execs/releases) | Everyone | The only supported install. In-app updater reads `latest.json` from `/releases/latest`. |
| [GitHub Issues](https://github.com/rndaom/execs/issues) | Everyone | Public inbox. Not the backlog. |
| [Discussions](https://github.com/rndaom/execs/discussions) | Everyone | Questions and ideas. Not a commitment to build. |
| [Linear · execs](https://linear.app/rndaom/project/execs-a89f9a30e95c) | You | The backlog, the milestone, the work. |
| `main` | You | Development. CI green. May be ahead of the last tag. |
| Draft / `workflow_dispatch` builds | You | Installer smoke only. Never a download link. |

No nightlies, no public prereleases, no "try this build" from `main`. A
prerelease tag would hide `/releases/latest` only if it is marked
prerelease; do not introduce that channel until there is a reason.

Unsolicited pull requests: thank them, move the idea to an issue, and
decline anything that touches the write surface, the updater, or the
profile format unless you asked for it.

## Versioning

`0.Y.Z` until a yearly review promotes **1.0.0**. The four product files
always match the tag `v0.Y.Z`:

- `apps/desktop/package.json`
- `apps/desktop/src-tauri/tauri.conf.json`
- `apps/desktop/src-tauri/Cargo.toml`
- `apps/desktop/src-tauri/core/Cargo.toml`

| Bump | When | Features | Data / write surface |
|---|---|---|---|
| **Patch** `0.Y.Z+1` | Anytime. Same day if install, updater, data-loss, or write-lock is broken. | None. | No new features or incompatible schema change. Older profiles still load; additive internal recovery metadata needed for a bug fix is allowed. |
| **Minor** `0.Y+1.0` | Monthly train (below). Skip if nothing is ready. | At most **three** user-visible features, or one large feature that is the whole release. | Additive only. A 0.1.0 profile still loads. |
| **1.0.0** | Yearly review says the contracts are stable. | — | Profile format, write surface, updater URL, and OS matrix are promises. |

A user-visible feature is something a player notices in a pane or on
first run. Refactors, tests, copy, and process docs are not features and
do not wait for a train.

**Breaking** (new minor at minimum, plus a migration note in
`CHANGELOG.md`): changing which files we write, a profile or manifest
change that an older execs cannot read, a new updater URL or signing
key, or dropping an OS / glibc target. Never in a patch.

## Compatibility classes

Label Linear issues `compat` when they touch profiles, the data dir, the
write surface, or the updater. Those lines are required in the notes.

Before every tag, walk this list:

- A profile exported from the last public version still imports.
- Absorb still classifies packs the same way.
- The write lock still refuses live-surface writes while TF2 runs.
- Nothing new is written outside `tf/custom/`, `tf/cfg/overrides/` (or
  vanilla user cfg), and the Steam Cloud `config.cfg` copy — except the
  documented preloader exception.
- `tf2_misc_*_dir.vpk` is still never written.
- `latest.json` will list both `windows-x86_64` and `linux-x86_64`.

## GitHub and Linear

Linear is private planning. GitHub is the public desk.

1. A GitHub issue or discussion arrives.
2. Same day: reproduce, ask for a log, or close with a reason.
3. If it is real work, open a Linear issue on the execs project, label
   `from-github`, and paste the GitHub URL. Add `compat` when it applies.
   Bug / Feature / Improvement stay the type labels.
4. Commit it to a version milestone only when it is in that minor's
   feature budget, or when it is patch-class and you will ship it now.
5. When the version that contains it is published, comment the version
   on the GitHub thread and close it.

Do not keep a second backlog on GitHub. Issues you will not do are
closed ("not planned") rather than left open as a wish list.

Project milestones are the release buckets (`0.2.0`, `0.3.0`, …). Do not
turn on Linear cycles — they are not tied to releases. Linear's Releases
feature needs a Business plan and a CI key; skip it. The GitHub tag is
the record of what users have.

## Cadence

### Every day (about 15 minutes)

1. [GitHub Issues](https://github.com/rndaom/execs/issues) — new threads
   and comments. Patch-class bugs leave this list as a Linear issue the
   same day, not at the end of the month.
2. [Discussions](https://github.com/rndaom/execs/discussions) — answer or
   convert a real request into a GitHub issue, then into Linear.
3. Linear execs project — triage, not a standup. Move work; do not
   admire the board.
4. If the last publish is less than 48 hours old, read new issues before
   anything else.

Nothing else is daily. Download counts and stars wait for the month.

### First Thursday of the month (the minor)

Skip the train when the Unreleased section has no user-facing feature
and no stacked fixes worth a tag. Empty months are correct.

When you do ship:

1. Freeze the milestone. Anything over the three-feature budget moves to
   the next minor. Do not add "one more thing" on release day.
2. Run the compatibility list.
3. Move `CHANGELOG.md` `[Unreleased]` into `## [0.Y.0] - YYYY-MM-DD`
   and leave a fresh empty `[Unreleased]`.
4. Bump the four version files. Commit. Tag `v0.Y.0` and push the tag.
5. Wait for the Release workflow: both platforms, draft, notes from
   the changelog, `latest.json` verified, then publish.
6. Watch GitHub Issues for 48 hours. A broken install or updater is a
   same-day patch, not a note on the next minor.
7. Open the next milestone. Pick a theme and at most three features.
   Leave the rest in the backlog.

### Anytime (a patch)

A patch is a bug the last public version has, with no feature attached.
Bump `Z`, write the changelog section, tag, done. If `main` already has
an unreleased breaking change, cut `release/0.Y` from the last tag,
patch there, and tag from that branch. Use a separate patch branch whenever main also contains unreleased features. Until that happens, patch from
`main`.

### Once a year (the first Thursday of September)

1. Compatibility: profile format, data dir layout, write surface,
   updater URL and signing, OS matrix (Windows 10 1803+, Linux glibc
   2.35+). Decide what is now a promise.
2. **1.0.0** — only if those promises can be kept. Otherwise stay on
   `0.Y.Z` and say so in the notes of the next minor.
3. Signing / SmartScreen (Authenticode, SignPath).
4. Dependency and advisory pass (`pnpm`, `cargo`).
5. `THIRD_PARTY.md` still matches what we fetch.
6. What to stop supporting. Dropping a target is a minor with a warning
   in the previous minor's notes.

## Ship checklist

- [ ] Milestone frozen; leftover issues moved off it
- [ ] Compatibility list walked
- [ ] `CHANGELOG.md` has a non-empty `## [X.Y.Z]` section
- [ ] Four version files equal `X.Y.Z`
- [ ] Tag is `vX.Y.Z` on that commit
- [ ] Release workflow published; both platforms in `latest.json`
- [ ] GitHub issues that shipped are commented and closed
- [ ] Linear milestone issues are Done
- [ ] Next milestone exists with a theme and a budget of three

`workflow_dispatch` builds a draft for the current version and never
publishes. Use it to inspect installers. To ship, push a tag.

## Changelog

`CHANGELOG.md` is the source of the GitHub release body (and therefore
the updater notes field). User-facing only. A line a player cannot see
does not belong.

Groups, in this order when present: **Added**, **Fixed**, **Changed**,
**Security**. Sentence case. Name the pane or the file when it helps.
Breaking changes go first under **Changed** and start with `Breaking:`.

Every user-facing pull request adds its line under `[Unreleased]` in the
same commit as the change. The release workflow fails the publish if
that version's section is missing or empty.
