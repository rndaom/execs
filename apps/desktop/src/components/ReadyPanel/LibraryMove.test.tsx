// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { LibraryMoveReview } from "../../lib/bridge";
import { FinderPanel } from "../FinderPanel";
import { LibraryMove } from "./LibraryMove";

let root: Root;
let box: HTMLDivElement;
const oldRoot = "C:/Program Files (x86)/Steam/steamapps/common/Team Fortress 2";

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

function button(label: string): HTMLButtonElement | undefined {
  return [...box.querySelectorAll("button")].find((node) => node.textContent?.trim() === label);
}

async function renderMove(review: LibraryMoveReview, running = false) {
  const onMove = vi.fn(async () => {});
  const onChangeInstall = vi.fn();
  await act(async () =>
    root.render(
      <LibraryMove
        running={running}
        busy={false}
        onReview={async () => review}
        onMove={onMove}
        onChangeInstall={onChangeInstall}
      />,
    ),
  );
  return { onMove, onChangeInstall };
}

it("offers to move profiles whose TF2 folder is gone", async () => {
  const { onMove } = await renderMove({
    libraryRoot: oldRoot,
    profileCount: 3,
    blockedReason: null,
  });
  expect(box.textContent).toContain("3 profiles were saved for TF2 at");
  expect(box.textContent).toContain(oldRoot);
  await act(async () => button("Move profiles here")?.click());
  expect(onMove).toHaveBeenCalledOnce();
});

it("explains a refused move and keeps Change install", async () => {
  const { onChangeInstall } = await renderMove({
    libraryRoot: oldRoot,
    profileCount: 1,
    blockedReason: `TF2 is still installed at ${oldRoot}.`,
  });
  expect(box.textContent).toContain("1 profile was saved");
  expect(box.textContent).toContain("still installed");
  expect(button("Move profiles here")).toBeUndefined();
  await act(async () => button("Change install")?.click());
  expect(onChangeInstall).toHaveBeenCalledOnce();
});

it("waits for TF2 to close before moving", async () => {
  await renderMove({ libraryRoot: oldRoot, profileCount: 1, blockedReason: null }, true);
  expect(button("Move profiles here")?.disabled).toBe(true);
});

it("names a saved TF2 folder that is missing and offers Retry", async () => {
  const onRetry = vi.fn();
  await act(async () =>
    root.render(
      <FinderPanel
        scanning={false}
        installs={[]}
        selected={null}
        error={null}
        canConfirm={false}
        busy={false}
        onSelect={vi.fn()}
        onBrowse={vi.fn()}
        onConfirm={vi.fn()}
        missing="H:/SteamLibrary/steamapps/common/Team Fortress 2"
        onRetryMissing={onRetry}
      />,
    ),
  );
  expect(box.querySelector('[data-testid="finder-missing"]')?.textContent).toContain(
    "execs can't find TF2 at H:/SteamLibrary/steamapps/common/Team Fortress 2",
  );
  await act(async () => button("Retry")?.click());
  expect(onRetry).toHaveBeenCalledOnce();
});
