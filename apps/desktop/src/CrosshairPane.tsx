import { useState } from "react";
import { PaneHeader } from "./components/ui/PaneHeader";
import { PaneSection } from "./components/ui/PaneSection";
import { CommunityPicker } from "./crosshair/CommunityPicker";
import { CrosshairDesigner } from "./crosshair/CrosshairDesigner";
import { CrosshairLibraryChips } from "./crosshair/CrosshairLibraryChips";
import { CrosshairPreview, crosshairShapeLabel } from "./crosshair/CrosshairPreview";
import { PngImportField } from "./crosshair/PngImportField";
import { useCrosshairDraft } from "./crosshair/useCrosshairDraft";
import {
  ALL_CLASSES_TAB,
  type ClassTab,
  WeaponOverrideTable,
} from "./crosshair/WeaponOverrideTable";
import { useAppStatus } from "./hooks/useAppStatus";
import { useAutosave } from "./hooks/useAutosave";
import type { CrosshairAssetPayload, CrosshairRecord, StockCrosshairSprite } from "./lib/bridge";
import { isTauri } from "./lib/bridge";
import { hexToRgb, rgbToHex } from "./lib/color";
import { COMMUNITY_CROSSHAIR_CREDIT } from "./lib/community-crosshairs";
import { defaultCrosshairDesign, parseDesign } from "./lib/crosshair-designer";
import {
  CROSSHAIR_CASUAL_COPY,
  CROSSHAIR_SHAPES,
  CROSSHAIR_STOCK_OVERRIDE_NOTE,
  type CrosshairColor,
  type CrosshairShape,
  CUSTOM_CROSSHAIR_SHAPE,
  crosshairDraftDirty,
} from "./lib/crosshair-ui";
import { type GameplayLayer, gameplayPath } from "./lib/gameplay-ui";
import { StockCrosshairSettings } from "./StockCrosshairSettings";

/**
 * The Crosshair pane: TF2's own crosshair controls, then the first-party
 * custom-crosshair builder. Orchestration only — the preview, chip grid,
 * override table, community picker and designer are their own components and
 * the draft plus every mutation on it live in `useCrosshairDraft`.
 */
