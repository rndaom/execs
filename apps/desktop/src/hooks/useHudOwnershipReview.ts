import { useCallback, useEffect, useRef, useState } from "react";
import type { Api } from "../lib/api";
import {
  BridgeError,
  type HudOwnershipReview,
  invokeErrorMessage,
  type ProfileDetail,
} from "../lib/bridge";

/** A review belongs to one exact profile and its native fingerprint. */
export function useHudOwnershipReview(
  api: Api,
  profileId: string,
  { running, busy }: { running: boolean; busy: boolean },
) {
  const [loaded, setLoaded] = useState<HudOwnershipReview | null>(null);
  const [selectedFolder, setSelectedFolder] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [applying, setApplying] = useState(false);
  const [applied, setApplied] = useState<ProfileDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const generation = useRef(0);
  const writing = useRef(false);
  const latest = useRef({ profileId, running, busy });
  latest.current = { profileId, running, busy };
  const review = loaded?.profileId === profileId ? loaded : null;

  const reload = useCallback(async () => {
    if (writing.current) return;
    const request = ++generation.current;
    setLoading(true);
    setLoaded(null);
    setSelectedFolder(null);
    setApplied(null);
    setError(null);
    try {
      const next = await api.getHudOwnership(profileId);
      if (request !== generation.current || latest.current.profileId !== profileId) return;
      if (next.profileId !== profileId) {
        throw new BridgeError("The profile changed. Read its HUD folders again.", "ProfileChanged");
      }
      setLoaded(next);
    } catch (err) {
      if (request === generation.current) setError(invokeErrorMessage(err));
    } finally {
      if (request === generation.current) setLoading(false);
    }
  }, [api, profileId]);

  useEffect(() => {
    void reload();
    return () => {
      generation.current += 1;
    };
  }, [reload]);

  const select = useCallback(
    (folder: string) => {
      if (
        writing.current ||
        applied ||
        !review?.candidates.some((candidate) => candidate.folder === folder)
      )
        return;
      setSelectedFolder(folder);
    },
    [applied, review],
  );

  const canApply = Boolean(
    review &&
      !loading &&
      !applying &&
      !applied &&
      !running &&
      !busy &&
      selectedFolder &&
      review.candidates.some((candidate) => candidate.folder === selectedFolder),
  );

  const apply = useCallback(async (): Promise<ProfileDetail | null> => {
    if (
      writing.current ||
      latest.current.running ||
      latest.current.busy ||
      latest.current.profileId !== profileId ||
      !review ||
      loading ||
      !selectedFolder ||
      applied ||
      !review.candidates.some((candidate) => candidate.folder === selectedFolder)
    )
      return null;
    const request = generation.current;
    writing.current = true;
    setApplying(true);
    setError(null);
    try {
      const detail = await api.selectProfileHud(profileId, selectedFolder, review.fingerprint);
      if (request !== generation.current || latest.current.profileId !== profileId) return null;
      if (detail.id !== profileId) {
        throw new BridgeError("The profile changed. Read its HUD folders again.", "ProfileChanged");
      }
      setApplied(detail);
      return detail;
    } catch (err) {
      if (request === generation.current) {
        // Even a partial/failed operation must be reviewed afresh. A stale
        // selected folder must never be resubmitted with an old fingerprint.
        setLoaded(null);
        setSelectedFolder(null);
        setError(invokeErrorMessage(err));
      }
      throw err;
    } finally {
      writing.current = false;
      if (request === generation.current) setApplying(false);
    }
  }, [api, applied, loading, profileId, review, selectedFolder]);

  return {
    review,
    selectedFolder,
    loading,
    applying,
    applied,
    error,
    canApply,
    select,
    reload,
    apply,
  };
}
