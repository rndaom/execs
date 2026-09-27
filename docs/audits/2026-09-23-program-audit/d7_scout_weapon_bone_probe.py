"""Audit-only, all-sequence Scout weapon-bone offset experiment.

Input and output are scratch MDL copies under the OS temp directory. The
installed TF2 archive, profiles and product builder are never written.
Run with Python -B to keep import caches out of the repository.

Source layout and position evaluation, pinned to Valve's Source SDK:
https://github.com/ValveSoftware/source-sdk-2013/blob/b8cfb12c0e083a2ef5b2f9f9b50f3902fa034474/src/public/studio.h
https://github.com/ValveSoftware/source-sdk-2013/blob/b8cfb12c0e083a2ef5b2f9f9b50f3902fa034474/src/public/studio.cpp
https://github.com/ValveSoftware/source-sdk-2013/blob/b8cfb12c0e083a2ef5b2f9f9b50f3902fa034474/src/public/bone_setup.cpp
"""

from __future__ import annotations

import argparse
import hashlib
import json
import math
import struct
import sys
import tempfile
from dataclasses import dataclass
from pathlib import Path

from d7_scout_viewer_preflight import STOCK_ANIM, STOCK_SHA256
from d7_stock_mdl_probe import MAX_FILE_BYTES, ProbeError, parse_mdl


SCOUT_FILE = "c_scout_animations.mdl"
HIDDEN_Z = -4096.0
BONE_STRIDE = 216
ANIM_STRIDE = 100
KNOWN_FLAGS = {0x01, 0x08, 0x0C, 0x20, 0x21}
MAX_SECTIONS = 16


@dataclass(frozen=True)
class WeaponPatch:
    input_sha256: str
    output_sha256: str
    input_bytes: int
    changed_bytes: int
    weapon_bone_count: int
    animation_chain_count: int
    weapon_raw_position_records: int
    weapon_compressed_position_records: int
    unweighted_weapon_sequence_cells: int
    unweighted_weapon_sequences: tuple[str, ...]
    default_z_offsets: tuple[int, ...]
    linear_z_offsets: tuple[int, ...]
    raw_z_offsets: tuple[int, ...]
    mdl_checksum_unchanged: bool


def _span(data: bytes, offset: int, size: int, label: str) -> None:
    if offset < 0 or size < 0 or offset > len(data) or size > len(data) - offset:
        raise ProbeError(f"{label} is outside the MDL")


def _int(data: bytes, offset: int, label: str) -> int:
    _span(data, offset, 4, label)
    return struct.unpack_from("<i", data, offset)[0]


def _name(data: bytes, offset: int, label: str) -> str:
    _span(data, offset, 1, label)
    end = data.find(b"\0", offset, min(len(data), offset + 193))
    if end <= offset:
        raise ProbeError(f"{label} has no bounded name")
    try:
        name = data[offset:end].decode("ascii")
    except UnicodeDecodeError as error:
        raise ProbeError(f"{label} is not ASCII") from error
    if not name.isprintable():
        raise ProbeError(f"{label} is not printable")
    return name


def _bones(data: bytes, expected_weapon_count: int) -> tuple[int, list[int], list[int]]:
    count = _int(data, 156, "bone count")
    table = _int(data, 160, "bone table")
    if not 1 <= count <= 128 or table < 408 or table % 4:
        raise ProbeError("Scout bone table is outside the probe limit")
    _span(data, table, count * BONE_STRIDE, "bone table")
    names: list[str] = []
    parents: list[int] = []
    for bone in range(count):
        base = table + bone * BONE_STRIDE
        relative = _int(data, base, "bone name offset")
        parent = _int(data, base + 4, "bone parent")
        if relative <= 0 or (bone == 0 and parent != -1) or (bone > 0 and not 0 <= parent < bone):
            raise ProbeError("Scout bone hierarchy is invalid")
        names.append(_name(data, base + relative, "bone"))
        parents.append(parent)
    if len(set(names)) != count or names[0] != "root":
        raise ProbeError("Scout bone names are duplicate or root changed")
    if names.count("bip_hand_L") != 1 or names.count("bip_hand_R") != 1:
        raise ProbeError("Scout hand bones differ from the pinned model")
    weapons = [
        bone for bone, name in enumerate(names)
        if name.lower().startswith(("weapon_bone", "vm_weapon_bone"))
    ]
    if len(weapons) != expected_weapon_count:
        raise ProbeError("Scout weapon bone count differs from the expected model")
    if any(names[parents[bone]] not in ("bip_hand_L", "bip_hand_R") for bone in weapons):
        raise ProbeError("Scout weapon bones are not direct children of hands")
    for hand in ("bip_hand_L", "bip_hand_R"):
        parent = parents[names.index(hand)]
        while parent >= 0:
            if parent in weapons:
                raise ProbeError("a Scout hand descends from a weapon bone")
            parent = parents[parent]
    return table, weapons, parents


