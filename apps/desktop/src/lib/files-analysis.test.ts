import { afterEach, describe, expect, it, vi } from "vitest";
import {
  analyzeFilesSnapshot,
  type FilesAnalysisSnapshot,
  runFilesAnalysis,
  validateAnalysisSnapshot,
} from "./files-analysis";

const snapshot: FilesAnalysisSnapshot = {
  profile: "a",
  identity: "a:1",
  files: [{ path: "tf/cfg/autoexec.cfg", text: "fov_desired 90\n" }],
};
class TestWorker {
  static instances: TestWorker[] = [];
  onmessage?: (event: { data: unknown }) => void;
  onerror?: () => void;
  terminate = vi.fn();
  postMessage = vi.fn();
  constructor() {
    TestWorker.instances.push(this);
  }
}
afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
  TestWorker.instances = [];
});
describe("revision-bound Files workers", () => {
  it("returns exact source identity and real findings from bounded worker execution", () => {
    const result = runFilesAnalysis(snapshot);
    expect(result.identity).toBe("a:1");
    expect(result.result.safetyComplete).toBe(true);
  });
  it("fails closed on unavailable workers, crashes and stale replies", async () => {
    vi.stubGlobal("Worker", undefined);
    await expect(analyzeFilesSnapshot(snapshot)).rejects.toThrow("could not start");
    vi.stubGlobal("Worker", TestWorker);
    const crash = analyzeFilesSnapshot(snapshot);
    TestWorker.instances[0].onerror?.();
    await expect(crash).rejects.toThrow("failed");
    const stale = analyzeFilesSnapshot(snapshot);
    TestWorker.instances[1].onmessage?.({
      data: { ...runFilesAnalysis(snapshot), identity: "a:0" },
    });
    await expect(stale).rejects.toThrow("obsolete");
    expect(TestWorker.instances.every((worker) => worker.terminate.mock.calls.length === 1)).toBe(
      true,
    );
  });
  it("terminates obsolete analysis and rejects timeout instead of accepting success", async () => {
    vi.useFakeTimers();
    vi.stubGlobal("Worker", TestWorker);
    const abort = new AbortController();
    const pending = analyzeFilesSnapshot(snapshot, abort.signal);
    abort.abort();
    await expect(pending).rejects.toThrow("cancelled");
    const timed = analyzeFilesSnapshot(snapshot);
    const expected = expect(timed).rejects.toThrow("timed out");
    await vi.advanceTimersByTimeAsync(10000);
    await expected;
    expect(TestWorker.instances.every((worker) => worker.terminate.mock.calls.length === 1)).toBe(
      true,
    );
  });
  it("rejects oversize transfer envelopes before creating a worker", async () => {
    vi.stubGlobal("Worker", TestWorker);
    await expect(
      analyzeFilesSnapshot({
        ...snapshot,
        files: Array.from({ length: 257 }, () => snapshot.files[0]),
      }),
    ).rejects.toThrow("limits");
    await expect(
      analyzeFilesSnapshot({ ...snapshot, files: [{ path: "a.cfg", text: "x".repeat(1048577) }] }),
    ).rejects.toThrow("limits");
    expect(TestWorker.instances).toHaveLength(0);
  });
  it("enforces UTF8 byte ceilings inside the worker even when UTF16 envelope fits", () => {
    expect(() =>
      validateAnalysisSnapshot({
        ...snapshot,
        files: [{ path: "a.cfg", text: "界".repeat(400000) }],
      }),
    ).toThrow("MiB");
    expect(() =>
      validateAnalysisSnapshot({
        ...snapshot,
        files: Array.from({ length: 9 }, (_, i) => ({
          path: `${i}.cfg`,
          text: "x".repeat(1048576),
        })),
      }),
    ).toThrow("MiB");
  });
});
