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
    onReviewFiles: vi.fn(),
    onInspectExport: vi.fn(async () => ["tf/cfg/config.cfg:8"]),
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

it("discloses credential locations before export and offers Files review", async () => {
  (props.profiles.library as ProfileLibrary).activeProfileId = "preview-1";
  await render();
  await act(async () =>
    box.querySelector<HTMLDetailsElement>('[data-testid="profile-library"] summary')?.click(),
  );
  await act(async () =>
    box.querySelector<HTMLButtonElement>('[data-testid="profile-actions"]')?.click(),
  );
  await act(async () => {
    [...document.querySelectorAll<HTMLButtonElement>("button")]
      .find((button) => button.textContent?.trim() === "Export profile")
      ?.click();
    await Promise.resolve();
  });
  expect(props.onInspectExport).toHaveBeenCalledWith("preview-1");
  expect(box.textContent).toContain("tf/cfg/config.cfg:8");
  expect(box.textContent).not.toContain("hunter2");
  expect(props.profiles.exportProfile).not.toHaveBeenCalled();
  await act(async () => {
    [...box.querySelectorAll<HTMLButtonElement>("button")]
      .find((button) => button.textContent?.trim() === "Review Files")
      ?.click();
  });
  expect(props.onReviewFiles).toHaveBeenCalledOnce();
  expect(props.profiles.exportProfile).not.toHaveBeenCalled();
});

it("closes deletion review before routing to Files from export review", async () => {
  const library = props.profiles.library as ProfileLibrary;
  library.activeProfileId = "preview-1";
  props.profiles.deleteTarget = library.profiles[0];
  props.profiles.cancelDelete = vi.fn(() => {
    props.profiles.deleteTarget = null;
  });
  await render();
  const deletion = box.querySelector<HTMLElement>('[data-testid="profile-delete-dialog"]');
  expect(deletion).not.toBeNull();
  await act(async () => {
    [...box.querySelectorAll<HTMLButtonElement>("button")]
      .find((button) => button.textContent?.trim() === "Export profile first")
      ?.click();
    await Promise.resolve();
  });
  const exportDialog = [...box.querySelectorAll<HTMLElement>('[role="dialog"]')].find((node) =>
    node.textContent?.includes("Possible saved credentials"),
  );
  expect(exportDialog).toBeDefined();
  expect(exportDialog?.getAttribute("aria-modal")).toBe("true");
  expect(deletion?.hasAttribute("inert")).toBe(true);
  expect(exportDialog?.contains(document.activeElement)).toBe(true);
  await act(async () => {
    [...box.querySelectorAll<HTMLButtonElement>("button")]
      .find((button) => button.textContent?.trim() === "Review Files")
      ?.click();
  });
  await render();
  expect(props.profiles.cancelDelete).toHaveBeenCalledOnce();
  expect(props.profiles.confirmDelete).not.toHaveBeenCalled();
  expect(props.onReviewFiles).toHaveBeenCalledOnce();
  expect(box.querySelector('[data-testid="profile-delete-dialog"]')).toBeNull();
  expect(box.querySelector('[role="dialog"]')).toBeNull();
  expect(document.activeElement?.closest("[inert], [role=dialog], [role=alertdialog]")).toBeNull();
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
