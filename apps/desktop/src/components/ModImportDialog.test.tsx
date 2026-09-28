// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { ModImportReview } from "../lib/bridge";
import { ModImportDialog, modChoiceDescription } from "./ModImportDialog";

const choice = (overrides: Partial<ModImportReview["choices"][number]>) => ({
  id: "0",
  name: "Gory Gibbing",
  path: ".",
  files: 3,
  bytes: 48 * 1024,
  contentRoots: ["particles"],
  disabledReason: null,
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
