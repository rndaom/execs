"""Read-only preflight for a Scout animation candidate and its renderable parent.

This audit tool reads the installed TF2 VPK and a candidate below the OS temp
directory. It does not start HLMV or TF2, mount game paths, or write game,
profile, or candidate files. Run Python with -B to avoid import cache writes.
The MDL field layout follows Valve's pinned Source SDK ``studio.h``:
https://github.com/ValveSoftware/source-sdk-2013/blob/b8cfb12c0e083a2ef5b2f9f9b50f3902fa034474/src/public/studio.h
"""

from __future__ import annotations

import argparse
import hashlib
import json
import struct
import sys
import tempfile
import zlib
from dataclasses import dataclass
from pathlib import Path

from d7_scout_root_offset_probe import HIDDEN_ROOT_POSITION, hidden_scout_draw
from d7_stock_mdl_probe import MAX_FILE_BYTES, ProbeError, parse_mdl


MODEL_DIR = "models/weapons/c_models/"
STOCK_ANIM = MODEL_DIR + "c_scout_animations.mdl"
SCOUT_ARMS = MODEL_DIR + "c_scout_arms.mdl"
STOCK_SHA256 = "da6aba88bfa1a2f0c55f2f0f376eacc2550b1c82343c56e4f01473f7b6d30710"
ARMS_SHA256 = "6708e5cce31198f80252e4c8df8eb8dd26580bae3fef7c55ffe136ddc579caf9"
CANDIDATE_SHA256 = "d3cd80bd9c8d70532ea3138362ee087899c3ecb166ae8b7d8faf79492954d4b8"
MAX_VPK_DIR_BYTES = 16 * 1024 * 1024
MAX_VPK_TREE_BYTES = 8 * 1024 * 1024
MAX_VPK_ENTRIES = 200_000
MAX_NAME_BYTES = 192


@dataclass(frozen=True)
class VpkEntry:
    crc32: int
    preload: bytes
    archive_index: int
    offset: int
    length: int


def _span(data: bytes, offset: int, size: int, label: str) -> None:
    if offset < 0 or size < 0 or offset > len(data) or size > len(data) - offset:
        raise ProbeError(f"{label} is outside its bounded input")


def _integer(data: bytes, offset: int, label: str) -> int:
    _span(data, offset, 4, label)
    return struct.unpack_from("<i", data, offset)[0]


def _name(data: bytes, offset: int, limit: int, label: str) -> tuple[str, int]:
    _span(data, offset, 1, label)
    end = data.find(b"\0", offset, min(limit, offset + MAX_NAME_BYTES + 1))
    if end < offset:
        raise ProbeError(f"{label} has no bounded terminator")
    try:
        return data[offset:end].decode("ascii"), end + 1
    except UnicodeDecodeError as error:
        raise ProbeError(f"{label} is not ASCII") from error


def find_vpk_entries(directory: bytes, targets: set[str]) -> dict[str, VpkEntry]:
    if len(directory) > MAX_VPK_DIR_BYTES:
        raise ProbeError("VPK directory exceeds 16 MiB")
    _span(directory, 0, 28, "VPK v2 header")
    signature, version, tree_size = struct.unpack_from("<III", directory)
    if signature != 0x55AA1234 or version != 2 or tree_size > MAX_VPK_TREE_BYTES:
        raise ProbeError("unsupported or oversized VPK directory")
    tree_end = 28 + tree_size
    _span(directory, 28, tree_size, "VPK tree")
    if not targets:
        raise ProbeError("no VPK targets were supplied")
    found: dict[str, VpkEntry] = {}
    offset = 28
    count = 0
    while True:
        extension, offset = _name(directory, offset, tree_end, "VPK extension")
        if not extension:
            break
        while True:
            folder, offset = _name(directory, offset, tree_end, "VPK folder")
            if not folder:
                break
            while True:
                stem, offset = _name(directory, offset, tree_end, "VPK stem")
                if not stem:
                    break
                count += 1
                if count > MAX_VPK_ENTRIES:
                    raise ProbeError("VPK tree exceeds the entry limit")
                _span(directory, offset, 18, "VPK entry")
                crc, preload_size, archive, entry_offset, length, terminator = struct.unpack_from(
                    "<IHHIIH", directory, offset
                )
                if terminator != 0xFFFF:
                    raise ProbeError("VPK entry terminator is invalid")
                offset += 18
                _span(directory, offset, preload_size, "VPK preload")
                path = f"{folder}/{stem}.{extension}"
                if path in targets:
                    if path in found or archive == 0x7FFF or length + preload_size > MAX_FILE_BYTES:
                        raise ProbeError("target VPK entry is duplicate, inline, or oversized")
                    found[path] = VpkEntry(
                        crc, directory[offset : offset + preload_size], archive, entry_offset, length
                    )
                offset += preload_size
    if offset != tree_end or set(found) != targets:
        raise ProbeError("VPK tree is malformed or target models are absent")
    return found


