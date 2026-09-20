"""Targeted speech follow-up; does not replace keyboard, IME or timing evidence."""
import json
import os
import subprocess
import time
from pathlib import Path

evidence = Path(os.environ["FILES_EVIDENCE"])
(evidence / "speech-only.txt").write_text("Diagnostic flat review and settled save only; no keyboard/IME/performance acceptance in this run.\n")
subprocess.run(["xdotool", "search", "--sync", "--name", "execs 0.1.7 isolated Files qualification", "windowactivate", "--sync"], check=True)
for attempt in range(60):
    runtime_path = evidence / "1200x800" / "runtime.json"
    if runtime_path.exists() and json.loads(runtime_path.read_text()).get("editor"):
        break
    time.sleep(1)
else:
    raise RuntimeError("Speech follow-up editor did not appear")
(evidence / "workflows-request").touch()
for attempt in range(120):
    runtime = json.loads(runtime_path.read_text())
    if runtime.get("speechPhase") == "problem-row" and not (evidence / "speech-reviewed").exists():
        # GNOME Orca desktop flat review, verified against ORCA_42_0 keymap.
        # https://help.gnome.org/orca/commands_flat_review.html
        # Document Say All from the focused problem link (GNOME reading commands).
        for command in ["KP_Add"]:
            subprocess.run(["xdotool", "key", "--clearmodifiers", command], check=True)
            time.sleep(8)
        subprocess.run(["xdotool", "key", "--clearmodifiers", "Control_L"], check=True)
        (evidence / "speech-reviewed").touch()
    result_path = evidence / "1200x800" / "workflows.json"
    if result_path.exists():
        result = json.loads(result_path.read_text())
        if not result.get("passed"):
            raise RuntimeError("Speech follow-up workflows failed; inspect workflows.json")
        break
    time.sleep(1)
else:
    raise RuntimeError("Speech follow-up workflows did not complete")
(evidence / "workflows-request").unlink()
