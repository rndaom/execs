# 0.1.4 release

Scope: Linear milestone **0.1.4**, RND-211, RND-216, RND-224, RND-238,
RND-260, RND-261, RND-262 and RND-263. The owner assigned this bounded
crosshair update to the patch. Work starts at maintenance commit `6d09490`,
which contains public **0.1.3 Hotfix 1** and its publication evidence.
Unrelated creator-profile and profile-preloader work stays on the minor track.
The owner added the Linux AppImage startup fix on September 9 and authorized
publication after verification.

## Behavior

- In-game and Custom are exclusive. Switching away from Custom moves its
  complete owned tree below `execs-crosshairs/inactive/` in the existing
  recoverable file transaction. Its scripts and materials no longer override
  TF2 content. The record, assets, assignments and stock selection survive.
- Color and size use the existing scoped cfg autosave. Custom pack changes
  require Build pack. Unbuilt edits retain a separate pending guard and an
  explicit discard action; profile transitions cannot silently drop them.
- The color picker keeps RGB authoritative and accepts precise hex input.
  The field, hue and accessible saturation/brightness controls feed the same
  RGB cvars in both modes. No second pack-color owner remains.
- Source tabs separate built-ins, named designs, community entries and PNG
  import. New built-ins use `execs-` names so they cannot replace the existing
  community chevron. Named designs preserve the legacy single-design format.
- The sprite request retries after cancellation or failure. Ordinary autosaves
  no longer display the global pending-profile/discard banner; Files retains
  its separate exit contract and autosaves retain their transition guards.

## Size specification correction

The original RND-263 acceptance text proposed modifying weapon-script width
and height. Valve uses those fields to calculate **texture coordinates**, so
that change alone crops sprites. The implementation preserves those intrinsic
dimensions and uses `cl_crosshair_scale` (16–64), which scales both stock and
weapon-defined sprites. Existing profiles without optional size metadata keep
their cfg scale. Stock file and size are retained separately when building.

