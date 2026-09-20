/**
 * Public-DOM authoring scenarios for disposable production-preview native hosts.
 * No component, editor-model, draft-store or IPC access. Programmatic DOM clicks
 * and execCommand editing are NOT evidence of physical keyboard or IME behavior.
 */
export async function runFilesWorkflows(speechReview = false) {
  const started = performance.now();
  const steps: { name: string; elapsedMs: number; detail?: unknown }[] = [];
  const wait = async (predicate: () => boolean, description: string) => {
    const deadline = performance.now() + 15000;
    while (!predicate()) {
      if (performance.now() > deadline) throw Error(`Workflow timed out: ${description}`);
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
  };
  const pane = () => {
    const element = document.querySelector<HTMLElement>('[data-testid="settings-files"]');
    if (!element) throw Error("Files pane is not rendered");
    return element;
  };
  const button = (name: string | RegExp, root: ParentNode = pane()) => {
    const found = [...root.querySelectorAll<HTMLButtonElement>("button")].find((element) => {
      const label = element.textContent?.trim() ?? "";
      return typeof name === "string" ? label === name : name.test(label);
    });
    if (!found) throw Error(`Missing workflow button: ${name}`);
    if (found.disabled) throw Error(`Disabled workflow button: ${name}`);
    return found;
  };
  const focusThenClick = async (target: HTMLElement) => {
    target.focus();
    // Observe real accessibility events; never inject or synthesize speech.
    await new Promise((resolve) => setTimeout(resolve, 400));
    target.click();
    await new Promise((resolve) => setTimeout(resolve, 100));
  };
  const click = async (name: string | RegExp, root?: ParentNode) => {
    await focusThenClick(button(name, root));
  };
  const content = () => {
    const element = pane().querySelector<HTMLElement>(".cm-content");
    if (!element) throw Error("Missing editor content");
    return element;
  };
  const text = () =>
    [...content().querySelectorAll(".cm-line")].map((line) => line.textContent ?? "").join("\n");
  const record = async (name: string, detail?: unknown) => {
    steps.push({ name, elapsedMs: performance.now() - started, detail });
    // Let native accessibility events reach the separately observed speech log.
    await new Promise((resolve) => setTimeout(resolve, 500));
  };
  const input = async (selector: string, value: string) => {
    const element = pane().querySelector<HTMLInputElement>(selector);
    if (!element) throw Error(`Missing workflow input: ${selector}`);
    element.focus();
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set?.call(element, value);
    element.dispatchEvent(new Event("input", { bubbles: true }));
    element.dispatchEvent(new Event("change", { bubbles: true }));
    await new Promise((resolve) => setTimeout(resolve, 100));
    if (element.value !== value) throw Error(`Input did not retain ${selector}`);
  };
  const replace = async (value: string) => {
    const element = content();
    element.focus();
    const selection = window.getSelection();
    if (!selection) throw Error("Native selection is unavailable");
    const range = document.createRange();
    range.selectNodeContents(element);
    selection.removeAllRanges();
    selection.addRange(range);
    if (!document.execCommand("insertText", false, value)) throw Error("Native DOM editing failed");
    await wait(() => text() === value, "exact inserted cfg text");
  };
  const create = async (name: string) => {
    await click("New cfg");
    await input("#new-cfg-name", name);
    const panel = pane().querySelector('[aria-label="New cfg"]');
    const path = panel?.textContent?.match(
      /tf\/cfg\/(?:overrides\/)?qualification\/[a-z_]+\.cfg/,
    )?.[0];
    if (!path) throw Error("New cfg did not disclose a verified cfg-layer path");
    await click("Open unsaved draft");
    await wait(
      () =>
        pane()
          .querySelector("h3")
          ?.textContent?.includes(name.split("/").pop() ?? name) === true,
      "new draft name",
    );
    if (!pane().querySelector("h3")?.textContent?.includes("Unsaved"))
      throw Error("Creation did not remain an unsaved draft");
    return path;
  };
  const open = async (path: string) => {
    await click("Open file");
    const item = [...pane().querySelectorAll<HTMLButtonElement>('[data-testid="files-item"]')].find(
      (element) => element.dataset.path === path,
    );
    if (!item) throw Error(`Missing listed draft: ${path}`);
    await focusThenClick(item);
  };
  const save = async () => {
    await wait(() => {
      const control = pane().querySelector<HTMLButtonElement>('[data-testid="files-save"]');
      return !!control && !control.disabled;
    }, "current draft save eligibility");
    await click("Save file");
    await wait(
      () => !pane().querySelector("h3")?.textContent?.includes("Unsaved"),
      "acknowledged fixture save",
    );
    // Keep focus still while the native reader consumes the polite status.
    if (speechReview) await new Promise((resolve) => setTimeout(resolve, 5000));
  };

  try {
    const pathA = await create("qualification/native_a");
    await record("Created unsaved helper in disclosed cfg layer", { path: pathA });
    await replace("fov_desired banana");
    await click(/^Problems \(/);
    await wait(
      () =>
        [...pane().querySelectorAll('[data-testid="files-finding"]')].some((row) =>
          row.textContent?.includes("expects a number"),
        ),
      "numeric finding",
    );
    const row = [...pane().querySelectorAll('[data-testid="files-finding"]')].find((item) =>
      item.textContent?.includes("expects a number"),
    );
    const jump = row?.querySelector<HTMLButtonElement>("button");
    if (!jump || !row?.textContent?.includes("warn"))
      throw Error("Numeric finding lacks non-color severity/location");
    if (speechReview) {
      jump.scrollIntoView({ block: "center" });
      jump.focus();
      document.body.dataset.qualificationSpeech = "problem-row";
      await wait(
        () => document.body.dataset.qualificationSpeech === "reviewed",
        "physical Orca problem-row review",
      );
    }
    await focusThenClick(jump);
    await wait(
      () => window.getSelection()?.toString() === "banana",
      "precise diagnostic selection",
    );
    await record("Numeric warning has text severity and selects exact argument");
    await click("Reference");
    await wait(() => {
      const reference =
        pane().querySelector('[aria-label="Offline cfg reference"]')?.textContent ?? "";
      return (
        reference.includes("fov_desired") &&
        reference.includes("Source snapshot") &&
        reference.includes("maximum 90")
      );
    }, "bundled command provenance and numeric bound");
    await record("Bundled reference displays command, provenance and sourced bounds");
    await click("Focus");
    const first = "fov_desired 90\n// 日本語; literal\\path";
    await replace(first);
    const pathB = await create("qualification/native_b");
    const second = `alias qualification_notice "echo quoted; echo literal\\path"\nexec ${pathA.replace(/^tf\/cfg\//, "").replace(/\.cfg$/, "")}`;
    await replace(second);
    await open(pathA);
    if (text() !== first) throw Error("Switching documents lost the first draft");
    await open(pathB);
    if (text() !== second) throw Error("Switching documents lost the second draft");
    await record(
      "Two unsaved documents preserve Unicode, literal backslashes and quoted separators",
      {
        pathA,
        pathB,
      },
    );
    const disclosure = [...pane().querySelectorAll("summary")].find(
      (element) => element.textContent === "File ownership and execution",
    );
    disclosure?.click();
    await wait(
      () =>
        [...pane().querySelectorAll("button")].some((element) =>
          element.textContent?.includes(pathA),
        ),
      "resolved helper link",
    );
    await click(new RegExp(pathA.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
    await wait(() => text() === first, "helper link navigation");
    await record("Resolved exec link navigates to retained helper draft");
    await save();
    await open(pathB);
    await save();
    await open(pathA);
    if (text() !== first)
      throw Error("Saved source no longer matches submitted Unicode/literal bytes");
    await open(pathB);
    if (text() !== second) throw Error("Saved alias/exec source no longer matches submitted bytes");
    await record("Both fixture saves acknowledged and reopen exact submitted source");
    await click("Find / replace");
    await wait(() => !!pane().querySelector(".cm-search"), "find/replace panel");
    await record("Find/replace opens through accessible button");
    await click("Go to line");
    await wait(() => !!pane().querySelector(".cm-goto-line"), "go-to-line panel");
    await record("Go-to-line opens through accessible button");
    await click("Open file");
    const provided = [
      ...pane().querySelectorAll<HTMLButtonElement>('[data-testid="files-item"]'),
    ].find((element) => ["hud", "pack", "comfigImport"].includes(element.dataset.origin ?? ""));
    if (!provided) throw Error("No provided source in representative fixture");
    const providedPath = provided.dataset.path;
    await focusThenClick(provided);
    await wait(
      () =>
        content().getAttribute("contenteditable") === "false" ||
        content().getAttribute("aria-readonly") === "true",
      "provided source read-only editor",
    );
    if (pane().querySelector('[data-testid="files-save"]'))
      throw Error("Provided source exposes a Save action");
    const providedContent = content();
    providedContent.focus();
    await record("Provided source is read-only with no Save action", {
      path: providedPath,
      focusReachedContent: document.activeElement === providedContent,
      accessibleName: providedContent.getAttribute("aria-label"),
      ariaReadonly: providedContent.getAttribute("aria-readonly"),
      contentEditable: providedContent.getAttribute("contenteditable"),
    });
    return {
      passed: true,
      steps,
      durationMs: performance.now() - started,
      scope:
        "Public DOM interactions in a disposable native-engine fixture; not physical keyboard, real filesystem, Cloud or source-conflict proof",
      remaining: [
        "vanilla versus comfig autoexec creation needs separate fresh fixture",
        "external source conflict and native transition proof require integration/native tests",
        "screen-reader speech must be checked independently",
      ],
    };
  } catch (error) {
    return {
      passed: false,
      steps,
      durationMs: performance.now() - started,
      error: error instanceof Error ? error.message : String(error),
      body: document.body.innerText,
    };
  }
}
