"""Synthetic tests for the Scout weapon-bone scratch probe; no Valve bytes."""

from __future__ import annotations

import hashlib
import struct
import unittest

from d7_scout_weapon_bone_probe import HIDDEN_Z, weapon_only_candidate
from d7_stock_mdl_probe import ProbeError, parse_mdl


def _align(data: bytearray) -> None:
    data.extend(b"\0" * (-len(data) % 4))


def fake_scout(*, compressed: bool = False, sectioned: bool = False) -> tuple[bytearray, dict[str, int]]:
    data = bytearray(408 + 40)
    data[:4] = b"IDST"
    data[12 : 12 + 40] = b"weapons/c_models/c_scout_animations.mdl\0"
    struct.pack_into("<ii", data, 4, 48, 0x12345678)
    struct.pack_into("<i", data, 400, 408)
    bone_table = len(data)
    bones = (("root", -1), ("bip_hand_L", 0), ("bip_hand_R", 0), ("weapon_bone", 2))
    data.extend(b"\0" * (len(bones) * 216))
    struct.pack_into("<ii", data, 156, len(bones), bone_table)
    for index, (name, parent) in enumerate(bones):
        base = bone_table + index * 216
        at = len(data)
        data.extend(name.encode("ascii") + b"\0")
        struct.pack_into("<ii", data, base, at - base, parent)
        struct.pack_into("<3f", data, base + 32, float(index + 1), 2.0, 3.0)
    _align(data)

    animation = len(data)
    data.extend(b"\0" * 100)
    sequence = len(data)
    data.extend(b"\0" * 212)
    struct.pack_into("<4i", data, 180, 1, animation, 1, sequence)
    struct.pack_into("<i", data, animation, -animation)
    struct.pack_into("<i", data, sequence, -sequence)
    anim_name = len(data)
    data.extend(b"@ss_draw\0")
    seq_name = len(data)
    data.extend(b"ss_draw\0")
    struct.pack_into("<i", data, animation + 4, anim_name - animation)
    struct.pack_into("<fi", data, animation + 8, 30.0, 0)
    struct.pack_into("<i", data, animation + 16, 3)
    struct.pack_into("<i", data, sequence + 4, seq_name - sequence)
    struct.pack_into("<i", data, sequence + 56, 1)
    struct.pack_into("<2i", data, sequence + 68, 1, 1)
    grid = len(data)
    data.extend(struct.pack("<h", 0))
    struct.pack_into("<i", data, sequence + 60, grid - sequence)
    weights = len(data)
    data.extend(struct.pack("<4f", 1.0, 1.0, 1.0, 1.0))
    struct.pack_into("<i", data, sequence + 156, weights - sequence)
    _align(data)

    section_table = -1
    if sectioned:
        section_table = len(data)
        data.extend(b"\0" * 24)
        struct.pack_into("<2i", data, animation + 80, section_table - animation, 2)

    first_record = -1
    first_weapon = -1
    for part in range(3 if sectioned else 1):
        start = len(data)
        if first_record < 0:
            first_record = start
        if sectioned:
            struct.pack_into("<2i", data, section_table + part * 8, 0, start - animation)
        else:
            struct.pack_into("<i", data, animation + 56, start - animation)
        data.extend(struct.pack("<BBh8s3e", 0, 0x21, 18, b"\0" * 8, 0.0, 0.0, 0.0))
        weapon = len(data)
        if first_weapon < 0:
            first_weapon = weapon
        if compressed:
            data.extend(struct.pack("<BBh6s3hBBh", 3, 0x0C, 20, b"\0" * 6, 0, 0, 6, 1, 3, 5))
        else:
            data.extend(struct.pack("<BBh8s3e", 3, 0x21, 18, b"\0" * 8, 4.0, 5.0, 6.0))
        data.extend(struct.pack("<BBh8s", 2, 0x20, 0, b"\0" * 8))
    if sectioned:
        struct.pack_into("<i", data, animation + 56, first_record - animation)
    _align(data)

    linear = len(data)
    data.extend(b"\0" * 64)
    positions = len(data)
    for index in range(len(bones)):
        data.extend(struct.pack("<3f", float(index + 1), 2.0, 3.0))
    scales = len(data)
    for _ in bones:
        data.extend(struct.pack("<3f", 0.004, 0.004, 0.004))
    struct.pack_into("<i", data, 408 + 16, linear - 408)
    struct.pack_into("<i", data, linear, len(bones))
    struct.pack_into("<i", data, linear + 12, positions - linear)
    struct.pack_into("<i", data, linear + 28, scales - linear)
    struct.pack_into("<i", data, 76, len(data))
    return data, {
        "bone_table": bone_table,
        "animation": animation,
        "first_weapon": first_weapon,
        "linear": linear,
        "positions": positions,
        "section_table": section_table,
    }


