"""Audit-only graph from installed TF2 item metadata to stock MDL animations.

The input MDL must be a scratch copy. This script does not use execs'
CompVM-derived group table and makes no explicit game, profile or repo writes.
Run with Python -B to avoid bytecode-cache writes in the repository.
Valve source is downloaded separately from the pinned SDK revision and checked
by SHA-256 before its viewmodel translation table is read.

Sources:
https://github.com/ValveSoftware/source-sdk-2013/blob/b8cfb12c0e083a2ef5b2f9f9b50f3902fa034474/src/game/shared/tf/tf_weaponbase.cpp#L4282-L4542
https://github.com/ValveSoftware/source-sdk-2013/blob/b8cfb12c0e083a2ef5b2f9f9b50f3902fa034474/src/public/studio.h#L3404-L3545
"""

from __future__ import annotations

import argparse
import hashlib
import json
import re
import struct
import sys
import tempfile
from pathlib import Path
from typing import Any

from d7_stock_mdl_probe import Model, ProbeError, parse_mdl


SCHEMA_LIMIT = 16 * 1024 * 1024
SDK_LIMIT = 512 * 1024
SDK_SHA256 = "f0c179bb431331e4f471836f9936d8eaed83ca69e7ae5f0b1c8f7099a25fc5db"
MODEL_STEM = {
    "demoman": "demo",
    "engineer": "engineer",
    "heavy": "heavy",
    "medic": "medic",
    "pyro": "pyro",
    "scout": "scout",
    "sniper": "sniper",
    "soldier": "soldier",
    "spy": "spy",
}
INSPECT = {
    "primary": "PRIMARY",
    "secondary": "SECONDARY",
    "melee": "MELEE",
    "building": "BUILDING",
}
MAX_TOKENS = 1_000_000
MAX_TOKEN_CHARS = 4096
MAX_DEPTH = 64


def _read(path: Path, limit: int, label: str) -> bytes:
    with path.open("rb") as source:
        data = source.read(limit + 1)
    if len(data) > limit:
        raise ProbeError(f"{label} exceeds the audit limit")
    return data


def _tokens(text: str) -> list[str]:
    if "\0" in text:
        raise ProbeError("KeyValues contains a NUL")
    tokens: list[str] = []
    pos = 0
    while pos < len(text):
        c = text[pos]
        if c.isspace():
            pos += 1
            continue
        if text.startswith("//", pos):
            end = text.find("\n", pos + 2)
            pos = len(text) if end < 0 else end + 1
            continue
        if text.startswith("/*", pos):
            end = text.find("*/", pos + 2)
            if end < 0:
                raise ProbeError("unterminated KeyValues comment")
            pos = end + 2
            continue
        if c in "{}":
            tokens.append(c)
            pos += 1
        elif c == '"':
            end = text.find('"', pos + 1)
            if end < 0:
                raise ProbeError("unterminated KeyValues string")
            tokens.append(text[pos + 1 : end])
            pos = end + 1
        else:
            end = pos
            while end < len(text) and not text[end].isspace() and text[end] not in '{}"':
                end += 1
            tokens.append(text[pos:end])
            pos = end
        if len(tokens) > MAX_TOKENS or len(tokens[-1]) > MAX_TOKEN_CHARS:
            raise ProbeError("KeyValues token limit exceeded")
    return tokens


def _pairs(tokens: list[str], start: int, depth: int, nested: bool) -> tuple[dict[str, Any], int]:
    if depth > MAX_DEPTH:
        raise ProbeError("KeyValues nesting limit exceeded")
    result: dict[str, Any] = {}
    pos = start
    while pos < len(tokens):
        key = tokens[pos]
        pos += 1
        if key == "}":
            if not nested:
                raise ProbeError("unexpected KeyValues close brace")
            return result, pos
        if key == "{" or pos >= len(tokens):
            raise ProbeError("KeyValues key lacks a value")
        value = tokens[pos]
        pos += 1
        if value == "{":
            parsed, pos = _pairs(tokens, pos, depth + 1, True)
            result[key.lower()] = parsed
        elif value == "}":
            raise ProbeError("KeyValues key lacks a value")
        else:
            result[key.lower()] = value
    if nested:
        raise ProbeError("unterminated KeyValues object")
    return result, pos


