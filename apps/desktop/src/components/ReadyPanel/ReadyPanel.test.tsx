// @vitest-environment jsdom
import { act, type ComponentProps } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { type AppStatus, AppStatusProvider } from "../../hooks/useAppStatus";
import type { ProfileLibrary } from "../../lib/bridge";
import { previewImportedLibrary } from "../../lib/library-ui";
import { idleSwitchProgress } from "../../lib/switch-progress-ui";
import { ReadyPanel } from "./ReadyPanel";

let root: Root;
let box: HTMLDivElement;
let props: ComponentProps<typeof ReadyPanel>;
let status: AppStatus;

async function render() {
  await act(async () =>
    root.render(
      <AppStatusProvider value={status}>
        <ReadyPanel {...props} />
      </AppStatusProvider>,
    ),
  );
}

function choose() {
  return [...box.querySelectorAll("button")].find(
    (button) => button.textContent?.trim() === "Choose profile",
  );
}

function menu() {
  return box.querySelector<HTMLDetailsElement>('[data-testid="profile-library"]');
}

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  box = document.createElement("div");
  document.body.append(box);
  root = createRoot(box);
  status = { error: null, setError: vi.fn(), busy: false, running: false };
  props = {
    path: "C:/TF2",
    profiles: {
      library: { ...previewImportedLibrary("C:/TF2"), activeProfileId: null },
      packPrompt: null,
      packPromptDeferred: false,
      deferPackPrompt: vi.fn(),
      bindSyncRequest: null,
      refreshKey: "fixture",
      onBindSyncHandled: vi.fn(),
      saveCurrent: vi.fn(async () => false),
      importProfile: vi.fn(async () => {}),
      importing: false,
      importStage: null,
      importReview: null,
      selectImportHud: vi.fn(),
      confirmImport: vi.fn(async () => {}),
      cancelImport: vi.fn(async () => {}),
      importError: null,
      importedProfile: null,
      dismissImport: vi.fn(),
      exportProfile: vi.fn(async () => {}),
      switchProfile: vi.fn(async () => {}),
      deleteTarget: null,
      deleting: false,
      deleteError: null,
      reviewDelete: vi.fn(),
      confirmDelete: vi.fn(async () => {}),
      cancelDelete: vi.fn(),
      folderRepair: null,
      reviewFolderRepair: vi.fn(async () => {}),
      repairFolders: vi.fn(async () => {}),
      cancelFolderRepair: vi.fn(),
      answerPackPrompt: vi.fn(async () => {}),
      setLibrary: vi.fn(),
      reset: vi.fn(),
    },
    progress: {
      state: idleSwitchProgress(),
      degraded: null,
      start: vi.fn(),
      complete: vi.fn(),
      cancel: vi.fn(),
    },
    draftName: "",
    launching: false,
    recoveryTargetId: null,
    onDraftName: vi.fn(),
    onSave: vi.fn(),
    onCreateNew: vi.fn(),
    onChangeInstall: vi.fn(),
    onLaunch: vi.fn(),
    onCancelLaunch: vi.fn(),
  };
});

afterEach(async () => {
  await act(async () => root.unmount());
  box.remove();
  vi.unstubAllGlobals();
});

it("opens the existing profiles menu and focuses a saved profile without activating it", async () => {
  await render();
  expect(box.querySelector("h1")?.textContent).toBe("Choose a profile");
  expect(menu()?.open).toBe(false);
  await act(async () => choose()?.click());
  expect(menu()?.open).toBe(true);
  const firstProfile = box.querySelector<HTMLButtonElement>('[data-testid="profile-name"]');
  expect(document.activeElement).toBe(firstProfile);
  expect(props.profiles.switchProfile).not.toHaveBeenCalled();
  await act(async () =>
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })),
  );
  expect(menu()?.open).toBe(false);
  expect(document.activeElement).toBe(menu()?.querySelector("summary"));
  await act(async () => choose()?.click());
  expect(menu()?.open).toBe(true);
  expect(document.activeElement).toBe(firstProfile);
  await act(async () => firstProfile?.click());
  expect(props.profiles.switchProfile).toHaveBeenCalledExactlyOnceWith("preview-1");
});

it("focuses a saved profile's repair action when that profile cannot be switched", async () => {
  const library = props.profiles.library as ProfileLibrary;
  library.profiles[0].unsafeCustomFolders = ["materials"];
  await render();
  await act(async () => choose()?.click());
  expect(document.activeElement?.textContent).toBe("Repair folder names");
  expect(props.profiles.switchProfile).not.toHaveBeenCalled();
  await act(async () => (document.activeElement as HTMLButtonElement).click());
  expect(props.profiles.reviewFolderRepair).toHaveBeenCalledExactlyOnceWith("preview-1");
});

it("allows browsing while TF2 runs and focuses an available row action without switching", async () => {
  status.running = true;
  await render();
  expect(box.textContent).toContain("Close TF2 before switching to a saved profile.");
  expect(choose()?.disabled).toBe(false);
  await act(async () => choose()?.click());
  expect(menu()?.open).toBe(true);
  expect(document.activeElement?.getAttribute("aria-label")).toBe("Actions for Main");
  expect(box.querySelector<HTMLButtonElement>('[data-testid="profile-name"]')?.disabled).toBe(true);
  expect(props.profiles.switchProfile).not.toHaveBeenCalled();
});

it("waits for an in-flight write before opening the chooser", async () => {
  status.busy = true;
  await render();
  expect(choose()?.disabled).toBe(true);
  await act(async () => choose()?.click());
  expect(menu()?.open).toBe(false);
});

it.each<Partial<ProfileLibrary>>([
  { rootMismatch: true },
  { usable: false },
  { pendingSwitchProfileId: "preview-1" },
  { profiles: [] },
  { activeProfileId: "preview-1" },
])("preserves the existing fallback for library state %j", async (state) => {
  props.profiles.library = { ...(props.profiles.library as ProfileLibrary), ...state };
  await render();
  expect(choose()).toBeUndefined();
  expect(box.querySelector("h1")).toBeNull();
});

it("keeps the recovery prompt instead of offering the ordinary inactive-library action", async () => {
  props.recoveryTargetId = "preview-1";
  await render();
  expect(choose()).toBeUndefined();
  expect(box.querySelector('[data-testid="switch-recovery-pending"]')?.textContent).toContain(
    "Switch to Main to finish recovery",
  );
});
