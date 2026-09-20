import {
  addEditorTextToBudget,
  FILES_EDITOR_MAX_FILE_BYTES,
  FILES_EDITOR_MAX_FILES,
  FILES_EDITOR_MAX_TOTAL_BYTES,
} from "./files-limits";
import { cfgSourceLinks } from "./files-reference";
import { type LintBundleResult, lintBundle } from "./files-ui";

export type FilesAnalysisSnapshot = {
  profile: string | null;
  files: { path: string; text: string }[];
  hudId?: string | null;
  identity: string;
};
export type FilesAnalysis = {
  identity: string;
  result: LintBundleResult;
  links: ReturnType<typeof cfgSourceLinks>;
};
export function validateAnalysisSnapshot(snapshot: FilesAnalysisSnapshot) {
  if (snapshot.files.length > FILES_EDITOR_MAX_FILES)
    throw Error("Analysis exceeds the 256-file limit.");
  let total = 0;
  for (const file of snapshot.files) {
    const next = addEditorTextToBudget(total, file.text);
    if (next === null) throw Error("Analysis exceeds the 1 MiB per-file or 8 MiB total limit.");
    total = next;
  }
}
/** One worker per settled snapshot: termination cancels queued and executing analysis. */
export function analyzeFilesSnapshot(
  snapshot: FilesAnalysisSnapshot,
  signal?: AbortSignal,
): Promise<FilesAnalysis> {
  return new Promise((resolve, reject) => {
    // A cheap UTF-16 envelope bounds transfer without rescanning every scalar on
    // the UI thread. The worker enforces the stricter UTF-8 byte ceilings.
    if (
      snapshot.files.length > FILES_EDITOR_MAX_FILES ||
      snapshot.files.some((file) => file.text.length > FILES_EDITOR_MAX_FILE_BYTES) ||
      snapshot.files.reduce((total, file) => total + file.text.length, 0) >
        FILES_EDITOR_MAX_TOTAL_BYTES
    ) {
      reject(Error("Analysis exceeds the bounded cfg inventory limits."));
      return;
    }
    if (signal?.aborted) {
      reject(Error("Analysis cancelled."));
      return;
    }
    let worker: Worker;
    try {
      worker = new Worker(new URL("./files-analysis.worker.ts", import.meta.url), {
        type: "module",
      });
    } catch {
      reject(Error("Background analysis could not start. Retry before saving."));
      return;
    }
    const finish = (error?: Error, result?: FilesAnalysis) => {
      clearTimeout(timeout);
      signal?.removeEventListener("abort", abort);
      worker.terminate();
      if (error) reject(error);
      else if (result) resolve(result);
    };
    const abort = () => finish(Error("Analysis cancelled."));
    const timeout = setTimeout(
      () => finish(Error("Analysis timed out. Reduce the cfg or retry before saving.")),
      10000,
    );
    signal?.addEventListener("abort", abort, { once: true });
    worker.onerror = () => finish(Error("Background analysis failed. Retry before saving."));
    worker.onmessage = (event: MessageEvent<Partial<FilesAnalysis> & { error?: string }>) => {
      if (event.data.identity !== snapshot.identity) {
        finish(Error("Analysis returned an obsolete snapshot."));
        return;
      }
      if (event.data.error) finish(Error(event.data.error));
      else if (event.data.result)
        finish(undefined, {
          identity: snapshot.identity,
          result: event.data.result,
          links: event.data.links ?? [],
        });
      else finish(Error("Analysis returned no result."));
    };
    worker.postMessage(snapshot);
  });
}
/** Worker entry and deterministic test entry share the same bounded operation. */
export function runFilesAnalysis(snapshot: FilesAnalysisSnapshot): FilesAnalysis {
  validateAnalysisSnapshot(snapshot);
  return {
    identity: snapshot.identity,
    result: lintBundle(snapshot.files, snapshot.hudId),
    links: cfgSourceLinks(snapshot.files),
  };
}
