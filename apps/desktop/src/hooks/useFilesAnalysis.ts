import { useEffect, useState } from "react";
import {
  analyzeFilesSnapshot,
  type FilesAnalysis,
  type FilesAnalysisSnapshot,
} from "../lib/files-analysis";
export function useFilesAnalysis(snapshot: FilesAnalysisSnapshot, active: boolean) {
  const [state, setState] = useState<{
    analysis?: FilesAnalysis;
    error?: string;
    identity?: string;
  }>({});
  const [retry, setRetry] = useState(0);
  // biome-ignore lint/correctness/useExhaustiveDependencies: retry deliberately restarts the same immutable snapshot.
  useEffect(() => {
    if (!active) return;
    const abort = new AbortController();
    const timer = setTimeout(() => {
      analyzeFilesSnapshot(snapshot, abort.signal)
        .then((analysis) => {
          if (!abort.signal.aborted) setState({ analysis });
        })
        .catch((error: Error) => {
          if (!abort.signal.aborted)
            setState({ error: error.message, identity: snapshot.identity });
        });
    }, 180);
    return () => {
      clearTimeout(timer);
      abort.abort();
    };
  }, [snapshot, active, retry]);
  const current =
    state.analysis?.identity === snapshot.identity ? state.analysis.result : undefined;
  const error = state.identity === snapshot.identity ? state.error : undefined;
  return {
    result: current,
    links: current ? (state.analysis?.links ?? []) : [],
    checking: active && !current && !error,
    error,
    retry: () => {
      setState({});
      setRetry((value) => value + 1);
    },
  };
}