def read_vpk_entry(directory_path: Path, entry: VpkEntry) -> bytes:
    if entry.archive_index > 999:
        raise ProbeError("VPK archive index is outside the numbered-shard range")
    shard = directory_path.with_name(f"tf2_misc_{entry.archive_index:03}.vpk")
    if not shard.is_file() or entry.offset + entry.length > shard.stat().st_size:
        raise ProbeError("VPK shard or entry span is missing")
    with shard.open("rb") as source:
        source.seek(entry.offset)
        payload = source.read(entry.length)
    data = entry.preload + payload
    if len(payload) != entry.length or zlib.crc32(data) & 0xFFFFFFFF != entry.crc32:
        raise ProbeError("VPK entry length or CRC-32 differs from the directory")
    return data


def included_models(mdl: bytes) -> tuple[str, ...]:
    count = _integer(mdl, 336, "included model count")
    table = _integer(mdl, 340, "included model table")
    if not 0 <= count <= 32:
        raise ProbeError("included model count exceeds the probe limit")
    if count:
        _span(mdl, table, count * 8, "included model table")
    names: list[str] = []
    for index in range(count):
        base = table + index * 8
        relative = _integer(mdl, base + 4, "included model name offset")
        name, _ = _name(mdl, base + relative, len(mdl), "included model name")
        names.append(name)
    return tuple(names)


def mdl_header_name(mdl: bytes) -> str:
    _span(mdl, 0, 408, "MDL header")
    if mdl[:4] != b"IDST" or _integer(mdl, 4, "MDL version") != 48:
        raise ProbeError("MDL identity or version is unsupported")
    if _integer(mdl, 76, "MDL declared length") != len(mdl):
        raise ProbeError("MDL declared length differs from the file")
    end = mdl.find(b"\0", 12, 76)
    if end <= 12:
        raise ProbeError("MDL header name has no terminator")
    try:
        return mdl[12:end].decode("ascii")
    except UnicodeDecodeError as error:
        raise ProbeError("MDL header name is not ASCII") from error


def scout_weapon_bone_relationships(mdl: bytes) -> dict[str, object]:
    count = _integer(mdl, 156, "Scout bone count")
    table = _integer(mdl, 160, "Scout bone table")
    if not 1 <= count <= 128:
        raise ProbeError("Scout bone count exceeds the Source limit")
    _span(mdl, table, count * 216, "Scout bone table")
    names: list[str] = []
    parents: list[int] = []
    for index in range(count):
        base = table + index * 216
        relative = _integer(mdl, base, "Scout bone name offset")
        parent = _integer(mdl, base + 4, "Scout bone parent")
        if relative <= 0 or (index == 0 and parent != -1) or (index > 0 and not 0 <= parent < index):
            raise ProbeError("Scout bone name or hierarchy is invalid")
        name, _ = _name(mdl, base + relative, len(mdl), "Scout bone name")
        names.append(name)
        parents.append(parent)
    if names[0] != "root" or names.count("bip_hand_L") != 1 or names.count("bip_hand_R") != 1:
        raise ProbeError("Scout root or hand bones differ from the pinned model")
    weapon_indexes = [
        index for index, name in enumerate(names)
        if name.lower().startswith(("weapon_bone", "vm_weapon_bone"))
    ]
    if not weapon_indexes or any(names[parents[index]] not in ("bip_hand_L", "bip_hand_R") for index in weapon_indexes):
        raise ProbeError("Scout weapon bones are not direct children of the two hands")
    weapon_set = set(weapon_indexes)
    for hand in ("bip_hand_L", "bip_hand_R"):
        parent = parents[names.index(hand)]
        while parent >= 0:
            if parent in weapon_set:
                raise ProbeError("a Scout hand descends from a weapon bone")
            parent = parents[parent]
    return {
        "bone_count": count,
        "weapon_bone_count": len(weapon_indexes),
        "weapon_bones_directly_parented_to_hands": True,
        "hands_descend_from_weapon_bones": False,
    }


