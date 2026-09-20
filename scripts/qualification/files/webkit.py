"""Native WebKitGTK fixture host; does not expose IPC or touch player state."""
import argparse
import json
import os
import time
from pathlib import Path
from urllib.parse import urlparse

import gi

gi.require_version("Gtk", "3.0")
gi.require_version("Gdk", "3.0")
gi.require_version("WebKit2", "4.1")
from gi.repository import Gdk, GLib, Gtk, WebKit2

parser = argparse.ArgumentParser()
parser.add_argument("--url", default="http://127.0.0.1:8765/?preview=settings-files")
parser.add_argument("--evidence", type=Path, required=True)
parser.add_argument("--width", type=int, default=1200)
parser.add_argument("--height", type=int, default=800)
parser.add_argument("--zoom", type=float, default=1)
parser.add_argument("--capture-seconds", type=int, default=0)
args = parser.parse_args()
target = urlparse(args.url)
if target.scheme != "http" or target.hostname != "127.0.0.1" or "preview=settings-files" not in target.query:
    parser.error("Only loopback Files preview fixtures are accepted")
args.evidence.mkdir(parents=True, exist_ok=False)
started = time.monotonic()
benchmark_started = False
workflows_started = False
maximum_rss = 0
window = Gtk.Window(title="execs 0.1.7 isolated Files qualification")
window.set_default_size(args.width, args.height)
context = WebKit2.WebContext.new_ephemeral()
web = WebKit2.WebView.new_with_context(context)
web.set_zoom_level(args.zoom)
if args.zoom == 2:
    Gtk.Settings.get_default().set_property("gtk-enable-animations", False)
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
    global benchmark_started, workflows_started
    native = window.get_window()
    if native:
        picture = Gdk.pixbuf_get_from_window(native, 0, 0, window.get_allocated_width(), window.get_allocated_height())
        if picture:
            picture.savev(str(args.evidence / "native-window.png"), "png", [], [])
    web.run_javascript("""(()=>{
      if (!window.__qualificationPaint) {
        window.__qualificationPaint=[];
        document.addEventListener('keydown',()=>{const start=performance.now();requestAnimationFrame(()=>requestAnimationFrame(()=>window.__qualificationPaint.push(performance.now()-start)));},true);
      }
      const values=[...window.__qualificationPaint].sort((a,b)=>a-b);
      return {viewport:{width:innerWidth,height:innerHeight,dpr:devicePixelRatio},
        timing:window.__qualificationTiming,
        reducedMotion:matchMedia('(prefers-reduced-motion: reduce)').matches,
        buttonTransitions:[...document.querySelectorAll('button')].map(button=>({name:button.textContent,transitionDuration:getComputedStyle(button).transitionDuration})),
        measurement:'physical keydown to second requestAnimationFrame',samples:values.length,
        p95ms:values[Math.max(0,Math.ceil(values.length*.95)-1)],values,
        workers:performance.getEntriesByType('resource').filter(x=>x.name.includes('worker')).map(x=>x.name),
        editor:document.querySelector('.cm-content')?.getAttribute('aria-label'),body:document.body.innerText};
    })()""", None, captured_runtime, None)
    if (args.evidence.parent / "benchmark-request").exists() and not benchmark_started:
        benchmark_started = True
        web.run_javascript("window.__runQualificationBenchmark().then(value=>window.__qualificationBenchmark=value).catch(error=>window.__qualificationBenchmark={error:String(error)})", None, None, None)
    if benchmark_started:
        web.run_javascript("window.__qualificationBenchmark ?? null", None, captured_benchmark, None)
    if (args.evidence.parent / "workflows-request").exists() and not workflows_started:
        workflows_started = True
        web.run_javascript("window.__runQualificationWorkflows().then(value=>window.__qualificationWorkflows=value).catch(error=>window.__qualificationWorkflows={passed:false,error:String(error)})", None, None, None)
    if workflows_started:
        web.run_javascript("window.__qualificationWorkflows ?? null", None, captured_workflows, None)
    return True


def captured_runtime(view, result, unused):
    try:
        value = view.run_javascript_finish(result).get_js_value()
        (args.evidence / "runtime.json").write_text(value.to_json(0))
    except GLib.Error as error:
        (args.evidence / "runtime-error.txt").write_text(str(error))


def captured_benchmark(view, result, unused):
    value = view.run_javascript_finish(result).get_js_value()
    serialized = value.to_json(0)
    if serialized != "null":
        (args.evidence / "worker-benchmark.json").write_text(serialized)
        (args.evidence / "memory.json").write_text(json.dumps({"maximumRssBytes": maximum_rss,
            "measurement": "100ms sampled host process-tree RSS during session; not absolute lifetime peak"}))


def captured_workflows(view, result, unused):
    serialized = view.run_javascript_finish(result).get_js_value().to_json(0)
    if serialized != "null":
        (args.evidence / "workflows.json").write_text(serialized)


def memory_sample():
    global maximum_rss
    pending = [os.getpid()]
    rss = 0
    while pending:
        pid = pending.pop()
        try:
            rss += int(Path(f"/proc/{pid}/statm").read_text().split()[1]) * os.sysconf("SC_PAGE_SIZE")
            pending.extend(int(child) for child in Path(f"/proc/{pid}/task/{pid}/children").read_text().split())
        except (OSError, IndexError, ValueError):
            pass
    maximum_rss = max(maximum_rss, rss)
    return True


GLib.timeout_add_seconds(2, capture)
GLib.timeout_add(100, memory_sample)
if args.capture_seconds:
    GLib.timeout_add_seconds(args.capture_seconds, Gtk.main_quit)
web.load_uri(args.url)
Gtk.main()
