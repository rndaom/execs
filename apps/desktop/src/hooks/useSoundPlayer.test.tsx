// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Api } from "../lib/api";
import { type SoundPlayer, useSoundPlayer } from "./useSoundPlayer";

let root: Root;
let player: SoundPlayer;
let audio: { src: string; pause: ReturnType<typeof vi.fn>; play: ReturnType<typeof vi.fn> };
const read = vi.fn<() => Promise<Uint8Array<ArrayBuffer>>>();
const create = vi.fn();
const revoke = vi.fn();
const api = { hitsoundBytes: read } as unknown as Api;
const pick = { kind: "installed", slot: "hit" } as const;

function Harness({ identity }: { identity: string }) {
  player = useSoundPlayer(api, identity);
  return null;
}
async function render(identity: string) {
  await act(async () => root.render(<Harness identity={identity} />));
}
async function play() {
  await act(async () => player.play(pick, 75));
}
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal(
    "Audio",
    class {
      src = "";
      pause = vi.fn();
      play = vi.fn(async () => {});
      addEventListener = vi.fn();
      removeEventListener = vi.fn();
      constructor() {
        audio = this;
      }
    },
  );
  create.mockReset().mockImplementation(() => `blob:${create.mock.calls.length}`);
  revoke.mockReset();
  vi.stubGlobal("URL", { createObjectURL: create, revokeObjectURL: revoke });
  read.mockReset().mockResolvedValue(new Uint8Array([1]));
  root = createRoot(document.createElement("div"));
});
afterEach(async () => {
  await act(async () => root.unmount());
  vi.unstubAllGlobals();
});

describe("installed sound auditions", () => {
  it("stops and revokes A before reading B, even for the same slot", async () => {
    await render("A");
    await play();
    expect(audio.src).toBe("blob:1");
    await render("B");
    expect(player.playing).toBeNull();
    expect(audio.pause).toHaveBeenCalled();
    expect(revoke).toHaveBeenCalledWith("blob:1");
    await play();
    expect(read).toHaveBeenCalledTimes(2);
    expect(audio.src).toBe("blob:2");
  });

  it.each(["replacement", "boost 6", "removed", "reinstalled"])(
    "invalidates %s and rereads the slot",
    async (change) => {
      await render("A:original");
      await play();
      await render(`A:${change}`);
      expect(revoke).toHaveBeenCalledWith("blob:1");
      await play();
      expect(read).toHaveBeenCalledTimes(2);
      expect(audio.src).toBe("blob:2");
    },
  );

  it("rereads bytes even when a replacement retains the same record", async () => {
    await render("A:original");
    await play();
    await play();
    expect(read).toHaveBeenCalledTimes(2);
    expect(revoke).toHaveBeenCalledWith("blob:1");
  });

  it("ignores an old response arriving after the new profile starts playing", async () => {
    let finish!: (bytes: Uint8Array<ArrayBuffer>) => void;
    read.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    await render("A");
    await play();
    await render("B");
    await play();
    await act(async () => finish(new Uint8Array([9])));
    expect(create).toHaveBeenCalledTimes(1);
    expect(audio.src).toBe("blob:1");
    expect(audio.play).toHaveBeenCalledTimes(1);
  });

  it("does not allocate an object URL after unmount", async () => {
    let finish!: (bytes: Uint8Array<ArrayBuffer>) => void;
    read.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    await render("A");
    await play();
    await act(async () => root.unmount());
    await act(async () => finish(new Uint8Array([9])));
    expect(create).not.toHaveBeenCalled();
  });
});
