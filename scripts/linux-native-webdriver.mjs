import assert from "node:assert/strict";
import { setTimeout as delay } from "node:timers/promises";

export const ELEMENT_KEY = "element-6066-11e4-a52e-4f735466cecf";

export async function waitUntil(label, check, timeout = 15_000) {
  const deadline = Date.now() + timeout;
  let lastError;
  do {
    try {
      const value = await check();
      if (value) return value;
    } catch (error) {
      lastError = error;
    }
    await delay(Math.min(150, Math.max(0, deadline - Date.now())));
  } while (Date.now() < deadline);
  throw new Error(`Timed out: ${label}`, { cause: lastError });
}

/** Small W3C client for the external Tauri driver; no IPC mocking or browser fallback. */
export class NativeWebDriver {
  constructor(port) {
    assert.ok(Number.isInteger(port) && port > 0 && port < 65536);
    this.origin = `http://127.0.0.1:${port}`;
    this.sessionId = null;
  }

  async request(method, path, body, timeout = 15_000) {
    assert.match(path, /^\/(status|session)(\/|$)/);
    const response = await fetch(`${this.origin}${path}`, {
      method,
      headers: { "content-type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(timeout),
      redirect: "error",
    });
    const payload = await response.json();
    if (!response.ok || payload.value?.error) {
      throw new Error(
        `${method} ${path}: ${payload.value?.error ?? response.status}: ${payload.value?.message ?? "driver failure"}`,
      );
    }
    return payload.value;
  }

  async start(application) {
    const value = await this.request(
      "POST",
      "/session",
      {
        capabilities: { alwaysMatch: { "tauri:options": { application, args: [] } } },
      },
      45_000,
    );
    assert.ok(typeof value.sessionId === "string" && value.sessionId.length > 0);
    this.sessionId = value.sessionId;
    this.capabilities = value.capabilities;
    await this.command("POST", "timeouts", { implicit: 0, script: 10_000, pageLoad: 30_000 });
  }

  command(method, path, body) {
    assert.ok(this.sessionId, "Native session has not started");
    return this.request(method, `/session/${encodeURIComponent(this.sessionId)}/${path}`, body);
  }

  read(script, args = []) {
    return this.command("POST", "execute/sync", { script, args });
  }

  async element(value, using = "css selector") {
    const element = await this.command("POST", "element", { using, value });
    assert.ok(element?.[ELEMENT_KEY], `Missing native element: ${value}`);
    return element[ELEMENT_KEY];
  }

  async click(value, using) {
    const id = await this.element(value, using);
    return this.command("POST", `element/${encodeURIComponent(id)}/click`, {});
  }

  async observeClick(value, using) {
    const id = await this.element(value, using);
    await this.read(
      `const target = arguments[0];
      const box = target.getBoundingClientRect().toJSON();
      const probe = {
        expected: { box, width: innerWidth, height: innerHeight,
          hit: target.contains(document.elementFromPoint((box.left + box.right) / 2, (box.top + box.bottom) / 2)) },
        events: [], target
      };
      probe.listener = (event) => probe.events.push({type: event.type, trusted: event.isTrusted,
        x: event.clientX, y: event.clientY, onTarget: target.contains(event.target),
        target: event.target.tagName + ':' + event.target.textContent.trim().slice(0, 80)});
      window.__execsNativeClickProbe = probe;
      document.addEventListener('pointerdown', probe.listener, true);
      document.addEventListener('click', probe.listener, true);`,
      [{ [ELEMENT_KEY]: id }],
    );
    let trace;
    try {
      await this.command("POST", `element/${encodeURIComponent(id)}/click`, {});
    } finally {
      trace = await this.read(`const probe = window.__execsNativeClickProbe;
        document.removeEventListener('pointerdown', probe.listener, true);
        document.removeEventListener('click', probe.listener, true);
        delete window.__execsNativeClickProbe;
        return { expected: probe.expected, events: probe.events,
          afterBox: probe.target.getBoundingClientRect().toJSON() };`);
    }
    return trace;
  }

  async tabTo(value, using = "css selector", maximum = 40) {
    const id = await this.element(value, using);
    for (let tabs = 0; tabs <= maximum; tabs++) {
      if (
        await this.read("return document.activeElement === arguments[0];", [{ [ELEMENT_KEY]: id }])
      )
        return tabs;
      if (tabs < maximum) await this.key("\uE004");
    }
    throw new Error(`Native keyboard did not reach ${value} in ${maximum} tabs`);
  }

  nextPaint() {
    return this.command("POST", "execute/async", {
      script:
        "const done = arguments[arguments.length - 1]; requestAnimationFrame(() => requestAnimationFrame(() => done(true)));",
      args: [],
    });
  }

  async key(key, control = false) {
    const actions = [
      ...(control ? [{ type: "keyDown", value: "\uE009" }] : []),
      { type: "keyDown", value: key },
      { type: "keyUp", value: key },
      ...(control ? [{ type: "keyUp", value: "\uE009" }] : []),
    ];
    await this.command("POST", "actions", {
      actions: [{ type: "key", id: "native-keyboard", actions }],
    });
  }

  async close() {
    if (!this.sessionId) return;
    const id = this.sessionId;
    this.sessionId = null;
    await this.request("DELETE", `/session/${encodeURIComponent(id)}`);
  }
}

/** Classify actual native input; never excuse an on-target application failure. */
export function classifyClickTrace(trace) {
  const { box, width, height, hit } = trace.expected;
  assert.ok(hit && box.width > 0 && box.height > 0, "Intended control is not hit-testable");
  assert.ok(
    box.left >= 0 && box.top >= 0 && box.right <= width + 1 && box.bottom <= height + 1,
    "Intended control is outside the viewport",
  );
  for (const key of ["left", "right", "top", "bottom"]) {
    assert.ok(
      Math.abs(box[key] - trace.afterBox[key]) <= 1,
      "Control moved during native click; coordinate result is ambiguous",
    );
  }
  const click = trace.events.findLast((event) => event.type === "click");
  assert.ok(click?.trusted, "No trusted native click was observed");
  const inBox =
    click.x >= box.left && click.x <= box.right && click.y >= box.top && click.y <= box.bottom;
  if (click.onTarget) {
    assert.ok(inBox, "Native target and event coordinates disagree");
    return "on-target";
  }
  assert.ok(!inBox, "Native click hit another element inside the intended control");
  return "driver-coordinate-mismatch";
}

export function assertMenuGeometry(state, focused = false) {
  assert.ok(state.open && state.profiles === 6, "Native fixture profile menu is not open");
  const box = focused ? state.focused : state.panel;
  assert.ok(box && box.width > 0 && box.height > 0, "Menu target has no rendered area");
  assert.ok(
    box.left >= 0 && box.top >= 0 && box.right <= state.width + 1 && box.bottom <= state.height + 1,
    "Menu target clips the native viewport",
  );
  if (focused) {
    assert.equal(state.focusText, "Change install");
    assert.ok(state.focusHit, "A clipping ancestor or overlay obscures the final action");
  } else {
    assert.ok(state.lastActionHit, "A clipping ancestor or overlay obscures the final action");
  }
}