Sources inspected September 8, 2026: Valve's
[HUD texture reader](https://github.com/ValveSoftware/source-sdk-2013/blob/master/src/game/client/hud.cpp),
[weapon-defined crosshair renderer](https://github.com/ValveSoftware/source-sdk-2013/blob/master/src/game/client/hud_crosshair.cpp)
and [TF2 stock renderer](https://github.com/ValveSoftware/source-sdk-2013/blob/master/src/game/client/tf/tf_hud_crosshair.cpp).
The preview uses a labeled 1280×720 reference with weapon scale 1. Weapon
effects, HUD-provided crosshairs and other game resolutions can differ.

The scene is the existing `scout_blank.jpg` from CompVMInstaller commit
`b215a5cdfcd809ec3c2d71529e7a1eb22a72a39e`, fetched at runtime. The source
image was inspected; it contains no baked crosshair. No Valve image is vendored.

## September 8 crosshair verification

Historical candidate checks, before the Linux packaging fix:

- Crosshair candidate code: `c030623c4f77d9226dffcb677736273980bbb852`.
  [Release preparation PR #44](https://github.com/rndaom/execs/pull/44) and
  [private verification run](https://github.com/rndaom/execs/actions/runs/34293583908).
- 413 desktop tests, 105 cfglint tests and 19 release-script tests pass;
  Windows native validation passes 679 tests plus the explicit installed-asset
  test. The candidate's frontend, Windows and Linux CI also pass.
- Frontend/cfglint and release-script tests; Biome; TypeScript/Vite production
  build; Rust formatting, workspace tests and Clippy with warnings denied.
- New UI tests cover explicit mode/build actions, rejected builds, deferred
  size changes, preserving unbuilt shapes through color saves, precise/invalid
  hex input and intrinsic non-square preview sizing. Existing autosave tests
  cover coalescing, failed/retried writes and changes during an in-flight save.
- The real SettingsHost reproduces leaving during the first stock decode,
  accepts the replacement response and ignores an obsolete response.
- Discard restores the stored design preview, preview caches reset by profile,
  and a legacy dot can shrink below its previous hidden geometry floor.
- Native round-trip checks include a 31×47 VTF, byte preservation, saved sizes,
  the TF2 write lock, failed builds, external drift refusal, inactive ZIP
  export/import, switching, absorb and reactivation.
- An explicit installed-asset test reads the user's actual stock sprites and
  weapon scripts, builds at sizes 16/32/64 **only in a temporary profile/root**,
  then deactivates it. Both source `_dir.vpk` hashes remain identical. Run with
  `EXECS_TEST_TF2_ROOT` and the ignored test
  `installed_assets_build_only_into_an_isolated_profile`.
- Browser interaction and visual checks cover the pane and designer, including
  the 960×640 minimum window. The designer's expanded options use a grid;
  the crosshair hero retains its preview beside the controls at that width.

## Combined candidate verification

[PR #46](https://github.com/rndaom/execs/pull/46) adds the Linux startup fix
at `86e5c1044ae93282d3dc2146747211c815670eb6`.
[Private candidate run 34422345530](https://github.com/rndaom/execs/actions/runs/34422345530)
passed frontend, Linux and Windows validation, both package builds, signed
upgrades from 0.1.3 Hotfix 1 and final signed asset/feed verification.
Publication was skipped for that rehearsal.

The combined revision passes 413 desktop, 105 cfglint, 24 release-script and
689 Linux native/integration tests, plus formatting, Clippy, Biome and the
production build. The explicit installed-asset test reads actual TF2 sprites
and scripts, writes only an isolated profile/root, and leaves both source VPK
hashes unchanged. Browser fixture layouts were checked at 1280×900 and 960×640.

The exact signed Linux candidate rendered on the affected Omarchy host without
any graphics environment overrides, using isolated application data and a
private session bus. Its SHA-256 is
`121c158f6c972db5af0604fa8aa3d4eb1aee5f8944ee3cf36584b17cb262e8d3`.

PRs #46 and [#44](https://github.com/rndaom/execs/pull/44) are merged.
[PR #45](https://github.com/rndaom/execs/pull/45) is merged into main, preserving
creator review and profile-owned preloaders for the unreleased 0.2.0 track.
Its final integration passes 418 desktop, 105 cfglint, 24 release-script and
700 Linux native/integration tests, as well as frontend/Windows/Linux CI.

The original September 8 reports under `audits/2026-09-08-0.1.4/` are historical
crosshair-candidate evidence. The combined candidate and tagged workflow
supersede them for the released artifact.

## Publication

Tag `v0.1.4` points to `12bb5a8effb8aebe77c6cfc4d8cd03d9bef45cdd`, the PR #44
merge commit. Its complete tree matches the verified combined candidate.
[Tagged workflow 34424094674](https://github.com/rndaom/execs/actions/runs/34424094674)
passed all validation, builds, signed upgrade checks, verification and
publication. [0.1.4](https://github.com/rndaom/execs/releases/tag/v0.1.4) was
published as the latest stable release on September 10, 2026 at 01:32 UTC
(September 9 in America/New_York).

Unauthenticated downloads through the actual Windows and Linux updater URLs
passed independent Minisign verification, size and SHA-256 checks. Public
`latest.json` contains both supported platforms and excludes `.deb` from
self-update. Public `release-commit.json` matches the tag and publishing run.
The final public AppImage also rendered on the affected Omarchy host without
graphics overrides, using isolated data; TF2's path was not confirmed and no
live game files were written.

Final evidence:
[Windows upgrade](audits/2026-09-09-0.1.4/windows-package-smoke.json),
[Linux upgrade](audits/2026-09-09-0.1.4/linux-package-smoke.json),
[public downloads and native launch](audits/2026-09-09-0.1.4/public-verification.json),
and [local validation](audits/2026-09-09-0.1.4/local-verification.json).

The cumulative live-game/Steam Cloud/Casual matrix remains tracked by RND-251
before 0.2.0. Fixture previews and isolated installed-asset tests do not claim
live multiplayer coverage or the owner's subjective in-game appearance review.

## September 9 Linux startup fix

Public 0.1.3 Hotfix 1 aborts during WebKit startup on Omarchy with current
NVIDIA/Mesa drivers. Loader diagnostics identify missing
`wl_fixes_interface` and `wl_display_create_queue_with_name` when host EGL
drivers load against the AppImage's older bundled Wayland client library.
Removing the bundled Wayland libraries makes the extracted app and a rebuilt
AppImage render without graphics environment overrides on the affected host.
The unchanged public image also renders when its process preloads the host
Wayland client library; no system graphics settings are changed.

The before-bundle hook installs an output-plugin wrapper in the Cargo target
directory's `.tauri` cache (`bundle.useLocalToolsDir`). It removes only Wayland
shared libraries after GTK/GStreamer deployment and before SquashFS packaging
and Tauri signing. WebKit, GStreamer, application data and the Windows package
are unchanged. The upstream output plugin is SHA-256 pinned; a moved upstream
asset fails closed and requires reviewing/updating the pin.

Regression tests cover multiarch and versioned libraries, symlink containment,
plugin discovery, argument forwarding and packaging failures. Installer smoke
also checks the actual extracted candidate for bundled Wayland libraries.
The combined candidate passed signed Windows/Linux upgrade verification.
Local repackaging established the diagnosis; only the workflow-built, signed
artifacts are distributed to users.
