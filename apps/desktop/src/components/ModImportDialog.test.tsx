// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { ModImportReview } from "../lib/bridge";
import { ModImportDialog, modChoiceDescription, modChoiceSoundNote } from "./ModImportDialog";

const choice = (
  overrides: Partial<ModImportReview["choices"][number]>,
): ModImportReview["choices"][number] => ({
  id: "0",
  name: "Gory Gibbing",
  path: ".",
  files: 3,
  bytes: 48 * 1024,
  contentRoots: ["particles"],
  disabledReason: null,
  soundSlots: [],
  ...overrides,
});

let root: Root;
let box: HTMLDivElement;
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  box = document.createElement("div");
  document.body.append(box);
  root = createRoot(box);
});
afterEach(async () => {
  await act(async () => root.unmount());
  box.remove();
  vi.unstubAllGlobals();
});

it("labels packs by name and shows small sizes in KB", () => {
  expect(modChoiceDescription(choice({}))).toBe("3 files · 48 KB · particles");
  expect(
    modChoiceDescription(choice({ name: "hd", path: "variants/hd.vpk", bytes: 3 * 1024 ** 2 })),
  ).toBe("variants/hd.vpk · 3 files · 3.0 MB · particles");
});

it("never labels the archive's top level as a dot", async () => {
  await act(async () =>
    root.render(
      <ModImportDialog
        review={{
          token: "t",
          readmes: [],
          choices: [choice({}), choice({ id: "1", name: "blue", path: "blue" })],
        }}
        onClose={vi.fn()}
        onConfirm={vi.fn()}
      />,
    ),
  );
  const labels = [...document.body.querySelectorAll(".t-row")].map((label) => label.textContent);
  expect(labels).toEqual(["Gory Gibbing", "blue"]);
});

it("flags a pack that replaces TF2's hit or kill sound and does not choose it for the player", async () => {
  expect(modChoiceSoundNote(choice({}))).toBeNull();
  expect(modChoiceSoundNote(choice({ soundSlots: ["kill"] }))).toContain("TF2's kill sound");
  expect(modChoiceSoundNote(choice({ soundSlots: ["hit", "kill"] }))).toContain(
    "hit and kill sounds",
  );
  const onConfirm = vi.fn();
  await act(async () =>
    root.render(
      <ModImportDialog
        review={{
          token: "t",
          readmes: [],
          choices: [choice({ name: "Sound pack", soundSlots: ["hit"] })],
        }}
        onClose={vi.fn()}
        onConfirm={onConfirm}
      />,
    ),
  );
  expect(document.body.textContent).toContain("can override what you chose in Sounds");
  const install = [...document.body.querySelectorAll("button")].find(
    (button) => button.textContent === "Install selected",
  );
  expect(install?.disabled).toBe(true);
});
