import { isTauri, setBindMouseCapture } from "./bridge";

// A new document starts after the previous one's sequence; individual calls
// stay ordered even when IPC completes out of order during rapid cancellation.
let sequence = Date.now() * 1000;
export function setNativeBindMouseCapture(enabled: boolean): Promise<void> {
  return isTauri() ? setBindMouseCapture(enabled, ++sequence) : Promise.resolve();
}

/** Keep the release of a recorded press from navigating after React re-renders. */
export function createBindMouseReleaseGuard(target: Window) {
  const held = new Set<number>();
  const timers = new Set<number>();
  function suppress(event: MouseEvent) {
    if (!held.has(event.button)) return;
    event.preventDefault();
    event.stopImmediatePropagation();
  }
  function release(event: MouseEvent) {
    if (!held.has(event.button)) return;
    suppress(event);
    // auxclick/contextmenu follows mouseup in the same native gesture.
    const timer = target.setTimeout(() => {
      held.delete(event.button);
      timers.delete(timer);
    }, 0);
    timers.add(timer);
  }
  function clear() {
    held.clear();
    for (const timer of timers) target.clearTimeout(timer);
    timers.clear();
  }
  target.addEventListener("mouseup", release, true);
  target.addEventListener("auxclick", suppress, true);
  target.addEventListener("click", suppress, true);
  target.addEventListener("contextmenu", suppress, true);
  target.addEventListener("blur", clear);
  return {
    capture(button: number) {
      held.add(button);
    },
    release,
    dispose() {
      clear();
      target.removeEventListener("mouseup", release, true);
      target.removeEventListener("auxclick", suppress, true);
      target.removeEventListener("click", suppress, true);
      target.removeEventListener("contextmenu", suppress, true);
      target.removeEventListener("blur", clear);
    },
  };
}
