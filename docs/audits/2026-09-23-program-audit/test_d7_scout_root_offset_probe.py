"""Synthetic Scout transform tests; no Valve model bytes are stored here."""

from __future__ import annotations

import hashlib
import struct
import unittest

from d7_scout_root_offset_probe import HIDDEN_ROOT_POSITION, hidden_scout_draw
from d7_stock_mdl_probe import ProbeError, parse_mdl


def fake_scout() -> bytearray:
    bone_base = 408
    animation_base = bone_base + 2 * 216
    sequence_base = animation_base + 100
    data = bytearray(sequence_base + 212)
    data[:4] = b"IDST"
    data[12 : 12 + 40] = b"weapons/c_models/c_scout_animations.mdl\0"
    struct.pack_into("<i", data, 4, 48)
    struct.pack_into("<2i", data, 156, 2, bone_base)
    struct.pack_into("<4i", data, 180, 1, animation_base, 1, sequence_base)

    for index, (name, parent) in enumerate(((b"root\0", -1), (b"hand\0", 0))):
        base = bone_base + index * 216
        struct.pack_into("<2i", data, base, len(data) - base, parent)
        data.extend(name)

    struct.pack_into("<i", data, animation_base, -animation_base)
    struct.pack_into("<i", data, animation_base + 4, len(data) - animation_base)
    data.extend(b"@ss_draw\0")
    struct.pack_into("<f", data, animation_base + 8, 30.0)
    struct.pack_into("<i", data, animation_base + 16, 21)

    struct.pack_into("<i", data, sequence_base, -sequence_base)
    struct.pack_into("<i", data, sequence_base + 4, len(data) - sequence_base)
    data.extend(b"ss_draw\0")
    struct.pack_into("<i", data, sequence_base + 56, 1)
    struct.pack_into("<2i", data, sequence_base + 68, 1, 1)
    struct.pack_into("<i", data, sequence_base + 60, len(data) - sequence_base)
    data.extend(struct.pack("<h", 0))
    struct.pack_into("<i", data, sequence_base + 156, len(data) - sequence_base)
    data.extend(struct.pack("<2f", 1.0, 1.0))

    struct.pack_into("<i", data, animation_base + 56, len(data) - animation_base)
    data.extend(struct.pack("<BBh8s3e", 0, 0x21, 18, b"\0" * 8, 1.0, 2.0, 3.0))
    data.extend(struct.pack("<BBh", 1, 0, 0))
    struct.pack_into("<i", data, 76, len(data))
    return data


def digest(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


class ScoutRootOffsetProbeTests(unittest.TestCase):
    def test_changes_only_one_root_vector48(self) -> None:
        original = bytes(fake_scout())
        candidate, patch = hidden_scout_draw(original, digest(original))
        self.assertEqual(patch.original_position, (1.0, 2.0, 3.0))
        self.assertEqual(patch.output_position, HIDDEN_ROOT_POSITION)
        self.assertEqual(candidate[: patch.position_offset], original[: patch.position_offset])
        self.assertEqual(candidate[patch.position_offset + 6 :], original[patch.position_offset + 6 :])
        self.assertEqual(struct.unpack_from("<3e", candidate, patch.position_offset), HIDDEN_ROOT_POSITION)
        self.assertEqual(len(candidate), len(original))
        self.assertEqual(parse_mdl(candidate).sequences, parse_mdl(original).sequences)

    def test_requires_exact_scratch_hash(self) -> None:
        with self.assertRaisesRegex(ProbeError, "SHA-256"):
            hidden_scout_draw(bytes(fake_scout()), "0" * 64)

    def test_rejects_missing_unique_sequence(self) -> None:
        data = fake_scout()
        sequence_base = 940
        name = sequence_base + struct.unpack_from("<i", data, sequence_base + 4)[0]
        data[name : name + 7] = b"xx_draw"
        with self.assertRaisesRegex(ProbeError, "one Scout draw"):
            hidden_scout_draw(bytes(data), digest(data))

    def test_rejects_unweighted_root(self) -> None:
        data = fake_scout()
        sequence_base = 940
        weights = sequence_base + struct.unpack_from("<i", data, sequence_base + 156)[0]
        struct.pack_into("<f", data, weights, 0.0)
        with self.assertRaisesRegex(ProbeError, "fully weight"):
            hidden_scout_draw(bytes(data), digest(data))

    def test_rejects_bone_outside_root_hierarchy(self) -> None:
        data = fake_scout()
        struct.pack_into("<i", data, 408 + 216 + 4, -1)
        with self.assertRaisesRegex(ProbeError, "rooted and ordered"):
            hidden_scout_draw(bytes(data), digest(data))

    def test_rejects_external_or_sectioned_animation(self) -> None:
        for offset in (52, 84):
            with self.subTest(offset=offset):
                data = fake_scout()
                struct.pack_into("<i", data, 840 + offset, 1)
                with self.assertRaisesRegex(ProbeError, "unsupported"):
                    hidden_scout_draw(bytes(data), digest(data))

    def test_rejects_non_raw_root_record(self) -> None:
        data = fake_scout()
        record = 840 + struct.unpack_from("<i", data, 840 + 56)[0]
        data[record + 1] = 0x08
        with self.assertRaisesRegex(ProbeError, "raw-position"):
            hidden_scout_draw(bytes(data), digest(data))

    def test_rejects_short_root_record(self) -> None:
        data = fake_scout()
        record = 840 + struct.unpack_from("<i", data, 840 + 56)[0]
        struct.pack_into("<h", data, record + 2, 6)
        with self.assertRaisesRegex(ProbeError, "raw-position"):
            hidden_scout_draw(bytes(data), digest(data))


if __name__ == "__main__":
    unittest.main()
