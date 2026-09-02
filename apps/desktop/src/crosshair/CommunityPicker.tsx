import { ArrowSquareOut, MagnifyingGlass, X } from "@phosphor-icons/react";
import { useEffect, useState } from "react";
import { Alert } from "../components/ui/Alert";
import { Modal } from "../components/ui/Modal";
import {
  fetchCommunityCrosshair,
  fetchCommunityCrosshairPreviews,
  openExternal,
  type StockCrosshairSprite,
} from "../lib/bridge";
import {
  COMMUNITY_CROSSHAIR_CREDIT,
  COMMUNITY_CROSSHAIRS,
  type CommunityCrosshairEntry,
  communityLibraryName,
  searchCommunityCrosshairs,
} from "../lib/community-crosshairs";
import type { CrosshairColor, CrosshairLibraryEntry } from "../lib/crosshair-ui";
import { CrosshairThumb } from "./CrosshairThumb";
import type { PreviewPixels } from "./useCrosshairDraft";

/**
 * Thumbnails for the whole pack, decoded once per session. The pack is ~1.7
 * MiB of 64×64 VTFs, fetched in parallel and cached on disk by the backend,
 * so the second open is instant and the first is a couple of seconds.
 */
let previewCache: Record<string, StockCrosshairSprite> | null = null;
let previewRequest: Promise<Record<string, StockCrosshairSprite>> | null = null;

function loadPreviews(): Promise<Record<string, StockCrosshairSprite>> {
  if (previewCache) {
    return Promise.resolve(previewCache);
  }
  if (!previewRequest) {
    previewRequest = fetchCommunityCrosshairPreviews(
      COMMUNITY_CROSSHAIRS.map((entry) => entry.file),
    )
      .then((previews) => {
        previewCache = previews;
        return previews;
      })
      .finally(() => {
        previewRequest = null;
      });
  }
  return previewRequest;
}

/**
 * Browse the pinned Venom Crosshairs list and download one into the library.
 * Every entry shows as a picture, tinted with the pane's colour, so you pick
 * by looking rather than by guessing from a file name.
 */
export function CommunityPicker({
  open,
  existing,
  color,
  onAdd,
  onClose,
}: {
  open: boolean;
  /** The builder's library, so an entry already added reads as added. */
  existing: Record<string, CrosshairLibraryEntry>;
  color: CrosshairColor | null;
  onAdd: (id: string, preview: PreviewPixels, bytes: number[]) => void;
  onClose: () => void;
}) {
  const [query, setQuery] = useState("");
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [previews, setPreviews] = useState<Record<string, StockCrosshairSprite> | null>(
    previewCache,
  );
  const [previewsFailed, setPreviewsFailed] = useState(false);
  const matches = searchCommunityCrosshairs(query);

  useEffect(() => {
    let cancelled = false;
    loadPreviews()
      .then((next) => {
        if (!cancelled) {
          setPreviews(next);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setPreviewsFailed(true);
        }
      });
    return () => {
      cancelled = true;
    };
  }, []);

  async function pick(entry: CommunityCrosshairEntry) {
    if (busyId) {
      return;
    }
    setBusyId(entry.id);
    setError(null);
    try {
      const fetched = await fetchCommunityCrosshair(entry.file);
      onAdd(entry.id, { width: fetched.width, height: fetched.height, rgba: fetched.rgba }, [
        ...fetched.bytes,
      ]);
      // Closing unmounts this component, so nothing after it may touch state.
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not download that crosshair.");
      setBusyId(null);
    }
  }

  const loading = previews === null && !previewsFailed;

  return (
    <Modal
      open={open}
      testId="crosshair-community-picker"
      title="Community crosshairs"
      description="The Venom Crosshairs pack — pick one and it downloads into your library."
      className="fixed inset-4 z-50 flex flex-col sm:inset-x-[max(1rem,calc(50vw-28rem))] sm:inset-y-8"
      onClose={onClose}
    >
      <button
        type="button"
        data-testid="crosshair-picker-close"
        onClick={onClose}
        aria-label="Close community crosshairs"
        className="btn btn-ghost absolute top-3 right-3 p-2"
      >
        <X size={16} />
      </button>

      <div className="mt-3 flex items-center gap-3">
        <label className="relative block flex-1">
          <span className="sr-only">Search community crosshairs</span>
          <MagnifyingGlass
            size={14}
            className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-ink-faint"
          />
          <input
            type="search"
            data-testid="crosshair-picker-search"
            value={query}
            onChange={(event) => {
              setQuery(event.target.value);
              // A failure belongs to the query that produced it; leaving it up
              // over unrelated results reads as "these are broken too".
              setError(null);
            }}
            placeholder="Search crosshairs…"
            className="field w-full py-2 pr-3 pl-8 text-[13px] text-ink placeholder:text-ink-faint focus:outline-none"
          />
        </label>
        <span className="tnum t-meta shrink-0" aria-live="polite">
          {loading
            ? "Loading previews…"
            : previewsFailed
              ? "Previews unavailable"
              : `${matches.length} of ${COMMUNITY_CROSSHAIRS.length}`}
        </span>
      </div>

      {error ? (
        <Alert tone="error" className="mt-2 px-3 py-2 text-[13px]">
          {error}
        </Alert>
      ) : null}

      <div className="mt-3 min-h-0 flex-1 overflow-y-auto pr-1">
        <div className="grid grid-cols-3 gap-2 sm:grid-cols-5 md:grid-cols-6 lg:grid-cols-7">
          {matches.map((entry) => {
            // Legacy libraries may still hold the bare stem; treat both as added.
            const added = communityLibraryName(entry.id) in existing || entry.id in existing;
            const sprite = previews?.[entry.file] ?? null;
            const fetching = busyId === entry.id;
            return (
              <button
                key={entry.id}
                type="button"
                data-testid={`crosshair-community-${entry.id}`}
                disabled={busyId !== null || added}
                onClick={() => void pick(entry)}
                title={entry.file}
                className={`thumb ${added ? "thumb-selected" : ""} ${
                  busyId !== null && !fetching ? "thumb-disabled" : ""
                }`}
              >
                <CrosshairThumb
                  shape={entry.id}
                  color={color}
                  preview={
                    sprite
                      ? { width: sprite.width, height: sprite.height, rgba: sprite.rgba }
                      : null
                  }
                  size={48}
                  className={sprite ? "enter-fade" : ""}
                />
                <span className="thumb-label">
                  {added ? "Added" : fetching ? "Adding…" : entry.file}
                </span>
              </button>
            );
          })}
        </div>
        {matches.length === 0 ? (
          <p className="t-meta py-10 text-center">No crosshairs match.</p>
        ) : null}
      </div>

      <p className="mt-3 flex flex-wrap items-center gap-1 text-[12px] text-ink-faint">
        {COMMUNITY_CROSSHAIR_CREDIT}
        <button
          type="button"
          onClick={() => void openExternal("https://github.com/hbivnm/Venom-Crosshairs")}
          className="inline-flex items-center gap-0.5 text-ink-muted underline decoration-edge-strong underline-offset-2 hover:text-ink"
        >
          Venom Crosshairs
          <ArrowSquareOut size={11} />
        </button>
      </p>
    </Modal>
  );
}