def digest(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def patch(data: bytes) -> tuple[bytes, object]:
    return weapon_only_candidate(data, digest(data), expected_weapon_count=1)


class ScoutWeaponBoneProbeTests(unittest.TestCase):
    def test_raw_position_changes_only_weapon_fields(self) -> None:
        source, indexes = fake_scout()
        original = bytes(source)
        candidate, result = patch(original)
        self.assertEqual(result.weapon_bone_count, 1)
        self.assertEqual(result.animation_chain_count, 1)
        self.assertEqual(result.weapon_raw_position_records, 1)
        self.assertEqual(result.weapon_compressed_position_records, 0)
        self.assertEqual(len(candidate), len(original))
        self.assertEqual(candidate[8:12], original[8:12])
        self.assertEqual(parse_mdl(candidate).sequences, parse_mdl(original).sequences)
        self.assertEqual(struct.unpack_from("<f", candidate, result.default_z_offsets[0])[0], HIDDEN_Z)
        self.assertEqual(struct.unpack_from("<f", candidate, result.linear_z_offsets[0])[0], HIDDEN_Z)
        self.assertEqual(struct.unpack_from("<e", candidate, result.raw_z_offsets[0])[0], HIDDEN_Z)
        allowed = set(range(result.default_z_offsets[0], result.default_z_offsets[0] + 4))
        allowed.update(range(result.linear_z_offsets[0], result.linear_z_offsets[0] + 4))
        allowed.update(range(result.raw_z_offsets[0], result.raw_z_offsets[0] + 2))
        changed = {i for i, (a, b) in enumerate(zip(original, candidate)) if a != b}
        self.assertTrue(changed)
        self.assertTrue(changed.issubset(allowed))
        self.assertEqual(candidate[indexes["bone_table"] : indexes["bone_table"] + 32],
                         original[indexes["bone_table"] : indexes["bone_table"] + 32])

    def test_compressed_position_uses_shifted_linear_base(self) -> None:
        source, indexes = fake_scout(compressed=True)
        original = bytes(source)
        candidate, result = patch(original)
        self.assertEqual(result.weapon_raw_position_records, 0)
        self.assertEqual(result.weapon_compressed_position_records, 1)
        self.assertEqual(candidate[indexes["first_weapon"] : indexes["first_weapon"] + 20],
                         original[indexes["first_weapon"] : indexes["first_weapon"] + 20])
        self.assertEqual(struct.unpack_from("<f", candidate, result.linear_z_offsets[0])[0], HIDDEN_Z)

    def test_sectioned_animation_covers_every_raw_record(self) -> None:
        source, _ = fake_scout(sectioned=True)
        _, result = patch(bytes(source))
        self.assertEqual(result.animation_chain_count, 3)
        self.assertEqual(result.weapon_raw_position_records, 3)
        self.assertEqual(len(set(result.raw_z_offsets)), 3)

    def test_requires_exact_input_hash(self) -> None:
        source, _ = fake_scout()
        with self.assertRaisesRegex(ProbeError, "SHA-256"):
            weapon_only_candidate(bytes(source), "0" * 64, expected_weapon_count=1)

    def test_rejects_missing_linear_table(self) -> None:
        source, _ = fake_scout()
        struct.pack_into("<i", source, 408 + 16, 0)
        with self.assertRaisesRegex(ProbeError, "linear bone table is missing"):
            patch(bytes(source))

    def test_rejects_out_of_bounds_linear_position_table(self) -> None:
        source, indexes = fake_scout()
        struct.pack_into("<i", source, indexes["linear"] + 12, len(source))
        with self.assertRaisesRegex(ProbeError, "linear positions"):
            patch(bytes(source))

    def test_rejects_unbounded_compressed_position(self) -> None:
        source, indexes = fake_scout(compressed=True)
        source[indexes["first_weapon"] + 16] = 0
        with self.assertRaisesRegex(ProbeError, "compressed position run"):
            patch(bytes(source))

    def test_rejects_raw_position_outside_record(self) -> None:
        source, indexes = fake_scout()
        struct.pack_into("<h", source, indexes["first_weapon"] + 2, 14)
        with self.assertRaisesRegex(ProbeError, "raw weapon position leaves"):
            patch(bytes(source))

    def test_rejects_weapon_bone_not_child_of_hand(self) -> None:
        source, indexes = fake_scout()
        struct.pack_into("<i", source, indexes["bone_table"] + 3 * 216 + 4, 0)
        with self.assertRaisesRegex(ProbeError, "direct children"):
            patch(bytes(source))

    def test_rejects_unexpected_weapon_count(self) -> None:
        source, _ = fake_scout()
        with self.assertRaisesRegex(ProbeError, "weapon bone count"):
            weapon_only_candidate(bytes(source), digest(source))

    def test_reports_unweighted_weapon_sequence(self) -> None:
        source, indexes = fake_scout()
        sequence = indexes["animation"] + 100
        weights = sequence + struct.unpack_from("<i", source, sequence + 156)[0]
        struct.pack_into("<f", source, weights + 3 * 4, 0.0)
        _, result = patch(bytes(source))
        self.assertEqual(result.unweighted_weapon_sequence_cells, 1)
        self.assertEqual(result.unweighted_weapon_sequences, ("ss_draw",))


if __name__ == "__main__":
    unittest.main()