def parse_keyvalues(text: str) -> dict[str, Any]:
    tokens = _tokens(text)
    result, end = _pairs(tokens, 0, 0, False)
    if end != len(tokens):
        raise ProbeError("trailing KeyValues content")
    return result


def _obj(data: dict[str, Any], key: str) -> dict[str, Any]:
    value = data.get(key)
    if not isinstance(value, dict):
        raise ProbeError(f"expected object {key}")
    return value


def _merge(base: dict[str, Any], overlay: dict[str, Any]) -> dict[str, Any]:
    result = dict(base)
    for key, value in overlay.items():
        old = result.get(key)
        result[key] = _merge(old, value) if isinstance(old, dict) and isinstance(value, dict) else value
    return result


def resolve_item(game: dict[str, Any], item_id: str) -> dict[str, Any]:
    prefabs = _obj(game, "prefabs")
    item = _obj(_obj(game, "items"), item_id)

    def inherited(node: dict[str, Any], seen: frozenset[str]) -> dict[str, Any]:
        if len(seen) > 16:
            raise ProbeError("item prefab depth exceeds 16")
        result: dict[str, Any] = {}
        for name in str(node.get("prefab", "")).split():
            if name in seen:
                raise ProbeError("item prefab cycle")
            parent = _obj(prefabs, name.lower())
            result = _merge(result, inherited(parent, seen | {name}))
        return _merge(result, node)

    return inherited(item, frozenset())


def read_valve_table(source: bytes) -> dict[tuple[str, str], str]:
    if hashlib.sha256(source).hexdigest() != SDK_SHA256:
        raise ProbeError("Valve source differs from pinned tf_weaponbase.cpp")
    text = source.decode("utf-8")
    match = re.search(r"viewmodelacttable_t\s+s_viewmodelacttable\[\]\s*=\s*\{(.*?)\n\};", text, re.S)
    if not match:
        raise ProbeError("Valve viewmodel activity table not found")
    rows = re.findall(r"\{\s*(ACT_[A-Z0-9_]+)\s*,\s*(ACT_[A-Z0-9_]+)\s*,\s*(TF_WPN_TYPE_[A-Z0-9_]+)\s*\}", match.group(1))
    if len(rows) < 100:
        raise ProbeError("Valve viewmodel activity table is incomplete")
    table: dict[tuple[str, str], str] = {}
    for base, target, role in rows:
        key = (role, base)
        if key in table:
            raise ProbeError("duplicate Valve role/base activity")
        table[key] = target
    return table


def mdl_activities(data: bytes, model: Model) -> dict[str, list[dict[str, Any]]]:
    seq_start = struct.unpack_from("<i", data, 192)[0]
    result: dict[str, list[dict[str, Any]]] = {}
    for index, sequence in enumerate(model.sequences):
        base = seq_start + index * 212
        offset = struct.unpack_from("<i", data, base + 8)[0]
        if offset < 0:
            raise ProbeError("sequence activity name offset is negative")
        if offset == 0:
            continue
        address = base + offset
        if not 0 <= address < len(data):
            raise ProbeError("sequence activity name leaves the MDL")
        end = data.find(b"\0", address, min(len(data), address + 192))
        if end < 0:
            raise ProbeError("sequence activity name lacks a bounded terminator")
        if end == address:
            continue
        raw = data[address:end]
        if any(c < 32 or c > 126 for c in raw):
            raise ProbeError("sequence activity name is not printable ASCII")
        activity = raw.decode("ascii")
        result.setdefault(activity, []).append({
            "sequence": sequence.label,
            "animations": [model.animations[i].name for i in sequence.animation_indexes],
        })
    return result