def validate_models(stock: bytes, arms: bytes, candidate: bytes) -> dict[str, object]:
    expected = ((stock, STOCK_SHA256, "stock animation"), (arms, ARMS_SHA256, "Scout arms"),
                (candidate, CANDIDATE_SHA256, "candidate animation"))
    for data, digest, label in expected:
        if hashlib.sha256(data).hexdigest() != digest:
            raise ProbeError(f"{label} SHA-256 differs from the pinned input")
    stock_meta = parse_mdl(stock)
    candidate_meta = parse_mdl(candidate)
    if stock_meta.name != STOCK_ANIM.removeprefix("models/") or mdl_header_name(arms) != SCOUT_ARMS.removeprefix("models/"):
        raise ProbeError("stock animation or Scout arms model identity differs")
    if candidate_meta.name != stock_meta.name or candidate_meta.animations != stock_meta.animations or candidate_meta.sequences != stock_meta.sequences:
        raise ProbeError("candidate metadata differs from the stock animation model")
    if _integer(stock, 232, "stock bodypart count") != 0 or _integer(candidate, 232, "candidate bodypart count") != 0:
        raise ProbeError("animation-only MDL unexpectedly has a bodypart")
    if _integer(arms, 232, "Scout arms bodypart count") < 1:
        raise ProbeError("Scout arms MDL is not a renderable parent")
    if included_models(arms) != (STOCK_ANIM,):
        raise ProbeError("Scout arms does not include exactly the stock animation model")
    rebuilt, patch = hidden_scout_draw(stock, STOCK_SHA256)
    if candidate != rebuilt or patch.output_sha256 != CANDIDATE_SHA256:
        raise ProbeError("candidate differs from the one-field Scout root-position patch")
    if patch.output_position != HIDDEN_ROOT_POSITION or _integer(stock, 8, "stock checksum") != _integer(candidate, 8, "candidate checksum"):
        raise ProbeError("candidate root position or MDL checksum differs")
    relationships = scout_weapon_bone_relationships(stock)
    return {
        "stock_animation_sha256": STOCK_SHA256,
        "scout_arms_sha256": ARMS_SHA256,
        "candidate_sha256": CANDIDATE_SHA256,
        "animation_bodyparts": 0,
        "scout_arms_bodyparts": _integer(arms, 232, "Scout arms bodypart count"),
        "scout_arms_includes": list(included_models(arms)),
        "changed_field_offset": patch.position_offset,
        "changed_field_bytes": 6,
        "candidate_root_position": list(HIDDEN_ROOT_POSITION),
        "mdl_checksum_unchanged": True,
        **relationships,
    }


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("vpk_dir", type=Path, help="confirmed install's tf2_misc_dir.vpk, read only")
    parser.add_argument("candidate", type=Path, help="candidate MDL below the OS temp directory")
    args = parser.parse_args(argv)
    try:
        directory_path = args.vpk_dir.resolve(strict=True)
        candidate_path = args.candidate.resolve(strict=True)
        temp_root = Path(tempfile.gettempdir()).resolve(strict=True)
        if directory_path.name != "tf2_misc_dir.vpk" or not (directory_path.parent / "steam.inf").is_file():
            raise ProbeError("VPK path is not a TF2 tf directory")
        steam_inf = (directory_path.parent / "steam.inf").read_text(encoding="ascii")
        if "appID=440" not in steam_inf.splitlines():
            raise ProbeError("steam.inf does not identify TF2 app 440")
        if candidate_path.name != "c_scout_animations.mdl" or not candidate_path.is_relative_to(temp_root):
            raise ProbeError("candidate must be a Scout MDL scratch file below the OS temp directory")
        with directory_path.open("rb") as source:
            directory = source.read(MAX_VPK_DIR_BYTES + 1)
        entries = find_vpk_entries(directory, {STOCK_ANIM, SCOUT_ARMS})
        with candidate_path.open("rb") as source:
            candidate = source.read(MAX_FILE_BYTES + 1)
        result = validate_models(
            read_vpk_entry(directory_path, entries[STOCK_ANIM]),
            read_vpk_entry(directory_path, entries[SCOUT_ARMS]),
            candidate,
        )
    except (OSError, ProbeError, UnicodeDecodeError, ValueError) as error:
        print(f"Scout viewer preflight: {error}", file=sys.stderr)
        return 2
    print(json.dumps(result, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
