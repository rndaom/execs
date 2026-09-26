"""Bounded read-only inspection of a tiny qualification export; never extracts."""
import hashlib
import io
import json
import os
import stat
import sys
import zipfile

assert stat.S_ISREG(os.lstat(sys.argv[1]).st_mode)
with open(sys.argv[1], "rb") as source:
    raw = source.read(2 * 1024 * 1024 + 1)
assert len(raw) <= 2 * 1024 * 1024, "archive size limit"


def unique(pairs):
    value = {}
    for key, item in pairs:
        assert key not in value, "duplicate JSON key"
        value[key] = item
    return value


members, seen, total, manifest = [], set(), 0, None
with zipfile.ZipFile(io.BytesIO(raw)) as archive:
    assert 0 < len(archive.infolist()) <= 16, "entry count limit"
    for entry in archive.infolist():
        name = entry.filename
        assert 0 < len(name) <= 1024, "member name limit"
        assert not any(char in name for char in ("\\", ":", "\x00")), "unsafe member"
        parts = name.split("/")
        assert len(parts) <= 32 and all(part not in ("", ".", "..") for part in parts), "unsafe member"
        assert name.casefold() not in seen, "duplicate member"
        seen.add(name.casefold())
        assert not entry.is_dir() and not entry.flag_bits & 1, "directory or encrypted member"
        assert stat.S_IFMT(entry.external_attr >> 16) in (0, stat.S_IFREG), "special member"
        assert entry.compress_type in (zipfile.ZIP_STORED, zipfile.ZIP_DEFLATED), "compression"
        assert entry.file_size <= 1024 * 1024, "member size limit"
        with archive.open(entry) as stream:
            payload = stream.read(1024 * 1024 + 1)
        assert len(payload) == entry.file_size, "member length mismatch"
        total += len(payload)
        assert total <= 2 * 1024 * 1024, "expanded size limit"
        members.append({"name": name, "bytes": len(payload), "sha256": hashlib.sha256(payload).hexdigest()})
        if name == "execs-profile.json":
            manifest = json.loads(payload.decode("utf-8"), object_pairs_hook=unique)
assert manifest is not None, "missing export manifest"
print(json.dumps({"sha256": hashlib.sha256(raw).hexdigest(), "bytes": len(raw), "members": members, "manifest": manifest}))
