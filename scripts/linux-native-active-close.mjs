import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync, realpathSync } from "node:fs";

// X.Org ICCCM 4.2.8.1: a WM_PROTOCOLS ClientMessage carrying WM_DELETE_WINDOW
// is a close request which the client may decline. XDestroyWindow is not used.
// https://www.x.org/releases/X11R7.7/doc/xorg-docs/icccm/icccm.html
export const X11_CLOSE_HELPER = `
import ctypes as C
import ctypes.util
import json
import os
import sys

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
bind('XSync', C.c_int, Display, C.c_int)

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

    queue, seen, windows = [X.XDefaultRootWindow(d)], set(), []
    while queue:
        w = queue.pop(0)
        if w in seen: continue
        seen.add(w)
        assert len(seen) <= 4096, 'Unbounded X window tree'
        if window_pid(w) == pid and delete_atom in protocols(w):
            name = C.c_void_p()
            title = ''
            if X.XFetchName(d, w, C.byref(name)) and name:
                try: title = C.string_at(name).decode('utf-8', 'replace')
                finally: X.XFree(name)
            windows.append({'id': w, 'pid': pid, 'title': title, 'deleteProtocol': True})
        root, parent, count = Window(), Window(), C.c_uint()
        children = C.POINTER(Window)()
        if X.XQueryTree(d, w, C.byref(root), C.byref(parent), C.byref(children), C.byref(count)):
            try:
                assert count.value <= 4096, 'Unbounded X window children'
                queue.extend(children[i] for i in range(count.value))
            finally:
                if children: X.XFree(children)
    result = {'windows': windows, 'mode': mode, 'pid': pid}
    if mode == 'request':
        assert len(windows) == 1 and windows[0]['id'] == expected, 'Expected exactly the previously observed owned X window'
        assert windows[0]['title'] == 'execs', 'Unexpected native window title'
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

export function requestOwnedNativeClose(identity, binary, childEnv) {
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
  assert.equal(observed.windows.length, 1, "Expected a single owned close-capable X11 window");
  assert.equal(observed.windows[0].title, "execs");
  verifyOwnedNativeProcess(verified, binary);
  return { process: verified, ...run(["request", String(observed.windows[0].id)]) };
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
