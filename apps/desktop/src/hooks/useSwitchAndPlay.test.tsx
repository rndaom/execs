// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { useSwitchAndPlay } from "./useSwitchAndPlay";

type Inputs = Parameters<typeof useSwitchAndPlay>[0];

let root: Root;
let box: HTMLDivElement;
let start: (id: string) => void;

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

function Harness(inputs: Inputs) {
  start = useSwitchAndPlay(inputs);
  return null;
}

function inputs(patch: Partial<Inputs> = {}): Inputs {
  return {
    request: (run) => void run(),
    switchProfile: vi.fn(async () => {}),
    activeProfileId: "a",
    switching: false,
    launchBlockReason: null,
    launch: vi.fn(),
    onBlocked: vi.fn(),
    ...patch,
  };
}

const render = (next: Inputs) => act(async () => root.render(<Harness {...next} />));

it("launches once the target is in the game and the switch has finished", async () => {
  const first = inputs({ switching: true });
  await render(first);
  await act(async () => start("b"));
  expect(first.switchProfile).toHaveBeenCalledWith("b");
  // Switched, but its progress is still showing.
  await render({ ...first, activeProfileId: "b", switching: true });
  expect(first.launch).not.toHaveBeenCalled();
  await render({ ...first, activeProfileId: "b", switching: false });
  expect(first.launch).toHaveBeenCalledOnce();
  // Nothing is left waiting.
  await render({ ...first, activeProfileId: "c", switching: false });
  await render({ ...first, activeProfileId: "b", switching: false });
  expect(first.launch).toHaveBeenCalledOnce();
});

it("does not launch when another profile is in the game afterwards", async () => {
  const first = inputs();
  await render(first);
  await act(async () => start("b"));
  await render({ ...first, activeProfileId: "a" });
  expect(first.launch).not.toHaveBeenCalled();
  expect(first.onBlocked).not.toHaveBeenCalled();
});

it("does not switch or launch when the request is declined", async () => {
  const first = inputs({ request: vi.fn() });
  await render(first);
  await act(async () => start("b"));
  await render({ ...first, activeProfileId: "b" });
  expect(first.switchProfile).not.toHaveBeenCalled();
  expect(first.launch).not.toHaveBeenCalled();
});

it("says why instead of launching when the game cannot start", async () => {
  const first = inputs({
    launchBlockReason: "Finish preloader recovery in Mods.",
    switching: true,
  });
  await render(first);
  await act(async () => start("b"));
  await render({ ...first, activeProfileId: "b", switching: false });
  expect(first.launch).not.toHaveBeenCalled();
  expect(first.onBlocked).toHaveBeenCalledWith("Finish preloader recovery in Mods.");
});
