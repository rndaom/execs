import { useCallback, useState } from "react";

export type OperationError = { source: string; message: string };
export type SetOperationError = (message: string | null, source?: string) => void;

/** Clearing an operation can never clear a failure reported by another source. */
export function useOperationErrors() {
  const [errors, setErrors] = useState<OperationError[]>([]);
  const current = errors.at(-1) ?? null;
  const setError = useCallback<SetOperationError>((message, source = "app") => {
    setErrors((previous) => {
      const retained = previous.filter((error) => error.source !== source);
      if (message === null) return retained.length === previous.length ? previous : retained;
      return [...retained, { source, message }];
    });
  }, []);
  const dismissError = useCallback(() => {
    // Capture the displayed object: a click cannot dismiss a newer failure
    // from the same source that arrived before React applied this update.
    setErrors((previous) => previous.filter((error) => error !== current));
  }, [current]);
  return { error: current?.message ?? null, setError, dismissError };
}
