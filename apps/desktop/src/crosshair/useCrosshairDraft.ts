import { type Dispatch, type SetStateAction, useMemo, useState } from "react";
import { draftRecordKey, useSeededDraft } from "../hooks/useSeededDraft";
import type { CrosshairAssetPayload, CrosshairRecord, StockCrosshairSprite } from "../lib/bridge";
import { communityLibraryName } from "../lib/community-crosshairs";
import {
  type CrosshairDesign,
  renderCrosshairDesign,
  serializeDesign,
} from "../lib/crosshair-designer";
import {
  CROSSHAIR_CANVAS_SIZE,
  CROSSHAIR_SHAPES,
  type CrosshairDraft,
  CUSTOM_CROSSHAIR_SHAPE,
  DESIGNED_CROSSHAIR_NAME,
  seedCrosshairDraft,
} from "../lib/crosshair-ui";

export type PreviewPixels = { width: number; height: number; rgba: number[] };

export type CrosshairDraftApi = {
  draft: CrosshairDraft;
  setDraft: Dispatch<SetStateAction<CrosshairDraft>>;
  seeded: CrosshairDraft;
  /** Local pixels for library entries added this session. */
  previewFor: (name: string) => PreviewPixels | null;
  addCommunity: (id: string, preview: PreviewPixels, bytes: number[]) => void;
  removeLibraryEntry: (name: string) => void;
  saveDesign: (design: CrosshairDesign) => void;
  setImportedPng: (pixels: number[]) => void;
  /** Library entries whose bytes we actually hold, for the apply call. */
  libraryPayload: () => Record<string, CrosshairAssetPayload>;
};

/**
 * The crosshair builder's draft and every mutation on it.
 *
 * Seeded through `useSeededDraft` keyed by the profile plus the record's
 * CONTENT: an unrelated write (a stock-crosshair apply, say) reloads the
 * profile detail with fresh object identities, and reseeding on identity would
 * wipe un-applied work — an imported PNG, a colour, a page of weapon
 * overrides. A profile switch is a different key and does discard the draft.
 */
export function useCrosshairDraft(
  profileId: string | null,
  record: CrosshairRecord | null,
  packPreviews: Record<string, StockCrosshairSprite> | null,
): CrosshairDraftApi {
  const recordKey = draftRecordKey(profileId, JSON.stringify(record ?? null));
  // biome-ignore lint/correctness/useExhaustiveDependencies: recordKey covers record by value.
  const seeded = useMemo(() => seedCrosshairDraft(record), [recordKey]);
  const [draft, setDraft] = useSeededDraft(seeded, (value) => JSON.stringify(value), recordKey);
  const [fetchedPreviews, setFetchedPreviews] = useState<Record<string, PreviewPixels>>({});

  function previewFor(name: string): PreviewPixels | null {
    const fetched = fetchedPreviews[name];
    if (fetched) {
      return fetched;
    }
    const stored = packPreviews?.[name];
    return stored ? { width: stored.width, height: stored.height, rgba: stored.rgba } : null;
  }

  function addCommunity(id: string, preview: PreviewPixels, bytes: number[]) {
    // Namespaced: two upstream stems ("circle", "dot") are first-party shape
    // names, and a bare id made the builtin shape win the preview while the
    // backend wrote one VTF for both meanings.
    const name = communityLibraryName(id);
    setFetchedPreviews((current) => ({ ...current, [name]: preview }));
    setDraft((current) => ({
      ...current,
      shape: name,
      library: { ...current.library, [name]: { format: "vtf", bytes } },
    }));
  }

  function removeLibraryEntry(name: string) {
    setFetchedPreviews((current) => {
      if (!(name in current)) {
        return current;
      }
      const next = { ...current };
      delete next[name];
      return next;
    });
    setDraft((current) => {
      const library = { ...current.library };
      delete library[name];
      const assignments = Object.fromEntries(
        Object.entries(current.assignments).filter(([, value]) => value !== name),
      );
      const removingSelection = current.shape === name;
      return {
        ...current,
        library,
        assignments,
        shape: removingSelection ? CROSSHAIR_SHAPES[0] : current.shape,
        // The imported-PNG buffer belongs to the "custom" shape; falling back
        // to a first-party shape while it lingers left a stale preview and a
        // stale payload on the next apply.
        customRgba: removingSelection ? null : current.customRgba,
        design: name === DESIGNED_CROSSHAIR_NAME ? null : current.design,
      };
    });
  }

  function saveDesign(design: CrosshairDesign) {
    // Stored untinted; the tint rides cl_crosshair_red/green/blue at apply time.
    const rgba = Array.from(renderCrosshairDesign(design, null));
    setFetchedPreviews((current) => ({
      ...current,
      [DESIGNED_CROSSHAIR_NAME]: {
        width: CROSSHAIR_CANVAS_SIZE,
        height: CROSSHAIR_CANVAS_SIZE,
        rgba,
      },
    }));
    setDraft((current) => ({
      ...current,
      shape: DESIGNED_CROSSHAIR_NAME,
      design: serializeDesign(design),
      library: {
        ...current.library,
        [DESIGNED_CROSSHAIR_NAME]: { format: "rgba", bytes: rgba },
      },
    }));
  }

  function setImportedPng(pixels: number[]) {
    // Functional: the decode is async, so anything the user changed while the
    // image loaded (colour, an override, a community add) would be reverted by
    // a spread of the captured draft.
    setDraft((current) => ({
      ...current,
      shape: CUSTOM_CROSSHAIR_SHAPE,
      customRgba: pixels,
    }));
  }

  function libraryPayload(): Record<string, CrosshairAssetPayload> {
    const payload: Record<string, CrosshairAssetPayload> = {};
    for (const [name, entry] of Object.entries(draft.library)) {
      if (entry.bytes !== null) {
        payload[name] = { format: entry.format, bytes: entry.bytes };
      }
    }
    return payload;
  }

  return {
    draft,
    setDraft,
    seeded,
    previewFor,
    addCommunity,
    removeLibraryEntry,
    saveDesign,
    setImportedPng,
    libraryPayload,
  };
}
