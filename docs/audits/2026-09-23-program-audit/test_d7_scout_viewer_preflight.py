"""Synthetic tests for the read-only Scout viewer preflight; no Valve bytes."""

from __future__ import annotations

import struct
import unittest

from d7_scout_viewer_preflight import (
    SCOUT_ARMS,
    STOCK_ANIM,
    find_vpk_entries,
    included_models,
    scout_weapon_bone_relationships,
)
from d7_stock_mdl_probe import ProbeError


def fake_vpk() -> bytearray:
    tree = bytearray(b"mdl\0models/weapons/c_models\0")
    for stem in (b"c_scout_animations", b"c_scout_arms"):
        tree.extend(stem + b"\0")
        tree.extend(struct.pack("<IHHIIH", 0, 0, 1, 0, 4, 0xFFFF))
    tree.extend(b"\0\0\0")
    return bytearray(struct.pack("<7I", 0x55AA1234, 2, len(tree), 0, 0, 0, 0) + tree)


def fake_include_model() -> bytearray:
    data = bytearray(408)
    struct.pack_into("<2i", data, 336, 1, 408)
    data.extend(b"\0" * 8)
    at = len(data)
    data.extend(STOCK_ANIM.encode("ascii") + b"\0")
    struct.pack_into("<i", data, 408 + 4, at - 408)
    return data


def fake_bones() -> bytearray:
    bones = (("root", -1), ("bip_collar_R", 0), ("bip_hand_R", 1),
             ("bip_hand_L", 0), ("vm_weapon_bone", 2))
    data = bytearray(408 + len(bones) * 216)
    struct.pack_into("<2i", data, 156, len(bones), 408)
    for index, (name, parent) in enumerate(bones):
        base = 408 + index * 216
        at = len(data)
        data.extend(name.encode("ascii") + b"\0")
        struct.pack_into("<2i", data, base, at - base, parent)
    return data


class ScoutViewerPreflightTests(unittest.TestCase):
    def test_reads_only_two_exact_vpk_targets(self) -> None:
        found = find_vpk_entries(bytes(fake_vpk()), {STOCK_ANIM, SCOUT_ARMS})
        self.assertEqual(set(found), {STOCK_ANIM, SCOUT_ARMS})
        self.assertEqual(found[STOCK_ANIM].archive_index, 1)

    def test_rejects_missing_vpk_target(self) -> None:
        with self.assertRaisesRegex(ProbeError, "absent"):
            find_vpk_entries(bytes(fake_vpk()), {STOCK_ANIM, "models/other.mdl"})

    def test_rejects_bad_vpk_entry_terminator(self) -> None:
        data = fake_vpk()
        entry = data.find(b"c_scout_animations\0") + len(b"c_scout_animations\0")
        struct.pack_into("<H", data, entry + 16, 0)
        with self.assertRaisesRegex(ProbeError, "terminator"):
            find_vpk_entries(bytes(data), {STOCK_ANIM, SCOUT_ARMS})

    def test_rejects_oversized_vpk_tree(self) -> None:
        data = fake_vpk()
        struct.pack_into("<I", data, 8, 8 * 1024 * 1024 + 1)
        with self.assertRaisesRegex(ProbeError, "oversized"):
            find_vpk_entries(bytes(data), {STOCK_ANIM, SCOUT_ARMS})

    def test_reads_parent_include_name(self) -> None:
        self.assertEqual(included_models(bytes(fake_include_model())), (STOCK_ANIM,))

    def test_rejects_out_of_bounds_parent_include(self) -> None:
        data = fake_include_model()
        struct.pack_into("<i", data, 412, len(data))
        with self.assertRaisesRegex(ProbeError, "outside"):
            included_models(bytes(data))

    def test_weapon_bone_is_direct_child_of_hand(self) -> None:
        result = scout_weapon_bone_relationships(bytes(fake_bones()))
        self.assertEqual(result["weapon_bone_count"], 1)
        self.assertTrue(result["weapon_bones_directly_parented_to_hands"])
        self.assertFalse(result["hands_descend_from_weapon_bones"])

    def test_rejects_weapon_bone_parented_to_root(self) -> None:
        data = fake_bones()
        struct.pack_into("<i", data, 408 + 4 * 216 + 4, 0)
        with self.assertRaisesRegex(ProbeError, "direct children"):
            scout_weapon_bone_relationships(bytes(data))


if __name__ == "__main__":
    unittest.main()
