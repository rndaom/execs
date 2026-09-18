import { useCallback, useContext, useEffect, useLayoutEffect, useRef, useState } from "react";
import type { Api } from "../lib/api";
import type { HitsoundPick } from "../lib/bridge";
import { AutosaveActivity } from "./useAutosave";

/** Immutable source auditions only. Installed slots are read afresh each time. */
const urls = new Map<string, string>();

function keyOf(pick: HitsoundPick): string {
  return JSON.stringify(pick);
}

/** A picked file is stashed per token; drop its URL when it is replaced. */
export function forgetSoundUrl(pick: HitsoundPick) {
  const key = keyOf(pick);
  const url = urls.get(key);
  if (url) {
    URL.revokeObjectURL(url);
    urls.delete(key);
  }
}

/**
 * Starting the next sound pauses the current one, and the browser rejects the
 * `play()` that was still running. That is the swap working, not a failure —
 * the raw "request was interrupted by a call to pause()" string must never
 * reach the pane.
 */
function isInterrupted(err: unknown): boolean {
  if (err instanceof Error) {
    return err.name === "AbortError" || /interrupt/i.test(err.message);
  }
  return false;
}

export type SoundPlayer = {
  /** Play one pick at a 0–100 volume; a second call stops the first. */
  play: (pick: HitsoundPick, volume: number) => void;
  stop: () => void;
  /** The pick currently sounding, for the button state. */
  playing: string | null;
  /** The last playback failure, for an inline note. */
  error: string | null;
};

/** One audio element for the whole pane, so sounds never overlap. */
export function useSoundPlayer(api: Api, installedIdentity: string): SoundPlayer {
  const active = useContext(AutosaveActivity);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const requestRef = useRef(0);
  const installedUrl = useRef<string | null>(null);
  const [playing, setPlaying] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const audio = new Audio();
    audio.preload = "auto";
    // Only a sound that reached its end clears the button. `pause` also fires
    // when this player swaps a source for the next pick, which would clear the
    // key that was just set.
    const onEnd = () => setPlaying(null);
    audio.addEventListener("ended", onEnd);
    audioRef.current = audio;
    return () => {
      requestRef.current += 1;
      audio.pause();
      if (installedUrl.current) {
        URL.revokeObjectURL(installedUrl.current);
        installedUrl.current = null;
      }
      audio.removeEventListener("ended", onEnd);
      audioRef.current = null;
    };
  }, []);

  const stop = useCallback(() => {
    requestRef.current += 1;
    audioRef.current?.pause();
    if (installedUrl.current) {
      URL.revokeObjectURL(installedUrl.current);
      installedUrl.current = null;
    }
    setPlaying(null);
  }, []);

  // A committed profile/content change invalidates playback before another
  // interaction. The request generation also rejects reads still in flight.
  useLayoutEffect(() => {
    void installedIdentity;
    stop();
    setError(null);
  }, [installedIdentity, stop]);

  useEffect(() => {
    if (!active) {
      stop();
    }
  }, [active, stop]);

  const play = useCallback(
    (pick: HitsoundPick, volume: number) => {
      const audio = audioRef.current;
      if (!audio) {
        return;
      }
      stop();
      const request = ++requestRef.current;
      const key = keyOf(pick);
      setError(null);
      setPlaying(key);
      const readUrl = async () => {
        const cached = pick.kind === "installed" ? undefined : urls.get(key);
        if (cached) return cached;
        const bytes = await api.hitsoundBytes(pick);
        if (request !== requestRef.current) return null;
        const url = URL.createObjectURL(new Blob([bytes], { type: "audio/wav" }));
        if (pick.kind === "installed") {
          installedUrl.current = url;
        } else {
          urls.set(key, url);
        }
        return url;
      };
      void readUrl()
        .then((url) => {
          if (!url || request !== requestRef.current) {
            return;
          }
          audio.pause();
          audio.src = url;
          audio.currentTime = 0;
          audio.volume = Math.min(1, Math.max(0, volume / 100));
          return audio.play().catch((err: unknown) => {
            if (request !== requestRef.current || isInterrupted(err)) {
              return;
            }
            setPlaying(null);
            setError("Could not play that sound.");
          });
        })
        .catch((err) => {
          // Reading the bytes failed: the backend's reason is the useful one.
          if (request !== requestRef.current) {
            return;
          }
          setPlaying(null);
          setError(err instanceof Error ? err.message : "Could not play that sound.");
        });
    },
    [api, stop],
  );

  return { play, stop, playing, error };
}

export function soundKey(pick: HitsoundPick): string {
  return keyOf(pick);
}
