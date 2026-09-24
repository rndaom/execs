"""Audit legacy Viewmodels names against a verified local TF2 VPK snapshot.

This is a compatibility comparison, not an independent derivation of groups or
a model transformer. It reads installed data and repository source only.

Valve's sequence/animation format:
https://github.com/ValveSoftware/source-sdk-2013/blob/b8cfb12c0e083a2ef5b2f9f9b50f3902fa034474/src/public/studio.h#L3404-L3472
"""

from __future__ import annotations

import argparse
import hashlib
import json
import re
import sys
from pathlib import Path

from d7_scout_viewer_preflight import (
    MAX_VPK_DIR_BYTES,
    find_vpk_entries,
    read_vpk_entry,
)
from d7_stock_mdl_probe import Model, ProbeError, parse_mdl


CLASSES = ("scout", "soldier", "pyro", "demo", "heavy", "engineer", "medic", "sniper", "spy")
MODEL_PREFIX = "models/weapons/c_models/c_"
EXPECTED_GROUPS = 64
EXPECTED_STEMS = 405


def _quoted_field(block: str, name: str) -> str:
    match = re.search(rf"\b{name}:\s*\"([^\"]+)\"", block)
    if match is None:
        raise ProbeError(f"legacy group lacks {name}")
    return match.group(1)


def legacy_groups(source: str) -> list[tuple[str, str, tuple[str, ...]]]:
    """Parse only the explicit file arrays in the current 64-group table."""
    blocks = re.findall(r"ViewmodelGroup\s*\{(.*?)\n\s*\},", source, re.S)
    groups = []
    for block in blocks:
        group = _quoted_field(block, "id")
        class_id = _quoted_field(block, "class_id")
        if class_id == "demoman":
            class_id = "demo"
        if class_id not in CLASSES:
            raise ProbeError(f"unknown class in group {group}")
        match = re.search(r"\bfiles:\s*&\[(.*?)\]", block, re.S)
        if match is None:
            raise ProbeError(f"legacy group {group} lacks a file list")
        stems = tuple(re.findall(r'"([^"]+)"', match.group(1)))
        if not stems:
            raise ProbeError(f"legacy group {group} is empty")
        groups.append((group, class_id, stems))
    if len(groups) != EXPECTED_GROUPS or len({group for group, _, _ in groups}) != len(groups):
        raise ProbeError("legacy group count or identity changed; review the comparison")
    if sum(len(stems) for _, _, stems in groups) != EXPECTED_STEMS:
        raise ProbeError("legacy sequence list changed; review the comparison")
    return groups


def forced_soldier_stems(source: str) -> tuple[str, ...]:
    match = re.search(r"SOLDIER_FORCED_FILES:\s*&\[([\s\S]*?)\];", source)
    if match is None:
        raise ProbeError("Soldier forced-file list is missing")
    stems = tuple(re.findall(r'"([^"]+)"', match.group(1)))
    if len(stems) != 6:
        raise ProbeError("Soldier forced-file list changed; review the comparison")
    return stems


def matched_animation(model: Model, stem: str) -> str:
    """Require one sequence and its sole local animation named @<stem>."""
    sequences = [sequence for sequence in model.sequences if sequence.label == stem]
    animations = [animation for animation in model.animations if animation.name == "@" + stem]
    if len(sequences) != 1 or len(animations) != 1:
        raise ProbeError(f"{model.name}: {stem} has no unique sequence/animation pair")
    indexes = sequences[0].animation_indexes
    if len(indexes) != 1 or model.animations[indexes[0]].name != "@" + stem:
        raise ProbeError(f"{model.name}: {stem} does not link solely to its local animation")
    return animations[0].name


def compare(groups: list[tuple[str, str, tuple[str, ...]]], forced: tuple[str, ...], models: dict[str, Model]) -> dict[str, object]:
    if set(models) != set(CLASSES):
        raise ProbeError("the nine class models are required")
    seen: set[tuple[str, str]] = set()
    for group, class_id, stems in groups:
        model = models[class_id]
        if model.name.replace("\\", "/").casefold() != f"weapons/c_models/c_{class_id}_animations.mdl":
            raise ProbeError(f"wrong model identity for {class_id}")
        for stem in stems:
            key = (class_id, stem.casefold())
            if key in seen:
                raise ProbeError(f"legacy stem {stem} appears in multiple {class_id} groups")
            seen.add(key)
            matched_animation(model, stem)
    for stem in forced:
        matched_animation(models["soldier"], stem)
    return {
        "groups": len(groups),
        "unique_legacy_stems": len(seen),
        "soldier_forced_stems": len(forced),
        "all_stems_have_one_matching_sequence_and_local_animation": True,
        "mdl_sha256": {class_id: models[class_id].sha256 for class_id in CLASSES},
    }


def run(tf2_root: Path, expected_vpk_sha256: str, expected_patch: str) -> dict[str, object]:
    root = tf2_root.resolve(strict=True)
    steam_inf = (root / "tf/steam.inf").read_text(encoding="ascii").splitlines()
    if "appID=440" not in steam_inf or f"PatchVersion={expected_patch}" not in steam_inf:
        raise ProbeError("TF2 identity or patch differs from the expected snapshot")
    vpk = root / "tf/tf2_misc_dir.vpk"
    with vpk.open("rb") as source:
        directory = source.read(MAX_VPK_DIR_BYTES + 1)
    digest = hashlib.sha256(directory).hexdigest()
    if digest != expected_vpk_sha256.lower():
        raise ProbeError("installed VPK directory hash differs from the expected snapshot")
    targets = {f"{MODEL_PREFIX}{class_id}_animations.mdl" for class_id in CLASSES}
    entries = find_vpk_entries(directory, targets)
    models = {
        class_id: parse_mdl(read_vpk_entry(vpk, entries[f"{MODEL_PREFIX}{class_id}_animations.mdl"]))
        for class_id in CLASSES
    }
    table = Path(__file__).resolve().parents[3] / "apps/desktop/src-tauri/core/src/viewmodel_groups.rs"
    source = table.read_text(encoding="utf-8")
    result = compare(legacy_groups(source), forced_soldier_stems(source), models)
    result["tf2_patch"] = expected_patch
    result["vpk_dir_sha256"] = digest
    result["legacy_table_sha256"] = hashlib.sha256(table.read_bytes()).hexdigest()
    return result


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("tf2_root", type=Path, help="confirmed TF2 installation; read only")
    parser.add_argument("--expected-vpk-sha256", required=True)
    parser.add_argument("--expected-patch", required=True)
    args = parser.parse_args(argv)
    try:
        result = run(args.tf2_root, args.expected_vpk_sha256, args.expected_patch)
    except (OSError, UnicodeError, ProbeError, ValueError) as error:
        print(f"legacy stock overlap: {error}", file=sys.stderr)
        return 2
    print(json.dumps(result, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
