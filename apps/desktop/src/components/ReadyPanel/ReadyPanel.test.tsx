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
      renameProfile: vi.fn(async () => true),
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
      retiredCasualReview: null,
      retiredCasualInFlight: false,
      confirmRetiredCasualReview: vi.fn(async () => {}),
      cancelRetiredCasualReview: vi.fn(),
      switchHandoff: null,
      captureKeptPacks: vi.fn(async () => {}),
      dismissSwitchHandoff: vi.fn(),
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
    onInspectExport: vi.fn(async () => ({
      revision: "saved-profile-revision",
      credentialLocations: ["tf/cfg/config.cfg:8"],
      customPacks: [
        { path: "tf/custom/creator.vpk", fileCount: 1, kind: "other" as const },
        {
          path: "tf/custom/execs-crosshairs/",
          fileCount: 3,
          kind: "crosshairScripts" as const,
        },
        { path: "tf/custom/execs-viewmodels.vpk", fileCount: 1, kind: "viewmodels" as const },
      ],
    })),
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

it("reviews exact saved Casual removals and preserves Cancel as an explicit choice", async () => {
  props.profiles.retiredCasualReview = {
    profileId: "preview-1",
    name: "Main",
    revision: "reviewed-selection",
    addonsToRemove: ["factory new"],
    particleModsToRemove: ["Square_Series"],
    directAddonsKept: ["Flat Textures v1"],
    profileParticleModsKept: ["installed-particles"],
  };
  await render();
  const review = box.querySelector<HTMLElement>('[data-testid="retired-casual-review"]');
  expect(review?.textContent).toContain("factory new");
  expect(review?.textContent).toContain("Square Series");
  expect(review?.textContent).toContain("Direct-author addons (1)");
  expect(review?.textContent).toContain("Cancel keeps it exactly as it is");
  expect(props.profiles.confirmRetiredCasualReview).not.toHaveBeenCalled();
  await act(async () =>
    [...(review?.querySelectorAll<HTMLButtonElement>("button") ?? [])]
      .find((button) => button.textContent === "Cancel")
      ?.click(),
  );
  expect(props.profiles.cancelRetiredCasualReview).toHaveBeenCalledOnce();
  expect(props.profiles.confirmRetiredCasualReview).not.toHaveBeenCalled();
  await act(async () =>
    [...(review?.querySelectorAll<HTMLButtonElement>("button") ?? [])]
      .find((button) => button.textContent === "Remove saved choices and switch")
      ?.click(),
  );
  expect(props.profiles.confirmRetiredCasualReview).toHaveBeenCalledOnce();
});

it("keeps Cancel and Escape closed while a reviewed Casual clear is in flight", async () => {
  props.profiles.retiredCasualReview = {
    profileId: "preview-1",
    name: "Main",
    revision: "reviewed-selection",
    addonsToRemove: ["factory new"],
    particleModsToRemove: [],
    directAddonsKept: [],
    profileParticleModsKept: [],
  };
  let finishClear: (() => void) | undefined;
  props.profiles.confirmRetiredCasualReview = vi.fn(
    () =>
      new Promise<void>((resolve) => {
        finishClear = resolve;
      }),
  );
  await render();
  await act(async () => {
    box
      .querySelector<HTMLButtonElement>('[data-testid="retired-casual-review"] .btn-primary')
      ?.click();
  });
  expect(props.profiles.confirmRetiredCasualReview).toHaveBeenCalledOnce();

  props.profiles.retiredCasualInFlight = true;
  await render();
  const review = box.querySelector<HTMLElement>('[data-testid="retired-casual-review"]');
  expect(review).not.toBeNull();
  expect(review?.querySelector('[role="status"]')?.textContent).toContain("Please wait");
  expect(review?.textContent).not.toContain("Cancel keeps it exactly as it is");
  const cancel = [...(review?.querySelectorAll<HTMLButtonElement>("button") ?? [])].find(
    (button) => button.textContent === "Cancel",
  );
  expect(cancel?.disabled).toBe(true);
  expect(review?.querySelector<HTMLButtonElement>(".btn-primary")?.disabled).toBe(true);
  await act(async () => {
    cancel?.click();
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    box.querySelector<HTMLElement>(".scrim")?.click();
    review?.querySelector<HTMLButtonElement>(".btn-primary")?.click();
  });
  expect(props.profiles.cancelRetiredCasualReview).not.toHaveBeenCalled();
  expect(props.profiles.confirmRetiredCasualReview).toHaveBeenCalledOnce();
  expect(box.querySelector('[data-testid="retired-casual-review"]')).not.toBeNull();
  await act(async () => finishClear?.());
});

