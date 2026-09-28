// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import type { Api } from "../lib/api";
import type { ModUpdateStatus } from "../lib/bridge";
import { useModManagement } from "./useModManagement";

it("discards an old profile's delayed update results and excludes active copy targets", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const box = document.createElement("div");
  const root = createRoot(box);
  let finishOld!: (value: ModUpdateStatus[]) => void;
  const oldUpdates = new Promise<ModUpdateStatus[]>((resolve) => {
    finishOld = resolve;
  });
  const api = {
    getProfileLibrary: vi.fn(async () => ({
      activeProfileId: "b",
      profiles: [
        { id: "a", name: "A" },
        { id: "b", name: "B" },
        { id: "c", name: "C" },
      ],
    })),
    checkModUpdates: vi
      .fn()
      .mockReturnValueOnce(oldUpdates)
      .mockResolvedValue([{ id: "new", updatedAt: 2, updateAvailable: true, error: null }]),
  } as unknown as Api;
  function Harness({ id }: { id: string }) {
    const state = useModManagement(api, true, id, "revision");
    return <span>{JSON.stringify(state)}</span>;
  }
  try {
    await act(async () => root.render(<Harness id="a" />));
    await act(async () => root.render(<Harness id="b" />));
    await act(async () =>
      finishOld([{ id: "stale", updatedAt: 1, updateAvailable: true, error: null }]),
    );
    expect(box.textContent).toContain('"id":"new"');
    expect(box.textContent).not.toContain('"id":"stale"');
    const state = JSON.parse(box.textContent ?? "{}");
    expect(state.profiles.map((entry: { id: string }) => entry.id)).toEqual(["a", "c"]);
  } finally {
    await act(async () => root.unmount());
    vi.unstubAllGlobals();
  }
});
