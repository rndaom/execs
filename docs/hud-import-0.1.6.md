# HUD import regressions — RND-303 / RND-304

The archive reader and profile ownership now use one component-level,
case-insensitive junk predicate. It omits `.bak`, `.cache`, `.ztmp`,
`.execs-part`, VCS/OS metadata and `node_modules`. Ordinary assets named
`backup_colors.res`, `cache`, or `file.bak.res` stay intact. The profile gate
still refuses unfiltered junk supplied directly; no manifest format changes.

`hud-junk.7z` is a synthetic LZMA2 fixture generated with py7zr 1.1.3. It
contains the three retained files in
`zip_7z_and_folder_imports_filter_the_same_profile_junk` plus that test's eight
junk paths, each containing `junk`. Tests compare exact ZIP/7z/folder results,
install and update the result, and check that refused writes preserve the
manifest and old live bytes. Archive limits and path validation are unchanged.

## Real-package check

The opt-in `pinned_catalog_huds_install_update_and_preserve_payloads` test
installs and updates actual downloaded packages in disposable game/profile
directories, comparing every retained payload against both live and library
bytes. Long profile staging paths exercise RND-303. Set `EXECS_HUD_FIXTURES`
to a directory containing these downloads (do not vendor them):

| Filename | Pinned codeload URL | SHA-256 |
| --- | --- | --- |
| hypnotizehud.zip | https://codeload.github.com/Hypnootize/hypnotizehud/zip/82d332540a82ab085ff1a14b9aef774982ac5b9e | `73e8ed011c9b912eeb5bdbbae61c6539e14f9f61ddcc7171d2c542995504c241` |
| kinhud.zip | https://codeload.github.com/kindredtf/kinhud/zip/ed528471a18eaaea7b97db689050491ab2db3316 | `6e851dd05357817f3fe1046ef1285069c71787b2bf6160ca90d4e9a1d710e9d0` |
| m0re-rockz.zip | https://codeload.github.com/rrkkss/m0re-edit/zip/431e2e9eb9f37e51fc3c4f679b2c3ed5a54ed5ca | `5c8a7022d73b6521dd6fd3f269644f4d0723a6db46dfd021b386dc4830c6bba9` |

Run:

```text
cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml -p execs-core --locked pinned_catalog_huds_install_update_and_preserve_payloads -- --ignored
```

The test verifies download hashes before extraction and performs no network
requests or changes to a real TF2 install. This is an install-integrity test,
not evidence of in-game rendering.

## Documentation and local validation

[Valve's HUD compatibility announcement](https://www.teamfortress.com/post.php?id=22759)
requires `info.vdf` at the HUD root with a matching `ui_version`; junk removal
does not synthesize compatibility metadata or choose among multiple HUD roots.
The junk extensions are execs' existing ownership policy, not a claim that
Valve forbids those names.

[Microsoft's path documentation](https://learn.microsoft.com/en-us/windows/win32/fileio/maximum-file-path-limitation)
requires both policy and manifest opt-in for unprefixed long paths. The RND-303
fix uses canonicalized, extended Windows parent paths at both direct move
endpoints and retains the leaf, supporting absent destinations and existing
containment checks. Reviewed without finding a new defect.

September 18 Windows verification: all three pinned downloads match the hashes
above. The opt-in install/update probe passes for HypnotizeHUD, kinhud and
m0re-rockz in disposable roots, checking all retained live/library bytes and
long staging paths with Windows `LongPathsEnabled=0`.

Application Control initially refused the installed compiler with error 4551.
An official Rust 1.96.0 toolchain installed alongside it runs these checks
without changing security policy. The integrated workspace suite passes 769
tests, with 16 opt-in tests explicitly ignored by the normal run; workspace
Clippy passes with warnings denied. Rust formatting and whitespace checks pass.

The signed candidate workflow
[35353749221](https://github.com/rndaom/execs/actions/runs/35353749221)
is ongoing at this documentation update. The local probe does not establish
in-game rendering or completion of candidate CI and packaged installer checks.
See the [0.1.6 release record](release-0.1.6.md) for final provenance and gates.
