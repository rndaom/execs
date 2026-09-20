#!/usr/bin/env bash
# A disposable Actions desktop only. Never run against a signed-in player session.
set -euo pipefail
test "${CI:-}" = true || { echo 'Requires disposable CI environment'; exit 2; }
export FILES_EVIDENCE=/tmp/files-qualification
mkdir -p "$FILES_EVIDENCE"
export NO_AT_BRIDGE=0 GTK_MODULES=gail:atk-bridge GTK_IM_MODULE=ibus
export XMODIFIERS=@im=ibus WEBKIT_DISABLE_COMPOSITING_MODE=1 LIBGL_ALWAYS_SOFTWARE=1
gsettings set org.gnome.desktop.interface toolkit-accessibility true
pulseaudio --start
speech-dispatcher --spawn
openbox >"$FILES_EVIDENCE/openbox.log" 2>&1 &
ibus-daemon --daemonize --xim --replace
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
grep -E 'SPEECH OUTPUT|SPEECH GENERATOR|Traceback|ERROR' "$FILES_EVIDENCE/orca.log" >"$FILES_EVIDENCE/speech-summary.txt" || true
grep -q 'SPEECH OUTPUT:.*Contents of' "$FILES_EVIDENCE/speech-summary.txt"
dpkg-query -W orca gir1.2-webkit2-4.1 ibus ibus-anthy >"$FILES_EVIDENCE/versions.txt"
lscpu >"$FILES_EVIDENCE/cpu.txt"
git rev-parse HEAD >"$FILES_EVIDENCE/commit.txt"
