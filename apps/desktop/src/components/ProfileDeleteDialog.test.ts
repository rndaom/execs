// @vitest-environment jsdom
import { act, type ComponentProps, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { previewSavedLibrary, previewSavedProfile } from "../lib/library-ui";
import { ProfileDeleteDialog } from "./ProfileDeleteDialog";

let root: Root;
let box: HTMLDivElement;
let props: ComponentProps<typeof ProfileDeleteDialog>;

async function render() {
  await act(async () => root.render(createElement(ProfileDeleteDialog, props)));
}

function button(label: string) {
  const result = [...box.querySelectorAll("button")].find(
    (node) => node.textContent?.trim() === label,
  );
  if (!result) throw new Error(`Missing button: ${label}`);
  return result;
}

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  box = document.createElement("div");
  document.body.append(box);
  root = createRoot(box);
  const library = previewSavedLibrary("C:/TF2", "Main");
  const trial = previewSavedProfile("Experiments", 2);
  library.profiles.push(trial);
  props = {
    profiles: {
      library,
      deleteTarget: trial,
      deleting: false,
      deleteError: null,
      confirmDelete: vi.fn(async () => {}),
      cancelDelete: vi.fn(),
      exportProfile: vi.fn(async () => {}),
    },
    running: false,
    busy: false,
  };
});

afterEach(async () => {
  await act(async () => root.unmount());
  box.remove();
  vi.unstubAllGlobals();
});

it("names the profile, distinguishes library from TF2, and initially focuses Cancel", async () => {
  await render();
  expect(box.textContent).toContain("Delete Experiments?");
  expect(box.textContent).toContain(
    "Your installed TF2 setup and other saved profiles stay in place",
  );
  expect(document.activeElement).toBe(button("Cancel"));
  await act(async () => button("Cancel").click());
  expect(props.profiles.cancelDelete).toHaveBeenCalledOnce();
  expect(props.profiles.confirmDelete).not.toHaveBeenCalled();
});

it("offers export without treating it as deletion consent", async () => {
  await render();
  await act(async () => button("Export profile first").click());
  expect(props.profiles.exportProfile).toHaveBeenCalledWith("preview-2");
  expect(props.profiles.confirmDelete).not.toHaveBeenCalled();
});

it("requires an explicit installed-files choice for the active and last profile", async () => {
  const library = previewSavedLibrary("C:/TF2", "Main");
  props.profiles.library = library;
  props.profiles.deleteTarget = library.profiles[0];
  await render();
  expect(button("Delete profile").disabled).toBe(true);
  expect(box.textContent).not.toContain("Switch to another profile first");
  await act(async () => box.querySelector<HTMLLabelElement>('label[for="delete-keep"]')?.click());
  expect(button("Delete profile").disabled).toBe(false);
  await act(async () => button("Delete profile").click());
  expect(props.profiles.confirmDelete).toHaveBeenCalledWith(true, undefined);
});

it("requires a named replacement before switch-and-delete", async () => {
  props.profiles.deleteTarget = props.profiles.library?.profiles[0] ?? null;
  await render();
  await act(async () => box.querySelector<HTMLLabelElement>('label[for="delete-switch"]')?.click());
  expect(button("Switch and delete profile").disabled).toBe(true);
  await act(async () => button("Experiments").click());
  expect(button("Switch and delete profile").disabled).toBe(false);
  await act(async () => button("Switch and delete profile").click());
  expect(props.profiles.confirmDelete).toHaveBeenCalledWith(false, "preview-2");
});

it("keeps Cancel available while TF2 runs and prevents closing a deletion in flight", async () => {
  props.running = true;
  await render();
  expect(button("Delete profile").disabled).toBe(true);
  expect(button("Cancel").disabled).toBe(false);
  expect(box.textContent).toContain("Close TF2");
  props.running = false;
  props.profiles.deleting = true;
  await render();
  expect(button("Cancel").disabled).toBe(true);
  await act(async () =>
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })),
  );
  expect(props.profiles.cancelDelete).not.toHaveBeenCalled();
});
