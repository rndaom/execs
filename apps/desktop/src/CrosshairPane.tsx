import { type ReactNode, useContext, useEffect, useId, useState } from "react";
import { PaneHeader } from "./components/ui/PaneHeader";
import { PaneSection } from "./components/ui/PaneSection";
import { Segmented } from "./components/ui/Segmented";
import { CommunityPicker } from "./crosshair/CommunityPicker";
import { CrosshairDesigner } from "./crosshair/CrosshairDesigner";
import { CrosshairLibraryChips } from "./crosshair/CrosshairLibraryChips";
import { CrosshairPreview } from "./crosshair/CrosshairPreview";
import { PngImportField } from "./crosshair/PngImportField";
import { designLibrary, useCrosshairDraft } from "./crosshair/useCrosshairDraft";
import {
  ALL_CLASSES_TAB,
  type ClassTab,
  WeaponOverrideTable,
} from "./crosshair/WeaponOverrideTable";
import { useAppStatus } from "./hooks/useAppStatus";
import { AutosaveActivity, AutosavePending } from "./hooks/useAutosave";
import { draftRecordKey, useSeededDraft } from "./hooks/useSeededDraft";
import type { CrosshairAssetPayload, CrosshairRecord, StockCrosshairSprite } from "./lib/bridge";
import { isTauri } from "./lib/bridge";
import { COMMUNITY_CROSSHAIR_CREDIT } from "./lib/community-crosshairs";
import { defaultCrosshairDesign, parseDesign } from "./lib/crosshair-designer";
import {
  CROSSHAIR_CASUAL_COPY,
  CROSSHAIR_SHAPES,
  type CrosshairColor,
  type CrosshairShape,
  CUSTOM_CROSSHAIR_SHAPE,
  crosshairDraftDirty,
} from "./lib/crosshair-ui";
import { type GameplayLayer, gameplayPath } from "./lib/gameplay-ui";
import { CrosshairControls, useCrosshairControls } from "./StockCrosshairSettings";

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
  onDeactivate,
  scene,
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
    settings?: { scale: number; stock: { file: string; scale: number }; libraryNames?: string[] },
  ) => Promise<unknown>;
  onRemove: () => void;
  onDeactivate?: () => Promise<unknown>;
  scene?: ReactNode;
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
    acknowledge,
    discard,
  } = useCrosshairDraft(profileId, record, packPreviews);
  // A pane the user only looked at must never write a pack on its own, so this
  // is a plain diff: with nothing installed the seed is the default draft, and
  // picking a shape is what makes it dirty.
  const dirty = crosshairDraftDirty({ ...draft, color: null }, { ...seeded, color: null });
  const [classTab, setClassTab] = useState<ClassTab>(ALL_CLASSES_TAB);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [designerOpen, setDesignerOpen] = useState(false);

  const libraryNames = Object.keys(draft.library).sort();
  const usesCustom =
    draft.customRgba !== null ||
    previewFor("custom") !== null ||
    draft.shape === CUSTOM_CROSSHAIR_SHAPE ||
    Object.values(draft.assignments).includes(CUSTOM_CROSSHAIR_SHAPE);
  const shapeChoices: CrosshairShape[] = [
    ...CROSSHAIR_SHAPES,
    ...(usesCustom ? [CUSTOM_CROSSHAIR_SHAPE] : []),
    ...libraryNames,
  ];
  // A reload drops the local pixel buffer; the installed pack still holds the
  // PNG and the backend recovers it on apply.
  const activeMode = record && !record.inactive ? "custom" : "stock";
  const [mode, setMode] = useSeededDraft<"custom" | "stock">(
    activeMode,
    (v) => v,
    draftRecordKey(profileId, "crosshair-mode"),
  );
  const controls = useCrosshairControls(
    profileId,
    effective,
    managedText,
    onSaveStock,
    mode === activeMode,
  );
  const color: CrosshairColor = [
    controls.draft.cl_crosshair_red,
    controls.draft.cl_crosshair_green,
    controls.draft.cl_crosshair_blue,
  ];
  const activity = useContext(AutosaveActivity);
  useEffect(() => {
    if (!activity) {
      setDesignerOpen(false);
      setPickerOpen(false);
    }
  }, [activity]);
  const [source, setSource] = useState<"builtin" | "designs" | "community" | "import">("builtin");
  const [search, setSearch] = useState("");
  const filteredChoices = shapeChoices
    .filter((name) =>
      source === "builtin"
        ? (CROSSHAIR_SHAPES as readonly string[]).includes(name)
        : source === "import"
          ? name === "custom"
          : source === "community"
            ? name.startsWith("venom_")
            : !name.startsWith("venom_") &&
              !(CROSSHAIR_SHAPES as readonly string[]).includes(name) &&
              name !== "custom",
    )
    .filter((name) => name.toLowerCase().includes(search.trim().toLowerCase()));
  const [stockSelection, setStockSelection] = useState(
    record?.stock ?? {
      file: controls.draft.cl_crosshair_file,
      scale: controls.draft.cl_crosshair_scale,
    },
  );
  const [customScale, setCustomScale] = useState(
    record?.scale ?? controls.draft.cl_crosshair_scale,
  );
  const reportPending = useContext(AutosavePending);
  const draftId = useId();
  const pendingPack = dirty || mode !== activeMode;
  useEffect(() => {
    reportPending?.(draftId, pendingPack);
    return () => reportPending?.(draftId, false);
  }, [reportPending, draftId, pendingPack]);
  function discardPack() {
    discard();
    setMode(activeMode);
    if (mode !== activeMode) controls.reset();
  }
  function chooseMode(next: "custom" | "stock") {
    if (mode === "custom") setCustomScale(controls.draft.cl_crosshair_scale);
    if (mode === "stock")
      setStockSelection({
        file: controls.draft.cl_crosshair_file,
        scale: controls.draft.cl_crosshair_scale,
      });
    setMode(next);
    if (next === "custom")
      controls.patch({
        cl_crosshair_file: "",
        cl_crosshair_scale: customScale,
      });
    else
      controls.patch({
        cl_crosshair_scale: stockSelection.scale,
        cl_crosshair_file: stockSelection.file as typeof controls.draft.cl_crosshair_file,
      });
  }
  async function build() {
    const stock = stockSelection;
    const sent = draft;
    await onApply(
      draft.shape,
      draft.assignments,
      draft.customRgba ?? undefined,
      color,
      libraryPayload(),
      draft.design,
      { scale: controls.draft.cl_crosshair_scale, stock, libraryNames: Object.keys(draft.library) },
    );
    acknowledge(sent, color);
    controls.patch({ cl_crosshair_file: "" });
  }

  return (
    <section data-testid="settings-crosshair" className="min-w-0 text-left">
      <PaneHeader
        title="Crosshair"
        lede="TF2's own crosshair, or a pack you build."
        actions={<p className="t-meta font-mono text-ink-faint">{gameplayPath(layer)}</p>}
      />

      <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <Segmented
          label="Crosshair mode"
          testIdPrefix="crosshair-mode"
          options={[
            { id: "stock", label: "In-game" },
            { id: "custom", label: "Custom" },
          ]}
          value={mode}
          disabled={busy}
          onChange={chooseMode}
        />
        {pendingPack ? (
          <button type="button" className="btn btn-ghost" disabled={busy} onClick={discardPack}>
            Discard custom edits
          </button>
        ) : null}
        {mode !== activeMode ? (
          <span className="t-meta">
            {activeMode === "custom" ? "Custom is installed" : "In-game is active"} · mode change
            not applied
          </span>
        ) : null}
      </div>
      <CrosshairControls
        {...controls}
        sprites={stockSprites}
        custom={mode === "custom"}
        scene={scene}
        preview={
          mode === "custom" ? (
            <CrosshairPreview
              shape={draft.shape}
              customRgba={draft.customRgba}
              color={color}
              preview={previewFor(draft.shape)}
              scale={controls.draft.cl_crosshair_scale}
              scene={scene}
            />
          ) : undefined
        }
      />
      {mode === "stock" && activeMode === "custom" ? (
        <button
          type="button"
          className="btn btn-primary mt-6"
          disabled={removeLocked}
          onClick={() => {
            void onDeactivate?.().catch(() => {});
          }}
        >
          Use in-game crosshair
        </button>
      ) : null}

      {mode === "custom" ? (
        <PaneSection
          title="Custom crosshairs"
          meta={
            <span className={`badge ${record ? "badge-ok" : ""}`}>
              {activeMode === "custom"
                ? "Pack installed"
                : record
                  ? "Saved, inactive"
                  : "Not installed"}
            </span>
          }
        >
          <div className="mt-6">
            <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
              <Segmented
                label="Crosshair source"
                size="sm"
                value={source}
                onChange={(value) => {
                  setSource(value);
                  setSearch("");
                }}
                options={[
                  { id: "builtin", label: "Built-in" },
                  { id: "designs", label: "My designs" },
                  { id: "community", label: "Community" },
                  { id: "import", label: "Import PNG" },
                ]}
              />
              {source === "designs" || source === "community" ? (
                <input
                  aria-label="Find a crosshair"
                  placeholder="Find a crosshair"
                  className="input w-44"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                />
              ) : null}
            </div>
            {source === "import" ? (
              <PngImportField locked={locked} onImport={setImportedPng} />
            ) : null}
            <div className="min-w-0">
              <CrosshairLibraryChips
                choices={filteredChoices}
                selected={draft.shape}
                color={color}
                customRgba={draft.customRgba}
                previewFor={previewFor}
                locked={locked}
                canBrowseCommunity={isTauri()}
                hasDesign={Boolean(designLibrary(draft.design)[draft.shape])}
                showDesigner={source === "designs"}
                showCommunity={source === "community"}
                onSelect={(shape) => setDraft((current) => ({ ...current, shape }))}
                onRemove={removeLibraryEntry}
                onOpenDesigner={() => setDesignerOpen(true)}
                onOpenCommunity={() => setPickerOpen(true)}
              />

              <WeaponOverrideTable
                profileId={profileId}
                draft={{ ...draft, color }}
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
            <p>Build pack applies the base shape and every weapon override.</p>
          </div>

          <div className="mt-6 flex flex-wrap items-center justify-between gap-3">
            {record ? (
              <button
                type="button"
                className="btn btn-ghost"
                disabled={removeLocked}
                onClick={onRemove}
              >
                Remove saved pack
              </button>
            ) : null}
            <p className="t-meta">
              {dirty
                ? "Custom edits have not been built."
                : activeMode === "custom"
                  ? "Custom pack installed."
                  : "Ready to build."}
            </p>
            <button
              type="button"
              data-testid="crosshair-build"
              className="btn btn-primary"
              disabled={removeLocked}
              onClick={() => {
                void build().catch(() => {});
              }}
            >
              Build pack
            </button>
          </div>
        </PaneSection>
      ) : null}

      <p className="t-meta mt-8 text-ink-faint">
        {COMMUNITY_CROSSHAIR_CREDIT} Scene screenshots by yttrium and Oblique (CompVMInstaller).
        Stock crosshair previews are decoded from your own copy of the game. execs is not affiliated
        with Valve or Steam; Team Fortress 2 and its sprites are © Valve Corporation.
      </p>

      {/* Mounted only while open so each visit starts from the current draft
          (the designer seeds its params once) and from a clean search box. */}
      {pickerOpen ? (
        <CommunityPicker
          open
          existing={draft.library}
          color={color}
          onAdd={addCommunity}
          onClose={() => setPickerOpen(false)}
        />
      ) : null}

      {designerOpen ? (
        <CrosshairDesigner
          open
          initial={
            parseDesign(designLibrary(draft.design)[draft.shape]) ?? defaultCrosshairDesign()
          }
          initialName={
            draft.shape.startsWith("design-") ? draft.shape.slice(7).replaceAll("-", " ") : ""
          }
          color={color}
          onSave={(design, name) => {
            saveDesign(design, name);
            setDesignerOpen(false);
          }}
          onClose={() => setDesignerOpen(false)}
        />
      ) : null}
    </section>
  );
}
