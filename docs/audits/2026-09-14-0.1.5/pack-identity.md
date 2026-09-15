# 0.1.5: pack identity and cfg loader

Issues: **RND-275**, **RND-276**. Implementation starts at `fae34cf` on
`codex/0.1.5-pack-identity`, the 0.1.5 maintenance worktree. All disk probes use
temporary fake installs with explicit empty Steam roots. No user cfg, profile
library, Steam Cloud file or retail game archive is modified.

## Reproduction and result

- **RND-275:** the new unchanged two-pack fixture fails before the fix:
  `-alpha/materials/a.txt` is reported changed and `alpha/materials/a.txt`
  missing. After the fix, dashed and undashed paths retain their own hashes
  through capture, absorb, export/import and switch. Disjoint and identical
  relative filenames are covered. Keep, Update and Restore remain separate;
  removing an owned pack cannot remove a peer with identical bytes.
- **RND-276:** the empty-overrides fixture fails before the fix with
  `Comfig` instead of `Vanilla`. Afterwards, empty/nonempty leftovers and a
  standalone addon agree between inventory and profile detail, retain nested
  `personal/practice.cfg`, and append managed execs to the vanilla autoexec.
  Real base, renamed VPK, dashed VPK and extracted-base fixtures use overrides.
  Removing the live base refuses a stale managed write; Update then selects
  vanilla while retaining the old override bytes.

The generic dash remapping and removal fallbacks are gone. HUD keys are literal
too. The remaining old-HUD recovery requires a recorded inactive plain HUD,
an absent plain live folder, and an unowned dashed counterpart. Owned peers
and unknown dashed HUDs retain their usual absorb behavior. Old ambiguous
collapsed identities are not guessed back into another pack's ownership.

One content detector now serves inventory and profile-based cfg decisions.
It considers mounted custom children in alphabetical order, then the ordinary
cfg layer, and recognizes the supported top-level startup path from
`comfig/comfig.cfg` to `overrides/autoexec.cfg`. Both relevant cfg files must
exist, and the core must contain a command. Comments and deferred bind/alias
payloads do not establish execution. It retains at most two cfg members,
each bounded to 1 MiB; VPK tree/materialization limits remain enforced. A
filename or an overrides folder alone cannot establish Comfig. Safe nested
cfgs and overrides are captured in both layers.

## Primary sources checked

- [Valve's wildcard search-path loader](https://github.com/ValveSoftware/source-sdk-2013/blob/b8cfb12c0e083a2ef5b2f9f9b50f3902fa034474/src/public/filesystem_init.cpp#L803)
  excludes leading dots, accepts dashed directories, sorts paths and mounts
  each accepted path. The literal-name fix follows that behavior.
- [mastercomfig's base packaging script](https://github.com/mastercomfig/mastercomfig/blob/d947673e721d686a64a3e7055f38197556a3405b/dev/presets/package.sh)
  generates the startup autoexec with direct core and overrides execs. The
  [core alias definitions](https://github.com/mastercomfig/mastercomfig/blob/d947673e721d686a64a3e7055f38197556a3405b/config/mastercomfig/cfg/comfig/comfig.cfg#L1986)
  and [custom cfg documentation](https://github.com/mastercomfig/mastercomfig/blob/d947673e721d686a64a3e7055f38197556a3405b/docs/customization/custom_configs.md)
  corroborate the user override location and startup behavior.
- Public **9.100.1** assets were downloaded into the external evidence folder,
  never vendored. The ignored manual-source regression verifies exact hashes,
  production inventory, saved detail and managed binds routing:

| Asset | Bytes | SHA-256 | Result |
| --- | ---: | --- | --- |
| [Base](https://github.com/mastercomfig/mastercomfig/releases/download/9.100.1/mastercomfig-base.vpk) | 120273 | `cdabc8251864a1ab2ef7f7ffed1b44f52810956e476d62183b8d7e3e960d8650` | Comfig |
| [No soundscapes addon](https://github.com/mastercomfig/mastercomfig/releases/download/9.100.1/mastercomfig-addon-no-soundscapes.vpk) | 268 | `dfe1da93f6bd09c71df1592e9bb33b044c076b8a33fab370f8e6928dadbe44d9` | Vanilla |

## Validation

Executed on Windows with a dedicated `CARGO_TARGET_DIR` at
`G:/Projects/execs-015-evidence/target-packs`:

```powershell
cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml -p execs-core --locked -- --test-threads=6
# 574 unit + 7 absorb integration + 8 pack integration passed;
# 3 existing unit ignores and 1 explicit-download source probe ignored.

$env:EXECS_TEST_MASTERCOMFIG_DIR = 'G:/Projects/execs-015-evidence/pack-sources'
cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml -p execs-core --test pack_identity --locked -- --include-ignored --nocapture
# Final 10 pack tests passed, including the added HUD-peer and public-asset tests.

cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml -p execs-core --lib --locked windows_pack_keys_fold_case_but_preserve_dashes
# Added Windows case/dash regression passed.
cargo clippy --manifest-path apps/desktop/src-tauri/Cargo.toml -p execs-core --all-targets --locked -- -D warnings
cargo fmt --manifest-path apps/desktop/src-tauri/Cargo.toml --all --check
git diff --check
```

Logs: `G:/Projects/execs-015-evidence/pack-core-tests.log`,
`pack-regressions.log`, and `pack-clippy.log`.

A separate suite run overlapped the root task's short retail fixture and
correctly refused writes with `GameRunning`; the complete passing rerun above
took place after it exited. The final checks use an isolated Cargo target,
avoiding cross-worktree executable/fingerprint reuse.

### Nested-folder review follow-up

The integration review found that the existing recursive vanilla collector
applied its special `user`, `app`, and `overrides` directory rules at every
depth. A fresh API regression failed on missing
`tf/cfg/personal/user/aim.cfg`; these nested paths were profile-ownable but
silently omitted by capture. The exclusions now apply only to immediate
`tf/cfg` children.

`nested_cfg_folder_names_survive_capture_export_and_switch` passes for both
vanilla and mastercomfig. It checks nested `user`, `app`, and `overrides`
payloads through capture, export/import, removal and reapplication; root
overrides remain captured. Root `user` and `app` files retain their original
live bytes, and only their migrated copies enter the manifest.

Follow-up checks passed: all **11** pack integration tests (including the
explicit public-asset probe), all **13** surface unit tests, core all-targets
clippy, workspace formatting and `git diff --check`. Logs are
`G:/Projects/execs-015-evidence/pack-nested-regressions.log`,
`pack-nested-surface-tests.log`, and `pack-nested-clippy.log`. The parent task
runs the full native matrix after integration.

## Limits

The detector recognizes the supported direct startup loader; it does not
evaluate arbitrary custom alias graphs, launch-option execs or custom
`gameinfo.txt` search-path arrangements. These tests prove file attribution,
cfg routing and byte preservation in the core APIs. They do not claim a retail
TF2 launch or remote Steam Cloud synchronization. Linux-specific case tests and
the full desktop/release matrix remain integration checks for the main task.
