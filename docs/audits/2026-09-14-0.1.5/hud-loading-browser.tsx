// Open this HTML through the desktop Vite server's /@fs/ workspace URL.
// The real SettingsHost/HudPane and preview adapter run with controlled read
// results. This harness never invokes Tauri or reads/writes a real profile.
import { useState } from "react";
import { createRoot } from "react-dom/client";
import { ToastProvider } from "../../../apps/desktop/src/components/ui/Toast";
import { AppStatusProvider } from "../../../apps/desktop/src/hooks/useAppStatus";
import { createPreviewApi } from "../../../apps/desktop/src/lib/preview-bridge";
import { SettingsHost } from "../../../apps/desktop/src/SettingsHost";
import "../../../apps/desktop/src/index.css";

const scenario = new URLSearchParams(location.search).get("case") ?? "cold";
const base = createPreviewApi("settings-hud-installed");
let recovered = false;
const api = {
  ...base,
  async getHudCatalog() {
    if (scenario === "cold" && !recovered)
      throw new Error("The catalog source is offline (fixture).");
    const value = await base.getHudCatalog();
    return {
      entries: value.entries.map((entry) => ({
        ...entry,
        banner: null,
        screenshots: [],
        album: null,
      })),
      warning:
        scenario === "partial" && !recovered
          ? "The catalog is incomplete: 1 HUD document could not be refreshed. Available cached entries are still shown."
          : null,
    };
  },
  async getHudState() {
    return { ...(await base.getHudState()), catalogUnavailable: !recovered };
  },
  async getHudStats() {
    return {
      ...(await base.getHudStats()),
      warning: !recovered
        ? "Download and view counts from tf2huds.dev could not be refreshed."
        : null,
    };
  },
  async getHudSchema(profile: string, hud: string) {
    if (scenario === "schema" && !recovered)
      throw new Error("The options source is offline (fixture).");
    return base.getHudSchema(profile, hud);
  },
};
function Check() {
  const [ready, setReady] = useState(false);
  return (
    <main className="text-ink" style={{ maxWidth: 1120, padding: 32, margin: "0 auto" }}>
      <div className="mb-6 border-b border-edge pb-4">
        <p className="eyebrow">Isolated HUD loading check · fixture data · no native IPC</p>
        <button
          type="button"
          className="btn btn-ghost mt-3"
          disabled={ready}
          onClick={() => {
            recovered = true;
            setReady(true);
          }}
        >
          Restore fixture sources
        </button>
      </div>
      <AppStatusProvider value={{ error: null, setError: () => {}, busy: false, running: false }}>
        <ToastProvider>
          <SettingsHost
            api={api}
            tab="hud"
            running={false}
            externalBusy={false}
            refreshKey={1}
            bindSyncRequest={null}
            onBindSyncHandled={() => {}}
            onBusyChange={() => {}}
            onError={() => {}}
          />
        </ToastProvider>
      </AppStatusProvider>
    </main>
  );
}
const root = document.getElementById("root");
if (!root) throw new Error("Missing check root");
createRoot(root).render(<Check />);