export function CrosshairPane({
  profileId,
  record,
  layer,
  effective,
  stockSprites = null,
  packPreviews = null,
  managedText,
  onSaveStock,
  onApply,
  onRemove,
}: {
  /** The profile these drafts belong to; a switch discards them. */
  profileId: string | null;
  record: CrosshairRecord | null;
  layer: GameplayLayer;
  effective: Record<string, string>;
  /** Valve's real crosshair sprites decoded from the user's game files. */
  stockSprites?: Record<string, StockCrosshairSprite> | null;
  /** Decoded previews of library crosshairs already in the installed pack. */
  packPreviews?: Record<string, StockCrosshairSprite> | null;
  managedText: string;
  /** Both resolve when the write settles; the toast reports it. */
  onSaveStock: (gameplayText: string) => Promise<unknown>;
  onApply: (
    shape: CrosshairShape,
    assignments: Record<string, string>,
    customRgba: number[] | undefined,
    color: CrosshairColor | null,
    library: Record<string, CrosshairAssetPayload>,
    design: string | null,
  ) => Promise<unknown>;
  onRemove: () => void;
}) {
  const { running, busy } = useAppStatus();
  // Nothing that feeds the pack is disabled — it is a draft, and the lock only
  // defers the write. Removing the pack is a different kind of act and waits.
  const locked = false;
  const removeLocked = running || busy;
  const {
    draft,
    setDraft,
    seeded,
    previewFor,
    addCommunity,
    removeLibraryEntry,
    saveDesign,
    setImportedPng,
    libraryPayload,
  } = useCrosshairDraft(profileId, record, packPreviews);
  // A pane the user only looked at must never write a pack on its own, so this
  // is a plain diff: with nothing installed the seed is the default draft, and
  // picking a shape is what makes it dirty.
  const dirty = crosshairDraftDirty(draft, seeded);
  const [classTab, setClassTab] = useState<ClassTab>(ALL_CLASSES_TAB);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [designerOpen, setDesignerOpen] = useState(false);

  const libraryNames = Object.keys(draft.library).sort();
  const usesCustom =
    draft.customRgba !== null ||
    draft.shape === CUSTOM_CROSSHAIR_SHAPE ||
    Object.values(draft.assignments).includes(CUSTOM_CROSSHAIR_SHAPE);
  const shapeChoices: CrosshairShape[] = [
    ...CROSSHAIR_SHAPES,
    ...(usesCustom ? [CUSTOM_CROSSHAIR_SHAPE] : []),
    ...libraryNames,
  ];
  // A reload drops the local pixel buffer; the installed pack still holds the
  // PNG and the backend recovers it on apply.
  const usesStoredCustom = usesCustom && draft.customRgba === null && record !== null;
  const colorHex = draft.color
    ? rgbToHex(draft.color[0], draft.color[1], draft.color[2])
    : "#ffffff";

  useAutosave({
    dirty,
    locked: running,
    token: JSON.stringify(draft),
    save: () =>
      onApply(
        draft.shape,
        draft.assignments,
        draft.customRgba ?? undefined,
        draft.color,
        libraryPayload(),
        draft.design,
      ),
  });

  return (
    <section data-testid="settings-crosshair" className="min-w-0 text-left">
      <PaneHeader
        title="Crosshair"
        lede="TF2's own crosshair, or a pack you build."
        actions={<p className="t-meta font-mono text-ink-faint">{gameplayPath(layer)}</p>}
      />

      <StockCrosshairSettings
        profileId={profileId}
        effective={effective}
        sprites={stockSprites}
        managedText={managedText}
        onSave={onSaveStock}
      />

      <PaneSection
        title="Custom crosshairs"
        meta={
          <span className={`badge ${record ? "badge-ok" : ""}`}>
            {record ? "Pack installed" : "Not installed"}
          </span>
        }
      >
        <div className="mt-5 grid gap-6 lg:grid-cols-[13rem_1fr]">
          <aside>
            <CrosshairPreview
              shape={draft.shape}
              customRgba={draft.customRgba}
              color={draft.color}
              preview={previewFor(draft.shape)}
            />
            <div className="mt-2 flex items-center justify-between gap-2 text-[12px] text-ink-faint">
              <span>Selected</span>
              <span className="capitalize text-ink-muted">{crosshairShapeLabel(draft.shape)}</span>
            </div>
            {usesStoredCustom ? (
              <p
                data-testid="crosshair-stored-custom"
                className="mt-1 text-[12px] leading-5 text-ink-faint"
              >
                Your imported PNG is kept in the installed pack.
              </p>
            ) : null}

            <div className="mt-4">
              <label
                htmlFor="crosshair-color"
                className="t-row flex items-center justify-between gap-3"
              >
                Color
                <span className="flex items-center gap-2">
                  <input
                    id="crosshair-color"
                    data-testid="crosshair-color"
                    type="color"
                    value={colorHex}
                    disabled={locked}
                    onChange={(event) => {
                      const rgb = hexToRgb(event.target.value);
                      if (!rgb) {
                        return;
                      }
                      setDraft((current) => ({ ...current, color: [rgb.r, rgb.g, rgb.b] }));
                    }}
                    className="h-7 w-10 cursor-pointer rounded-md border border-edge-strong bg-panel disabled:opacity-50"
                  />
                  {draft.color ? (
                    <button
                      type="button"
                      data-testid="crosshair-color-reset"
                      disabled={locked}
                      onClick={() => setDraft((current) => ({ ...current, color: null }))}
                      className="text-[12px] text-ink-muted underline decoration-edge-strong underline-offset-2 hover:text-ink"
                    >
                      Reset
                    </button>
                  ) : null}
                </span>
              </label>
              <p className="mt-1.5 text-[12px] leading-5 text-ink-faint">
                Tints the whole pack; applying overwrites the colour above.
              </p>
            </div>

            <PngImportField locked={locked} onImport={setImportedPng} />
          </aside>

          <div className="min-w-0">
            <CrosshairLibraryChips
              choices={shapeChoices}
              selected={draft.shape}
              color={draft.color}
              customRgba={draft.customRgba}
              previewFor={previewFor}
              locked={locked}
              canBrowseCommunity={isTauri()}
              hasDesign={draft.design !== null}
              onSelect={(shape) => setDraft((current) => ({ ...current, shape }))}
              onRemove={removeLibraryEntry}
              onOpenDesigner={() => setDesignerOpen(true)}
              onOpenCommunity={() => setPickerOpen(true)}
            />

            <WeaponOverrideTable
              profileId={profileId}
              draft={draft}
              choices={shapeChoices}
              classTab={classTab}
              locked={locked}
              previewFor={previewFor}
              onSelectClass={setClassTab}
              onChange={setDraft}
            />
          </div>
        </div>

        <div className="t-meta mt-8 grid gap-x-10 gap-y-1 border-t border-edge pt-4 md:grid-cols-2">
          <p>{CROSSHAIR_CASUAL_COPY}</p>
          <p>{CROSSHAIR_STOCK_OVERRIDE_NOTE}</p>
        </div>

        {record ? (
          <div className="mt-6 flex flex-wrap items-center justify-between gap-3">
            <p className="t-meta">The pack is installed in this profile.</p>
            <button
              type="button"
              data-testid="crosshair-remove"
              disabled={removeLocked}
              onClick={onRemove}
              className="btn btn-ghost"
            >
              Remove pack
            </button>
          </div>
        ) : null}
      </PaneSection>

      <p className="t-meta mt-8 text-ink-faint">
        {COMMUNITY_CROSSHAIR_CREDIT} Stock crosshair previews are decoded from your own copy of the
        game. execs is not affiliated with Valve or Steam; Team Fortress 2 and its sprites are ©
        Valve Corporation.
      </p>

      {/* Mounted only while open so each visit starts from the current draft
          (the designer seeds its params once) and from a clean search box. */}
      {pickerOpen ? (
        <CommunityPicker
          open
          existing={draft.library}
          color={draft.color}
          onAdd={addCommunity}
          onClose={() => setPickerOpen(false)}
        />
      ) : null}

      {designerOpen ? (
        <CrosshairDesigner
          open
          initial={parseDesign(draft.design) ?? defaultCrosshairDesign()}
          color={draft.color}
          onSave={(design) => {
            saveDesign(design);
            setDesignerOpen(false);
          }}
          onClose={() => setDesignerOpen(false)}
        />
      ) : null}
    </section>
  );
}
