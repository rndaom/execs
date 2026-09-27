"""Synthetic bounds tests; no Valve model bytes are stored in the repository."""

from __future__ import annotations

import struct
import unittest

from d7_stock_mdl_probe import ProbeError, parse_mdl


def fake_mdl() -> bytearray:
    data = bytearray(408 + 2 * 100 + 212)
    data[:4] = b"IDST"
    data[12:22] = b"test.mdl\0\0"
    struct.pack_into("<i", data, 4, 48)
    struct.pack_into("<4i", data, 180, 2, 408, 1, 608)

    for index, name in enumerate((b"idle\0", b"fire\0")):
        base = 408 + index * 100
        struct.pack_into("<i", data, base, -base)
        struct.pack_into("<f", data, base + 8, 30.0)
        struct.pack_into("<i", data, base + 16, 3)
        struct.pack_into("<i", data, base + 4, len(data) - base)
        data.extend(name)

    base = 608
    struct.pack_into("<i", data, base, -base)
    struct.pack_into("<i", data, base + 4, len(data) - base)
    data.extend(b"attack\0")
    struct.pack_into("<i", data, base + 56, 2)
    struct.pack_into("<2i", data, base + 68, 2, 1)
    struct.pack_into("<i", data, base + 60, len(data) - base)
    data.extend(struct.pack("<2h", 0, 1))
    struct.pack_into("<i", data, 76, len(data))
    return data


class ProbeTests(unittest.TestCase):
    def test_reads_relative_names_and_sequence_links(self) -> None:
        model = parse_mdl(fake_mdl())
        self.assertEqual(model.name, "test.mdl")
        self.assertEqual([anim.name for anim in model.animations], ["idle", "fire"])
        self.assertEqual(model.sequences[0].label, "attack")
        self.assertEqual(model.sequences[0].animation_indexes, (0, 1))

    def test_rejects_header_length_mismatch(self) -> None:
        data = fake_mdl()
        struct.pack_into("<i", data, 76, len(data) + 1)
        with self.assertRaisesRegex(ProbeError, "file length"):
            parse_mdl(data)

    def test_rejects_animation_table_outside_file(self) -> None:
        data = fake_mdl()
        struct.pack_into("<i", data, 184, len(data) - 4)
        with self.assertRaisesRegex(ProbeError, "animation table"):
            parse_mdl(data)

    def test_rejects_relative_name_outside_file(self) -> None:
        data = fake_mdl()
        struct.pack_into("<i", data, 412, len(data))
        with self.assertRaisesRegex(ProbeError, "animation name"):
            parse_mdl(data)

    def test_rejects_unbounded_name(self) -> None:
        data = fake_mdl()
        data.extend(b"A" * 192)
        struct.pack_into("<i", data, 412, len(data) - 408 - 192)
        struct.pack_into("<i", data, 76, len(data))
        with self.assertRaisesRegex(ProbeError, "bounded NUL"):
            parse_mdl(data)

    def test_rejects_bad_blend_index(self) -> None:
        data = fake_mdl()
        grid = 608 + struct.unpack_from("<i", data, 608 + 60)[0]
        struct.pack_into("<h", data, grid + 2, 2)
        with self.assertRaisesRegex(ProbeError, "invalid local animation"):
            parse_mdl(data)

    def test_rejects_bad_blend_dimensions(self) -> None:
        data = fake_mdl()
        struct.pack_into("<i", data, 608 + 72, 2)
        with self.assertRaisesRegex(ProbeError, "does not match"):
            parse_mdl(data)

    def test_rejects_truncated_header(self) -> None:
        with self.assertRaisesRegex(ProbeError, "studiohdr_t"):
            parse_mdl(b"IDST")

    def test_rejects_oversized_input(self) -> None:
        with self.assertRaisesRegex(ProbeError, "8 MiB"):
            parse_mdl(b"\0" * (8 * 1024 * 1024 + 1))


if __name__ == "__main__":
    unittest.main()