it("discloses credentials and included custom packs before export and offers Files review", async () => {
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
  expect(box.textContent).toContain("Custom packs in this ZIP: 3");
  expect(box.textContent).toContain("tf/custom/creator.vpk");
  expect(box.textContent).toContain("tf/custom/execs-crosshairs/");
  expect(box.textContent).toContain("modified copies of installed TF2 files");
  expect(box.textContent).toContain("tf/custom/execs-viewmodels.vpk");
  expect(box.textContent).toContain("another creator’s animations");
  expect(box.textContent).toContain("Export does not verify permission");
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

it("passes the reviewed profile revision to the ZIP exporter", async () => {
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
  await act(async () => {
    [...box.querySelectorAll<HTMLButtonElement>("button")]
      .find((button) => button.textContent?.trim() === "Export ZIP…")
      ?.click();
  });
  expect(props.profiles.exportProfile).toHaveBeenCalledExactlyOnceWith(
    "preview-1",
    "saved-profile-revision",
  );
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

async function openRename() {
  await act(async () =>
    box.querySelector<HTMLDetailsElement>('[data-testid="profile-library"] summary')?.click(),
  );
  await act(async () =>
    box.querySelector<HTMLButtonElement>('[data-testid="profile-actions"]')?.click(),
  );
  await act(async () => {
    const item = [...document.querySelectorAll<HTMLButtonElement>("button")].find(
      (button) => button.textContent?.trim() === "Rename…",
    );
    // A real click presses first; the menu is portaled outside the popover.
    item?.dispatchEvent(new Event("pointerdown", { bubbles: true }));
    item?.click();
  });
  expect(menu()?.open).toBe(true);
  const input = box.querySelector<HTMLInputElement>("#profile-rename-input");
  if (!input) throw new Error("Missing rename field");
  return input;
}

async function typeName(input: HTMLInputElement, value: string) {
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set?.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

it("renames a profile inline and keeps the menu open for the result", async () => {
  const library = props.profiles.library as ProfileLibrary;
  const first = library.profiles[0];
  await render();
  const input = await openRename();
  expect(input.value).toBe(first.name);
  expect(document.activeElement).toBe(input);

  await typeName(input, "   ");
  const save = () =>
    [...box.querySelectorAll<HTMLButtonElement>('[data-testid="profile-rename"] button')].find(
      (button) => button.textContent === "Save",
    );
  expect(save()?.disabled).toBe(true);
  expect(box.textContent).toContain("Enter a name.");

  await typeName(input, "  Casual ✨ ");
  await act(async () => {
    box.querySelector<HTMLFormElement>('[data-testid="profile-rename"]')?.requestSubmit();
    await Promise.resolve();
  });
  expect(props.profiles.renameProfile).toHaveBeenCalledWith(first.id, "Casual ✨");
  expect(box.querySelector('[data-testid="profile-rename"]')).toBeNull();
  expect(menu()?.open).toBe(true);
});

it("cancels a rename with Escape without closing the menu or saving", async () => {
  await render();
  const input = await openRename();
  await typeName(input, "Something else");
  await act(async () => {
    input.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
  });
  expect(box.querySelector('[data-testid="profile-rename"]')).toBeNull();
  expect(menu()?.open).toBe(true);
  expect(props.profiles.renameProfile).not.toHaveBeenCalled();
});

it("keeps the editor open with the typed name when a rename fails", async () => {
  props.profiles.renameProfile = vi.fn(async () => false);
  await render();
  const input = await openRename();
  await typeName(input, "Broken");
  await act(async () => {
    box.querySelector<HTMLFormElement>('[data-testid="profile-rename"]')?.requestSubmit();
    await Promise.resolve();
  });
  expect(box.querySelector<HTMLInputElement>("#profile-rename-input")?.value).toBe("Broken");
});
