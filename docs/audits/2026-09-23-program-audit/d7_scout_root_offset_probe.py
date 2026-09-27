"""Audit-only Scout MDL experiment; never writes to the TF2 installation.

This intentionally narrow probe changes the root position for one stock
animation in a verified scratch copy. It is not a product builder or a
validated way to hide a viewmodel in retail TF2.

Source definitions:
https://github.com/ValveSoftware/source-sdk-2013/blob/b8cfb12c0e083a2ef5b2f9f9b50f3902fa034474/src/public/studio.h
https://github.com/ValveSoftware/source-sdk-2013/blob/b8cfb12c0e083a2ef5b2f9f9b50f3902fa034474/src/public/bone_setup.cpp
https://github.com/ValveSoftware/source-sdk-2013/blob/b8cfb12c0e083a2ef5b2f9f9b50f3902fa034474/src/public/mathlib/compressed_vector.h
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

from d7_stock_mdl_probe import MAX_FILE_BYTES, ProbeError, parse_mdl


SCOUT_MODEL = "weapons/c_models/c_scout_animations.mdl"
SCOUT_FILE = "c_scout_animations.mdl"
ANIMATION = "@ss_draw"
SEQUENCE = "ss_draw"
ROOT_BONE_STRIDE = 216
HIDDEN_ROOT_POSITION = (0.0, 0.0, -4096.0)
ROOT_RECORD_FLAGS = 0x21  # STUDIO_ANIM_RAWPOS | STUDIO_ANIM_RAWROT2


@dataclass(frozen=True)
class Patch:
    position_offset: int
    original_position: tuple[float, float, float]
    output_position: tuple[float, float, float]
    original_sha256: str
    output_sha256: str


def _integer(data: bytes, offset: int, label: str) -> int:
    if offset < 0 or offset + 4 > len(data):
        raise ProbeError(f"{label} is outside the MDL")
    return struct.unpack_from("<i", data, offset)[0]


def _span(data: bytes, offset: int, size: int, label: str) -> None:
    if offset < 0 or size < 0 or offset > len(data) or size > len(data) - offset:
        raise ProbeError(f"{label} is outside the MDL")


def _name(data: bytes, offset: int, label: str) -> str:
    _span(data, offset, 1, label)
    end = data.find(b"\0", offset, min(offset + 192, len(data)))
    if end <= offset:
        raise ProbeError(f"{label} has no bounded name")
    return data[offset:end].decode("ascii", errors="strict")


def hidden_scout_draw(data: bytes, expected_sha256: str) -> tuple[bytes, Patch]:
    """Return a candidate with only one six-byte root Vector48 field changed."""
    if len(data) > MAX_FILE_BYTES:
        raise ProbeError("MDL exceeds the 8 MiB probe limit")
    actual_sha256 = hashlib.sha256(data).hexdigest()
    if actual_sha256 != expected_sha256.lower():
        raise ProbeError("scratch input SHA-256 differs from the supplied digest")

    model = parse_mdl(data)
    if model.name != SCOUT_MODEL:
        raise ProbeError("input is not the expected Scout animation model")

    animation_indexes = [i for i, animation in enumerate(model.animations) if animation.name == ANIMATION]
    sequences = [sequence for sequence in model.sequences if sequence.label == SEQUENCE]
    if len(animation_indexes) != 1 or len(sequences) != 1:
        raise ProbeError("expected one Scout draw animation and sequence")
    if sequences[0].animation_indexes != (animation_indexes[0],):
        raise ProbeError("Scout draw must reference only the chosen local animation")
    if any(
        animation_indexes[0] in sequence.animation_indexes
        for sequence in model.sequences
        if sequence is not sequences[0]
    ):
        raise ProbeError("Scout draw animation is shared by another sequence")

    bone_count = _integer(data, 156, "numbones")
    bone_index = _integer(data, 160, "boneindex")
    if not 1 <= bone_count <= 128:
        raise ProbeError("bone count is outside the Source limit")
    _span(data, bone_index, bone_count * ROOT_BONE_STRIDE, "bone table")
    if bone_index < 408 or bone_index % 4:
        raise ProbeError("bone table offset is invalid")
    root_name_offset = _integer(data, bone_index, "root bone name index")
    if root_name_offset <= 0 or _name(data, bone_index + root_name_offset, "root bone") != "root":
        raise ProbeError("bone zero is not the expected root")
    if _integer(data, bone_index + 4, "root parent") != -1:
        raise ProbeError("root bone has a parent")
    for bone in range(1, bone_count):
        parent = _integer(data, bone_index + bone * ROOT_BONE_STRIDE + 4, "bone parent")
        if not 0 <= parent < bone:
            raise ProbeError("Scout bone hierarchy is not rooted and ordered")

    sequence_base = _integer(data, 192, "localseqindex") + model.sequences.index(sequences[0]) * 212
    weight_index = _integer(data, sequence_base + 156, "weightlistindex")
    _span(data, sequence_base + weight_index, bone_count * 4, "sequence bone weights")
    root_weight = struct.unpack_from("<f", data, sequence_base + weight_index)[0]
    if root_weight != 1.0:
        raise ProbeError("Scout draw does not fully weight the root bone")

    animation_base = _integer(data, 184, "localanimindex") + animation_indexes[0] * 100
    if _integer(data, animation_base + 52, "animblock") != 0:
        raise ProbeError("external animation block is unsupported")
    if _integer(data, animation_base + 80, "sectionindex") != 0 or _integer(
        data, animation_base + 84, "sectionframes"
    ) != 0:
        raise ProbeError("sectioned animation is unsupported")
    animation_offset = _integer(data, animation_base + 56, "animindex")
    if animation_offset <= 0:
        raise ProbeError("local animation data is missing")

    record = animation_base + animation_offset
    seen_bones: set[int] = set()
    position_offset = -1
    for _ in range(bone_count):
        _span(data, record, 4, "animation bone record")
        bone, flags, next_offset = struct.unpack_from("<BBh", data, record)
        if bone >= bone_count or bone in seen_bones:
            raise ProbeError("animation bone index is invalid or duplicated")
        seen_bones.add(bone)
        if bone == 0:
            if flags != ROOT_RECORD_FLAGS or next_offset < 18:
                raise ProbeError("root record is not an unsectioned raw-position record")
            position_offset = record + 12  # four-byte record + Quaternion64
            _span(data, position_offset, 6, "root Vector48")
        if next_offset == 0:
            break
        if next_offset < 4:
            raise ProbeError("animation record does not advance")
        _span(data, record, next_offset, "animation record payload")
        record += next_offset
    else:
        raise ProbeError("animation chain exceeds the bone count")
    if position_offset < 0:
        raise ProbeError("Scout draw has no root animation record")

    original_position = struct.unpack_from("<3e", data, position_offset)
    if not all(math.isfinite(value) and abs(value) < 1024 for value in original_position):
        raise ProbeError("original root position is outside the probe limit")
    output = bytearray(data)
    struct.pack_into("<3e", output, position_offset, *HIDDEN_ROOT_POSITION)
    output_bytes = bytes(output)
    if data[:position_offset] != output_bytes[:position_offset] or data[position_offset + 6 :] != output_bytes[position_offset + 6 :]:
        raise ProbeError("candidate changed bytes outside the root Vector48")
    if output_bytes == data or parse_mdl(output_bytes).sha256 == model.sha256:
        raise ProbeError("candidate did not change the animation model")
    if struct.unpack_from("<3e", output_bytes, position_offset) != HIDDEN_ROOT_POSITION:
        raise ProbeError("candidate root position failed to round-trip")

    return output_bytes, Patch(
        position_offset,
        original_position,
        HIDDEN_ROOT_POSITION,
        actual_sha256,
        hashlib.sha256(output_bytes).hexdigest(),
    )


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("scratch_copy", type=Path, help="Scout MDL scratch copy under the OS temp directory")
    parser.add_argument("--expected-sha256", required=True, help="SHA-256 of that exact scratch copy")
    args = parser.parse_args(argv)
    try:
        input_path = args.scratch_copy.resolve(strict=True)
        temp_root = Path(tempfile.gettempdir()).resolve(strict=True)
        if input_path.name != SCOUT_FILE or not input_path.is_relative_to(temp_root):
            raise ProbeError("input must be a Scout MDL scratch copy below the OS temp directory")
        with input_path.open("rb") as source:
            data = source.read(MAX_FILE_BYTES + 1)
        output_data, patch = hidden_scout_draw(data, args.expected_sha256)
        output_dir = Path(tempfile.mkdtemp(prefix="execs-d7-scout-root-probe-", dir=temp_root))
        output_path = output_dir / SCOUT_FILE
        with output_path.open("xb") as destination:
            destination.write(output_data)
        if output_path.read_bytes() != output_data:
            raise ProbeError("scratch output failed readback")
    except (OSError, ProbeError, UnicodeDecodeError, ValueError) as error:
        print(f"Scout root probe: {error}", file=sys.stderr)
        return 2

    print(json.dumps({"output_scratch_copy": str(output_path), **patch.__dict__}, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
