import { useCallback, useEffect, useRef, useState } from "react";
import type { Api } from "../lib/api";
import type { HitsoundPick } from "../lib/bridge";

/** Object URLs for auditioned sounds, keyed by pick. Session-long. */
const urls = new Map<string, string>();

function keyOf(pick: HitsoundPick): string {
  return JSON.stringify(pick);
}

async function urlFor(api: Api, pick: HitsoundPick): Promise<string> {
  const key = keyOf(pick);
  const cached = urls.get(key);
  if (cached) {
    return cached;
  }
  const bytes = await api.hitsoundBytes(pick);
  const url = URL.createObjectURL(new Blob([bytes], { type: "audio/wav" }));
  urls.set(key, url);
  return url;
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
export function useSoundPlayer(api: Api): SoundPlayer {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const requestRef = useRef(0);
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
      audio.pause();
      audio.removeEventListener("ended", onEnd);
      audioRef.current = null;
    };
  }, []);

  const stop = useCallback(() => {
    requestRef.current += 1;
    audioRef.current?.pause();
    setPlaying(null);
  }, []);

  const play = useCallback(
    (pick: HitsoundPick, volume: number) => {
      const audio = audioRef.current;
      if (!audio) {
        return;
      }
      const request = ++requestRef.current;
      const key = keyOf(pick);
      setError(null);
      setPlaying(key);
      void urlFor(api, pick)
        .then((url) => {
          if (request !== requestRef.current) {
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
    [api],
  );

  return { play, stop, playing, error };
}

export function soundKey(pick: HitsoundPick): string {
  return keyOf(pick);
}
