import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import {
  ownedNativeProcessExited,
  requestOwnedNativeClose,
  verifyOwnedNativeProcess,
} from "./linux-native-active-close.mjs";
import {
  assertLinuxNativeActiveCheckpoint,
  assertLinuxNativeActiveFixture,
  CLOSE_SAVE_APPEND,
  DISCARD_APPEND,
  EXPLICIT_APPEND,
  expectedActiveText,
  seedLinuxNativeActiveFixture,
  sha256,
} from "./linux-native-active-fixture.mjs";
import {
  copyEditorText,
  EDITOR,
  KEYS,
  nativeErrorDiagnostic,
  press,
  readEditorState,
  tabToEditorWithTrace,
  typeEditorText,
  waitForEditorRetention,
} from "./linux-native-active-input.mjs";
import { activeRuntimePreflight, LinuxActiveSession } from "./linux-native-active-runtime.mjs";
import { linuxNativeEnvironment } from "./linux-native-fixture.mjs";
import { waitUntil } from "./linux-native-webdriver.mjs";

const EXIT_DIALOG = '[data-testid="files-exit-guard"]';

export async function main() {
  const runtime = activeRuntimePreflight();
  const fixture = seedLinuxNativeActiveFixture(process.env.RUNNER_TEMP);
  const childEnv = linuxNativeEnvironment(fixture, process.env);
  const evidence = join(fixture.scratch, "evidence");
  mkdirSync(evidence);
  let checkpoint = assertLinuxNativeActiveFixture(fixture, "original", "before-launch");
  const report = {
    schema: 1,
    status: "running",
    scope:
      "Linux X11/WebKitGTK real release binary; active owned Vanilla profile, Files draft retention, explicit helper Save and actual native close Cancel/Discard/Save. No installer, updater, Steam or game qualification.",
    revision: runtime.revision,
    binarySha256: runtime.binarySha256,
    fixture: fixture.provenance,
    isolation: fixture.childEnv,
    checks: [],
    captures: [],
    preservation: [checkpoint],
  };
  const saveReport = () =>
    writeFileSync(join(evidence, "results.json"), `${JSON.stringify(report, null, 2)}\n`);
  writeFileSync(join(evidence, "fixture-baseline.json"), `${JSON.stringify(fixture, null, 2)}\n`);
  saveReport();
  const session = new LinuxActiveSession({
    ...runtime,
    fixture,
    childEnv,
    evidence,
    report,
    saveReport,
  });
  let smokeError;

  function preserve(stage) {
    const result = assertLinuxNativeActiveCheckpoint(fixture, checkpoint, stage);
    report.preservation.push(result);
    saveReport();
    return result;
  }

  async function openHelper() {
    await session.driver.click('[data-testid="settings-tab-files"]');
    await waitUntil("native Files list loaded", () =>
      session.driver.read(
        'return document.querySelectorAll("[data-testid=files-item]").length >= 2;',
      ),
    );
    await session.driver.click(
      `//button[@data-testid='files-item' and contains(@aria-label, '. ${fixture.helperPath}')]`,
      "xpath",
    );
    await waitUntil(
      "native helper editable after close guard and cfg reads",
      async () => {
        const state = await readEditorState(session.driver);
        return state?.editable && state.path === `Contents of ${fixture.helperPath}` && state;
      },
      30_000,
    );
    await session.driver.tabTo(EDITOR, "css selector", 80);
  }

  async function copyExpected(text, label) {
    let copied;
    try {
      copied = await copyEditorText(session.driver, childEnv, text);
    } catch (error) {
      report.checks.push({
        label,
        result: "failed",
        copyDiagnostics: error.copyDiagnostics ?? null,
      });
      saveReport();
      throw error;
    }
    report.checks.push({
      label,
      nativeClipboardSha256: sha256(copied),
      bytes: Buffer.byteLength(copied),
      matchesAuthoredText: true,
    });
    saveReport();
  }

  async function append(text) {
    await session.driver.tabTo(EDITOR, "css selector", 80);
    await press(session.driver, KEYS.end, { control: true });
    await typeEditorText(session.driver, text);
    await waitUntil(
      "edited native helper is analyzed and explicitly saveable",
      async () => (await readEditorState(session.driver))?.saveEnabled,
      30_000,
    );
  }

  async function closeRequest(label, expectDialog = true) {
    const trace = requestOwnedNativeClose(
      session.nativeProcess,
      runtime.binary,
      childEnv,
      (observation) => {
        report.checks.push({ label: `${label}-x11-${observation.mode}`, observation });
        saveReport();
      },
    );
    report.checks.push({ label, closeRequest: trace });
    saveReport();
    if (!expectDialog) return;
    const dialog = await waitUntil("actual native close opens Files draft decision", () =>
      session.driver.read(`const dialog = document.querySelector(${JSON.stringify(EXIT_DIALOG)});
      return dialog && { text: dialog.textContent, focus: document.activeElement?.textContent,
        buttons: Array.from(dialog.querySelectorAll('button')).map((button) => ({ text: button.textContent, disabled: button.disabled })) };`),
    );
    assert.ok(
      dialog.text.includes("Save Files drafts?") && dialog.text.includes(fixture.helperPath),
    );
    assert.equal(dialog.focus, "Cancel", "Native close must initially focus the safe action");
    for (const label of ["Save and continue", "Discard and continue", "Cancel"]) {
      assert.ok(
        dialog.buttons.some((button) => button.text === label && !button.disabled),
        `${label} must be available`,
      );
    }
    report.checks.push({ label: `${label}-dialog`, dialog });
    preserve(`${label}-before-decision`);
  }

  async function chooseCloseAction(label) {
    let responseError;
    try {
      await session.driver.click(
        `//*[@data-testid='files-exit-guard']//button[normalize-space(.)='${label}']`,
        "xpath",
      );
    } catch (error) {
      // Some native drivers lose their response context when the accepted UI
      // action closes the window. It is valid only with verified process exit.
      assert.match(String(error), /no such window|invalid session id/i);
      responseError = String(error);
    }
    await waitUntil(
      "native process exits after its explicit close decision",
      () => ownedNativeProcessExited(session.nativeProcess),
      15_000,
    );
    report.checks.push({
      label: `native-close-${label}`,
      process: session.nativeProcess,
      processExitedBeforeCleanup: true,
      nativeExitCode: null,
      nativeExitStatus: "not observed; tauri-driver owns the child",
      ...(responseError ? { responseError } : {}),
    });
    saveReport();
  }

  try {
    await session.launch("first-active-launch");
    await openHelper();
    await copyExpected(fixture.initialText, "initial-native-helper");
    preserve("active-boot-and-files-read");
    await session.capture("01-native-active-files");

    await append(EXPLICIT_APPEND);
    const savedText = expectedActiveText(fixture, "explicit-saved");
    await copyExpected(savedText, "native-unsaved-draft-bytes");
    preserve("draft-is-memory-only");
    await press(session.driver, KEYS.home, { control: true });
    await press(session.driver, KEYS.down, { repeat: fixture.selectionLine - 1 });
    await press(session.driver, KEYS.end);
    await press(session.driver, KEYS.left, { shift: true, repeat: fixture.selectionText.length });
    const before = await waitUntil("real selection and both editor scroll axes", async () => {
      const state = await readEditorState(session.driver);
      return (
        state?.selection === fixture.selectionText && state.top > 100 && state.left > 20 && state
      );
    });
    const retention = {
      label: "native-pane-navigation-retains-selection-and-scroll",
      result: "running",
      before,
    };
    report.checks.push(retention);
    saveReport();
    try {
      await session.capture("02-native-draft-before-navigation");
      retention.beforeNavigation = await readEditorState(session.driver);
      await session.driver.click('[data-testid="settings-tab-binds"]');
      await waitUntil("Files editor releases its active surface", () =>
        session.driver.read(
          'return document.querySelector("[data-testid=settings-tab-binds]")?.getAttribute("aria-current") === "page" && !document.querySelector(".cm-content");',
        ),
      );
      preserve("away-pane-does-not-save-files");
      await session.driver.click('[data-testid="settings-tab-files"]');
      retention.firstRender = await waitUntil("Files editor restored", () =>
        readEditorState(session.driver),
      );
      await session.driver.nextPaint();
      retention.afterPaintBeforeFocus = await readEditorState(session.driver);
      await tabToEditorWithTrace(session.driver, retention);
      retention.after = await waitForEditorRetention(session.driver, before, retention);
      retention.result = "passed";
    } catch (error) {
      retention.result = "failed";
      retention.error = nativeErrorDiagnostic(error);
      throw error;
    } finally {
      saveReport();
    }
    await session.capture("03-native-draft-after-navigation");
    await copyExpected(savedText, "native-draft-bytes-after-navigation");
    preserve("retained-draft-is-still-memory-only");

    await session.driver.click('[data-testid="files-save"]');
    checkpoint = await waitUntil(
      "explicit native Save commits exact helper and hashes",
      () => assertLinuxNativeActiveFixture(fixture, "explicit-saved", "explicit-files-save"),
      30_000,
    );
    report.preservation.push(checkpoint);
    await waitUntil(
      "native Save acknowledgment clears dirty state",
      async () => (await readEditorState(session.driver))?.saveEnabled === false,
    );
    await session.capture("04-native-explicit-save");

    await append(DISCARD_APPEND);
    const discardText = savedText + DISCARD_APPEND;
    await copyExpected(discardText, "native-close-candidate-draft");
    preserve("close-candidate-is-memory-only");
    await closeRequest("close-cancel");
    await session.capture("05-native-close-cancel-dialog");
    await session.driver.click(
      "//*[@data-testid='files-exit-guard']//button[normalize-space(.)='Cancel']",
      "xpath",
    );
    await waitUntil("Cancel keeps native window open", () =>
      session.driver.read(`return !document.querySelector(${JSON.stringify(EXIT_DIALOG)});`),
    );
    verifyOwnedNativeProcess(session.nativeProcess, runtime.binary);
    await copyExpected(discardText, "native-close-cancel-retains-draft");
    preserve("native-close-cancel-preserves-checkpoint");

    await closeRequest("close-discard");
    await session.capture("06-native-close-discard-dialog");
    await chooseCloseAction("Discard and continue");
    preserve("native-discard-closed-without-saving");
    await session.stop();
    preserve("after-discard-process-cleanup");

    await session.launch("restart-after-discard");
    await openHelper();
    await copyExpected(savedText, "native-discard-restart-loads-last-save");
    preserve("native-discard-restart-preserves-checkpoint");
    await session.capture("07-native-after-discard-restart");

    await append(CLOSE_SAVE_APPEND);
    const closeSavedText = expectedActiveText(fixture, "close-saved");
    await copyExpected(closeSavedText, "native-close-save-candidate");
    await closeRequest("close-save");
    await session.capture("08-native-close-save-dialog");
    await chooseCloseAction("Save and continue");
    checkpoint = assertLinuxNativeActiveFixture(
      fixture,
      "close-saved",
      "native-close-save-committed",
    );
    report.preservation.push(checkpoint);
    await session.stop();
    preserve("after-close-save-process-cleanup");

    await session.launch("restart-after-close-save");
    await openHelper();
    await copyExpected(closeSavedText, "native-close-save-restart-loads-committed-bytes");
    preserve("native-close-save-restart-preserves-checkpoint");
    await session.capture("09-native-after-close-save-restart");
    await closeRequest("clean-native-close", false);
    await waitUntil("clean native window exits without a draft decision", () =>
      ownedNativeProcessExited(session.nativeProcess),
    );
    report.checks.push({
      label: "clean-native-close",
      processExitedBeforeCleanup: true,
      nativeExitCode: null,
      nativeExitStatus: "not observed; tauri-driver owns the child",
    });
    await session.stop();
    preserve("final-clean-native-exit");
    report.status = "passed";
  } catch (error) {
    smokeError = error;
    report.status = "failed";
    report.error = error.stack ?? String(error);
    report.errorDiagnostic = nativeErrorDiagnostic(error);
    if (session.driver?.sessionId) {
      try {
        await session.capture("failure");
      } catch (captureError) {
        report.captureError = String(captureError);
      }
    }
  } finally {
    try {
      await session.stop();
      preserve("final-owned-process-cleanup");
    } catch (error) {
      report.status = "failed";
      report.cleanupError = error.stack ?? String(error);
      smokeError = smokeError
        ? new AggregateError(
            [smokeError, error],
            "Active native test and cleanup/preservation failed",
          )
        : error;
    } finally {
      saveReport();
      console.log(`Linux active native smoke ${report.status}; evidence: ${evidence}`);
    }
  }
  if (smokeError) throw smokeError;
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  await main();
}
