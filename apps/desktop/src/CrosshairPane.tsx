import { useState } from "react";
import { ApplyBar } from "./components/ui/ApplyBar";
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
import { useAppStatus, useCanWrite } from "./hooks/useAppStatus";
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
} from "./lib/crosshair-ui";
import type { GameplayLayer } from "./lib/gameplay-ui";
import { StockCrosshairSettings } from "./StockCrosshairSettings";

/**
 * The Crosshair pane: TF2's own crosshair controls, then the first-party
 * custom-crosshair builder. Orchestration only — the preview, chip grid,
 * override table, community picker and designer are their own components and
 * the draft plus every mutation on it live in `useCrosshairDraft`.
 */
export function CrosshairPane({
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
  record: CrosshairRecord | null;
  layer: GameplayLayer;
  effective: Record<string, string>;
  /** Valve's real crosshair sprites decoded from the user's game files. */
  stockSprites?: Record<string, StockCrosshairSprite> | null;
  /** Decoded previews of library crosshairs already in the installed pack. */
  packPreviews?: Record<string, StockCrosshairSprite> | null;
  managedText: string;
  onSaveStock: (gameplayText: string) => void;
  onApply: (
    shape: CrosshairShape,
    assignments: Record<string, string>,
    customRgba: number[] | undefined,
    color: CrosshairColor | null,
    library: Record<string, CrosshairAssetPayload>,
    design: string | null,
  ) => void;
  onRemove: () => void;
}) {
  const { running } = useAppStatus();
  const locked = !useCanWrite();
  const {
    draft,
    setDraft,
    previewFor,
    addCommunity,
    removeLibraryEntry,
    saveDesign,
    setImportedPng,
    libraryPayload,
  } = useCrosshairDraft(record, packPreviews);
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

  return (
    <section data-testid="settings-crosshair" className="min-w-0 text-left">
      <StockCrosshairSettings
        layer={layer}
        effective={effective}
        sprites={stockSprites}
        managedText={managedText}
        onSave={onSaveStock}
      />

      <PaneSection
        title="Custom crosshairs"
        description="Install a first-party VTF crosshair for every weapon — pick a shape, a community crosshair, or design your own; then override individual weapons if you want."
        meta={
          <span
            className={`badge ${
              record
                ? "border border-health/50 bg-health/10 text-health"
                : "border border-edge text-ink-faint"
            }`}
          >
            {record ? "Pack installed" : "Not installed"}
          </span>
        }
      >
        <div className="mt-4 grid gap-6 xl:grid-cols-[15rem_1fr]">
          <aside>
            <CrosshairPreview
              shape={draft.shape}
              customRgba={draft.customRgba}
              color={draft.color}
              preview={previewFor(draft.shape)}
            />
            <div className="mt-2 flex items-center justify-between gap-2 text-[11px] text-ink-faint">
              <span>Selected</span>
              <span className="capitalize text-ink-muted">{crosshairShapeLabel(draft.shape)}</span>
            </div>
            {usesStoredCustom ? (
              <p
                data-testid="crosshair-stored-custom"
                className="mt-1 text-[10px] leading-4 text-ink-faint"
              >
                Your imported PNG is stored in the installed pack and stays in use on apply.
              </p>
            ) : null}

            <div className="mt-4">
              <label
                htmlFor="crosshair-color"
                className="flex items-center justify-between gap-3 text-xs font-medium text-ink"
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
                      className="text-[11px] text-ink-muted underline decoration-edge underline-offset-2 hover:text-ink"
                    >
                      Reset
                    </button>
                  ) : null}
                </span>
              </label>
              <p className="mt-1 text-[10px] leading-4 text-ink-faint">
                Tints every crosshair in the pack. It drives the same{" "}
                <code className="font-mono">cl_crosshair_red/green/blue</code> cvars as the default
                in-game crosshair above, so applying overwrites the colour set there.
              </p>
            </div>

            <PngImportField locked={locked} onImport={setImportedPng} />
          </aside>

          <div className="min-w-0">
            <CrosshairLibraryChips
              choices={shapeChoices}
              selected={draft.shape}
              locked={locked}
              canBrowseCommunity={isTauri()}
              hasDesign={draft.design !== null}
              onSelect={(shape) => setDraft((current) => ({ ...current, shape }))}
              onRemove={removeLibraryEntry}
              onOpenDesigner={() => setDesignerOpen(true)}
              onOpenCommunity={() => setPickerOpen(true)}
            />

            <WeaponOverrideTable
              draft={draft}
              choices={shapeChoices}
              classTab={classTab}
              locked={locked}
              onSelectClass={setClassTab}
              onChange={setDraft}
            />
          </div>
        </div>

        <div className="mt-6 grid gap-x-8 gap-y-1 border-t border-edge/60 pt-4 text-xs leading-5 text-ink-muted md:grid-cols-2">
          <p>{CROSSHAIR_CASUAL_COPY}</p>
          <p className="text-ink">{CROSSHAIR_STOCK_OVERRIDE_NOTE}</p>
        </div>
      </PaneSection>

      <p className="mt-4 text-[11px] leading-5 text-ink-faint">
        Applying writes a first-party pack to this profile's custom folder.{" "}
        {COMMUNITY_CROSSHAIR_CREDIT} Stock crosshair previews are decoded from your own copy of the
        game. execs is not affiliated with Valve or Steam; Team Fortress 2 and its sprites are ©
        Valve Corporation.
      </p>

      <ApplyBar
        status={
          locked
            ? running
              ? "Close TF2 before changing crosshair files."
              : "Finish the current profile task before changing crosshairs."
            : record
              ? "Applying rewrites the installed crosshair pack."
              : "Applying writes a new crosshair pack to this profile."
        }
        actionLabel={record ? "Update crosshairs" : "Apply crosshairs"}
        lockedLabel="Close TF2 to apply"
        running={running}
        locked={locked}
        dirty
        testId="crosshair-apply"
        extra={
          record ? (
            <button
              type="button"
              data-testid="crosshair-remove"
              disabled={locked}
              onClick={onRemove}
              className="btn btn-ghost"
            >
              Remove pack
            </button>
          ) : null
        }
        onApply={() =>
          onApply(
            draft.shape,
            draft.assignments,
            draft.customRgba ?? undefined,
            draft.color,
            libraryPayload(),
            draft.design,
          )
        }
      />

      {/* Mounted only while open so each visit starts from the current draft
          (the designer seeds its params once) and from a clean search box. */}
      {pickerOpen ? (
        <CommunityPicker
          open
          existing={draft.library}
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
