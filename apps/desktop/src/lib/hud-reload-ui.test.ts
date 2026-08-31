import { describe, expect, it } from "vitest";
import { HudReloadQueue } from "./hud-reload-ui";

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((next) => {
    resolve = next;
  });
  return { promise, resolve };
}

describe("HUD reload queue", () => {
  it("runs a later cached reload only after an explicit refresh finishes", async () => {
    const queue = new HudReloadQueue();
    const refreshGate = deferred();
    const events: string[] = [];

    const refresh = queue.enqueue(async () => {
      events.push("refresh:start");
      await refreshGate.promise;
      events.push("refresh:finish");
    });
    const cached = queue.enqueue(async () => {
      events.push("cached:start");
    });

    await Promise.resolve();
    expect(events).toEqual(["refresh:start"]);

    refreshGate.resolve();
    await Promise.all([refresh, cached]);
    expect(events).toEqual(["refresh:start", "refresh:finish", "cached:start"]);
  });

  it("continues with the newest request after an earlier reload fails", async () => {
    const queue = new HudReloadQueue();
    const events: string[] = [];

    const failed = queue.enqueue(async () => {
      events.push("failed");
      throw new Error("offline");
    });
    const recovered = queue.enqueue(async () => {
      events.push("recovered");
      return "cached";
    });

    await expect(failed).rejects.toThrow("offline");
    await expect(recovered).resolves.toBe("cached");
    expect(events).toEqual(["failed", "recovered"]);
  });
});
