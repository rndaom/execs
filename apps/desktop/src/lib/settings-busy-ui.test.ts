import { describe, expect, it } from "vitest";
import { SettingsBusyQueue } from "./settings-busy-ui";

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((next) => {
    resolve = next;
  });
  return { promise, resolve };
}

describe("shared settings busy queue", () => {
  it("holds the shared lock through a queued bind-sync reload", async () => {
    const changes: boolean[] = [];
    const firstGate = deferred();
    const syncGate = deferred();
    const queue = new SettingsBusyQueue((busy) => changes.push(busy));

    const first = queue.run(() => firstGate.promise);
    const sync = queue.run(() => syncGate.promise);

    expect(queue.active).toBe(true);
    expect(changes).toEqual([true]);
    firstGate.resolve();
    await first;
    expect(queue.active).toBe(true);
    expect(changes).toEqual([true]);

    syncGate.resolve();
    await sync;
    expect(queue.active).toBe(false);
    expect(changes).toEqual([true, false]);
  });

  it("releases the shared lock when bind sync fails", async () => {
    const changes: boolean[] = [];
    const queue = new SettingsBusyQueue((busy) => changes.push(busy));

    await expect(
      queue.run(async () => {
        throw new Error("write failed");
      }),
    ).rejects.toThrow("write failed");

    expect(queue.active).toBe(false);
    expect(changes).toEqual([true, false]);
  });
});
