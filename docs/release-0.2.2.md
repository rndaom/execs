# 0.2.2 release

0.2.2 is a patch after public [0.2.1](https://github.com/rndaom/execs/releases/tag/v0.2.1).
It carries user-visible features, so the release policy asks for the owner's
explicit assignment. On October 1, 2026 the owner kept the name 0.2.2 rather
than 0.3.0: the rebuilt Crosshair pane brings back choices earlier versions
already offered (designs, PNG and VTF imports, per-weapon crosshairs), and
GameBanana Sounds and map installs are small additions to Mods. Nothing in it
is a breaking change.

There is no Linear issue list for this patch; the pull requests below are its
scope.

## Scope

- [#149](https://github.com/rndaom/execs/pull/149) boot splash test clock (tests only).
- [#150](https://github.com/rndaom/execs/pull/150) removes the unreviewed direct mod
  import commands; every install goes through the reviewed chooser.
- [#151](https://github.com/rndaom/execs/pull/151) current-public package baselines
  from authentic v0.2.1 exports (CI only).
- [#152](https://github.com/rndaom/execs/pull/152) unit tests can never discover the
  real Steam install (the September 30 Cloud `config.cfg` incident).
- [#153](https://github.com/rndaom/execs/pull/153) mod archive, notice and PDA
  crosshair fixes: WinRAR Quick Open, flat textures, Deflate64, high-dictionary 7z,
  greyed-out VPK choices, wrapper folder names, readable 7z errors, fading error
  notices with Dismiss, GUI mods and maps installing from Mods.
- [#155](https://github.com/rndaom/execs/pull/155) GameBanana Sounds, with hit and
  kill sounds handed to Sounds instead of installed as packs.
- [#156](https://github.com/rndaom/execs/pull/156) AppImage output plugin re-pin (CI only).
- [#154](https://github.com/rndaom/execs/pull/154) the Crosshair pane rebuilt around
  one gallery and a true-size preview.
- [#158](https://github.com/rndaom/execs/pull/158) fixes from the pre-release audit
  of everything since v0.2.1.

## Pre-release audit

A review of the whole `v0.2.1..main` diff on October 1 found no blockers and eight
small problems, all fixed in #158: a GameBanana download with a greyed-out choice
beside its only installable one kept a wrapper folder name; the true-size preview
read gamescope's `-W`/`-H` before `%command%` as TF2's resolution; Snap Steam's
`registry.vdf` was not read; Switch to TF2's crosshair could leave the cvar draft
on a different file than the one written; plus case handling for `.vmf` and `.vpk`
names and a needless copy of downloaded sounds. Dependency advisories are
unchanged from 0.2.1 (all transitive through Tauri's Linux GTK stack), and no open
GitHub issue or Linear item targets this release.

## Compatibility walk

- Profiles and exports from public 0.2.1 still load. Crosshair records gain values
  (`tf-default`, `tf-crosshair1`–`7`, `shape-*` names and named designs) that are
  additive; earlier built-in shapes stay buildable and selectable while a profile
  uses one. A 0.2.2 export that uses a TF2 crosshair inside a pack does not import
  into 0.2.1, which expects a material for every crosshair choice; older versions
  reading newer exports is not a release promise.
- TF2 writes stay inside `tf/custom/`, the cfg layer and the Steam Cloud
  `config.cfg` copy. Maps install as ordinary custom packs (`maps/`,
  `scripts/population/` inside the pack); a crosshair pack omits scripts for weapons
  kept on TF2's default. The preloader exception is unchanged and
  `tf2_misc_*_dir.vpk` is never written.
- The crosshair preview reads TF2's saved resolution (Windows registry or Steam's
  `registry.vdf`) read-only. GameBanana sounds are prepared into the existing
  `hitsound-cache/picked/` store and are installed only by Sounds' Use and Apply.
- The `zip` crate gains Deflate64 decoding. Mod archives no longer have a
  compression-ratio limit (byte, entry and file-count ceilings still apply);
  profile ZIP imports keep a 1100x ratio guard above deflate's ceiling.

## Checks before the tag

- PR checks on #154, #155, #158 and the release PR, and a private candidate run
  (`workflow_dispatch` with `release_tag=v0.2.2`) that builds signed Windows and
  Linux installers into a private draft and upgrades public 0.2.1 on both
  platforms with the profile library preserved.
- `scripts/fixtures/package-smoke-v021.json` holds the authentic v0.2.1 exports
  the installer smoke seeds (see `scripts/fixtures/README.md`).

## Not checked automatically

These are outside what fixtures and CI can prove; the owner decides whether any
must be tried in the installed candidate before the tag:

- Build a crosshair pack in the installed app and see the "not in TF2 yet" bar
  clear; compare the Actual size preview with the crosshair in game.
- Install a GameBanana map and load it in TF2 with `map <name>`.
- Use a GameBanana hit or kill sound through Use in Sounds and hear it in game.
- Install a RAR mod saved with WinRAR's default settings.
- Linux in person (CI covers the Linux builds, the native smoke and packages).

## Candidate

Not run yet.
