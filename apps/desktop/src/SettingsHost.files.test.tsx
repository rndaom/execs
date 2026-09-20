// @vitest-environment jsdom
import { EditorView } from "@codemirror/view";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { ToastProvider } from "./components/ui/Toast";
import { AppStatusProvider } from "./hooks/useAppStatus";
import { analyzeFilesSnapshot } from "./lib/files-analysis";
import { createFilesDraftStore, type DirtyFileDraft } from "./lib/files-drafts";
import { saveFileDrafts } from "./lib/files-exit";
import { createPreviewApi } from "./lib/preview-bridge";
import { SettingsHost } from "./SettingsHost";

vi.mock("./lib/files-analysis", async (load) => {
  const actual = await load<typeof import("./lib/files-analysis")>();
  return {
    ...actual,
    analyzeFilesSnapshot: vi.fn(async (snapshot, signal) => {
      await Promise.resolve();
      if (signal?.aborted) throw Error("Analysis cancelled.");
      return actual.runFilesAnalysis(snapshot);
    }),
  };
});

let root: Root;
let box: HTMLDivElement;
let api: ReturnType<typeof createPreviewApi>;
let store: ReturnType<typeof createFilesDraftStore>;
let profile: string;
const saver: { current: ((draft: DirtyFileDraft) => Promise<boolean>) | null } = { current: null };
const noop = () => {};

async function click(label: string) {
  await act(async () => {
    const button = [...document.querySelectorAll("button")].find(
      (element) => element.textContent?.trim() === label,
    );
    if (!button) throw Error(`Missing button ${label}`);
    button.click();
  });
}
function editor() {
  const element = box.querySelector<HTMLElement>(".cm-editor");
  if (!element) throw Error("Missing editor");
  return EditorView.findFromDOM(element) as EditorView;
}
async function edit(text: string) {
  await act(async () =>
    editor().dispatch({ changes: { from: 0, to: editor().state.doc.length, insert: text } }),
  );
}
async function save(draft = store.dirty()[0]) {
  let result = false;
  await act(async () => {
    result = (await saver.current?.(draft)) ?? false;
  });
  return result;
}
beforeEach(async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  Range.prototype.getClientRects = () => [] as unknown as DOMRectList;
  Range.prototype.getBoundingClientRect = () => new DOMRect();
  window.matchMedia = vi
    .fn()
    .mockReturnValue({ matches: false, addEventListener: noop, removeEventListener: noop });
  box = document.createElement("div");
  document.body.append(box);
  root = createRoot(box);
  api = createPreviewApi("settings-files");
  store = createFilesDraftStore();
  profile = (await api.getActiveProfileDetail())?.id ?? "";
  await renderHost();
  await act(async () => {
    await vi.dynamicImportSettled();
  });
});
async function renderHost(refreshKey = 1, running = false) {
  await act(async () =>
    root.render(
      <ToastProvider>
        <AppStatusProvider value={{ error: null, setError: noop, running, busy: false }}>
          <SettingsHost
            api={api}
            filesDraftStore={store}
            filesSaver={saver}
            tab="files"
            running={running}
            externalBusy={false}
            refreshKey={refreshKey}
            bindSyncRequest={null}
            onBindSyncHandled={noop}
            onBusyChange={noop}
            onError={noop}
          />
        </AppStatusProvider>
      </ToastProvider>,
    ),
  );
}
afterEach(async () => {
  await act(async () => root.unmount());
  box.remove();
  vi.restoreAllMocks();
  vi.clearAllMocks();
  vi.unstubAllGlobals();
});

async function saveShortcut() {
  await act(async () => {
    editor().contentDOM.dispatchEvent(
      new KeyboardEvent("keydown", {
        key: "s",
        code: "KeyS",
        ctrlKey: true,
        bubbles: true,
        cancelable: true,
      }),
    );
  });
}

it("Ctrl+S immediately validates and saves the current edit before the debounce settles", async () => {
  const write = vi.spyOn(api, "writeOwnedFile");
  await edit("echo immediate shortcut\n");
  expect(box.querySelector('[data-testid="files-lint-badge"]')?.textContent).toContain("Checking");
  await saveShortcut();
  expect(write).toHaveBeenCalledWith(
    expect.any(String),
    "echo immediate shortcut\n",
    expect.any(Object),
  );
  expect(store.dirty()).toEqual([]);
});

