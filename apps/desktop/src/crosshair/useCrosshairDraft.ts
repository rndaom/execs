import { type Dispatch, type SetStateAction, useMemo } from "react";
import { draftRecordKey, useSeededDraft } from "../hooks/useSeededDraft";
import type { CrosshairAssetPayload, CrosshairRecord, StockCrosshairSprite } from "../lib/bridge";
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
  discard: () => void;
  /** Local pixels for library entries added this session. */
  previewFor: (name: string) => PreviewPixels | null;
  removeLibraryEntry: (name: string) => void;
  saveDesign: (design: CrosshairDesign, label?: string) => void;
  acknowledge: (sent: CrosshairDraft, color: [number, number, number]) => void;
  setImportedPng: (pixels: number[]) => void;
  /** Library entries whose bytes we actually hold, for the apply call. */
  libraryPayload: () => Record<string, CrosshairAssetPayload>;
};

/**
 * The crosshair builder's draft and every mutation on it.
 *
 * The profile and slot own this draft. The record's content updates its seed:
 * an unrelated write reloads fresh objects without clearing unbuilt PNGs,
 * library bytes or weapon overrides. A profile switch changes ownership and
 * discards the old draft; a confirmed build acknowledges only the sent version.
 */
export function useCrosshairDraft(
  profileId: string | null,
  record: CrosshairRecord | null,
  packPreviews: Record<string, StockCrosshairSprite> | null,
): CrosshairDraftApi {
  const recordKey = draftRecordKey(profileId, JSON.stringify(record ?? null));
  // biome-ignore lint/correctness/useExhaustiveDependencies: recordKey covers record by value.
  const seeded = useMemo(() => seedCrosshairDraft(record), [recordKey]);
  const [draft, setDraft] = useSeededDraft(
    seeded,
    (value) => JSON.stringify(value),
    draftRecordKey(profileId, "custom-crosshair"),
  );
  const [fetchedPreviews, setFetchedPreviews] = useSeededDraft<Record<string, PreviewPixels>>(
    {},
    JSON.stringify,
    draftRecordKey(profileId, "crosshair-previews"),
  );

  function previewFor(name: string): PreviewPixels | null {
    const fetched = fetchedPreviews[name];
    if (fetched) {
      return fetched;
    }
    let stored = packPreviews?.[name];
    if (!stored && (name === "venom_circle" || name === "venom_dot")) {
      const oldName = name.slice("venom_".length);
      if (record?.library?.[oldName] === "vtf" && !(name in record.library)) {
        stored = packPreviews?.[oldName];
      }
    }
    return stored ? { width: stored.width, height: stored.height, rgba: stored.rgba } : null;
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
      const designs = designLibrary(current.design);
      delete designs[name];
      return {
        ...current,
        library,
        assignments,
        shape: removingSelection ? CROSSHAIR_SHAPES[0] : current.shape,
        // The imported-PNG buffer belongs to the "custom" shape; falling back
        // to a first-party shape while it lingers left a stale preview and a
        // stale payload on the next apply.
        customRgba: removingSelection ? null : current.customRgba,
        design: Object.keys(designs).length ? JSON.stringify(designs) : null,
      };
    });
  }

  function saveDesign(design: CrosshairDesign, label?: string) {
    const base = label
      ? `design-${
          label
            .toLowerCase()
            .replace(/[^a-z0-9]+/g, "-")
            .replace(/^-|-$/g, "")
            .slice(0, 40) || "crosshair"
        }`
      : DESIGNED_CROSSHAIR_NAME;
    let name = base;
    for (let suffix = 2; name in draft.library && draft.shape !== name; suffix += 1) {
      name = `${base}-${suffix}`;
    }
    // Stored untinted; the tint rides cl_crosshair_red/green/blue at apply time.
    const rgba = Array.from(renderCrosshairDesign(design, null));
    setFetchedPreviews((current) => ({
      ...current,
      [name]: {
        width: CROSSHAIR_CANVAS_SIZE,
        height: CROSSHAIR_CANVAS_SIZE,
        rgba,
      },
    }));
    setDraft((current) => ({
      ...current,
      shape: name,
      design: JSON.stringify({ ...designLibrary(current.design), [name]: serializeDesign(design) }),
      library: {
        ...current.library,
        [name]: { format: "rgba", bytes: rgba },
      },
    }));
  }

  function setImportedPng(pixels: number[]) {
    // Functional: the decode is async, so anything the user changed while the
    // image loaded (colour or an override) would be reverted by
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
    discard: () => {
      setDraft(seeded);
      setFetchedPreviews({});
    },
    previewFor,
    removeLibraryEntry,
    saveDesign,
    setImportedPng,
    libraryPayload,
    acknowledge: (sent, color) =>
      setDraft((current) =>
        JSON.stringify(current) === JSON.stringify(sent)
          ? {
              ...current,
              color,
              customRgba: null,
              library: Object.fromEntries(
                Object.entries(current.library).map(([name, entry]) => [
                  name,
                  { ...entry, bytes: null },
                ]),
              ),
            }
          : current,
      ),
  };
}

export function designLibrary(raw: string | null): Record<string, string> {
  if (!raw) return {};
  try {
    const value = JSON.parse(raw);
    return value && typeof value === "object" && !Array.isArray(value)
      ? value.style
        ? { designed: raw }
        : (Object.fromEntries(
            Object.entries(value).filter(([, text]) => typeof text === "string"),
          ) as Record<string, string>)
      : {};
  } catch {
    return {};
  }
}
