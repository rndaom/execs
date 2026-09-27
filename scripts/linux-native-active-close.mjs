import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync, realpathSync } from "node:fs";

export const X11_MAIN_WINDOW_SELECTOR = `
def eligible_main_windows(windows, pid):
    # IsViewable=2 includes mapped ancestors; InputOutput=1 excludes input-only helpers.
    return [w for w in windows if w['pid'] == pid and w['title'] == 'execs'
            and w['deleteProtocol'] and w['mapState'] == 2 and w['windowClass'] == 1
            and not w['overrideRedirect'] and w['parent'] == w['root']
            and w['parent'] > 0 and w['transientFor'] is None
            and w['geometry']['width'] > 0 and w['geometry']['height'] > 0]
`;

// X.Org ICCCM 4.2.8.1: a WM_PROTOCOLS ClientMessage carrying WM_DELETE_WINDOW
// is a close request which the client may decline. XDestroyWindow is not used.
// https://www.x.org/releases/X11R7.7/doc/xorg-docs/icccm/icccm.html
export const X11_CLOSE_HELPER = `
import ctypes as C
import ctypes.util
import json
import os
import sys

${X11_MAIN_WINDOW_SELECTOR}

pid, mode = int(sys.argv[1]), sys.argv[2]
assert pid > 1 and mode in ('inspect', 'request')
expected = int(sys.argv[3]) if len(sys.argv) > 3 else None
X = C.CDLL(ctypes.util.find_library('X11') or 'libX11.so.6')
Atom = Window = C.c_ulong
Display = C.c_void_p

def bind(name, restype, *argtypes):
    fn = getattr(X, name)
    fn.restype, fn.argtypes = restype, argtypes
    return fn

bind('XOpenDisplay', Display, C.c_char_p)
bind('XCloseDisplay', C.c_int, Display)
bind('XDefaultRootWindow', Window, Display)
bind('XInternAtom', Atom, Display, C.c_char_p, C.c_int)
bind('XFree', C.c_int, C.c_void_p)
bind('XQueryTree', C.c_int, Display, Window, C.POINTER(Window), C.POINTER(Window), C.POINTER(C.POINTER(Window)), C.POINTER(C.c_uint))
bind('XGetWindowProperty', C.c_int, Display, Window, Atom, C.c_long, C.c_long, C.c_int, Atom, C.POINTER(Atom), C.POINTER(C.c_int), C.POINTER(C.c_ulong), C.POINTER(C.c_ulong), C.POINTER(C.POINTER(C.c_ubyte)))
bind('XGetWMProtocols', C.c_int, Display, Window, C.POINTER(C.POINTER(Atom)), C.POINTER(C.c_int))
bind('XFetchName', C.c_int, Display, Window, C.POINTER(C.c_void_p))
bind('XGetTransientForHint', C.c_int, Display, Window, C.POINTER(Window))
bind('XSync', C.c_int, Display, C.c_int)

class WindowAttributes(C.Structure):
    _fields_ = [('x', C.c_int), ('y', C.c_int), ('width', C.c_int), ('height', C.c_int),
                ('border_width', C.c_int), ('depth', C.c_int), ('visual', C.c_void_p),
                ('root', Window), ('window_class', C.c_int), ('bit_gravity', C.c_int),
                ('win_gravity', C.c_int), ('backing_store', C.c_int),
                ('backing_planes', C.c_ulong), ('backing_pixel', C.c_ulong),
                ('save_under', C.c_int), ('colormap', C.c_ulong), ('map_installed', C.c_int),
                ('map_state', C.c_int), ('all_event_masks', C.c_long),
                ('your_event_mask', C.c_long), ('do_not_propagate_mask', C.c_long),
                ('override_redirect', C.c_int), ('screen', C.c_void_p)]

class ClassHint(C.Structure):
    _fields_ = [('res_name', C.c_void_p), ('res_class', C.c_void_p)]

bind('XGetWindowAttributes', C.c_int, Display, Window, C.POINTER(WindowAttributes))
bind('XGetClassHint', C.c_int, Display, Window, C.POINTER(ClassHint))

class Data(C.Union):
    _fields_ = [('b', C.c_char * 20), ('s', C.c_short * 10), ('l', C.c_long * 5)]

class ClientMessage(C.Structure):
    _fields_ = [('type', C.c_int), ('serial', C.c_ulong), ('send_event', C.c_int),
                ('display', Display), ('window', Window), ('message_type', Atom),
                ('format', C.c_int), ('data', Data)]

class Event(C.Union):
    _fields_ = [('xclient', ClientMessage), ('pad', C.c_long * 24)]

bind('XSendEvent', C.c_int, Display, Window, C.c_int, C.c_long, C.POINTER(Event))
d = X.XOpenDisplay(os.environ.get('DISPLAY', '').encode())
assert d, 'Could not open the isolated X display'
try:
    pid_atom = X.XInternAtom(d, b'_NET_WM_PID', False)
    cardinal = X.XInternAtom(d, b'CARDINAL', False)
    protocols_atom = X.XInternAtom(d, b'WM_PROTOCOLS', False)
    delete_atom = X.XInternAtom(d, b'WM_DELETE_WINDOW', False)

    def window_pid(w):
        kind, fmt, count, remaining = Atom(), C.c_int(), C.c_ulong(), C.c_ulong()
        data = C.POINTER(C.c_ubyte)()
        result = X.XGetWindowProperty(d, w, pid_atom, 0, 1, False, cardinal,
                                      C.byref(kind), C.byref(fmt), C.byref(count), C.byref(remaining), C.byref(data))
        try:
            if result == 0 and kind.value == cardinal and fmt.value == 32 and count.value == 1:
                return C.cast(data, C.POINTER(C.c_ulong))[0]
            return None
        finally:
            if data: X.XFree(data)

    def protocols(w):
        values, count = C.POINTER(Atom)(), C.c_int()
        if not X.XGetWMProtocols(d, w, C.byref(values), C.byref(count)): return []
        try:
            assert 0 <= count.value <= 64, 'Unbounded WM_PROTOCOLS list'
            return [values[i] for i in range(count.value)]
        finally:
            if values: X.XFree(values)

    def class_hint(w):
        hint = ClassHint()
        if not X.XGetClassHint(d, w, C.byref(hint)): return None
        try:
            return {key: C.string_at(value).decode('utf-8', 'replace')[:256] if value else None
                    for key, value in [('name', hint.res_name), ('class', hint.res_class)]}
        finally:
            if hint.res_name: X.XFree(hint.res_name)
            if hint.res_class: X.XFree(hint.res_class)

    queue, seen, windows = [X.XDefaultRootWindow(d)], set(), []
    while queue:
        w = queue.pop(0)
        if w in seen: continue
        seen.add(w)
        assert len(seen) <= 4096, 'Unbounded X window tree'
        root, parent, count = Window(), Window(), C.c_uint()
        children = C.POINTER(Window)()
        assert X.XQueryTree(d, w, C.byref(root), C.byref(parent), C.byref(children), C.byref(count)), 'Incomplete X window tree observation'
        try:
            assert count.value <= 4096, 'Unbounded X window children'
            queue.extend(children[i] for i in range(count.value))
        finally:
            if children: X.XFree(children)
        owned_pid = window_pid(w)
        supported = protocols(w) if owned_pid == pid else []
        if owned_pid == pid and delete_atom in supported:
            attributes = WindowAttributes()
            assert X.XGetWindowAttributes(d, w, C.byref(attributes)), 'Owned window attributes unavailable'
            name = C.c_void_p()
            title = ''
            if X.XFetchName(d, w, C.byref(name)) and name:
                try: title = C.string_at(name).decode('utf-8', 'replace')[:256]
                finally: X.XFree(name)
            transient = Window()
            transient_for = transient.value if X.XGetTransientForHint(d, w, C.byref(transient)) else None
            windows.append({'id': w, 'pid': owned_pid, 'title': title,
                            'deleteProtocol': True, 'protocolAtoms': supported,
                            'mapState': attributes.map_state, 'windowClass': attributes.window_class,
                            'overrideRedirect': bool(attributes.override_redirect),
                            'parent': parent.value, 'root': attributes.root,
                            'transientFor': transient_for, 'classHint': class_hint(w),
                            'geometry': {'x': attributes.x, 'y': attributes.y,
                                         'width': attributes.width, 'height': attributes.height,
                                         'borderWidth': attributes.border_width, 'depth': attributes.depth}})
            assert len(windows) <= 128, 'Unbounded owned window candidates'
    result = {'windows': windows, 'treeWindowIds': sorted(seen), 'mode': mode, 'pid': pid}
    if mode == 'request':
        candidates = eligible_main_windows(windows, pid)
        if len(candidates) != 1 or candidates[0]['id'] != expected:
            result['refused'] = 'Expected exactly the previously observed viewable owned main window'
        else:
            event = Event()
            event.xclient.type = 33
            event.xclient.send_event = True
            event.xclient.display = d
            event.xclient.window = expected
            event.xclient.message_type = protocols_atom
            event.xclient.format = 32
            event.xclient.data.l[0] = delete_atom
            event.xclient.data.l[1] = 0
            assert X.XSendEvent(d, expected, False, 0, C.byref(event)) != 0, 'XSendEvent failed'
            X.XSync(d, False)
            result['selectedId'] = expected
            result['requested'] = 'WM_PROTOCOLS/WM_DELETE_WINDOW'
    print(json.dumps(result))
finally:
    X.XCloseDisplay(d)
`;