it("Ctrl+S cannot save a newly blocked command behind stale clean diagnostics", async () => {
  const write = vi.spyOn(api, "writeOwnedFile");
  await edit("unbind escape\n");
  await saveShortcut();
  expect(write).not.toHaveBeenCalled();
  expect(editor().state.doc.toString()).toBe("unbind escape\n");
  expect(store.dirty()).toHaveLength(1);
});

it.each(["exec config_default\n", "exec missing_personal_helper\n"])(
  "permits unresolved personal exec warnings when saving %j",
  async (text) => {
    await edit(text);
    const write = vi.spyOn(api, "writeOwnedFile");
    expect(await save()).toBe(true);
    expect(write).toHaveBeenCalledWith(expect.any(String), text, expect.any(Object));
  },
);

it("does not turn provided pack advisories into a personal-file save restriction", async () => {
  store.read(profile, "tf/custom/provided/cfg/helper.cfg", "unbind escape\n");
  await edit("echo personal safe command\n");
  expect(await save()).toBe(true);
});

it.each([false, true])(
  "restores a reviewed missing live file only while TF2 is closed (running=%s)",
  async (running) => {
    await edit("echo retained restoration draft\n");
    const draft = store.dirty()[0];
    const originalRead = api.readProfileFile;
    const originalWrite = api.writeOwnedFile;
    const existing = await originalRead(draft.path);
    let missing = true;
    const absent = { ...existing.source, sha256: null };
    vi.spyOn(api, "readProfileFile").mockImplementation(async (...args) =>
      args[0] === draft.path && missing
        ? { ...existing, text: null, source: absent }
        : originalRead(...args),
    );
    const write = vi
      .spyOn(api, "writeOwnedFile")
      .mockImplementation(async (path, text, expected) => {
        expect(path).toBe(draft.path);
        expect(expected).toEqual(absent);
        missing = false;
        return originalWrite(path, text, existing.source);
      });
    await renderHost(2, running);
    expect(store.state(profile, draft.path)).toMatchObject({
      missing: true,
      conflict: true,
      text: draft.text,
    });
    await click("Compare current source");
    await click("Review draft for restoration");
    expect(store.state(profile, draft.path)).toMatchObject({
      missingReviewed: true,
      expected: absent,
    });
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 220));
    });
    await click("Restore file");
    if (running) {
      expect(write).not.toHaveBeenCalled();
      expect(store.state(profile, draft.path)?.dirty).toBe(true);
    } else {
      expect(write).toHaveBeenCalledOnce();
      expect(store.state(profile, draft.path)).toMatchObject({ dirty: false, missing: false });
      expect((await originalRead(draft.path)).text).toBe(draft.text);
    }
  },
);

it("creates an empty cfg draft without writing and saves only with an absent-source token", async () => {
  const write = vi.spyOn(api, "writeOwnedFile");
  await click("New cfg");
  await click("Helper");
  await act(async () => {
    const input = box.querySelector<HTMLInputElement>("#new-cfg-name");
    if (!input) throw Error("Missing name input");
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set?.call(input, "first");
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await click("helpers");
  await click("Start editing");
  const draft = store.dirty()[0];
  expect(draft.path).toMatch(/\/helpers\/first\.cfg$/);
  expect(draft.text).toBe("");
  expect(write).not.toHaveBeenCalled();
  expect(await save(draft)).toBe(true);
  expect(write).toHaveBeenCalledWith(
    draft.path,
    "",
    expect.objectContaining({ profileId: profile, sha256: null, librarySha256: null }),
  );
  expect((await api.readProfileFile(draft.path)).text).toBe("");
  expect(store.dirty()).toEqual([]);
});

it("saves the current buffer under a new cfg identity with an absent destination token", async () => {
  const originalPath = store.selected(profile);
  const context = await api.getFilesContext();
  const destination = `${context.layer === "comfig" ? "tf/cfg/overrides" : "tf/cfg"}/copied_config.cfg`;
  const write = vi.spyOn(api, "writeOwnedFile");
  await edit("echo copied draft\n");
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 220));
  });
  await act(async () => {
    editor().contentDOM.dispatchEvent(
      new KeyboardEvent("keydown", {
        key: "S",
        ctrlKey: true,
        shiftKey: true,
        bubbles: true,
        cancelable: true,
      }),
    );
  });
  expect(box.textContent).toContain("Save as new cfg");
  await act(async () => {
    const input = box.querySelector<HTMLInputElement>("#save-as-name");
    if (!input) throw Error("Missing Save as name input");
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set?.call(
      input,
      "copied_config",
    );
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await click("Save new cfg");
  expect(write).toHaveBeenCalledWith(
    destination,
    "echo copied draft\n",
    expect.objectContaining({ sha256: null, librarySha256: null }),
  );
  expect((await api.readProfileFile(destination)).text).toBe("echo copied draft\n");
  expect(store.selected(profile)).toBe(destination);
  expect(store.dirty()).toEqual([]);
  if (originalPath)
    expect((await api.readProfileFile(originalPath)).text).not.toBe("echo copied draft\n");
});

