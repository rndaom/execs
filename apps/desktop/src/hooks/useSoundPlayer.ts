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
    const onEnd = () => setPlaying(null);
    audio.addEventListener("ended", onEnd);
    audio.addEventListener("pause", onEnd);
    audioRef.current = audio;
    return () => {
      audio.pause();
      audio.removeEventListener("ended", onEnd);
      audio.removeEventListener("pause", onEnd);
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
          return audio.play();
        })
        .catch((err) => {
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
