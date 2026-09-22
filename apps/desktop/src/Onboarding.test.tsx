// @vitest-environment jsdom
import { act, type ComponentProps } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FinderPanel } from "./components/FinderPanel";
import { FirstRunExisting } from "./FirstRunExisting";
import { COMFIG_PRESETS } from "./lib/comfig-catalog";
import { OFFICIAL_ADDONS } from "./lib/first-run-ui";
import { SetupWizard } from "./SetupWizard";

const status = vi.hoisted(() => ({ running: false, busy: false, error: null as string | null }));
vi.mock("./hooks/useAppStatus", () => ({ useAppStatus: () => status }));

let root: Root;
let host: HTMLDivElement;
const installPath = "G:/SteamLibrary/steamapps/common/Team Fortress 2";

beforeEach(() => {
  status.running = false;
  status.busy = false;
  status.error = null;
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});

afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function button(label: string): HTMLButtonElement {
  const found = [...host.querySelectorAll("button")].find(
    (node) => node.textContent?.trim() === label,
  );
  if (!found) throw new Error(`Missing button: ${label}`);
  return found;
}

async function submit(selector: string) {
  const form = host.querySelector<HTMLFormElement>(selector);
  if (!form) throw new Error(`Missing form: ${selector}`);
  await act(async () =>
    form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })),
  );
}

function wizardProps(
  overrides: Partial<ComponentProps<typeof SetupWizard>> = {},
): ComponentProps<typeof SetupWizard> {
  return {
    draftName: "Main",
    preset: "medium",
    addons: [],
    onDraftName: vi.fn(),
    onPreset: vi.fn(),
    onToggleAddon: vi.fn(),
    onApply: vi.fn(),
    ...overrides,
  };
}

