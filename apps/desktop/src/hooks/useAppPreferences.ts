import { useCallback, useEffect, useRef, useState } from "react";
import type { Api } from "../lib/api";
import type { AppPreferences, AppSettingsPayload } from "../lib/app-settings-ui";
import { invokeErrorMessage } from "../lib/bridge";

export type AppPreferencesState = {
  data: AppSettingsPayload | null;
  loading: boolean;
  saving: boolean;
  error: string | null;
  save: (patch: Partial<AppPreferences>) => Promise<void>;
  retry: () => Promise<void>;
};

/** Global settings are persisted immediately, independently of the game lock. */
export function useAppPreferences(api: Api): AppPreferencesState {
  const [data, setData] = useState<AppSettingsPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const dataRef = useRef<AppSettingsPayload | null>(null);
  const committed = useRef<AppSettingsPayload | null>(null);
  const pending = useRef<AppPreferences | null>(null);
  const write = useRef<{ generation: number; promise: Promise<void> } | null>(null);
  const generation = useRef(0);

  const load = useCallback(async () => {
    const request = ++generation.current;
    setLoading(true);
    setError(null);
    try {
      const next = await api.getAppSettings();
      if (request !== generation.current) return;
      dataRef.current = next;
      committed.current = next;
      setData(next);
    } catch (err) {
      if (request === generation.current) setError(invokeErrorMessage(err));
    } finally {
      if (request === generation.current) setLoading(false);
    }
  }, [api]);

  useEffect(() => {
    dataRef.current = null;
    committed.current = null;
    pending.current = null;
    write.current = null;
    setSaving(false);
    setData(null);
    void load();
    return () => {
      generation.current += 1;
    };
  }, [load]);

  useEffect(() => {
    if (data?.preferences.motion === "reduce") {
      document.documentElement.dataset.motion = "reduce";
    } else {
      delete document.documentElement.dataset.motion;
    }
    return () => {
      delete document.documentElement.dataset.motion;
    };
  }, [data?.preferences.motion]);

  const save = useCallback(
    async (patch: Partial<AppPreferences>) => {
      const current = dataRef.current;
      if (!current) return;
      const preferences = { ...current.preferences, ...patch };
      pending.current = preferences;
      dataRef.current = { ...current, preferences };
      setData(dataRef.current);
      setError(null);
      if (write.current) return write.current.promise;

      const request = ++generation.current;
      setSaving(true);
      const promise = (async () => {
        try {
          while (pending.current) {
            const attempt = pending.current;
            const next = await api.setAppPreferences(attempt);
            if (request !== generation.current) return;
            committed.current = next;
            if (pending.current === attempt) {
              pending.current = null;
              dataRef.current = next;
              setData(next);
            }
            // A newer edit remains visible and follows this completed write.
          }
        } catch (err) {
          if (request === generation.current) {
            // Keep the exact attempted choice for Retry, but make the controls
            // truthful about what is saved once persistence has failed.
            dataRef.current = committed.current;
            setData(committed.current);
            setError(invokeErrorMessage(err));
          }
          throw err;
        } finally {
          if (write.current?.generation === request) write.current = null;
          if (request === generation.current) setSaving(false);
        }
      })();
      write.current = { generation: request, promise };
      return promise;
    },
    [api],
  );

  const retry = useCallback(async () => {
    if (pending.current) await save(pending.current);
    else await load();
  }, [load, save]);

  return { data, loading, saving, error, save, retry };
}