def _linear_positions(data: bytes, bone_count: int) -> tuple[int, int]:
    hdr2 = _int(data, 400, "studiohdr2 offset")
    if hdr2 < 408 or hdr2 % 4:
        raise ProbeError("Scout extended header is missing")
    _span(data, hdr2, 40, "studiohdr2")
    relative = _int(data, hdr2 + 16, "linear bone offset")
    if relative <= 0:
        raise ProbeError("Scout linear bone table is missing")
    base = hdr2 + relative
    _span(data, base, 40, "linear bone header")
    if _int(data, base, "linear bone count") != bone_count:
        raise ProbeError("linear bone count differs from bone table")
    position_relative = _int(data, base + 12, "linear position offset")
    scale_relative = _int(data, base + 28, "linear scale offset")
    if position_relative <= 0 or scale_relative <= 0:
        raise ProbeError("linear position or scale table is missing")
    positions = base + position_relative
    scales = base + scale_relative
    _span(data, positions, bone_count * 12, "linear positions")
    _span(data, scales, bone_count * 12, "linear scales")
    return positions, scales


def _validate_value_stream(data: bytes, start: int, end: int, frames: int) -> None:
    """Bound the RLE position channel used by CalcBonePosition."""
    if frames <= 0 or end > len(data):
        raise ProbeError("compressed position frame or record span is invalid")
    cursor = start
    covered = 0
    while covered < frames:
        if cursor < start or cursor + 2 > end:
            raise ProbeError("compressed position stream leaves its bone record")
        valid, total = struct.unpack_from("<BB", data, cursor)
        if not 1 <= valid <= total:
            raise ProbeError("compressed position run is invalid")
        size = 2 + valid * 2
        if cursor + size > end:
            raise ProbeError("compressed position samples leave their bone record")
        covered += total
        cursor += size


def _animation_chains(data: bytes, bone_count: int) -> list[tuple[int, int]]:
    count = _int(data, 180, "animation count")
    table = _int(data, 184, "animation table")
    if not 1 <= count <= 128 or table <= 0 or table % 4:
        raise ProbeError("Scout animation table is outside the probe limit")
    _span(data, table, count * ANIM_STRIDE, "animation table")
    chains: list[tuple[int, int]] = []
    for animation in range(count):
        base = table + animation * ANIM_STRIDE
        if _int(data, base, "animation baseptr") != -base:
            raise ProbeError("animation descriptor base pointer is invalid")
        flags = _int(data, base + 12, "animation flags")
        frames = _int(data, base + 16, "animation frame count")
        block = _int(data, base + 52, "animation block")
        offset = _int(data, base + 56, "animation offset")
        section_offset = _int(data, base + 80, "section offset")
        section_frames = _int(data, base + 84, "section frames")
        zero_frame_count = struct.unpack_from("<h", data, base + 90)[0]
        zero_frame_offset = _int(data, base + 92, "zero-frame offset")
        if flags not in (0, 1) or not 1 <= frames <= 65535 or zero_frame_count or zero_frame_offset:
            raise ProbeError("Scout animation has unsupported delta or zero-frame data")
        if block != 0 or offset <= 0:
            raise ProbeError("Scout animation is external or missing")
        if section_frames == 0:
            if section_offset:
                raise ProbeError("unsectioned animation has a section table")
            chains.append((base + offset, frames))
            continue
        if not 1 <= section_frames < frames or section_offset <= 0:
            raise ProbeError("sectioned animation descriptor is invalid")
        section_count = frames // section_frames + 2
        if section_count > MAX_SECTIONS:
            raise ProbeError("animation section count exceeds probe limit")
        section_table = base + section_offset
        _span(data, section_table, section_count * 8, "animation sections")
        for section in range(section_count):
            part_block, part_offset = struct.unpack_from("<ii", data, section_table + section * 8)
            if part_block != 0 or part_offset <= 0:
                raise ProbeError("animation section is external or missing")
            needed = max(1, min(section_frames, frames - 1 - section * section_frames))
            chains.append((base + part_offset, needed))
    if len({at for at, _ in chains}) != len(chains):
        raise ProbeError("animation chains unexpectedly share an offset")
    return chains


