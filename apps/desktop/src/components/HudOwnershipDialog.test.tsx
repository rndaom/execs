// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { Api } from "../lib/api";
import { BridgeError, type HudOwnershipReview, type ProfileDetail } from "../lib/bridge";
import { HudOwnershipDialog, type HudOwnershipDialogProps } from "./HudOwnershipDialog";
import { ToastProvider } from "./ui/Toast";

let container: HTMLDivElement;
let root: Root;
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  localStorage.clear();
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  localStorage.clear();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function review(): HudOwnershipReview {
  return {
    profileId: "profile-a",
    selectedHud: "rayshud",
    candidates: [
      { folder: "rayshud", source: "profile", files: 41 },
      { folder: "toonhud", source: "live", files: 82 },
    ],
    fingerprint: "review-1",
    reviewRequired: true,
    managedOptionFiles: [],
    resetOptions: false,
  };
}
const detail: ProfileDetail = {
  id: "profile-a",
  name: "Casual",
  layer: "comfig",
  files: [],
  launchOptions: "",
};

function button(label: string) {
  const found = [...container.querySelectorAll("button")].find(
    (node) => node.textContent?.trim() === label,
  );
  if (!found) throw Error(`Missing button: ${label}`);
  return found;
}
function choice(index: number) {
  const found = container.querySelector<HTMLInputElement>(
    `[data-testid="hud-ownership-choice-${index}"]`,
  );
  if (!found) throw Error(`Missing HUD choice ${index}`);
  return found;
}
async function renderDialog(overrides: Partial<HudOwnershipDialogProps> = {}) {
  const props: HudOwnershipDialogProps = {
    api: {
      getHudOwnership: vi.fn().mockResolvedValue(review()),
      selectProfileHud: vi.fn().mockResolvedValue(detail),
    } as unknown as Api,
    profile: { id: "profile-a", name: "Casual" },
    running: false,
    busy: false,
    onClose: vi.fn(),
    onApplied: vi.fn(),
    onBusyChange: vi.fn(),
    ...overrides,
  };
  await act(async () =>
    root.render(
      <ToastProvider>
        <HudOwnershipDialog {...props} />
      </ToastProvider>,
    ),
  );
  return props;
}

it("focuses Cancel and lets Escape close without selecting a HUD", async () => {
  const props = await renderDialog();
  expect(document.activeElement).toBe(button("Cancel"));
  expect(choice(0).checked).toBe(false);
  expect(choice(1).checked).toBe(false);
  expect(button("Use selected HUD").disabled).toBe(true);
  expect(container.textContent).toContain("Original HUD copies are kept for recovery");
  expect(container.textContent).toContain("manual recovery");
  expect(container.textContent).toContain("will not stay selectable inside this profile");
  await act(async () =>
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })),
  );
  expect(props.onClose).toHaveBeenCalledOnce();
  expect(props.api.selectProfileHud).not.toHaveBeenCalled();
});

it.each(["running", "busy"] as const)(
  "keeps review and Cancel available while %s blocks the file operation",
  async (guard) => {
    const props = await renderDialog({ [guard]: true });
    expect(choice(1).disabled).toBe(false);
    await act(async () => choice(1).click());
    expect(choice(1).checked).toBe(true);
    expect(button("Use selected HUD").disabled).toBe(true);
    expect(button("Cancel").disabled).toBe(false);
    await act(async () => button("Cancel").click());
    expect(props.onClose).toHaveBeenCalledOnce();
    expect(props.api.selectProfileHud).not.toHaveBeenCalled();
  },
);

it("holds the dialog and parent busy guard until the selected HUD and profile refresh finish", async () => {
  let resolveWrite!: (value: ProfileDetail) => void;
  let resolveRefresh!: () => void;
  const write = new Promise<ProfileDetail>((resolve) => {
    resolveWrite = resolve;
  });
  const refresh = new Promise<void>((resolve) => {
    resolveRefresh = resolve;
  });
  const api = {
    getHudOwnership: vi.fn().mockResolvedValue(review()),
    selectProfileHud: vi.fn().mockReturnValue(write),
  } as unknown as Api;
  const props = await renderDialog({ api, onApplied: vi.fn().mockReturnValue(refresh) });
  await act(async () => choice(1).click());
  await act(async () => button("Use selected HUD").click());
  expect(api.selectProfileHud).toHaveBeenCalledExactlyOnceWith("profile-a", "toonhud", "review-1");
  expect(button("Cancel").disabled).toBe(true);
  expect(choice(0).disabled).toBe(true);
  expect(props.onBusyChange).toHaveBeenLastCalledWith(true);
  await act(async () =>
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })),
  );
  expect(props.onClose).not.toHaveBeenCalled();
  await act(async () => resolveWrite(detail));
  expect(props.onApplied).toHaveBeenCalledExactlyOnceWith(detail);
  expect(button("Refreshing profile…").disabled).toBe(true);
  expect(props.onBusyChange).toHaveBeenLastCalledWith(true);
  expect(props.onClose).not.toHaveBeenCalled();
  await act(async () => resolveRefresh());
  expect(props.onClose).toHaveBeenCalledOnce();
  expect(props.onBusyChange).toHaveBeenLastCalledWith(false);
});