def item_graph(game: dict[str, Any], item_id: str, class_name: str, table: dict[tuple[str, str], str], activities: dict[str, list[dict[str, Any]]]) -> dict[str, Any]:
    item = resolve_item(game, item_id)
    classes = _obj(item, "used_by_classes")
    if str(classes.get(class_name, "0")) == "0":
        raise ProbeError(f"item {item_id} is not used by {class_name}")
    slot = str(item.get("item_slot", ""))
    role = str(item.get("anim_slot", "")).upper()
    if not role:
        raise ProbeError(f"item {item_id} has no anim_slot; weapon-script role is unresolved")
    role_name = "TF_WPN_TYPE_" + role
    bases = sorted(base for known_role, base in table if known_role == role_name)
    if not bases:
        raise ProbeError(f"item {item_id} has unsupported anim_slot {role}")
    visuals = _obj(item, "visuals")
    replacements = visuals.get("animation_replacement", {})
    if not isinstance(replacements, dict):
        raise ProbeError("animation_replacement is not an object")
    if any(key.startswith("visuals_") for key in item):
        raise ProbeError("team-specific visuals need a separate verified pass")
    edges = []
    for base in bases:
        translated = replacements.get(base.lower()) or table[(role_name, base)]
        edges.append({"base": base, "activity": translated, "sequences": activities.get(translated, [])})
    if slot in INSPECT:
        for stage in ("START", "IDLE", "END"):
            base = f"ACT_{INSPECT[slot]}_VM_INSPECT_{stage}"
            translated = replacements.get(base.lower(), base)
            edges.append({"base": base, "activity": translated, "sequences": activities.get(translated, [])})
    return {
        "item_id": item_id,
        "item_name": item.get("name", item.get("item_name", "")),
        "item_class": item.get("item_class", ""),
        "class": class_name,
        "loadout_slot": slot,
        "animation_role": role_name,
        "role_source": "installed item-schema anim_slot",
        "edges": edges,
        "matched_edges": sum(bool(edge["sequences"]) for edge in edges),
        "unmatched_edges": [edge["activity"] for edge in edges if not edge["sequences"]],
    }


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--tf-root", type=Path, required=True)
    parser.add_argument("--scratch-mdl", type=Path, required=True)
    parser.add_argument("--valve-source", type=Path, required=True)
    parser.add_argument("--class", dest="class_name", choices=sorted(MODEL_STEM), required=True)
    parser.add_argument("--item-id", required=True)
    parser.add_argument("--expected-schema-sha256", required=True)
    parser.add_argument("--expected-mdl-sha256", required=True)
    args = parser.parse_args(argv)
    try:
        root = args.tf_root.resolve(strict=True)
        mdl_path = args.scratch_mdl.resolve(strict=True)
        temp_root = Path(tempfile.gettempdir()).resolve(strict=True)
        if not mdl_path.is_relative_to(temp_root):
            raise ProbeError("MDL must be a scratch copy below the OS temporary directory")
        stem = MODEL_STEM[args.class_name]
        if mdl_path.name != f"c_{stem}_animations.mdl":
            raise ProbeError("scratch MDL name does not match the selected class")
        inf = _read(root / "tf" / "steam.inf", 1024, "steam.inf").decode("ascii")
        if "appID=440" not in inf.splitlines():
            raise ProbeError("root is not an app-440 TF2 installation")
        schema_bytes = _read(root / "tf" / "scripts" / "items" / "items_game.txt", SCHEMA_LIMIT, "item schema")
        schema_sha = hashlib.sha256(schema_bytes).hexdigest()
        if schema_sha != args.expected_schema_sha256.lower():
            raise ProbeError("installed item schema differs from the expected SHA-256")
        mdl_bytes = _read(mdl_path, 8 * 1024 * 1024, "scratch MDL")
        model = parse_mdl(mdl_bytes)
        if model.sha256 != args.expected_mdl_sha256.lower():
            raise ProbeError("scratch MDL differs from the expected SHA-256")
        if model.name.replace("\\", "/") != f"weapons/c_models/c_{stem}_animations.mdl":
            raise ProbeError("MDL internal name does not match the selected class")
        source = _read(args.valve_source, SDK_LIMIT, "Valve source")
        table = read_valve_table(source)
        graph = item_graph(
            _obj(parse_keyvalues(schema_bytes.decode("utf-8-sig")), "items_game"),
            args.item_id,
            args.class_name,
            table,
            mdl_activities(mdl_bytes, model),
        )
    except (OSError, UnicodeError, ProbeError, struct.error) as error:
        print(f"stock activity graph: {error}", file=sys.stderr)
        return 2
    print(json.dumps({
        "patch": next((line.partition("=")[2] for line in inf.splitlines() if line.startswith("PatchVersion=")), ""),
        "schema_sha256": schema_sha,
        "mdl_sha256": model.sha256,
        "valve_source_sha256": SDK_SHA256,
        "graph": graph,
    }, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
