"""Synthetic tests for the D7 activity graph; no Valve assets are committed."""

from __future__ import annotations

import struct
import unittest

from d7_stock_activity_graph import item_graph, mdl_activities, parse_keyvalues, resolve_item
from d7_stock_mdl_probe import ProbeError, parse_mdl
from test_d7_stock_mdl_probe import fake_mdl


TABLE = {
    ("TF_WPN_TYPE_SECONDARY", "ACT_VM_DRAW"): "ACT_SECONDARY_VM_DRAW",
    ("TF_WPN_TYPE_SECONDARY", "ACT_VM_IDLE"): "ACT_SECONDARY_VM_IDLE",
    ("TF_WPN_TYPE_ITEM1", "ACT_VM_DRAW"): "ACT_ITEM1_VM_DRAW",
}


def schema() -> dict:
    text = '''
    "items_game" {
      "prefabs" {
        "base" { "item_slot" "primary" "used_by_classes" { "scout" "1" } }
        "short" {
          "prefab" "base" "anim_slot" "secondary"
          "visuals" { "animation_replacement" {
            "ACT_VM_DRAW" "ACT_SECONDARY_VM_DRAW_2"
            "ACT_PRIMARY_VM_INSPECT_START" "ACT_PRIMARY_ALT1_VM_INSPECT_START"
          } }
        }
      }
      // Per-item fields override inherited prefab values.
      "items" {
        "220" { "prefab" "short" "name" "Shortstop" }
        "140" {
          "name" "Wrangler" "item_slot" "secondary" "anim_slot" "item1"
          "used_by_classes" { "engineer" "1" }
          "visuals" { "animation_replacement" {
            "ACT_SECONDARY_VM_INSPECT_START" "ACT_ITEM1_VM_INSPECT_START"
          } }
        }
      }
    }
    '''
    return parse_keyvalues(text)["items_game"]


class StockActivityGraphTests(unittest.TestCase):
    def test_prefab_and_item_overlay(self) -> None:
        item = resolve_item(schema(), "220")
        self.assertEqual(item["item_slot"], "primary")
        self.assertEqual(item["anim_slot"], "secondary")
        self.assertEqual(item["used_by_classes"]["scout"], "1")

    def test_scout_slot_and_inspect_use_different_paths(self) -> None:
        activities = {
            "ACT_SECONDARY_VM_DRAW_2": [{"sequence": "ss_draw", "animations": ["@ss_draw"]}],
            "ACT_PRIMARY_ALT1_VM_INSPECT_START": [
                {"sequence": "primary_alt1_inspect_start", "animations": ["@primary_alt1_inspect_start"]}
            ],
        }
        graph = item_graph(schema(), "220", "scout", TABLE, activities)
        self.assertEqual(graph["animation_role"], "TF_WPN_TYPE_SECONDARY")
        draw = next(edge for edge in graph["edges"] if edge["base"] == "ACT_VM_DRAW")
        inspect = next(edge for edge in graph["edges"] if edge["base"] == "ACT_PRIMARY_VM_INSPECT_START")
        self.assertEqual(draw["sequences"][0]["animations"], ["@ss_draw"])
        self.assertEqual(inspect["activity"], "ACT_PRIMARY_ALT1_VM_INSPECT_START")

    def test_wrangler_inspect_override_is_applied_after_slot(self) -> None:
        activities = {"ACT_ITEM1_VM_INSPECT_START": [
            {"sequence": "item1_inspect_start", "animations": ["@item1_inspect_start"]}
        ]}
        graph = item_graph(schema(), "140", "engineer", TABLE, activities)
        inspect = next(edge for edge in graph["edges"] if edge["base"] == "ACT_SECONDARY_VM_INSPECT_START")
        self.assertEqual(inspect["activity"], "ACT_ITEM1_VM_INSPECT_START")
        self.assertEqual(inspect["sequences"][0]["sequence"], "item1_inspect_start")

    def test_no_anim_slot_does_not_guess_from_loadout_slot(self) -> None:
        game = schema()
        game["items"]["220"] = {"item_slot": "primary", "used_by_classes": {"scout": "1"}}
        with self.assertRaisesRegex(ProbeError, "weapon-script role is unresolved"):
            item_graph(game, "220", "scout", TABLE, {})

    def test_wrong_class_rejected(self) -> None:
        with self.assertRaisesRegex(ProbeError, "not used by"):
            item_graph(schema(), "220", "engineer", TABLE, {})

    def test_reads_activity_name_and_all_blend_animations(self) -> None:
        data = fake_mdl()
        base = 608
        struct.pack_into("<i", data, base + 8, len(data) - base)
        data.extend(b"ACT_VM_PRIMARYATTACK\0")
        struct.pack_into("<i", data, 76, len(data))
        result = mdl_activities(data, parse_mdl(data))
        self.assertEqual(result["ACT_VM_PRIMARYATTACK"][0]["animations"], ["idle", "fire"])

    def test_rejects_activity_pointer_outside_mdl(self) -> None:
        data = fake_mdl()
        struct.pack_into("<i", data, 608 + 8, len(data))
        with self.assertRaisesRegex(ProbeError, "leaves the MDL"):
            mdl_activities(data, parse_mdl(data))

    def test_rejects_broken_keyvalues(self) -> None:
        with self.assertRaisesRegex(ProbeError, "unterminated KeyValues object"):
            parse_keyvalues('"items_game" { "items" { "220" "value" }')


if __name__ == "__main__":
    unittest.main()
