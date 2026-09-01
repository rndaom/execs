import { ArrowSquareOut, MagnifyingGlass, X } from "@phosphor-icons/react";
import { useState } from "react";
import { Alert } from "../components/ui/Alert";
import { Modal } from "../components/ui/Modal";
import { fetchCommunityCrosshair, openExternal } from "../lib/bridge";
import {
  COMMUNITY_CROSSHAIR_CREDIT,
  type CommunityCrosshairEntry,
  communityLibraryName,
  searchCommunityCrosshairs,
} from "../lib/community-crosshairs";
import type { PreviewPixels } from "./useCrosshairDraft";

/**
 * Browse the pinned Venom Crosshairs list and download one into the library.
 * Entries are written into the pack verbatim at their own dimensions.
 */
export function CommunityPicker({
  open,
  existing,
  onAdd,
  onClose,
}: {
  open: boolean;
  existing: Record<string, unknown>;
  onAdd: (id: string, preview: PreviewPixels, bytes: number[]) => void;
  onClose: () => void;
}) {
  const [query, setQuery] = useState("");
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const matches = searchCommunityCrosshairs(query);

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

  return (
    <Modal
      open={open}
      testId="crosshair-community-picker"
      title="Community crosshairs"
      description="The Venom Crosshairs pack — pick one and it downloads into your library."
      className="fixed inset-4 z-50 flex flex-col sm:inset-8"
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

      <label className="relative mt-3 block">
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

      {error ? (
        <Alert tone="error" className="mt-2 px-3 py-2 text-[13px]">
          {error}
        </Alert>
      ) : null}

      <div className="mt-3 min-h-0 flex-1 overflow-y-auto">
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 md:grid-cols-4">
          {matches.map((entry) => {
            // Legacy libraries may still hold the bare stem; treat both as added.
            const added = communityLibraryName(entry.id) in existing || entry.id in existing;
            return (
              <button
                key={entry.id}
                type="button"
                data-testid={`crosshair-community-${entry.id}`}
                disabled={busyId !== null || added}
                onClick={() => void pick(entry)}
                className={`flex items-center justify-between gap-2 rounded-lg border px-3 py-2 text-left text-[13px] transition-colors duration-150 ${
                  added
                    ? "border-ok/50 text-ok"
                    : "border-edge text-ink-muted hover:border-edge-strong hover:text-ink"
                } disabled:cursor-not-allowed`}
              >
                <span className="min-w-0 truncate">{entry.file}</span>
                <span className="shrink-0 text-[12px] text-ink-faint">
                  {added ? "Added" : busyId === entry.id ? "…" : ""}
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