export function parseOwnedProcessRows(output, processGroup) {
  assert.ok(Number.isInteger(processGroup) && processGroup > 1);
  const matches = output.split(/\r?\n/).flatMap((line) => {
    const match = /^\s*(\d+)\s+(\d+)\s+(\S+)\s*$/.exec(line);
    return match && Number(match[2]) === processGroup && match[3] === "execs"
      ? [{ pid: Number(match[1]), processGroup: Number(match[2]) }]
      : [];
  });
  assert.equal(matches.length, 1, "Expected exactly one execs process in the owned driver group");
  assert.ok(matches[0].pid > 1);
  return matches[0];
}

export function verifyOwnedNativeProcess(identity, binary) {
  assert.equal(
    realpathSync(`/proc/${identity.pid}/exe`),
    binary,
    "Owned native executable changed",
  );
  const stat = readFileSync(`/proc/${identity.pid}/stat`, "utf8");
  const tail = stat
    .slice(stat.lastIndexOf(") ") + 2)
    .trim()
    .split(/\s+/);
  assert.equal(Number(tail[2]), identity.processGroup, "Native process left the owned group");
  assert.notEqual(tail[0], "Z", "Native process has already exited");
  const startTime = tail[19];
  assert.match(startTime, /^\d+$/);
  if (identity.startTime) assert.equal(startTime, identity.startTime, "Native PID was reused");
  return { ...identity, startTime, executable: binary };
}