describe("Onboarding", () => {
  it("selects a full install path without confirming it, then requires the explicit confirm action", async () => {
    const props: ComponentProps<typeof FinderPanel> = {
      installs: [{ path: installPath }],
      scanning: false,
      busy: false,
      selected: null,
      error: null,
      canConfirm: false,
      onSelect: vi.fn(),
      onBrowse: vi.fn(),
      onConfirm: vi.fn(),
    };
    await act(async () => root.render(<FinderPanel {...props} />));
    expect(props.onConfirm).not.toHaveBeenCalled();
    expect(host.textContent).toContain(installPath);
    expect(host.querySelector('[aria-current="step"]')?.textContent).toContain("Find TF2");
    await act(async () => host.querySelector<HTMLButtonElement>("[data-selected]")?.click());
    expect(props.onSelect).toHaveBeenCalledWith(installPath);
    expect(props.onConfirm).not.toHaveBeenCalled();
    expect(button("Confirm install").disabled).toBe(true);

    await act(async () =>
      root.render(<FinderPanel {...props} selected={installPath} canConfirm />),
    );
    expect(host.querySelector('[aria-current="step"]')?.textContent).toContain("Confirm folder");
    await act(async () => button("Confirm install").click());
    expect(props.onConfirm).toHaveBeenCalledTimes(1);
    await act(async () =>
      root.render(<FinderPanel {...props} selected={installPath} canConfirm busy />),
    );
    await act(async () => {
      button("Confirm install").click();
      button("Browse…").click();
      host.querySelector<HTMLButtonElement>("[data-selected]")?.click();
    });
    expect(props.onConfirm).toHaveBeenCalledTimes(1);
    expect(props.onSelect).toHaveBeenCalledTimes(1);
    expect(props.onBrowse).not.toHaveBeenCalled();
  });

  it("keeps Browse available for an empty scan and prevents confirmation during scanning", async () => {
    const props: ComponentProps<typeof FinderPanel> = {
      installs: [],
      scanning: false,
      busy: false,
      selected: null,
      error: null,
      canConfirm: false,
      onSelect: vi.fn(),
      onBrowse: vi.fn(),
      onConfirm: vi.fn(),
    };
    await act(async () => root.render(<FinderPanel {...props} />));
    await act(async () => button("Browse…").click());
    expect(props.onBrowse).toHaveBeenCalledTimes(1);
    expect(button("Confirm install").disabled).toBe(true);
    await act(async () =>
      root.render(<FinderPanel {...props} scanning selected={installPath} canConfirm />),
    );
    expect(host.querySelector('[role="status"]')?.textContent).toContain(
      "Scanning Steam libraries",
    );
    expect(button("Confirm install").disabled).toBe(true);
  });

  it("only captures an existing setup, and refuses invalid or locked form submission", async () => {
    const props: ComponentProps<typeof FirstRunExisting> = {
      path: installPath,
      draftName: "Main",
      reasons: ["Found autoexec.cfg", "Found packs in custom"],
      onDraftName: vi.fn(),
      onSave: vi.fn(),
      onChange: vi.fn(),
    };
    await act(async () => root.render(<FirstRunExisting {...props} />));
    expect(host.textContent).toContain(installPath);
    expect(host.querySelectorAll('[data-testid="first-run-reasons"] li')).toHaveLength(2);
    expect(host.querySelectorAll('input[type="radio"], [role="switch"]')).toHaveLength(0);
    expect(host.querySelector('[aria-current="step"]')?.textContent).toContain("Save current");
    await submit("#first-run-save-form");
    expect(props.onSave).toHaveBeenCalledTimes(1);

    for (const state of [
      { busy: true, running: false, name: "Main" },
      { busy: false, running: true, name: "Main" },
      { busy: false, running: false, name: "  " },
    ]) {
      status.busy = state.busy;
      status.running = state.running;
      await act(async () => root.render(<FirstRunExisting {...props} draftName={state.name} />));
      expect(button("Save current setup").disabled).toBe(true);
      await submit("#first-run-save-form");
    }
    expect(props.onSave).toHaveBeenCalledTimes(1);
  });

  it("retains every real preset and addon and only exposes Current setup when supplied", async () => {
    const props = wizardProps({ onStartFrom: vi.fn() });
    await act(async () => root.render(<SetupWizard {...props} />));
    expect(host.querySelector('[data-testid="wizard-start-from"]')).toBeNull();
    expect(host.querySelectorAll('input[name="comfig-preset"]')).toHaveLength(4);
    await act(async () => button("Show all presets").click());
    expect(
      [...host.querySelectorAll<HTMLInputElement>('input[name="comfig-preset"]')].map(
        (node) => node.value,
      ),
    ).toEqual(COMFIG_PRESETS.map((preset) => preset.id));
    expect(host.querySelectorAll('[role="switch"]')).toHaveLength(OFFICIAL_ADDONS.length);
    await act(async () =>
      host.querySelector<HTMLButtonElement>('[data-testid="wizard-addon-no-tutorial"]')?.click(),
    );
    expect(props.onToggleAddon).toHaveBeenCalledWith("no-tutorial");

    await act(async () => root.render(<SetupWizard {...props} creating startFrom="current" />));
    expect(host.querySelector<HTMLInputElement>("#wizard-start-from-current")?.checked).toBe(true);
    await act(async () =>
      host.querySelector<HTMLInputElement>("#wizard-start-from-fresh")?.click(),
    );
    expect(props.onStartFrom).toHaveBeenCalledWith("fresh");
    expect(host.querySelector('[aria-label="Setup progress"]')).toBeNull();
    expect(button("Create and switch").disabled).toBe(false);
  });

  it("keeps setup choices live during TF2, but requires an unlocked, named profile to apply", async () => {
    const props = wizardProps();
    status.running = true;
    await act(async () => root.render(<SetupWizard {...props} />));
    expect(host.querySelector<HTMLInputElement>("#wizard-name")?.disabled).toBe(false);
    expect(host.querySelector<HTMLInputElement>("#comfig-preset-high")?.disabled).toBe(false);
    const addon = host.querySelector<HTMLButtonElement>('[data-testid="wizard-addon-no-tutorial"]');
    expect(addon?.disabled).toBe(false);
    await act(async () => addon?.click());
    expect(props.onToggleAddon).toHaveBeenCalledWith("no-tutorial");
    await submit("#setup-wizard");
    expect(props.onApply).not.toHaveBeenCalled();

    status.running = false;
    status.busy = true;
    await act(async () => root.render(<SetupWizard {...props} />));
    expect(host.querySelector<HTMLInputElement>("#wizard-name")?.disabled).toBe(true);
    expect(
      host.querySelector<HTMLButtonElement>('[data-testid="wizard-addon-no-tutorial"]')?.disabled,
    ).toBe(true);
    await submit("#setup-wizard");
    status.busy = false;
    await act(async () => root.render(<SetupWizard {...props} draftName="  " />));
    await submit("#setup-wizard");
    expect(props.onApply).not.toHaveBeenCalled();
    await act(async () => root.render(<SetupWizard {...props} />));
    await submit("#setup-wizard");
    expect(props.onApply).toHaveBeenCalledTimes(1);
  });
});
