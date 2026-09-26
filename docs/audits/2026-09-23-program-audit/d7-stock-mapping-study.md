# D7 — deriving Viewmodels groups from installed TF2 data

**Status: research only; D7 remains open.** This study tests whether a replacement for the current CompVMInstaller-derived selection map can be built independently from the player's installed TF2 data. It does not establish a replacement animation-editing pipeline, the same 64 choices, correct in-game behavior, or rights to export derived Valve models. No game file was changed.

## Source behavior

Valve's [studio model declarations](https://github.com/ValveSoftware/source-sdk-2013/blob/b8cfb12c0e083a2ef5b2f9f9b50f3902fa034474/src/public/studio.h) distinguish local animation descriptions from sequences. A sequence has a label, activity name and one or more references to local animations; a name prefix alone is not a complete account of what an item plays. The installed `tf2_misc_dir.vpk` and its sibling archives contain the class animation MDLs.

The [TF2 weapon script parser](https://github.com/ValveSoftware/source-sdk-2013/blob/b8cfb12c0e083a2ef5b2f9f9b50f3902fa034474/src/game/shared/tf/tf_weapon_parse.cpp#L130-L168) supplies a weapon role from `WeaponType`. [Weapon activity selection](https://github.com/ValveSoftware/source-sdk-2013/blob/b8cfb12c0e083a2ef5b2f9f9b50f3902fa034474/src/game/shared/tf/tf_weaponbase.cpp#L4185-L4205) allows an item's `anim_slot` to override that role. [First-person activity translation](https://github.com/ValveSoftware/source-sdk-2013/blob/b8cfb12c0e083a2ef5b2f9f9b50f3902fa034474/src/game/shared/tf/tf_weaponbase.cpp#L4513-L4542) first consults the item's per-team activity replacement, then the role table. [Inspect activities](https://github.com/ValveSoftware/source-sdk-2013/blob/b8cfb12c0e083a2ef5b2f9f9b50f3902fa034474/src/game/shared/tf/tf_weaponbase.cpp#L2503-L2566) start from the class loadout slot; their overrides therefore need a separate pass. These links describe engine behavior, not a permission grant for code or game assets.

## Read-only installed-data observation

The inspected installation identified itself as app 440, patch `10828683` in `tf/steam.inf`. Its `tf/tf2_misc_dir.vpk` SHA-256 was `63f7db0d1c509e303ca9002fee9e3d805e9220ea5afdd639d8a6b68b8a3710b9`; its loose `tf/scripts/items/items_game.txt` SHA-256 was `4d1f15b63e63e3e897552cfb8042cccb99d2e233a0c8d8afd8734a3ea49d08da`. Paths here are relative to the confirmed TF2 root; no installed bytes are included in this document.

A read-only VPK and MDL inspection found all nine `models/weapons/c_models/c_<class>_animations.mdl` files. All nine matched their VPK CRCs and declared MDL version 48. Their local descriptors contained **862 animations and 748 sequences** in total; all **859 sequence blend references** resolved to an in-range local animation. The separate [bounded stock-MDL probe](d7-stock-mdl-probe.md) records a repeatable metadata check and synthetic malformed-input tests. Counts by installed model:

| Model | Animations | Sequences |
|---|---:|---:|
| `c_demo_animations.mdl` | 85 | 73 |
| `c_engineer_animations.mdl` | 110 | 98 |
| `c_heavy_animations.mdl` | 92 | 80 |
| `c_medic_animations.mdl` | 62 | 50 |
| `c_pyro_animations.mdl` | 98 | 86 |
| `c_scout_animations.mdl` | 103 | 91 |
| `c_sniper_animations.mdl` | 88 | 76 |
| `c_soldier_animations.mdl` | 109 | 97 |
| `c_spy_animations.mdl` | 115 | 97 |

The installed Scout MDL links sequence `ss_draw` with `ACT_SECONDARY_VM_DRAW_2` and local animation `@ss_draw`. The installed item schema puts the Shortstop in the **primary** loadout slot, gives it `anim_slot` **secondary**, and replaces `ACT_VM_DRAW` with `ACT_SECONDARY_VM_DRAW_2`. The Engineer MDL links `wgl_draw` with `ACT_ITEM1_VM_DRAW` and `@wgl_draw`; the Wrangler occupies the **secondary** loadout slot with `anim_slot` **item1**. These are examples of direct, independent item-to-animation links. They do not establish the complete reachable set for either weapon.

## Proposed independent derivation

1. Confirm app 440, then read the installed MDLs, `items_game.txt`, and `tf_weapon_*.ctx`/`.txt` members with size, path and VPK integrity bounds. The existing [VPK reader](../../../apps/desktop/src-tauri/core/src/vpk.rs) and [weapon-script decoder](../../../apps/desktop/src-tauri/core/src/crosshair.rs) can provide bounded inputs; the [inventory parser](../../../apps/desktop/src-tauri/core/src/inventory.rs) already handles item prefabs. Record source fingerprints so a game update cannot silently reuse an old map.
2. Parse each stock class MDL's local animations, sequence labels, activity names and **all** blend references into a graph. Reject malformed offsets, duplicate identities, unresolved references and missing class models. Keep this parser independent of the existing group table.
3. Resolve each candidate equipped item through its item-schema prefabs, class availability, class-specific loadout slot, `item_class`, `anim_slot`, and team visuals. Read the installed weapon script's `WeaponType` where `anim_slot` does not override it. Apply the engine's activity translation and item activity replacements; handle inspect by its loadout-slot path. Record specialized weapon-class behavior as explicit, source-backed cases, then test them in game.
4. Derive selectable groups from sets of reachable class animations and item families. Keep inspect, alternate attack and other distinct actions separately selectable only where a real activity path and a behavioral test support that choice. Label groups from installed item identities and actions. Freeze this independently produced graph **before** comparing it with the existing CompVM-derived 64 choices.
5. After the independent map is frozen, compare each old `yttrium-1` ID with the new graph for profile migration. Preserve old records and installed VPK bytes. A missing or changed correspondence requires an explicit review; it must never silently reinterpret a saved selection. The current ID and file table in [viewmodel_groups.rs](../../../apps/desktop/src-tauri/core/src/viewmodel_groups.rs) is a compatibility input only, not derivation evidence.

The mapping step alone cannot turn compiled stock MDLs into editable QC/SMD sources. A separate bounded transformation and pack pipeline must be proven before it can replace [the current ZIP-and-`studiomdl` build](../../../apps/desktop/src-tauri/core/src/viewmodel_build.rs).

## Validation matrix before a replacement is accepted

| Requirement | Objective check |
|---|---|
| Installed-source integrity | On Windows and Linux, discover the confirmed app-440 root; parse all nine expected models and schema/scripts read-only with limits, checksums, exact class identity and deterministic fingerprints. Reject missing, malformed, mixed-version or updated inputs rather than guessing. |
| Activity reachability | For each class and supported item definition, enumerate base role, `anim_slot`, team overrides, loadout-specific inspect, special weapon behavior, resulting activities, candidate sequences and all local animations. Explain every unmapped or multiply mapped path; do not infer coverage from a sequence prefix alone. |
| Group coverage | Freeze independently derived group membership and labels; then compare with the 64 legacy IDs. Each equivalent, split, merged and unmatched old choice needs a documented migration result and a test. An exact count of 64 is not assumed. |
| Build isolation | Transform only a copied, bounded input in scratch space; prove unchanged installed archives. Validate every output model and VPK against Source's parser and expected model path. Test failure, interruption, cleanup and a TF2 update. |
| Retail behavior | In actual TF2, exercise every derived group with at least one item that reaches it, plus alternate items that share or override its activities; cover nine classes, draw/idle/fire/reload, alternate attack, inspect, melee, unusual items, both teams, full-hide and hands-visible modes, single and combined groups. Capture visible shown/hidden behavior and regressions in unaffected actions, including third person where claimed. Static MDL parsing and `studiomdl` success do not pass this row. |
| Profile compatibility | Reopen, switch, export/import and rebuild legacy `yttrium-1` profiles without changing approved bytes or silently dropping selections. Confirm explicit review for unmapped groups and intact user-supplied VPK import. |
| Asset rights | Review the permission basis for deriving, installing and **exporting** a VPK made from the player's Valve files; profile ZIPs can carry compiled model bytes. Replacing CompVM material does not itself settle Valve-content obligations or D7's other four sources. |

## Current blockers

- No independently derived complete item-to-sequence graph or reviewed group list has been implemented. The 862/748/859 counts establish parseability and descriptor integrity on one installed patch, not 64-group equivalence.
- Weapon scripts, item-schema team overrides, specialized classes and inspect rules have not been exhaustively composed into reachable sets. The Shortstop example demonstrates why slot-only or prefix-only grouping would be wrong.
- No stock-MDL editing/recompilation path or in-game behavior has been validated. The existing successful compiler test used CompVMInstaller's source ZIP.
- Valve asset transformation and export rights require review. D7 remains unchecked until the chosen full replacement or documented grants cover the actual product behavior.