def _unweighted_weapon_sequence_cells(
    data: bytes, bone_count: int, weapons: list[int]
) -> tuple[int, tuple[str, ...]]:
    count = _int(data, 188, "sequence count")
    table = _int(data, 192, "sequence table")
    if not 1 <= count <= 128 or table <= 0 or table % 4:
        raise ProbeError("Scout sequence table is outside the probe limit")
    _span(data, table, count * 212, "sequence table")
    unweighted = 0
    labels: list[str] = []
    for sequence in range(count):
        base = table + sequence * 212
        name_relative = _int(data, base + 4, "sequence name offset")
        if name_relative <= 0:
            raise ProbeError("sequence name is missing")
        label = _name(data, base + name_relative, "sequence")
        relative = _int(data, base + 156, "sequence weight offset")
        if relative <= 0:
            raise ProbeError("sequence bone weights are missing")
        weights = base + relative
        _span(data, weights, bone_count * 4, "sequence bone weights")
        sequence_has_unweighted_weapon = False
        for bone in weapons:
            weight = struct.unpack_from("<f", data, weights + bone * 4)[0]
            if weight not in (0.0, 1.0):
                raise ProbeError("Scout weapon bone has an unsupported sequence weight")
            unweighted += weight == 0.0
            sequence_has_unweighted_weapon |= weight == 0.0
        if sequence_has_unweighted_weapon:
            labels.append(label)
    return unweighted, tuple(labels)