it("retains editor bytes and the original token after native FileConflict", async () => {
  await edit("echo my retained draft\n");
  const draft = store.dirty()[0];
  if (!draft.expected) throw Error("Missing original source token");
  await api.writeOwnedFile(draft.path, "echo external change\n", draft.expected);
  expect(await save(draft)).toBe(false);
  expect(editor().state.doc.toString()).toBe("echo my retained draft\n");
  expect(store.state(profile, draft.path)).toMatchObject({
    text: draft.text,
    expected: draft.expected,
    dirty: true,
    conflict: true,
    source: "echo external change\n",
  });
  expect(box.textContent).toContain("Compare current source");
  expect((await api.readProfileFile(draft.path)).text).toBe("echo external change\n");
});

it("validates one captured all-draft snapshot while preserving later edits during save-all", async () => {
  const candidates = store.documents(profile).filter((file) => file.path.startsWith("tf/cfg/"));
  const [first, second] = candidates;
  expect(second).toBeDefined();
  store.edit(profile, first.path, "echo first submitted\n");
  store.edit(profile, second.path, "echo second submitted\n");
  const submissions = store.dirty();
  const originalWrite = api.writeOwnedFile;
  vi.spyOn(api, "writeOwnedFile").mockImplementation(async (...args) => {
    if (args[0] === first.path) store.edit(profile, second.path, "echo newer second draft\n");
    return originalWrite(...args);
  });
  let saved = true;
  await act(async () => {
    saved = await saveFileDrafts(
      store,
      (draft) => saver.current?.(draft) ?? Promise.resolve(false),
    );
  });
  expect(saved).toBe(false);
  expect(store.state(profile, second.path)?.text).toBe("echo newer second draft\n");
  expect(store.state(profile, second.path)?.dirty).toBe(true);
  for (const draft of submissions) {
    const checked = vi
      .mocked(analyzeFilesSnapshot)
      .mock.calls.find(
        ([snapshot]) =>
          snapshot.identity === `${draft.profile}:${draft.path}:${draft.revision ?? 0}`,
      );
    expect(checked?.[0].files).toEqual(draft.documents?.map(({ path, text }) => ({ path, text })));
  }
});

it("acknowledges the committed hash rather than a later reload's external hash", async () => {
  await edit("echo submitted\n");
  const draft = store.dirty()[0];
  const originalWrite = api.writeOwnedFile;
  let committedHash: string | undefined;
  let externalHash: string | undefined;
  vi.spyOn(api, "writeOwnedFile").mockImplementation(async (...args) => {
    const committed = await originalWrite(...args);
    const committedFile = await api.readProfileFile(args[0]);
    committedHash = committedFile.sha256;
    store.edit(profile, args[0], "echo edit while saving\n");
    await originalWrite(args[0], "echo subsequent external change\n", committedFile.source);
    externalHash = (await api.readProfileFile(args[0])).sha256;
    return structuredClone(committed);
  });
  expect(await save(draft)).toBe(true);
  expect(store.state(profile, draft.path)).toMatchObject({
    text: "echo edit while saving\n",
    expected: { sha256: committedHash },
    currentExpected: { sha256: externalHash },
    dirty: true,
    conflict: true,
  });
  expect(committedHash).not.toBe(externalHash);
});
