import { type FilesAnalysisSnapshot, runFilesAnalysis } from "./files-analysis";

self.onmessage = (event: MessageEvent<FilesAnalysisSnapshot>) => {
  try {
    self.postMessage(runFilesAnalysis(event.data));
  } catch (error) {
    self.postMessage({
      identity: event.data.identity,
      error: error instanceof Error ? error.message : "Analysis failed.",
    });
  }
};