it("retries a failed parent refresh without repeating the committed file operation", async () => {
  const onApplied = vi
    .fn()
    .mockRejectedValueOnce(Error("Library is unavailable"))
    .mockResolvedValueOnce(undefined);
  const props = await renderDialog({ onApplied });
  await act(async () => choice(0).click());
  await act(async () => button("Use selected HUD").click());
  expect(container.textContent).toContain(
    "The HUD was selected, but the profile view could not refresh.",
  );
  expect(container.textContent).toContain("Library is unavailable");
  expect(props.onClose).not.toHaveBeenCalled();
  expect(choice(0).disabled).toBe(true);
  expect(button("Refresh profile view").disabled).toBe(false);
  await act(async () => button("Refresh profile view").click());
  expect(props.api.selectProfileHud).toHaveBeenCalledOnce();
  expect(onApplied).toHaveBeenCalledTimes(2);
  expect(props.onClose).toHaveBeenCalledOnce();
});

it("removes stale controls until the user requests and selects a fresh review", async () => {
  const api = {
    getHudOwnership: vi
      .fn()
      .mockResolvedValueOnce(review())
      .mockResolvedValueOnce({ ...review(), fingerprint: "review-2" }),
    selectProfileHud: vi
      .fn()
      .mockRejectedValueOnce(new BridgeError("HUD files changed", "HudReviewStale"))
      .mockResolvedValueOnce(detail),
  } as unknown as Api;
  const props = await renderDialog({ api });
  await act(async () => choice(0).click());
  await act(async () => button("Use selected HUD").click());
  expect(container.querySelector('input[type="radio"]')).toBeNull();
  expect(container.textContent).toContain("HUD files changed");
  expect(button("Use selected HUD").disabled).toBe(true);
  await act(async () => button("Read HUD folders again").click());
  expect(choice(0).checked).toBe(false);
  expect(button("Use selected HUD").disabled).toBe(true);
  await act(async () => choice(1).click());
  await act(async () => button("Use selected HUD").click());
  expect(api.selectProfileHud).toHaveBeenLastCalledWith("profile-a", "toonhud", "review-2");
  expect(props.onClose).toHaveBeenCalledOnce();
});

it("shows an empty read without inventing a selectable none option", async () => {
  const api = {
    getHudOwnership: vi.fn().mockResolvedValue({ ...review(), selectedHud: null, candidates: [] }),
    selectProfileHud: vi.fn(),
  } as unknown as Api;
  await renderDialog({ api });
  expect(container.textContent).toContain("No HUD folders were found for this profile.");
  expect(container.querySelector('input[type="radio"]')).toBeNull();
  expect(button("Use selected HUD").disabled).toBe(true);
  expect(button("Cancel").disabled).toBe(false);
  expect(api.selectProfileHud).not.toHaveBeenCalled();
});

it("discloses the exact option files and startup lines reset by choosing another HUD", async () => {
  const api = {
    getHudOwnership: vi.fn().mockResolvedValue({
      ...review(),
      managedOptionFiles: [
        "tf/cfg/overrides/execs_hud.cfg",
        "tf/cfg/overrides/execs_hud_crosshair.cfg",
      ],
    }),
    selectProfileHud: vi.fn(),
  } as unknown as Api;
  await renderDialog({ api });
  expect(container.querySelector('[data-testid="hud-ownership-option-reset"]')).toBeNull();
  await act(async () => choice(0).click());
  expect(container.querySelector('[data-testid="hud-ownership-option-reset"]')).toBeNull();
  await act(async () => choice(1).click());
  const notice = container.querySelector('[data-testid="hud-ownership-option-reset"]');
  expect(notice?.textContent).toContain("tf/cfg/overrides/execs_hud.cfg");
  expect(notice?.textContent).toContain("tf/cfg/overrides/execs_hud_crosshair.cfg");
  expect(notice?.textContent).toContain("and their startup lines");
  expect(notice?.textContent).toContain("Original files are kept in recovery copies");
  expect(api.selectProfileHud).not.toHaveBeenCalled();
});

it("discloses pending imported option cleanup even when only one HUD remains to choose", async () => {
  const original = review();
  const api = {
    getHudOwnership: vi.fn().mockResolvedValue({
      ...original,
      candidates: [original.candidates[0]],
      managedOptionFiles: ["tf/cfg/overrides/execs_hud.cfg"],
      resetOptions: true,
    }),
    selectProfileHud: vi.fn(),
  } as unknown as Api;
  await renderDialog({ api });
  expect(
    container.querySelector('[data-testid="hud-ownership-option-reset"]')?.textContent,
  ).toContain("tf/cfg/overrides/execs_hud.cfg");
  expect(button("Use selected HUD").disabled).toBe(true);
  await act(async () => choice(0).click());
  expect(button("Use selected HUD").disabled).toBe(false);
  expect(container.querySelector('[data-testid="hud-ownership-option-reset"]')).not.toBeNull();
  expect(api.selectProfileHud).not.toHaveBeenCalled();
});
