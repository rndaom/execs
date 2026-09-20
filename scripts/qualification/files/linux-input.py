"""Physical keyboard probe with AT-SPI observations, never synthesized speech."""
import json
import os
import subprocess
import time
from pathlib import Path

import pyatspi

evidence = Path(os.environ["FILES_EVIDENCE"])
observations = []


def walk(obj, depth=0):
    if depth > 40:
        return
    yield obj
    for child in obj:
        yield from walk(child, depth + 1)


def snapshot():
    rows = []
    for application in pyatspi.Registry.getDesktop(0):
        if application.name != "webkit.py":
            continue
        for item in walk(application):
            state = item.getState()
            row = {"name": item.name, "role": item.getRoleName(),
                   "focused": state.contains(pyatspi.STATE_FOCUSED),
                   "editable": state.contains(pyatspi.STATE_EDITABLE)}
            if row["focused"] or row["editable"]:
                try:
                    text = item.queryText()
                    row["text"] = text.getText(0, min(text.characterCount, 20000))
                except NotImplementedError:
                    pass
            rows.append(row)
    return rows


def key(value):
    subprocess.run(["xdotool", "key", "--clearmodifiers", value], check=True)
    time.sleep(.4)


for attempt in range(60):
    rows = snapshot()
    if any(row["editable"] and ("cfg" in row["name"].lower() or "editor" in row["name"].lower()) for row in rows):
        break
    time.sleep(1)
else:
    (evidence / "accessibility-initial.json").write_text(json.dumps(rows, indent=2))
    raise RuntimeError("Files editor did not appear in native accessibility tree")

(evidence / "accessibility-initial.json").write_text(json.dumps(rows, indent=2))
subprocess.run(["xdotool", "search", "--sync", "--name", "execs 0.1.7 isolated Files qualification", "windowactivate", "--sync"], check=True)

editor_reached = False
for step in range(100):
    key("Tab")
    focused = [row for row in snapshot() if row["focused"]]
    observations.append({"step": step, "key": "Tab", "focused": focused})
    if any(row["editable"] and ("cfg" in row["name"].lower() or "editor" in row["name"].lower()) for row in focused):
        editor_reached = True
        break
(evidence / "tab-navigation.json").write_text(json.dumps(observations, indent=2))
if not editor_reached:
    raise RuntimeError("Editor was not keyboard reachable")

# Clear suggestions before testing default Tab exit. Return with Shift+Tab.
key("Escape")
key("Tab")
after_tab = [row for row in snapshot() if row["focused"]]
(evidence / "tab-exit.json").write_text(json.dumps(after_tab, indent=2))
if any(row["editable"] and ("cfg" in row["name"].lower() or "editor" in row["name"].lower()) for row in after_tab):
    raise RuntimeError("Tab remained trapped in editor")
key("shift+Tab")
key("ctrl+End")
key("Return")
subprocess.run(["xdotool", "type", "--clearmodifiers", "--delay", "50", "// IME "], check=True)
try:
    engine = subprocess.run(["ibus", "engine", "anthy"], capture_output=True, text=True)
    (evidence / "ibus-activation.json").write_text(json.dumps({"code": engine.returncode, "stdout": engine.stdout, "stderr": engine.stderr}))
    engine.check_returncode()
    time.sleep(1)
    subprocess.run(["xdotool", "type", "--clearmodifiers", "--delay", "180", "nihongo"], check=True)
    key("space")
    key("Return")
    ime_rows = snapshot()
    (evidence / "ime.json").write_text(json.dumps(ime_rows, indent=2, ensure_ascii=False))
    if not any("日本語" in row.get("text", "") for row in ime_rows):
        raise RuntimeError("Real ibus-anthy Japanese composition did not commit the expected text")
    ime_result = {"passed": True, "method": "Physical X11 roman-key input through ibus-anthy"}
except (subprocess.CalledProcessError, RuntimeError) as error:
    ime_result = {"passed": False, "error": str(error)}
(evidence / "ime-result.json").write_text(json.dumps(ime_result, indent=2))
subprocess.run(["ibus", "engine", "xkb:us::eng"], check=False)
time.sleep(2)
(evidence / "benchmark-request").touch()
for attempt in range(80):
    result_path = evidence / "1200x800" / "worker-benchmark.json"
    if result_path.exists():
        result = json.loads(result_path.read_text())
        if not result.get("results") or not all(row["expectationMet"] for row in result["results"]):
            raise RuntimeError("Worker boundary benchmark failed")
        break
    time.sleep(1)
else:
    raise RuntimeError("Worker benchmark did not complete")
(evidence / "benchmark-request").unlink()
