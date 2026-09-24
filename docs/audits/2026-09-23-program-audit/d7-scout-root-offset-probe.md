# D7 — one Scout animation root-position experiment

**Status: scratch feasibility evidence only; D7 remains open.** This experiment tests one way to alter an installed stock animation model without using CompVMInstaller source files or its group map. It does not establish a working Viewmodels builder, a hands-visible mode, a rendered result, or a redistribution right.

## Basis

Valve's pinned [`mstudioanim_t` and `mstudioanimdesc_t` definitions](https://github.com/ValveSoftware/source-sdk-2013/blob/b8cfb12c0e083a2ef5b2f9f9b50f3902fa034474/src/public/studio.h#L3160-L3355) put a `Vector48` raw position after the eight-byte raw quaternion in a bone animation record with flags `STUDIO_ANIM_RAWPOS | STUDIO_ANIM_RAWROT2`. [`Vector48`](https://github.com/ValveSoftware/source-sdk-2013/blob/b8cfb12c0e083a2ef5b2f9f9b50f3902fa034474/src/public/mathlib/compressed_vector.h#L2230-L2289) stores three 16-bit floats. Valve's [`CalcBonePosition`](https://github.com/ValveSoftware/source-sdk-2013/blob/b8cfb12c0e083a2ef5b2f9f9b50f3902fa034474/src/public/bone_setup.cpp#L3014-L3133) reads this position directly. The [bone-chain code](https://github.com/ValveSoftware/source-sdk-2013/blob/b8cfb12c0e083a2ef5b2f9f9b50f3902fa034474/src/public/bone_setup.cpp#L2592-L2613) composes child transforms with their parents. These definitions support the mechanism; retail TF2 behavior still needs a separate test.

The previously verified app-440 installation (patch `10828683`) supplied a scratch copy of `weapons/c_models/c_scout_animations.mdl`, SHA-256 `da6aba88bfa1a2f0c55f2f0f376eacc2550b1c82343c56e4f01473f7b6d30710`. The bounded metadata probe found 58 bones, 103 local animations, and 91 sequences. `ss_draw` references only `@ss_draw`; no other sequence references that animation. Its root bone is fully weighted and all 57 other bones descend from root. The root record has the two expected raw flags and stores position `(-2.6328125, 3.919921875, -25.03125)`.

## Scratch result

[`d7_scout_root_offset_probe.py`](d7_scout_root_offset_probe.py) requires a scratch input below the OS temporary directory and its exact SHA-256. It checks the model identity, unique sequence link, bone hierarchy, root weight, local unsectioned animation data and raw-position record before changing bytes. Its explicit output is a new uniquely named directory in the OS temporary directory, never the TF2 root or profile library. Run Python with `-B` to prevent import cache writes in the repository. No Valve model bytes are committed.

On this installed copy the script replaced the root `Vector48` for `@ss_draw` with `(0, 0, -4096)`. The candidate has the **same 439,268-byte length** and differs from the input at exactly the six bytes of that one field, starting at offset `88748`. The rest of the model is byte-for-byte unchanged. Its SHA-256 is `d3cd80bd9c8d70532ea3138362ee087899c3ecb166ae8b7d8faf79492954d4b8`. The existing MDL metadata parser accepted the output and retained the same 103 animation and 91 sequence descriptors and links. The script re-read the scratch output and verified its bytes. Eight synthetic tests cover the byte boundary, exact input hash, sequence identity, bone hierarchy, root weight and unsupported record layouts.

## Read-only viewer preflight (September 24, 2026)

The [bounded viewer preflight](d7_scout_viewer_preflight.py) read the two relevant stock entries from the confirmed app-440 install's `tf2_misc_dir.vpk` and the hash-pinned candidate under the OS temporary directory. It checked each VPK entry's CRC-32 and each complete MDL's SHA-256. The stock animation entry matched the hash above; `c_scout_arms.mdl` matched SHA-256 `6708e5cce31198f80252e4c8df8eb8dd26580bae3fef7c55ffe136ddc579caf9`. No installed file or profile was written.

Valve's pinned [`studiohdr_t` and `mstudiomodelgroup_t` definitions](https://github.com/ValveSoftware/source-sdk-2013/blob/b8cfb12c0e083a2ef5b2f9f9b50f3902fa034474/src/public/studio.h) identify the bodypart and included-model fields. The animation MDL has **zero bodyparts**, so loading it alone cannot display a weapon or hands. The stock `c_scout_arms.mdl` has one bodypart and exactly one included model, `models/weapons/c_models/c_scout_animations.mdl`; it is the concrete renderable-parent candidate for a viewer check. In the animation MDL, all 17 `weapon_bone`/`vm_weapon_bone` bones are direct children of the two `bip_hand` bones, and neither hand descends from a weapon bone. This is evidence that a separate weapon-bone transform might preserve hand poses, not a tested hands-visible implementation. The preflight also recomputed the candidate from the pinned stock MDL, matched it byte-for-byte, and confirmed the MDL header checksum is unchanged. Eight synthetic preflight tests cover VPK tree bounds, exact entry selection, include offsets and bone parenting.

Valve's [TF2 mod `gameinfo.txt` example](https://github.com/ValveSoftware/source-sdk-2013/blob/b8cfb12c0e083a2ef5b2f9f9b50f3902fa034474/game/mod_tf/gameinfo.txt) and [filesystem loader](https://github.com/ValveSoftware/source-sdk-2013/blob/b8cfb12c0e083a2ef5b2f9f9b50f3902fa034474/src/public/filesystem_init.cpp) show a possible isolated mod search path with scratch write paths and read-only `|appid_440|` mounts. The [Valve Developer Community HLMV guide](https://developer.valvesoftware.com/wiki/Half-Life_Model_Viewer_%28Source%29) describes rendering and animation controls, but also says viewer settings are saved in the Windows registry and that file browsing may require a matching game-directory tree. These sources do not prove that the **installed** HLMV binary confines every side write to the scratch mod path. It was not launched. An isolated visual check remains dependent on a verified viewer sandbox, a scratch override of the included animation MDL, and loading the renderable Scout arms parent with the appropriate weapon model. The preflight establishes the parent link and candidate bytes only; it does not establish a rendered or retail TF2 hide result.

Reproduce against a **scratch copy** of that exact installed Scout MDL:

```powershell
$scratch = '<OS temp directory>/c_scout_animations.mdl'
python -B docs/audits/2026-09-23-program-audit/d7_scout_root_offset_probe.py $scratch --expected-sha256 da6aba88bfa1a2f0c55f2f0f376eacc2550b1c82343c56e4f01473f7b6d30710
python -B -m unittest discover -s docs/audits/2026-09-23-program-audit -p test_d7_scout_root_offset_probe.py -v

$vpk = '<confirmed TF2 install>/tf/tf2_misc_dir.vpk'
$candidate = '<OS temp directory>/c_scout_animations.mdl' # Hash shown above.
python -B docs/audits/2026-09-23-program-audit/d7_scout_viewer_preflight.py $vpk $candidate
python -B -m unittest discover -s docs/audits/2026-09-23-program-audit -p test_d7_scout_viewer_preflight.py -v
```

## Limits and next checks

- This is a **full-pose root offset** candidate for one draw sequence. It provides no hands-visible/weapon-only variant and no coverage for idle, fire, reload, inspect, other Scout items, or the other eight classes. The root change may interact with layering, transitions, attachments or third-person use.
- Structural parsing does not prove the Source renderer accepts or uses the copied MDL. The installed `hlmv.exe` was located but this candidate was not loaded into a viewer, packed, installed, or exercised in TF2. No visual or in-game hide result is claimed. A retail test would need an isolated candidate environment and evidence of hidden draw with unaffected actions and recovery.
- The MDL checksum field and sequence bounds stay at their stock values. Whether companion model files or runtime checks require a different relationship is not established. These points must be checked before considering product use.
- Profile export can include modified compiled models. [Valve's Source-mod distribution guidance](https://partner.steamgames.com/doc/sdk/uploading/distributing_source_engine?l=english) describes conditions for freely distributing qualifying community mods, but its application to execs-generated profile ZIPs has not been established. The [D7 mapping study](d7-stock-mapping-study.md) calls for a separate Valve-asset rights review. This scratch experiment does not establish permission to distribute model bytes or settle rights for D7's other sources.
