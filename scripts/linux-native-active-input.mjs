import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
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
  await driver.command("POST", `element/${encodeURIComponent(id)}/value`, {
    text,
    value: [...text],
  });
}

export async function readEditorState(driver) {
  return driver.read(`const editor = document.querySelector(${JSON.stringify(EDITOR)});
    if (!editor) return null;
    const scroller = editor.closest('.cm-editor').querySelector('.cm-scroller');
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

/** Copy through real native keys, then read this disposable X server's clipboard. */
export async function copyEditorText(driver, childEnv, expected) {
  await driver.tabTo(EDITOR, "css selector", 80);
  await press(driver, "a", { control: true });
  await driver.read(`const probe = { events: [] };
    probe.listener = (event) => probe.events.push({ trusted: event.isTrusted,
      text: event.clipboardData?.getData('text/plain') ?? null });
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
  assert.ok(
    trace.some((event) => event.trusted && event.text === expected),
    "No trusted copy event carried the complete draft bytes",
  );
  return waitUntil("native editor clipboard bytes match authored draft", () => {
    const text = execFileSync("xclip", ["-selection", "clipboard", "-out"], {
      env: childEnv,
      encoding: "utf8",
      timeout: 3_000,
      maxBuffer: 256 * 1_024,
    });
    assert.equal(text, expected, "Native copied draft bytes differ");
    return text;
  });
}
