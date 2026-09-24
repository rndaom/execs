// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ToastProvider } from "./components/ui/Toast";
import { AppStatusProvider } from "./hooks/useAppStatus";
import type { Api } from "./lib/api";
import { BridgeError, type GameBananaPage } from "./lib/bridge";
import {
  DIRECT_DEVELOPER_TEXTURES_ID,
  DIRECT_FLAT_TEXTURES_ID,
  PREVIEW_GAMEBANANA_RECORDS,
  PREVIEW_MODS_CATALOG,
  PREVIEW_MODS_STATUS,
} from "./lib/mods-ui";
import { SettingsHost } from "./SettingsHost";

// Real settings queue, Mods pane, import dialog, cards, and toast. Only IPC is
// substituted, so handled native errors cannot accidentally become success UI.
const hudMessage =
  "This VPK contains a HUD. No files were installed. Extract the HUD and import its folder in HUD.";
const record = PREVIEW_GAMEBANANA_RECORDS.find((mod) => mod.id === 700_000);
if (!record) throw new Error("Missing GameBanana test fixture");
const page: GameBananaPage = {
  records: [record],
  total: { kind: "exact", value: 1 },
  perPage: 20,
  complete: true,
  ordering: "server",
  filters: {
    query: "global",
    category: "global",
    contentRating: "global",
    installability: "global",
  },
  cache: { source: "network", freshForMs: 600_000 },
};
const deferred = <T,>() => {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
};

