# 0.1.4 preparation

Scope: Linear milestone **0.1.4**, RND-211, RND-216, RND-224, RND-238,
RND-260, RND-261, RND-262 and RND-263. The owner assigned this bounded
crosshair update to the patch. Work starts at maintenance commit `6d09490`,
which contains public **0.1.3 Hotfix 1** and its publication evidence.
Unrelated creator-profile and profile-preloader work stays on the minor track.

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

## Verification

Local Windows checks:

- Frontend/cfglint and release-script tests; Biome; TypeScript/Vite production
  build; Rust formatting, workspace tests and Clippy with warnings denied.
- New UI tests cover explicit mode/build actions, rejected builds, deferred
  size changes, preserving unbuilt shapes through color saves, precise/invalid
  hex input and intrinsic non-square preview sizing. Existing autosave tests
  cover coalescing, failed/retried writes and changes during an in-flight save.
- The real SettingsHost reproduces leaving during the first stock decode,
  accepts the replacement response and ignores an obsolete response.
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

## Release gates

Publication is not authorized by this preparation task. No public tag or
release is created as part of implementation.

- [ ] Exact candidate Windows/Linux CI and package builds
- [ ] Signed updater and installer smoke from public 0.1.3 Hotfix 1
- [ ] Candidate asset/feed verification
- [ ] Owner review of the crosshair workflow and live in-game appearance
- [ ] Carry the patch into the 0.2.0 branch
- [ ] Owner-authorized tag/publication, then milestone closure

The cumulative live-game/Steam Cloud/Casual matrix remains tracked by RND-251.
Fixture and isolated-asset tests do not claim that live multiplayer matrix.