def weapon_only_candidate(
    data: bytes, expected_sha256: str, *, expected_weapon_count: int = 17
) -> tuple[bytes, WeaponPatch]:
    if len(data) > MAX_FILE_BYTES or len(data) < 408:
        raise ProbeError("MDL length is outside the 8 MiB probe limit")
    digest = hashlib.sha256(data).hexdigest()
    if digest != expected_sha256.lower():
        raise ProbeError("scratch input SHA-256 differs from the expected digest")
    model = parse_mdl(data)
    if model.name != STOCK_ANIM.removeprefix("models/"):
        raise ProbeError("input is not the Scout animation model")
    if _int(data, 232, "animation bodyparts") != 0:
        raise ProbeError("Scout animation model unexpectedly has geometry")
    table, weapons, _ = _bones(data, expected_weapon_count)
    bone_count = _int(data, 156, "bone count")
    linear_positions, linear_scales = _linear_positions(data, bone_count)
    unweighted, unweighted_sequences = _unweighted_weapon_sequence_cells(data, bone_count, weapons)
    output = bytearray(data)
    default_offsets: list[int] = []
    linear_offsets: list[int] = []
    allowed: set[int] = set()
    for bone in weapons:
        default = table + bone * BONE_STRIDE + 32
        linear = linear_positions + bone * 12
        default_pos = struct.unpack_from("<3f", data, default)
        linear_pos = struct.unpack_from("<3f", data, linear)
        linear_scale = struct.unpack_from("<3f", data, linear_scales + bone * 12)
        if default_pos != linear_pos or not all(math.isfinite(v) and abs(v) < 1024 for v in default_pos):
            raise ProbeError("Scout weapon default and linear positions differ or are out of range")
        if not all(math.isfinite(v) and 0 < abs(v) * 32768 < 1024 for v in linear_scale):
            raise ProbeError("Scout weapon linear position scale exceeds the hide bound")
        for offset, target in ((default + 8, default_offsets), (linear + 8, linear_offsets)):
            struct.pack_into("<f", output, offset, HIDDEN_Z)
            target.append(offset)
            allowed.update(range(offset, offset + 4))

    raw_offsets: list[int] = []
    compressed = 0
    for start, frames in _animation_chains(data, bone_count):
        record = start
        seen: set[int] = set()
        for _ in range(bone_count):
            _span(data, record, 4, "animation bone record")
            bone, flags, next_offset = struct.unpack_from("<BBh", data, record)
            if bone >= bone_count or bone in seen or flags not in KNOWN_FLAGS:
                raise ProbeError("animation bone record index or flags are invalid")
            seen.add(bone)
            if next_offset < 0 or (next_offset != 0 and next_offset < 4):
                raise ProbeError("animation bone record does not advance")
            if next_offset:
                _span(data, record, next_offset, "animation bone record payload")
            if bone in weapons:
                if next_offset == 0:
                    raise ProbeError("weapon record has no bounded successor")
                end = record + next_offset
                if flags == 0x21:
                    position = record + 12  # four-byte record + Quaternion64
                    if position + 6 > end:
                        raise ProbeError("raw weapon position leaves its bone record")
                    xyz = struct.unpack_from("<3e", data, position)
                    if not all(math.isfinite(v) and abs(v) < 1024 for v in xyz):
                        raise ProbeError("raw weapon position is outside the probe limit")
                    z = position + 4
                    struct.pack_into("<e", output, z, HIDDEN_Z)
                    raw_offsets.append(z)
                    allowed.update(range(z, z + 2))
                elif flags == 0x0C:
                    pointer = record + 10  # rotation valueptr follows the header
                    if pointer + 6 > end:
                        raise ProbeError("compressed weapon position pointer leaves its record")
                    for axis in range(3):
                        relative = struct.unpack_from("<h", data, pointer + axis * 2)[0]
                        if relative < 0:
                            raise ProbeError("compressed weapon position pointer is negative")
                        if relative:
                            _validate_value_stream(data, pointer + relative, end, frames)
                    compressed += 1
                else:
                    raise ProbeError("weapon record has an unsupported position encoding")
            if next_offset == 0:
                break
            record += next_offset
        else:
            raise ProbeError("animation chain exceeds the bone count")

    fields = [(offset, 4) for offset in default_offsets + linear_offsets]
    fields += [(offset, 2) for offset in raw_offsets]
    changed = {index for index, (before, after) in enumerate(zip(data, output)) if before != after}
    if (not changed or not changed.issubset(allowed)
            or len(allowed) != sum(size for _, size in fields)
            or not all(any(index in changed for index in range(offset, offset + size)) for offset, size in fields)):
        raise ProbeError("candidate changed bytes outside the expected weapon position fields")
    result = bytes(output)
    parsed = parse_mdl(result)
    if parsed.name != model.name or parsed.animations != model.animations or parsed.sequences != model.sequences:
        raise ProbeError("candidate changed Scout animation metadata")
    if result[8:12] != data[8:12] or len(result) != len(data):
        raise ProbeError("candidate checksum or length differs from stock")
    for offset in default_offsets + linear_offsets:
        if struct.unpack_from("<f", result, offset)[0] != HIDDEN_Z:
            raise ProbeError("candidate weapon default position failed readback")
    for offset in raw_offsets:
        if struct.unpack_from("<e", result, offset)[0] != HIDDEN_Z:
            raise ProbeError("candidate weapon raw position failed readback")
    return result, WeaponPatch(
        digest,
        hashlib.sha256(result).hexdigest(),
        len(data),
        len(changed),
        len(weapons),
        len(_animation_chains(data, bone_count)),
        len(raw_offsets),
        compressed,
        unweighted,
        unweighted_sequences,
        tuple(default_offsets),
        tuple(linear_offsets),
        tuple(raw_offsets),
        True,
    )


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("scratch_copy", type=Path, help="Scout MDL scratch copy below the OS temp directory")
    args = parser.parse_args(argv)
    try:
        input_path = args.scratch_copy.resolve(strict=True)
        temp_root = Path(tempfile.gettempdir()).resolve(strict=True)
        if input_path.name != SCOUT_FILE or not input_path.is_relative_to(temp_root):
            raise ProbeError("input must be a Scout MDL scratch copy below the OS temp directory")
        with input_path.open("rb") as source:
            data = source.read(MAX_FILE_BYTES + 1)
        output, patch = weapon_only_candidate(data, STOCK_SHA256)
        output_dir = Path(tempfile.mkdtemp(prefix="execs-d7-scout-weapon-probe-", dir=temp_root))
        output_path = output_dir / SCOUT_FILE
        with output_path.open("xb") as destination:
            destination.write(output)
        if output_path.read_bytes() != output:
            raise ProbeError("scratch candidate failed readback")
    except (OSError, ProbeError, UnicodeDecodeError, ValueError) as error:
        print(f"Scout weapon probe: {error}", file=sys.stderr)
        return 2
    print(json.dumps({
        "output_scratch_copy": str(output_path),
        "input_sha256": patch.input_sha256,
        "output_sha256": patch.output_sha256,
        "input_bytes": patch.input_bytes,
        "changed_bytes": patch.changed_bytes,
        "weapon_bone_count": patch.weapon_bone_count,
        "animation_chain_count": patch.animation_chain_count,
        "weapon_raw_position_records": patch.weapon_raw_position_records,
        "weapon_compressed_position_records": patch.weapon_compressed_position_records,
        "unweighted_weapon_sequence_cells": patch.unweighted_weapon_sequence_cells,
        "unweighted_weapon_sequences": patch.unweighted_weapon_sequences,
        "default_position_fields": len(patch.default_z_offsets),
        "linear_position_fields": len(patch.linear_z_offsets),
        "raw_position_fields": len(patch.raw_z_offsets),
        "mdl_checksum_unchanged": patch.mdl_checksum_unchanged,
    }, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
