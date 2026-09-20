"""Native WebKitGTK fixture host; does not expose IPC or touch player state."""
import argparse
import json
import time
from pathlib import Path
from urllib.parse import urlparse

import gi

gi.require_version("Gtk", "3.0")
gi.require_version("WebKit2", "4.1")
from gi.repository import Gdk, GLib, Gtk, WebKit2

parser = argparse.ArgumentParser()
parser.add_argument("--url", default="http://127.0.0.1:8765/?preview=settings-files")
parser.add_argument("--evidence", type=Path, required=True)
parser.add_argument("--width", type=int, default=1200)
parser.add_argument("--height", type=int, default=800)
parser.add_argument("--zoom", type=float, default=1)
args = parser.parse_args()
target = urlparse(args.url)
if target.scheme != "http" or target.hostname != "127.0.0.1" or "preview=settings-files" not in target.query:
    parser.error("Only loopback Files preview fixtures are accepted")
args.evidence.mkdir(parents=True, exist_ok=False)
started = time.monotonic()
window = Gtk.Window(title="execs 0.1.7 isolated Files qualification")
window.set_default_size(args.width, args.height)
context = WebKit2.WebContext.new_ephemeral()
web = WebKit2.WebView.new_with_context(context)
web.set_zoom_level(args.zoom)
window.add(web)
window.connect("destroy", Gtk.main_quit)


def loaded(view, event):
    if event == WebKit2.LoadEvent.FINISHED:
        (args.evidence / "host.json").write_text(json.dumps({
            "url": args.url, "width": args.width, "height": args.height, "zoom": args.zoom,
            "webkit": ".".join(str(part()) for part in [WebKit2.get_major_version, WebKit2.get_minor_version, WebKit2.get_micro_version]),
            "navigationMs": round((time.monotonic() - started) * 1000),
            "scope": "Native engine preview; not packaged Tauri/IPC or screen-reader certification",
        }, indent=2))


def navigation(view, decision, decision_type):
    if decision_type in (WebKit2.PolicyDecisionType.NAVIGATION_ACTION, WebKit2.PolicyDecisionType.NEW_WINDOW_ACTION):
        destination = urlparse(decision.get_request().get_uri())
        if destination.scheme != "http" or destination.hostname != "127.0.0.1":
            decision.ignore()
            return True
    return False


web.connect("decide-policy", navigation)
web.connect("load-changed", loaded)
window.show_all()


def capture():
    native = window.get_window()
    if native:
        picture = Gdk.pixbuf_get_from_window(native, 0, 0, window.get_allocated_width(), window.get_allocated_height())
        if picture:
            picture.savev(str(args.evidence / "native-window.png"), "png", [], [])
    return True


GLib.timeout_add_seconds(2, capture)
web.load_uri(args.url)
Gtk.main()
