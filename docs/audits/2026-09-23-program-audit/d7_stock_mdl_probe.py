"""Read-only, bounded inventory of local animations in a Source MDL v48 file.

This audit probe follows Valve's studiohdr_t, mstudioanimdesc_t and
mstudioseqdesc_t structures. It does not decode animation frames, decompile
models, build a VPK, or write to its input directory.

Source: https://github.com/ValveSoftware/source-sdk-2013/blob/b8cfb12c0e083a2ef5b2f9f9b50f3902fa034474/src/public/studio.h
"""

from __future__ import annotations

import argparse
import hashlib
import json
import math
import struct
import sys
from dataclasses import dataclass
from pathlib import Path


MAX_FILE_BYTES = 8 * 1024 * 1024
MAX_RECORDS = 4096
MAX_BLEND_CELLS = 4096
MAX_NAME_BYTES = 192
HEADER_BYTES = 408
ANIM_DESC_BYTES = 100
SEQ_DESC_BYTES = 212


class ProbeError(ValueError):
    """The input does not meet this probe's deliberately narrow MDL bounds."""


@dataclass(frozen=True)
class Animation:
    name: str
    frames: int
    fps: float


@dataclass(frozen=True)
class Sequence:
    label: str
    animation_indexes: tuple[int, ...]


@dataclass(frozen=True)
class Model:
    name: str
    sha256: str
    animations: tuple[Animation, ...]
    sequences: tuple[Sequence, ...]


def _span(data: bytes, offset: int, size: int, what: str) -> None:
    if offset < 0 or size < 0 or offset > len(data) or size > len(data) - offset:
        raise ProbeError(f"{what} extends outside the MDL")


def _int(data: bytes, offset: int, what: str) -> int:
    _span(data, offset, 4, what)
    return struct.unpack_from("<i", data, offset)[0]


def _float(data: bytes, offset: int, what: str) -> float:
    _span(data, offset, 4, what)
    return struct.unpack_from("<f", data, offset)[0]


def _name(data: bytes, offset: int, what: str) -> str:
    _span(data, offset, 1, what)
    end = data.find(b"\0", offset, min(len(data), offset + MAX_NAME_BYTES))
    if end <= offset:
        raise ProbeError(f"{what} is empty or lacks a bounded NUL terminator")
    raw = data[offset:end]
    if any(byte < 32 or byte > 126 for byte in raw):
        raise ProbeError(f"{what} is not printable ASCII")
    return raw.decode("ascii")


def _table(data: bytes, count: int, offset: int, stride: int, what: str) -> range:
    if count < 0 or count > MAX_RECORDS:
        raise ProbeError(f"{what} count is outside the probe limit")
    if count == 0:
        return range(0)
    if offset <= 0 or offset % 4:
        raise ProbeError(f"{what} table offset is invalid")
    _span(data, offset, count * stride, f"{what} table")
    return range(offset, offset + count * stride, stride)


def parse_mdl(data: bytes) -> Model:
    """Inspect metadata only; all references are checked before dereference."""
    if len(data) > MAX_FILE_BYTES:
        raise ProbeError("MDL exceeds the 8 MiB probe limit")
    _span(data, 0, HEADER_BYTES, "studiohdr_t")
    if data[:4] != b"IDST" or _int(data, 4, "version") != 48:
        raise ProbeError("expected a Source IDST MDL v48 file")
    if _int(data, 76, "length") != len(data):
        raise ProbeError("studiohdr_t.length differs from the file length")
    model_name = _name(data, 12, "model name")

    # studiohdr_t fields at 180..192. Array indices are file-relative here.
    anim_count = _int(data, 180, "numlocalanim")
    anim_index = _int(data, 184, "localanimindex")
    seq_count = _int(data, 188, "numlocalseq")
    seq_index = _int(data, 192, "localseqindex")

    animations = []
    for base in _table(data, anim_count, anim_index, ANIM_DESC_BYTES, "animation"):
        if _int(data, base, "animation baseptr") != -base:
            raise ProbeError("animation descriptor does not point back to the header")
        name_offset = _int(data, base + 4, "animation name offset")
        if name_offset <= 0:
            raise ProbeError("animation name offset is invalid")
        name = _name(data, base + name_offset, "animation name")
        fps = _float(data, base + 8, "animation FPS")
        frames = _int(data, base + 16, "animation frame count")
        if not math.isfinite(fps) or not 0 < fps <= 1000:
            raise ProbeError("animation FPS is outside the probe limit")
        if not 0 < frames <= 65535:
            raise ProbeError("animation frame count is outside the probe limit")
        animations.append(Animation(name, frames, fps))

    sequences = []
    for base in _table(data, seq_count, seq_index, SEQ_DESC_BYTES, "sequence"):
        if _int(data, base, "sequence baseptr") != -base:
            raise ProbeError("sequence descriptor does not point back to the header")
        label_offset = _int(data, base + 4, "sequence label offset")
        if label_offset <= 0:
            raise ProbeError("sequence label offset is invalid")
        label = _name(data, base + label_offset, "sequence label")
        blends = _int(data, base + 56, "sequence numblends")
        grid_offset = _int(data, base + 60, "sequence animindexindex")
        width = _int(data, base + 68, "sequence groupsize[0]")
        height = _int(data, base + 72, "sequence groupsize[1]")
        if not 0 < blends <= MAX_BLEND_CELLS or width <= 0 or height <= 0:
            raise ProbeError("sequence blend grid is outside the probe limit")
        if width * height != blends or grid_offset <= 0:
            raise ProbeError("sequence blend grid does not match numblends")
        grid_base = base + grid_offset
        _span(data, grid_base, blends * 2, "sequence animation index grid")
        indexes = struct.unpack_from(f"<{blends}h", data, grid_base)
        if any(index < 0 or index >= len(animations) for index in indexes):
            raise ProbeError("sequence references an invalid local animation")
        sequences.append(Sequence(label, indexes))

    return Model(model_name, hashlib.sha256(data).hexdigest(), tuple(animations), tuple(sequences))


def inspect_file(path: Path) -> Model:
    with path.open("rb") as file:
        data = file.read(MAX_FILE_BYTES + 1)
    return parse_mdl(data)


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("paths", nargs="+", type=Path, help="MDL files or a directory of scratch MDL copies")
    parser.add_argument("--names", action="store_true", help="include animation and sequence names")
    args = parser.parse_args(argv)
    paths = []
    for path in args.paths:
        paths.extend(sorted(path.glob("*.mdl")) if path.is_dir() else [path])
    if not paths or len(paths) > 32:
        parser.error("provide between 1 and 32 MDL files")

    result = []
    for path in paths:
        try:
            model = inspect_file(path)
        except (OSError, ProbeError) as error:
            print(f"{path}: {error}", file=sys.stderr)
            return 2
        item: dict[str, object] = {
            "file": path.name,
            "model": model.name,
            "sha256": model.sha256,
            "local_animations": len(model.animations),
            "local_sequences": len(model.sequences),
        }
        if args.names:
            item["animations"] = [animation.name for animation in model.animations]
            item["sequences"] = [
                {
                    "label": sequence.label,
                    "animations": [model.animations[index].name for index in sequence.animation_indexes],
                }
                for sequence in model.sequences
            ]
        result.append(item)
    print(json.dumps(result, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
