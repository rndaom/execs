import { type Dispatch, type SetStateAction, useMemo } from "react";
import { draftRecordKey, useSeededDraft } from "../hooks/useSeededDraft";
import type { CrosshairAssetPayload, CrosshairRecord, StockCrosshairSprite } from "../lib/bridge";
import {
  type CrosshairDesign,
  renderCrosshairDesign,
  serializeDesign,
} from "../lib/crosshair-designer";
import { DESIGN_PREFIX, IMAGE_PREFIX, libraryName, VTF_PREFIX } from "../lib/crosshair-labels";
import {
  CROSSHAIR_CANVAS_SIZE,
  type CrosshairDraft,
  CUSTOM_CROSSHAIR_SHAPE,
  DESIGNED_CROSSHAIR_NAME,
  seedCrosshairDraft,
  serializeCrosshairDraft,
  tf2ChoiceForFile,
} from "../lib/crosshair-ui";

export type PreviewPixels = { width: number; height: number; rgba: number[] | Uint8ClampedArray };

export type CrosshairDraftApi = {
  draft: CrosshairDraft;
  setDraft: Dispatch<SetStateAction<CrosshairDraft>>;
  seeded: CrosshairDraft;
  discard: () => void;
  /** Local pixels for library entries added this session, else the pack's. */
  previewFor: (name: string) => PreviewPixels | null;
  removeLibraryEntry: (name: string) => void;
  /** Save a design; `replace` overwrites that entry instead of adding one. */
  saveDesign: (design: CrosshairDesign, label?: string, replace?: string) => string;
  acknowledge: (sent: CrosshairDraft, color: [number, number, number]) => void;
  /** The legacy single imported image. */
  setImportedPng: (pixels: number[]) => void;
  /** A named 64×64 image in the library; returns its name. */
  addImage: (pixels: number[], label: string) => string;
  /** A named VTF in the library, previewed with `sprite`; returns its name. */
  addVtf: (bytes: number[], sprite: StockCrosshairSprite, label: string) => string;
  /** Library entries whose bytes we actually hold, for the apply call. */
  libraryPayload: () => Record<string, CrosshairAssetPayload>;
  /** Per-weapon choices kept in a switched-off pack, for an explicit restore. */
  savedAssignments: Record<string, string>;
};

/**
 * The crosshair builder's draft and every mutation on it.
 *
 * The profile and slot own this draft. The record's content updates its seed:
 * an unrelated write reloads fresh objects without clearing unbuilt PNGs,
 * library bytes or weapon overrides. A profile switch changes ownership and
 * discards the old draft; a confirmed build acknowledges only the sent version.
 *
 * With no pack running (none saved, or one switched off) the seed starts from
 * TF2's own live crosshair (`stockFile`); a switched-off pack still lends its
 * library so saved designs stay available.
 */
export function useCrosshairDraft(
  profileId: string | null,
  record: CrosshairRecord | null,
  packPreviews: Record<string, StockCrosshairSprite> | null,
  stockFile?: string,
): CrosshairDraftApi {
  const packLive = record !== null && !record.inactive;
  const recordKey = draftRecordKey(
    profileId,
    JSON.stringify([record ?? null, packLive ? null : (stockFile ?? null)]),
  );
  // biome-ignore lint/correctness/useExhaustiveDependencies: recordKey covers record by value.
  const seeded = useMemo(() => {
    const fromRecord = seedCrosshairDraft(record);
    if (packLive || stockFile === undefined) return fromRecord;
    return { ...fromRecord, shape: tf2ChoiceForFile(stockFile), assignments: {} };
  }, [recordKey]);
  // biome-ignore lint/correctness/useExhaustiveDependencies: recordKey covers record by value.
  const savedAssignments = useMemo(
    () => (record?.inactive ? seedCrosshairDraft(record).assignments : {}),
    [recordKey],
  );
  // Compared as content, so a confirmed build reads as clean once the sorted
  // native record comes back, and later reloads can reseed it.
  const [draft, setDraft] = useSeededDraft(
    seeded,
    serializeCrosshairDraft,
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
        shape: removingSelection ? "shape-cross" : current.shape,
        // The imported-PNG buffer belongs to the "custom" shape; falling back
        // to a first-party shape while it lingers left a stale preview and a
        // stale payload on the next apply.
        customRgba:
          removingSelection && name === CUSTOM_CROSSHAIR_SHAPE ? null : current.customRgba,
        design: Object.keys(designs).length ? JSON.stringify(designs) : null,
      };
    });
  }

  function remember(name: string, pixels: PreviewPixels) {
    setFetchedPreviews((current) => ({ ...current, [name]: pixels }));
  }

  function saveDesign(design: CrosshairDesign, label?: string, replace?: string): string {
    const name =
      replace && (replace in draft.library || replace === DESIGNED_CROSSHAIR_NAME)
        ? replace
        : label
          ? libraryName(DESIGN_PREFIX, label, (taken) => taken in draft.library)
          : DESIGNED_CROSSHAIR_NAME;
    // Stored untinted; the tint rides cl_crosshair_red/green/blue at apply time.
    const rgba = Array.from(renderCrosshairDesign(design, null));
    remember(name, { width: CROSSHAIR_CANVAS_SIZE, height: CROSSHAIR_CANVAS_SIZE, rgba });
    setDraft((current) => ({
      ...current,
      // A new design becomes the main crosshair; an edited one stays wherever
      // it is already used.
      shape: replace === name ? current.shape : name,
      design: JSON.stringify({
        ...designLibrary(current.design),
        [name]: serializeDesign(design, label),
      }),
      library: {
        ...current.library,
        [name]: { format: "rgba", bytes: rgba },
      },
    }));
    return name;
  }

  function addImage(pixels: number[], label: string): string {
    const name = libraryName(IMAGE_PREFIX, label, (taken) => taken in draft.library);
    remember(name, { width: CROSSHAIR_CANVAS_SIZE, height: CROSSHAIR_CANVAS_SIZE, rgba: pixels });
    setDraft((current) => ({
      ...current,
      shape: name,
      library: { ...current.library, [name]: { format: "rgba", bytes: pixels } },
    }));
    return name;
  }

  function addVtf(bytes: number[], sprite: StockCrosshairSprite, label: string): string {
    const name = libraryName(VTF_PREFIX, label, (taken) => taken in draft.library);
    remember(name, { width: sprite.width, height: sprite.height, rgba: sprite.rgba });
    setDraft((current) => ({
      ...current,
      shape: name,
      library: { ...current.library, [name]: { format: "vtf", bytes } },
    }));
    return name;
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
    addImage,
    addVtf,
    libraryPayload,
    savedAssignments,
    acknowledge: (sent, color) =>
      setDraft((current) =>
        serializeCrosshairDraft(current) === serializeCrosshairDraft(sent)
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
