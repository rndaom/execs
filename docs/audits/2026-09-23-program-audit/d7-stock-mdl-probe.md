# D7 stock MDL metadata probe

This audit-local script is a first, read-only check of whether the player's installed TF2 animation models expose enough structure for an independent Viewmodels pipeline. It does **not** replace the CompVMInstaller source, prove the 64-group feature can be rebuilt, or resolve D7.

## Source and safety scope

The parser follows Valve's pinned Source SDK 2013 definitions for [`studiohdr_t`](https://github.com/ValveSoftware/source-sdk-2013/blob/b8cfb12c0e083a2ef5b2f9f9b50f3902fa034474/src/public/studio.h#L2134-L2207), [`mstudioanimdesc_t`](https://github.com/ValveSoftware/source-sdk-2013/blob/b8cfb12c0e083a2ef5b2f9f9b50f3902fa034474/src/public/studio.h#L723-L797), and [`mstudioseqdesc_t`](https://github.com/ValveSoftware/source-sdk-2013/blob/b8cfb12c0e083a2ef5b2f9f9b50f3902fa034474/src/public/studio.h#L800-L905). It reads the 408-byte header and local animation/sequence metadata; sequence blend grids are checked against the animation table. It uses no CompVMInstaller ZIP, option mapping, or decompiler.

`d7_stock_mdl_probe.py` opens input files in binary read mode only. It caps a file at 8 MiB, a table at 4,096 records, a blend grid at 4,096 cells, and a name at 192 bytes. It checks the header length and every table, record-relative pointer, name, and animation index that it actually dereferences. It accepts MDL v48 only. No installed TF2 file, VPK, profile, or product code is written; tests use synthetic bytes and do not commit Valve models.

## Reproduce

The local Steam `libraryfolders.vdf` identified a TF2 install whose `tf/steam.inf` reported `appID=440` and `PatchVersion=10828683`. The nine `c_<class>_animations.mdl` files used for this check were previously extracted from that confirmed install's `tf2_misc_dir.vpk` into a scratch directory. The probe was run against those copies. The scratch directory is outside the repository and is not a shipped fixture.

```powershell
$copies = '<scratch model directory>' # Replace with a directory containing the nine MDL copies.
python docs/audits/2026-09-23-program-audit/d7_stock_mdl_probe.py $copies
python docs/audits/2026-09-23-program-audit/d7_stock_mdl_probe.py --names (Join-Path $copies 'c_scout_animations.mdl')
python -m unittest discover -s docs/audits/2026-09-23-program-audit -p 'test_d7_stock_mdl_probe.py' -v
```

The first command parsed all nine copies without error on September 24, 2026:

| Class | Local animations | Local sequences |
|---|---:|---:|
| Demo | 85 | 73 |
| Engineer | 110 | 98 |
| Heavy | 92 | 80 |
| Medic | 62 | 50 |
| Pyro | 98 | 86 |
| Scout | 103 | 91 |
| Sniper | 88 | 76 |
| Soldier | 109 | 97 |
| Spy | 115 | 97 |
| **Total** | **862** | **748** |

All nine metadata tables and sequence-to-animation references passed the probe. The synthetic test run passed nine cases, including truncation, out-of-bounds table/name references, invalid blend indexes and dimensions, and oversized input. The command prints each model's SHA-256, so a later run can detect changed input copies.

## What remains

Sequence labels and blend references are metadata, not geometry or decoded frame data. The probe cannot identify weapon/arm regions, safely hide them, reconstruct a compile-ready source model, establish the 64 UI groups, or prove an in-game result. A future independent pipeline would have to derive those semantics from installed TF2 assets, implement bounded decoding and transformation, build in isolated staging, and test both modes across the supported groups. The model hashes and sequence inventory can also key candidate inputs for the [isolated preview capture follow-up](../../design/2026-09-22-overhaul/implementation/viewmodel-preview-follow-up.md), but no render or screenshot was produced here.
