# D7 — first independent stock item-to-animation graph

**Status: audit research; D7 stays open.** This is a reproducible, read-only graph for two representative installed TF2 items. It is derived from the player's installed item schema and class animation MDLs plus Valve's pinned activity-translation source. It does not read the CompVM-derived `viewmodel_groups.rs` table or establish that an output model works in retail TF2.

## Source and snapshot

- The confirmed `tf/steam.inf` reports app 440 and patch `10828683`. The installed loose `tf/scripts/items/items_game.txt` SHA-256 is `4d1f15b63e63e3e897552cfb8042cccb99d2e233a0c8d8afd8734a3ea49d08da`. The installed `tf/tf2_misc_dir.vpk` SHA-256 was rechecked as `63f7db0d1c509e303ca9002fee9e3d805e9220ea5afdd639d8a6b68b8a3710b9`; the [earlier MDL probe](d7-stock-mdl-probe.md) checked the archive-entry CRCs before creating scratch copies.
- Scout scratch `c_scout_animations.mdl` SHA-256: `da6aba88bfa1a2f0c55f2f0f376eacc2550b1c82343c56e4f01473f7b6d30710`. Engineer scratch `c_engineer_animations.mdl` SHA-256: `83338e65f783e3de511454e827ece3f39f24c8fd04d230f59d5d525cd5c7a0e7`. The audit command requires these exact hashes, class-specific file and internal model names, a scratch location under the OS temporary directory, and app-440 identity.
- The [`s_viewmodelacttable`](https://github.com/ValveSoftware/source-sdk-2013/blob/b8cfb12c0e083a2ef5b2f9f9b50f3902fa034474/src/game/shared/tf/tf_weaponbase.cpp#L4282-L4508) at Valve commit `b8cfb12` yields 196 distinct role/base-activity translations across 11 roles. The downloaded source file SHA-256 is `f0c179bb431331e4f471836f9936d8eaed83ca69e7ae5f0b1c8f7099a25fc5db`; the script refuses other bytes. Valve's [translation function](https://github.com/ValveSoftware/source-sdk-2013/blob/b8cfb12c0e083a2ef5b2f9f9b50f3902fa034474/src/game/shared/tf/tf_weaponbase.cpp#L4513-L4542) applies an item activity override first, then its `anim_slot` role, then the table. The [inspect function](https://github.com/ValveSoftware/source-sdk-2013/blob/b8cfb12c0e083a2ef5b2f9f9b50f3902fa034474/src/game/shared/tf/tf_weaponbase.cpp#L2503-L2566) instead selects a base inspect activity by loadout slot. This static graph then applies the installed schema's `animation_replacement` to that activity; the retail hand-model call chain remains unverified.
- Valve's [`mstudioseqdesc_t`](https://github.com/ValveSoftware/source-sdk-2013/blob/b8cfb12c0e083a2ef5b2f9f9b50f3902fa034474/src/public/studio.h#L3404-L3472) stores the activity name and a grid of local-animation indexes. The probe checks each relative activity-name pointer and uses the [bounded MDL parser](d7-stock-mdl-probe.md) for the sequence and every blend reference.

## Observed links

The installed schema defines Shortstop item `220` as Scout **primary loadout**, with `anim_slot=secondary` and per-item replacements to the `SECONDARY_*_2` action family. Its inspect replacements use the `PRIMARY_ALT1` family, because inspect starts from the loadout slot. Wrangler item `140` is Engineer **secondary loadout**, with `anim_slot=item1`; its inspect replacements switch `SECONDARY` to `ITEM1`. These are separate, source-backed paths.

| Item | Base activity | Resolved activity | Installed sequence | Local animation |
|---|---|---|---|---|
| Shortstop | `ACT_VM_DRAW` | `ACT_SECONDARY_VM_DRAW_2` | `ss_draw` | `@ss_draw` |
| Shortstop | `ACT_VM_IDLE` | `ACT_SECONDARY_VM_IDLE_2` | `ss_idle` | `@ss_idle` |
| Shortstop | `ACT_VM_PRIMARYATTACK` | `ACT_SECONDARY_VM_PRIMARYATTACK_2` | `ss_fire` | `@ss_fire` |
| Shortstop | `ACT_VM_RELOAD` | `ACT_SECONDARY_VM_RELOAD_2` | `ss_reload` | `@ss_reload` |
| Shortstop | primary inspect start / idle / end | `ACT_PRIMARY_ALT1_VM_INSPECT_*` | `primary_alt1_inspect_*` | `@primary_alt1_inspect_*` |
| Wrangler | `ACT_VM_DRAW` | `ACT_ITEM1_VM_DRAW` | `wgl_draw` | `@wgl_draw` |
| Wrangler | `ACT_VM_IDLE` | `ACT_ITEM1_VM_IDLE` | `wgl_idle` | `@wgl_idle` |
| Wrangler | `ACT_VM_RELOAD` plus reload start / finish | `ACT_ITEM1_VM_RELOAD`, `ACT_ITEM1_RELOAD_START/FINISH` | `wgl_reload_loop/start/end` | matching `@wgl_*` |
| Wrangler | secondary inspect start / idle / end | `ACT_ITEM1_VM_INSPECT_*` | `item1_inspect_*` | matching `@item1_inspect_*` |

The script considered 23 role-table and inspect base activities for each item. **Seven** Shortstop and **eight** Wrangler edges have a direct sequence in the inspected class MDL, with seven and eight distinct local animations respectively. The other 16 and 15 edges have **no direct local sequence in that MDL**. These counts describe this static graph, not action reachability or a proportion of gameplay covered. For example, Wrangler's translated primary attack has no direct local sequence here; its real behavior may involve specialized weapon code, an included model, or a different activity path.

## Reproduction and extension

[`d7_stock_activity_graph.py`](d7_stock_activity_graph.py) accepts one item ID, class, installed TF2 root, scratch MDL and a separately downloaded copy of Valve's pinned `tf_weaponbase.cpp`. It emits source fingerprints and the base-activity → translated-activity → direct local sequence → every blend animation chain as JSON. The script makes no explicit file writes; `python -B` prevents import bytecode caches. Example, after making a scratch copy of the installed MDL and verifying it with the [MDL probe](d7-stock-mdl-probe.md):

```powershell
$tfRoot = '<confirmed TF2 root>'
$scratch = '<OS temp directory>/c_scout_animations.mdl'
$valveSource = '<OS temp directory>/tf_weaponbase.cpp from Valve commit b8cfb12'
python -B docs/audits/2026-09-23-program-audit/d7_stock_activity_graph.py --tf-root $tfRoot --scratch-mdl $scratch --valve-source $valveSource --class scout --item-id 220 --expected-schema-sha256 4d1f15b63e63e3e897552cfb8042cccb99d2e233a0c8d8afd8734a3ea49d08da --expected-mdl-sha256 da6aba88bfa1a2f0c55f2f0f376eacc2550b1c82343c56e4f01473f7b6d30710
python -B -m unittest discover -s docs/audits/2026-09-23-program-audit -p test_d7_stock_activity_graph.py -v
```

On the inspected snapshot, this command passed and eight synthetic tests passed. The same command shape accepts any of the nine classes with its verified stock MDL hash and item ID. It intentionally refuses items without `anim_slot`: [Valve's weapon script parser](https://github.com/ValveSoftware/source-sdk-2013/blob/b8cfb12c0e083a2ef5b2f9f9b50f3902fa034474/src/game/shared/tf/tf_weapon_parse.cpp#L134-L167) then supplies a role from `WeaponType`, and a script/`item_class` resolver has not been implemented. It also refuses team-specific visuals until their override order is verified. This makes unsupported paths visible instead of guessing from loadout slot or sequence prefix.

## Remaining limits

- The graph is limited to local sequences in the chosen class animation MDL and to candidate activities in the pinned general role table plus inspect. It does not traverse included models, sequence autolayers, activity modifiers, transitions, events, subclass overrides, or runtime item attributes. A row without a direct local sequence is unresolved, not proof that the item lacks that action.
- The two representative items do not establish full item or nine-class coverage. All supported items need weapon-script fallback, class-specific loadout and visual resolution, specialized activity paths, and a frozen independent graph before comparison or migration from 64 legacy choices.
- This work does not make stock compiled MDLs editable into a complete full-hide or hands-visible product pipeline. Structural parsing cannot validate rendering, game selection, third-person effects, profile compatibility or rights to distribute generated Valve model bytes. The [D7 register](d7-asset-rights.md) remains unchecked.
