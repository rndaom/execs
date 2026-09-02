import { useEffect, useState } from "react";
import type { Api } from "../lib/api";

/**
 * Object URLs for CompVMInstaller's preview screenshots, keyed by upstream
 * stem. Module-level so a picture fetched once stays warm for the rest of the
 * session (the backend caches the bytes on disk; this caches the decode).
 */
const urls = new Map<string, string>();
const pending = new Map<string, Promise<string | null>>();

async function load(api: Api, stem: string): Promise<string | null> {
  const cached = urls.get(stem);
  if (cached) {
    return cached;
  }
  const inFlight = pending.get(stem);
  if (inFlight) {
    return inFlight;
  }
  const promise = api
    .viewmodelPreviewImage(stem)
    .then((bytes) => {
      const url = URL.createObjectURL(new Blob([bytes], { type: "image/jpeg" }));
      urls.set(stem, url);
      return url;
    })
    .catch(() => null)
    .finally(() => {
      pending.delete(stem);
    });
  pending.set(stem, promise);
  return promise;
}

/** Warm the cache for a set of stems (a class's whole guide on tab change). */
export function prefetchViewmodelPreviews(api: Api, stems: string[]) {
  for (const stem of stems) {
    void load(api, stem);
  }
}

export type ViewmodelPreviewState = {
  /** An object URL once the picture is available, otherwise null. */
  src: string | null;
  /** True while the first fetch for this stem is still running. */
  loading: boolean;
  /** True once the fetch settled without a picture. */
  failed: boolean;
};

/** The picture for one stem, resolving from the cache without a flash. */
export function useViewmodelPreview(api: Api, stem: string | null): ViewmodelPreviewState {
  const [state, setState] = useState<ViewmodelPreviewState>(() => ({
    src: stem ? (urls.get(stem) ?? null) : null,
    loading: stem !== null && !urls.has(stem),
    failed: false,
  }));

  useEffect(() => {
    if (!stem) {
      setState({ src: null, loading: false, failed: false });
      return;
    }
    const cached = urls.get(stem);
    if (cached) {
      setState({ src: cached, loading: false, failed: false });
      return;
    }
    let cancelled = false;
    // Keep the previous picture on screen while the next one loads: a blank
    // stage between two hovers reads as flicker.
    setState((current) => ({ ...current, loading: true, failed: false }));
    void load(api, stem).then((url) => {
      if (!cancelled) {
        setState({ src: url, loading: false, failed: url === null });
      }
    });
    return () => {
      cancelled = true;
    };
  }, [api, stem]);

  return state;
}
