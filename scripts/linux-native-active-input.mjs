import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { ELEMENT_KEY, waitUntil } from "./linux-native-webdriver.mjs";

export const EDITOR = '[data-testid="settings-files"] .cm-content';
export const KEYS = {
  backspace: "\uE003",
  tab: "\uE004",
  enter: "\uE007",
  escape: "\uE00C",
  end: "\uE010",
  home: "\uE011",
  left: "\uE012",
  up: "\uE013",
  right: "\uE014",
  down: "\uE015",
};

/** Send standard W3C key actions; never mutate the editor through script. */
export async function press(driver, key, { control = false, shift = false, repeat = 1 } = {}) {
  assert.ok(Number.isInteger(repeat) && repeat >= 1 && repeat <= 200);
  assert.equal([...key].length, 1);
  const modifiers = [...(control ? ["\uE009"] : []), ...(shift ? ["\uE008"] : [])];
  await driver.command("POST", "actions", {
    actions: [
      {
        type: "key",
        id: "native-keyboard",
        actions: [
          ...modifiers.map((value) => ({ type: "keyDown", value })),
          ...Array.from({ length: repeat }, () => [
            { type: "keyDown", value: key },
            { type: "keyUp", value: key },
          ]).flat(),
          ...modifiers.reverse().map((value) => ({ type: "keyUp", value })),
        ],
      },
    ],
  });
}

export async function typeEditorText(driver, text) {
  assert.ok(typeof text === "string" && text.length > 0 && text.length <= 1_024);
  assert.match(text, /^[\x20-\x7E\n]+$/u, "Only bounded authored ASCII fixture text is entered");
  const id = await driver.element(EDITOR);
  assert.ok(
    await driver.read("return document.activeElement === arguments[0];", [{ [ELEMENT_KEY]: id }]),
    "The native editor must be focused before typing",
  );
  const lines = text.split("\n");
  for (const [index, line] of lines.entries()) {
    if (line) {
      await driver.command("POST", `element/${encodeURIComponent(id)}/value`, {
        text: line,
        value: [...line],
      });
    }
    // The first run's visible caret suggested that text input omitted its LF.
    // Use the actual Enter editing key; keep the exact expected bytes unchanged.
    if (index < lines.length - 1) await press(driver, KEYS.enter);
  }
}

export async function readEditorState(driver) {
  return driver.read(`const editor = document.querySelector(${JSON.stringify(EDITOR)});
    if (!editor) return null;
    const scroller = editor.closest('.cm-editor').querySelector('.cm-scroller');
    const pane = document.querySelector('[data-testid="settings-scroll"]');
    const active = document.activeElement;
    const activeBox = active?.getBoundingClientRect();
    const selection = getSelection();
    const inside = selection && editor.contains(selection.anchorNode) && editor.contains(selection.focusNode);
    return {
      path: editor.getAttribute('aria-label'),
      selectedFile: document.querySelector('[data-testid="files-item"][aria-current="true"]')?.getAttribute('aria-label'),
      focused: document.activeElement === editor,
      editable: editor.getAttribute('contenteditable') === 'true',
      position: document.querySelector('#files-editor-keyboard-help .tabular-nums')?.textContent,
      selection: inside ? selection.toString() : null,
      top: scroller.scrollTop, left: scroller.scrollLeft,
      scrollHeight: scroller.scrollHeight, clientHeight: scroller.clientHeight,
      scrollWidth: scroller.scrollWidth, clientWidth: scroller.clientWidth,
      saveEnabled: document.querySelector('[data-testid="files-save"]')?.disabled === false,
      status: document.querySelector('#files-editor-keyboard-help')?.textContent,
      activeElement: active && {
        tag: active.tagName, id: active.id, testId: active.getAttribute('data-testid'),
        label: active.getAttribute('aria-label') ?? active.textContent?.trim().slice(0, 160),
        box: { x: activeBox.x, y: activeBox.y, width: activeBox.width, height: activeBox.height }
      },
      paneScroll: pane && { top: pane.scrollTop, left: pane.scrollLeft },
      windowScroll: { top: scrollY, left: scrollX },
      width: innerWidth, height: innerHeight
    };`);
}

export function assertEditorRetained(before, after) {
  assert.ok(
    before?.focused && after?.focused,
    "Editor focus must be established with native input",
  );
  assert.ok(before.editable && after.editable);
  assert.ok(before.selection?.length > 0, "Retention probe requires a real non-empty selection");
  assert.ok(before.top > 100 && before.left > 20, "Retention probe must scroll both axes");
  for (const key of ["path", "selectedFile", "position", "selection"]) {
    assert.equal(after[key], before[key], `Editor ${key} was not retained`);
  }
  for (const key of ["top", "left"]) {
    assert.ok(Math.abs(after[key] - before[key]) <= 2, `Editor ${key} scroll was not retained`);
  }
}

/** Keep the actual error chain; Error.stack alone omits waitUntil's last assertion. */
export function nativeErrorDiagnostic(error, depth = 0) {
  const result = {
    name: String(error?.name ?? "Error").slice(0, 160),
    message: String(error?.message ?? error).slice(0, 2_048),
    stack: String(error?.stack ?? error).slice(0, 8_192),
  };
  if (error?.cause !== undefined) {
    if (depth < 3) result.cause = nativeErrorDiagnostic(error.cause, depth + 1);
    else result.causeTruncated = true;
  }
  return result;
}

