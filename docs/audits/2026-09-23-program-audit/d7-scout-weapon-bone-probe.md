# D7 — Scout weapon-bone scratch candidate

**Status: structural feasibility evidence only; D7 remains open.** This audit-only experiment tests a possible hands-visible, weapon-only transform in the player's installed Scout animation model. It does not prove a visible result, a working Viewmodels builder, 64-group parity, or redistribution rights.

## Source basis and input

Valve's pinned [`mstudiobone_t`, `mstudiolinearbone_t`, `mstudioanim_t` and `mstudioanimdesc_t` definitions](https://github.com/ValveSoftware/source-sdk-2013/blob/b8cfb12c0e083a2ef5b2f9f9b50f3902fa034474/src/public/studio.h) describe the two default-position tables, raw `Vector48` positions, compressed animation channels and section tables. Valve's [`pAnim` implementation](https://github.com/ValveSoftware/source-sdk-2013/blob/b8cfb12c0e083a2ef5b2f9f9b50f3902fa034474/src/public/studio.cpp) selects local animation sections. [`CalcVirtualAnimation` and `CalcBonePosition`](https://github.com/ValveSoftware/source-sdk-2013/blob/b8cfb12c0e083a2ef5b2f9f9b50f3902fa034474/src/public/bone_setup.cpp) read linear positions when present, use a raw position directly, or add a compressed channel to a default position. These Source SDK definitions inform the byte experiment; they are not a retail TF2 render test.

The input is a scratch copy read from the confirmed app-440 installation's `tf2_misc_dir.vpk` (patch `10828683`). The VPK reader checked the stock entry CRC-32 and the complete MDL SHA-256: `da6aba88bfa1a2f0c55f2f0f376eacc2550b1c82343c56e4f01473f7b6d30710`. The separate [viewer preflight](d7-scout-root-offset-probe.md#read-only-viewer-preflight-september-24-2026) established that `c_scout_arms.mdl` is a renderable parent which includes this animation model, and that the animation model itself has no bodyparts. This probe does not reread or modify the parent.

## Candidate and checks

[`d7_scout_weapon_bone_probe.py`](d7_scout_weapon_bone_probe.py) accepts only the exact hash-pinned Scout animation MDL copied below the OS temporary directory. It writes a new scratch file under a unique OS-temporary-directory path. It never writes to the TF2 installation, profile library, repository model assets or product builder. Run Python with `-B` to avoid import-cache files in the repository.

The model has 17 `weapon_bone` / `vm_weapon_bone` bones that are direct children of `bip_hand_L` or `bip_hand_R`; neither hand descends from one of them. The candidate sets **only the local Z position** of those 17 bones to `-4096` in both default-position tables, and sets the raw-position Z for each weapon record with a raw `Vector48` position. For compressed weapon-position records, it leaves the encoded channel intact and shifts the default position used by `CalcBonePosition`. The probe checks every affected compressed pointer and run within its bounded bone record, and bounds each weapon position scale so its maximum signed-short displacement is less than 1024 units. It leaves hand, root, rotation, parent, sequence, weight, inverse-bind and other bytes unchanged.

On this exact stock input, the bounded walk found 103 local animations represented by 138 local chains, including all sections of six sectioned animations. It found 278 raw and 324 compressed weapon-position records. The candidate changed 17 default Z fields, 17 linear Z fields and 278 raw half-float Z fields. All 692 bytes within those fields changed; an independent whole-file comparison found exactly 692 differing bytes and no length or MDL-header-checksum change. Both files are 439,268 bytes. The output SHA-256 is `59ac3b24d586818a6a9ac64258160031d76ca41e3898da071e00f280a5f9da29`. The metadata parser accepted the candidate with the same animation and sequence descriptors and links. The unmodified root and hand bone records were also compared byte-for-byte.

One important qualification came from the sequence weight tables: `r_handposes` has eight zero-weight weapon-bone cells. The candidate bytes cover the associated animation records, but zero-weight cells may cause other pose or layer state to govern those bones. The structural probe therefore cannot claim that every rendered weapon piece moves off screen.

Eleven [synthetic tests](test_d7_scout_weapon_bone_probe.py) exercise raw and compressed paths, section coverage, changed-byte confinement, the input hash, missing/out-of-bounds linear tables, malformed compressed runs, short raw records, invalid bone parenting and zero-weight reporting. No Valve model bytes are committed as fixtures.

To rerun against a scratch copy already extracted and CRC-checked from that exact installed VPK:

```powershell
$py = '<Python interpreter>'
$copy = '<OS temp directory>/c_scout_animations.mdl'
& $py -B docs/audits/2026-09-23-program-audit/d7_scout_weapon_bone_probe.py $copy
& $py -B -m unittest discover -s docs/audits/2026-09-23-program-audit -p test_d7_scout_weapon_bone_probe.py -v
```

## Remaining validation

- The new scratch MDL has **not** been loaded in HLMV, combined with a renderable Scout arms/weapon model, packed into a product VPK, installed in a profile, or run in retail TF2. The earlier [viewer preflight](d7-scout-root-offset-probe.md#read-only-viewer-preflight-september-24-2026) could not establish a safe isolated viewer side-write boundary, so no viewer was launched. Whether a weapon remains visible through other attachments, blending, procedural bones or different model files is unknown.
- Only one installed Scout animation model was tested. This is an all-sequence offset experiment, not the selected 64 per-class groups. It has no independent item-to-animation mapping, per-group isolation, migration of saved `yttrium-1` selections, Linux build path or retail behavior checks.
- Keeping the MDL checksum and companion files unchanged is a structural fact, not proof that the engine will accept the override or keep companion relationships valid. Model geometry, animations, transforms and third-person consequences need isolated visual and retail testing before product use.
- The output contains transformed Valve model bytes only in OS scratch space. [Valve's Source-mod distribution guidance](https://partner.steamgames.com/doc/sdk/uploading/distributing_source_engine?l=english) needs a separate applicability review before any generated profile ZIP containing such bytes can be shared. This experiment does not settle that question or the third-party rights in the [D7 register](d7-asset-rights.md).