export function findOwnedNativeProcess(processGroup, binary) {
  return verifyOwnedNativeProcess(
    parseOwnedProcessRows(
      execFileSync("ps", ["-eo", "pid=,pgid=,comm="], { encoding: "utf8" }),
      processGroup,
    ),
    binary,
  );
}

export function x11MainWindowRejectionReasons(window, pid) {
  const reasons = [];
  if (window.pid !== pid) reasons.push("Different process");
  if (window.title !== "execs") reasons.push("Not the main window title");
  if (window.deleteProtocol !== true) reasons.push("No WM_DELETE_WINDOW protocol");
  if (window.mapState !== 2) reasons.push("Not viewable with mapped ancestors");
  if (window.windowClass !== 1) reasons.push("Not an InputOutput window");
  if (window.overrideRedirect !== false) reasons.push("Overrides window-manager control");
  if (!Number.isSafeInteger(window.root) || window.root <= 0 || window.parent !== window.root)
    reasons.push("Not a direct root child in the isolated Xvfb display");
  if (window.transientFor !== null) reasons.push("Transient or unknown window relationship");
  if (
    !Number.isSafeInteger(window.geometry?.width) ||
    !Number.isSafeInteger(window.geometry?.height) ||
    window.geometry.width <= 0 ||
    window.geometry.height <= 0
  )
    reasons.push("No positive native window geometry");
  return reasons;
}

/** The owned Xvfb has no window manager, so a main window must be a root child. */
export function selectOwnedMainWindow(observed, identity, onObservation = () => {}) {
  assert.equal(observed.pid, identity.pid, "X11 inspection returned a different process");
  assert.ok(Array.isArray(observed.windows) && observed.windows.length <= 128);
  const windows = observed.windows.map((window) => ({
    ...window,
    rejectionReasons: x11MainWindowRejectionReasons(window, identity.pid),
  }));
  onObservation({ process: identity, ...observed, windows });
  assert.ok(windows.every((window) => Number.isSafeInteger(window.id) && window.id > 0));
  assert.equal(new Set(windows.map((window) => window.id)).size, windows.length);
  const candidates = windows.filter((window) => window.rejectionReasons.length === 0);
  assert.equal(candidates.length, 1, "Expected a single viewable owned main X11 window");
  return candidates[0];
}

export function requestOwnedNativeClose(identity, binary, childEnv, onObservation = () => {}) {
  const verified = verifyOwnedNativeProcess(identity, binary);
  const run = (args) =>
    JSON.parse(
      execFileSync("python3", ["-c", X11_CLOSE_HELPER, String(identity.pid), ...args], {
        env: childEnv,
        encoding: "utf8",
        timeout: 5_000,
        maxBuffer: 128 * 1_024,
      }),
    );
  const observed = run(["inspect"]);
  const selected = selectOwnedMainWindow(observed, verified, onObservation);
  verifyOwnedNativeProcess(verified, binary);
  const requested = run(["request", String(selected.id)]);
  const confirmed = selectOwnedMainWindow(requested, verified, onObservation);
  assert.equal(confirmed.id, selected.id, "Native main window changed before its close request");
  assert.equal(requested.refused, undefined, requested.refused);
  assert.equal(requested.selectedId, selected.id);
  assert.equal(requested.requested, "WM_PROTOCOLS/WM_DELETE_WINDOW");
  return { process: verified, ...requested };
}

export function ownedNativeProcessExited(identity) {
  try {
    const stat = readFileSync(`/proc/${identity.pid}/stat`, "utf8");
    const tail = stat
      .slice(stat.lastIndexOf(") ") + 2)
      .trim()
      .split(/\s+/);
    assert.equal(tail[19], identity.startTime, "Native PID was reused before exit verification");
    return tail[0] === "Z";
  } catch (error) {
    if (error.code === "ENOENT") return true;
    throw error;
  }
}
