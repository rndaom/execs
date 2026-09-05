import { useEffect, useState } from "react";
import type { Api } from "../lib/api";
import { type WriteLockState, watchWriteLock } from "../lib/write-lock-ui";

export type { WriteLockState } from "../lib/write-lock-ui";

export function useWriteLock(api: Api): WriteLockState {
  const [state, setState] = useState<WriteLockState>({
    running: true,
    quitNonce: 0,
    degraded: null,
  });
  useEffect(() => watchWriteLock(api, setState), [api]);
  return state;
}