let profileId: string;
let refreshKey: number;
let api: ReturnType<typeof makeApi>;
let root: Root;
let box: HTMLDivElement;
const onNavigate = vi.fn();
const onHudReviewRequired = vi.fn();
const onError = vi.fn();
const onBusyChange = vi.fn();
const onBindSyncHandled = vi.fn();
function makeApi() {
  return {
    getActiveProfileDetail: vi.fn(async () => ({
      id: profileId,
      layer: "vanilla",
      files: [],
      launchOptions: "",
      hud: null,
      mods: [],
    })),
    getFilesContext: vi.fn(async () => ({ profileId, root: "fixture", layer: "vanilla" })),
    getComfigState: vi.fn(async () => null),
    getPreloaderStatus: vi.fn(async () => ({
      ...PREVIEW_MODS_STATUS,
      modsCached: false,
      status: { ...PREVIEW_MODS_STATUS.status, untrackedModified: [] },
    })),
    getDefaultMods: vi.fn(async () => ({
      cached: false,
      catalog: {
        addons: PREVIEW_MODS_CATALOG.addons.filter(
          (addon) =>
            addon.id === DIRECT_FLAT_TEXTURES_ID || addon.id === DIRECT_DEVELOPER_TEXTURES_ID,
        ),
        particleMods: [],
      },
    })),
    gameBananaModCategories: vi.fn(async () => []),
    searchGameBananaMods: vi.fn(async () => page),
    gameBananaDownloadVariants: vi.fn(async () => [
      {
        id: 7_000_001,
        fileName: "preview.zip",
        description: "Main version",
        sizeBytes: 1000,
        addedAt: 100,
        supported: true,
      },
    ]),
    importModArchive: vi.fn(async (): Promise<{ id: string } | null> => ({ id: profileId })),
    importModFolder: vi.fn(async (): Promise<{ id: string } | null> => ({ id: profileId })),
    installGameBananaMod: vi.fn(async () => ({ id: profileId })),
  };
}
async function render() {
  await act(async () => {
    root.render(
      <ToastProvider>
        <AppStatusProvider value={{ error: null, setError: onError, busy: false, running: false }}>
          <SettingsHost
            api={api as unknown as Api}
            tab="mods"
            running={false}
            externalBusy={false}
            refreshKey={refreshKey}
            bindSyncRequest={null}
            onBindSyncHandled={onBindSyncHandled}
            onBusyChange={onBusyChange}
            onError={onError}
            onNavigate={onNavigate}
            onHudReviewRequired={onHudReviewRequired}
          />
        </AppStatusProvider>
      </ToastProvider>,
    );
  });
}
function element(id: string): HTMLElement {
  const found = box.querySelector<HTMLElement>(`[data-testid="${id}"]`);
  if (!found) throw new Error(`Missing ${id}: ${box.textContent}`);
  return found;
}
function button(label: string): HTMLButtonElement {
  const found = [...box.querySelectorAll("button")].find((item) => item.textContent === label);
  if (!found) throw new Error(`Missing button ${label}: ${box.textContent}`);
  return found;
}
async function click(id: string) {
  await act(async () => element(id).click());
}
async function chooseGameBananaFile() {
  await click("mods-gb-install-700000");
  await act(async () => {
    box.querySelector<HTMLInputElement>('input[name="gamebanana-file"]')?.click();
  });
  await click("mods-gb-install-selected");
}
async function importMod(kind: "archive" | "folder") {
  await click("mods-import");
  await click(`mods-import-${kind}`);
}
function expectOnlyHudRecovery() {
  expect(element("mods-hud-import-required").textContent).toContain(hudMessage);
  expect(box.querySelectorAll('[role="alert"]')).toHaveLength(1);
  expect(box.querySelector('[data-testid="toast"]')).toBeNull();
  expect(box.textContent).not.toContain("Mod imported");
  expect(box.textContent).not.toContain("Mod installed");
  expect(onError.mock.calls.filter(([message]) => message !== null)).toEqual([]);
}

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.clearAllMocks();
  window.localStorage.clear();
  profileId = "A";
  refreshKey = 1;
  api = makeApi();
  box = document.createElement("div");
  document.body.append(box);
  root = createRoot(box);
});
afterEach(async () => {
  await act(async () => root.unmount());
  box.remove();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("Mods HUD recovery through the real settings host", () => {
  it("shows both direct author choices before the cueki catalog is cached", async () => {
    await render();
    expect(api.getDefaultMods).toHaveBeenCalledOnce();
    expect(element("mods-addon-flat-textures-v1")).toBeTruthy();
    expect(element("mods-addon-developer-textures-overhaul-v2")).toBeTruthy();
    expect(element("mods-download").textContent).toContain("Download other choices");
  });

  it.each(["archive", "folder"] as const)(
    "routes a rejected %s import to one actionable HUD review without success feedback",
    async (kind) => {
      api[kind === "archive" ? "importModArchive" : "importModFolder"].mockRejectedValueOnce(
        new BridgeError(hudMessage, "HudImportRequired"),
      );
      await render();
      await importMod(kind);
      expectOnlyHudRecovery();
      await act(async () => button("Review in HUD").click());
      expect(onNavigate).toHaveBeenCalledExactlyOnceWith("hud");
      expect(onHudReviewRequired).not.toHaveBeenCalled();
      expect(api.importModArchive).toHaveBeenCalledTimes(kind === "archive" ? 1 : 0);
      expect(api.importModFolder).toHaveBeenCalledTimes(kind === "folder" ? 1 : 0);
    },
  );

  it("keeps a GameBanana HUD redirect actionable without a misleading retry alert", async () => {
    vi.useFakeTimers();
    const install = deferred<Awaited<ReturnType<typeof api.installGameBananaMod>>>();
    api.installGameBananaMod.mockReturnValueOnce(install.promise);
    await render();
    await chooseGameBananaFile();
    expect(element("mods-gb-install-700000").textContent).toBe("Installing…");
    await act(async () => vi.advanceTimersByTimeAsync(450));
    expect(element("toast").textContent).toBe("Saving…");
    await act(async () => install.reject(new BridgeError(hudMessage, "HudImportRequired")));
    expectOnlyHudRecovery();
    expect(box.textContent).not.toContain("Retry this mod");
    expect(box.textContent).not.toContain("Preview mod 01 installed.");
    await act(async () => vi.advanceTimersByTimeAsync(1000));
    expect(box.querySelector('[data-testid="toast"]')).toBeNull();
  });

  it.each(["archive", "folder", "gamebanana"] as const)(
    "clears a previous HUD import warning when a new %s attempt starts",
    async (kind) => {
      api.importModArchive.mockRejectedValueOnce(new BridgeError(hudMessage, "HudImportRequired"));
      await render();
      await importMod("archive");
      expectOnlyHudRecovery();
      const next = deferred<Awaited<ReturnType<typeof api.importModArchive>>>();
      if (kind === "gamebanana") {
        api.installGameBananaMod.mockReturnValueOnce(next.promise as Promise<{ id: string }>);
        await chooseGameBananaFile();
      } else {
        api[kind === "archive" ? "importModArchive" : "importModFolder"].mockReturnValueOnce(
          next.promise,
        );
        await importMod(kind);
      }
      expect(box.querySelector('[data-testid="mods-hud-import-required"]')).toBeNull();
      await act(async () => next.resolve(kind === "gamebanana" ? { id: profileId } : null));
    },
  );

  it("clears HUD import recovery when the active profile identity changes", async () => {
    api.importModArchive.mockRejectedValueOnce(new BridgeError(hudMessage, "HudImportRequired"));
    await render();
    await importMod("archive");
    expectOnlyHudRecovery();
    profileId = "B";
    refreshKey += 1;
    await render();
    expect(box.querySelector('[data-testid="mods-hud-import-required"]')).toBeNull();
    expect(box.querySelector('[data-testid="toast"]')).toBeNull();
  });

  it.each(["HudImportRequired", "HudReviewRequired", "HudLiveReviewRequired"])(
    "does not publish a late %s failure into another profile",
    async (code) => {
      const previous = deferred<Awaited<ReturnType<typeof api.importModArchive>>>();
      api.importModArchive.mockReturnValueOnce(previous.promise);
      await render();
      await importMod("archive");
      profileId = "B";
      refreshKey += 1;
      await render();
      await act(async () => previous.reject(new BridgeError(hudMessage, code)));
      expect(box.querySelector('[data-testid="mods-hud-import-required"]')).toBeNull();
      expect(box.querySelector('[data-testid="toast"]')).toBeNull();
      expect(onHudReviewRequired).not.toHaveBeenCalled();
    },
  );

  it.each(["HudReviewRequired", "HudLiveReviewRequired"])(
    "routes %s to the profile ownership review once without a second failure surface",
    async (code) => {
      api.importModArchive.mockRejectedValueOnce(
        new BridgeError("Review this profile's HUDs.", code),
      );
      await render();
      await importMod("archive");
      expect(onHudReviewRequired).toHaveBeenCalledExactlyOnceWith("A");
      expect(onNavigate).not.toHaveBeenCalled();
      expect(box.querySelector('[data-testid="mods-hud-import-required"]')).toBeNull();
      expect(box.querySelector('[data-testid="toast"]')).toBeNull();
      expect(box.querySelector('[role="alert"]')).toBeNull();
    },
  );

  it("does not leave a failed GameBanana card behind after a profile changes", async () => {
    const previous = deferred<Awaited<ReturnType<typeof api.installGameBananaMod>>>();
    api.installGameBananaMod.mockReturnValueOnce(previous.promise);
    await render();
    await chooseGameBananaFile();
    profileId = "B";
    refreshKey += 1;
    await render();
    await act(async () => previous.reject(new BridgeError(hudMessage, "HudImportRequired")));
    expect(box.querySelector('[data-testid="mods-hud-import-required"]')).toBeNull();
    expect(box.querySelector('[data-testid="toast"]')).toBeNull();
    expect(box.querySelector('[role="alert"]')).toBeNull();
    expect(box.textContent).not.toContain("Review HUDs before installing");
    expect(element("mods-gb-install-700000").getAttribute("aria-label")).toBe(
      "Install Preview mod 01",
    );
  });

  it("keeps an ordinary failed import on the existing error toast", async () => {
    api.importModArchive.mockRejectedValueOnce(new BridgeError("Archive could not be read.", "Io"));
    await render();
    await importMod("archive");
    expect(element("toast").getAttribute("data-kind")).toBe("error");
    expect(element("toast").textContent).toContain("Archive could not be read");
    expect(box.querySelector('[data-testid="mods-hud-import-required"]')).toBeNull();
    expect(onHudReviewRequired).not.toHaveBeenCalled();
    expect(onNavigate).not.toHaveBeenCalled();
  });
});