/** Observe every real Tab destination, including any browser-induced scroll. */
export async function tabToEditorWithTrace(driver, diagnostic, maximum = 80) {
  assert.ok(Number.isInteger(maximum) && maximum >= 0 && maximum <= 80);
  diagnostic.tabTraversal = [];
  for (let tabs = 0; tabs <= maximum; tabs++) {
    const state = await readEditorState(driver);
    diagnostic.tabTraversal.push({ tabs, state });
    if (state?.focused) return tabs;
    if (tabs < maximum) await press(driver, KEYS.tab);
  }
  throw new Error(`Native keyboard did not reach the editor in ${maximum} tabs`);
}

/** Retain a bounded tail even when the unchanged retention assertion never passes. */
export async function waitForEditorRetention(driver, before, diagnostic, timeout = 15_000) {
  diagnostic.polls = [];
  diagnostic.pollCount = 0;
  diagnostic.lastAssertion = null;
  try {
    return await waitUntil(
      "draft selection and scroll restored",
      async () => {
        const state = await readEditorState(driver);
        diagnostic.pollCount++;
        diagnostic.polls.push(state);
        if (diagnostic.polls.length > 20) diagnostic.polls.shift();
        try {
          assertEditorRetained(before, state);
        } catch (error) {
          diagnostic.lastAssertion = nativeErrorDiagnostic(error);
          throw error;
        }
        return state;
      },
      timeout,
    );
  } catch (error) {
    diagnostic.error = nativeErrorDiagnostic(error);
    throw error;
  }
}

const COPY_TEXT_LIMIT = 16 * 1_024;

export function copyTextDiagnostic(actual, expected) {
  if (typeof actual !== "string") return { available: false };
  let firstDifference = 0;
  while (
    firstDifference < Math.min(actual.length, expected.length) &&
    actual[firstDifference] === expected[firstDifference]
  )
    firstDifference++;
  return {
    available: true,
    characters: actual.length,
    bytes: Buffer.byteLength(actual),
    sha256: createHash("sha256").update(actual).digest("hex"),
    matchesExpected: actual === expected,
    firstDifference:
      actual === expected
        ? null
        : {
            index: firstDifference,
            actualCodePoint: actual.codePointAt(firstDifference) ?? null,
            expectedCodePoint: expected.codePointAt(firstDifference) ?? null,
          },
    text: actual.slice(0, COPY_TEXT_LIMIT),
    truncated: actual.length > COPY_TEXT_LIMIT,
  };
}

function nativeClipboard(childEnv) {
  return execFileSync("xclip", ["-selection", "clipboard", "-out"], {
    env: childEnv,
    encoding: "utf8",
    timeout: 3_000,
    maxBuffer: 256 * 1_024,
  });
}

/** Copy through real native keys, then read this disposable X server's clipboard. */
export async function copyEditorText(
  driver,
  childEnv,
  expected,
  { readClipboard = nativeClipboard } = {},
) {
  assert.ok(expected.length <= COPY_TEXT_LIMIT, "Authored copy probe must remain bounded");
  await driver.tabTo(EDITOR, "css selector", 80);
  await press(driver, "a", { control: true });
  await driver.read(`const probe = { events: [] };
    probe.listener = (event) => {
      const text = event.clipboardData?.getData('text/plain') ?? null;
      probe.events.push({ trusted: event.isTrusted,
        text: text?.slice(0, ${COPY_TEXT_LIMIT}) ?? null,
        truncated: text !== null && text.length > ${COPY_TEXT_LIMIT} });
    };
    window.__execsActiveCopyProbe = probe;
    document.addEventListener('copy', probe.listener);`);
  let trace;
  try {
    await press(driver, "c", { control: true });
  } finally {
    trace = await driver.read(`const probe = window.__execsActiveCopyProbe;
      document.removeEventListener('copy', probe.listener);
      delete window.__execsActiveCopyProbe;
      return probe.events;`);
  }
  try {
    assert.ok(
      trace.some((event) => event.trusted && !event.truncated && event.text === expected),
      "No trusted copy event carried the complete draft bytes",
    );
    return await waitUntil("native editor clipboard bytes match authored draft", () => {
      const text = readClipboard(childEnv);
      assert.equal(text, expected, "Native copied draft bytes differ");
      return text;
    });
  } catch (error) {
    let clipboard;
    let editor;
    try {
      clipboard = copyTextDiagnostic(readClipboard(childEnv), expected);
    } catch (readError) {
      clipboard = { error: String(readError) };
    }
    try {
      editor = await readEditorState(driver);
      if (editor?.selection) editor.selection = editor.selection.slice(0, COPY_TEXT_LIMIT);
    } catch (readError) {
      editor = { error: String(readError) };
    }
    error.copyDiagnostics = {
      expected: copyTextDiagnostic(expected, expected),
      events: trace.slice(0, 8).map((event) => ({
        trusted: event.trusted,
        sourceTruncated: event.truncated ?? false,
        text: copyTextDiagnostic(event.text, expected),
      })),
      clipboard,
      editor,
    };
    throw error;
  }
}
