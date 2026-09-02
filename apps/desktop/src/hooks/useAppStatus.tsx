import { createContext, type ReactNode, useContext } from "react";
import { canWrite } from "../lib/write-gate";

export type AppStatus = {
  error: string | null;
  setError: (message: string | null) => void;
  /** A profile or settings write is in flight. */
  busy: boolean;
  /** TF2 is running — the whole live surface is read-only. */
  running: boolean;
};

const AppStatusContext = createContext<AppStatus | null>(null);

/**
 * `{error, busy, running}` for every pane: one context and one derivation,
 * rather than a prop threaded App → ReadyPanel → SettingsLayout →
 * SettingsHost → pane and re-derived at each hop.
 */
export function AppStatusProvider({ value, children }: { value: AppStatus; children?: ReactNode }) {
  return <AppStatusContext.Provider value={value}>{children}</AppStatusContext.Provider>;
}

export function useAppStatus(): AppStatus {
  const value = useContext(AppStatusContext);
  if (!value) {
    throw new Error("useAppStatus must be used inside an AppStatusProvider");
  }
  return value;
}

/** The one write gate: no writes while TF2 runs or another write is in flight. */
export function useCanWrite(): boolean {
  const { running, busy } = useAppStatus();
  return canWrite(running, busy);
}
