import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import { resolveApi } from "./lib/api";
import { type PreviewState, previewStateFromSearch } from "./lib/preview";
import "./index.css";

const root = document.getElementById("root");
if (!root) {
  throw new Error("root element missing");
}

const preview: PreviewState =
  (typeof window === "undefined" ? null : previewStateFromSearch(window.location.search)) ??
  "empty";

// One adapter choice for the whole app: real IPC, or the `?preview=` fixtures.
// Every screen below talks to `api` and never re-checks `isTauri()`.
resolveApi(preview).then((api) => {
  createRoot(root).render(
    <StrictMode>
      <App api={api} preview={preview} />
    </StrictMode>,
  );
});
