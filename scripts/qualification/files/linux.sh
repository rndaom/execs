#!/usr/bin/env bash
# A disposable Actions desktop only. Never run against a signed-in player session.
set -euo pipefail
test "${CI:-}" = true || { echo 'Requires disposable CI environment'; exit 2; }
export FILES_EVIDENCE=/tmp/files-qualification
mkdir -p "$FILES_EVIDENCE"
dpkg-query -W orca gir1.2-webkit2-4.1 ibus ibus-anthy >"$FILES_EVIDENCE/versions.txt"
lscpu >"$FILES_EVIDENCE/cpu.txt"
git rev-parse HEAD >"$FILES_EVIDENCE/commit.txt"
export NO_AT_BRIDGE=0 GTK_MODULES=gail:atk-bridge GTK_IM_MODULE=ibus
export XMODIFIERS=@im=ibus WEBKIT_DISABLE_COMPOSITING_MODE=1 LIBGL_ALWAYS_SOFTWARE=1
gsettings set org.gnome.desktop.interface toolkit-accessibility true
pulseaudio --start
speech-dispatcher --spawn
openbox >"$FILES_EVIDENCE/openbox.log" 2>&1 &
gsettings set org.freedesktop.ibus.general preload-engines "['xkb:us::eng', 'anthy']"
gsettings set org.freedesktop.ibus.general engines-order "['xkb:us::eng', 'anthy']"
gsettings set org.freedesktop.ibus.general use-global-engine true
gsettings set org.freedesktop.ibus.general use-system-keyboard-layout true
gsettings set org.freedesktop.ibus.general.hotkey triggers "[]"
gsettings set org.freedesktop.ibus.engine.anthy.common input-mode 0
gsettings set org.freedesktop.ibus.engine.anthy.common typing-method 0
gsettings get org.freedesktop.ibus.engine.anthy.common input-mode >"$FILES_EVIDENCE/anthy-input-mode.txt"
ibus-daemon --daemonize --xim --replace --cache=refresh >"$FILES_EVIDENCE/ibus.log" 2>&1
for attempt in $(seq 1 30); do
  ibus list-engine >"$FILES_EVIDENCE/ibus-engines.txt" 2>>"$FILES_EVIDENCE/ibus.log" && break
  sleep 1
done
ibus list-engine >"$FILES_EVIDENCE/ibus-engines.txt"
pnpm --filter @execs/desktop exec vite build --config ../../scripts/qualification/files/vite.config.mts --outDir "$FILES_EVIDENCE/bundle" >"$FILES_EVIDENCE/build.log" 2>&1
node scripts/qualification/files/serve.mjs "$FILES_EVIDENCE/bundle" >"$FILES_EVIDENCE/server.log" 2>&1 &
orca --replace --enable=speech --disable=braille --debug --debug-file="$FILES_EVIDENCE/orca.log" >"$FILES_EVIDENCE/orca-console.log" 2>&1 &
for attempt in $(seq 1 60); do
  curl --silent --fail 'http://127.0.0.1:8765/?preview=settings-files' >/dev/null && break
  sleep 1
done
python3 scripts/qualification/files/webkit.py --evidence "$FILES_EVIDENCE/1200x800" >"$FILES_EVIDENCE/webkit.log" 2>&1 &
host_pid=$!
trap 'kill "$host_pid" 2>/dev/null || true' EXIT
python3 scripts/qualification/files/linux-input.py
kill "$host_pid"
wait "$host_pid" || true
trap - EXIT
python3 scripts/qualification/files/webkit.py --width 960 --height 640 --capture-seconds 12 --evidence "$FILES_EVIDENCE/960x640"
python3 scripts/qualification/files/webkit.py --width 1280 --height 800 --capture-seconds 12 --evidence "$FILES_EVIDENCE/1280x800"
python3 scripts/qualification/files/webkit.py --zoom 2 --capture-seconds 12 --evidence "$FILES_EVIDENCE/1200x800-200pct"
grep -E 'SPEECH OUTPUT|SPEECH GENERATOR|Traceback|ERROR' "$FILES_EVIDENCE/orca.log" >"$FILES_EVIDENCE/speech-summary.txt" || true
grep -q 'SPEECH OUTPUT:.*Contents of' "$FILES_EVIDENCE/speech-summary.txt"
python3 -c 'import json,os; from pathlib import Path; result=json.loads((Path(os.environ["FILES_EVIDENCE"])/"ime-result.json").read_text()); assert result["passed"], result'
