import { type ReactNode, useContext, useEffect, useRef, useState } from "react";
import { Disclosure } from "./components/ui/Disclosure";
import { PaneHeader } from "./components/ui/PaneHeader";
import { Segmented } from "./components/ui/Segmented";
import { CommunityPicker } from "./crosshair/CommunityPicker";
import { CrosshairDesigner, type CrosshairDesignerDraft } from "./crosshair/CrosshairDesigner";
import { CrosshairLibraryChips } from "./crosshair/CrosshairLibraryChips";
import { CrosshairPreview, crosshairShapeLabel } from "./crosshair/CrosshairPreview";
import { CrosshairThumb } from "./crosshair/CrosshairThumb";
import { PngImportField } from "./crosshair/PngImportField";
import { designLibrary, useCrosshairDraft } from "./crosshair/useCrosshairDraft";
import {
  ALL_CLASSES_TAB,
  type ClassTab,
  WeaponOverrideTable,
} from "./crosshair/WeaponOverrideTable";
import { useAppStatus } from "./hooks/useAppStatus";
import { AutosaveActivity } from "./hooks/useAutosave";
import { useExplicitDraft } from "./hooks/useExplicitDraft";
import { draftRecordKey, useSeededDraft } from "./hooks/useSeededDraft";
import type {
  ContentIndex,
  CrosshairAssetPayload,
  CrosshairRecord,
  CrosshairSourceStatus,
  StockCrosshairSprite,
} from "./lib/bridge";
import { isTauri } from "./lib/bridge";
import { COMMUNITY_CROSSHAIR_CREDIT } from "./lib/community-crosshairs";
import {
  defaultCrosshairDesign,
  designFromPreset,
  parseDesign,
  renderCrosshairDesign,
} from "./lib/crosshair-designer";
import {
  CROSSHAIR_CASUAL_COPY,
  CROSSHAIR_SHAPES,
  type CrosshairColor,
  type CrosshairShape,
  CUSTOM_CROSSHAIR_SHAPE,
  crosshairDraftDirty,
} from "./lib/crosshair-ui";
import type { GameplayLayer } from "./lib/gameplay-ui";
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
  effective,
  stockSprites = null,
  packPreviews = null,
  managedText,
  onSaveStock,
  onApply,
  onRemove,
  onDeactivate,
  stockArtSources = null,
  sourceStatus = null,
  onOpenMods,
  hudOverlayState = "none",
  hudName,
  onOpenHud,
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
  ) => Promise<boolean>;
  onRemove: () => void;
  onDeactivate?: () => Promise<unknown>;
  stockArtSources?: ContentIndex | null;
  sourceStatus?: CrosshairSourceStatus | null;
  onOpenMods?: () => void;
  hudOverlayState?: "enabled" | "disabled" | "possible" | "none";
  hudName?: string;
  onOpenHud?: () => void;
  scene?: ReactNode;
}) {
  const { running, busy } = useAppStatus();
  const currentProfile = useRef(profileId);
  currentProfile.current = profileId;
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
  const [designerSession, setDesignerSession] = useSeededDraft<{
    initial: CrosshairDesignerDraft;
    current: CrosshairDesignerDraft;
  } | null>(null, JSON.stringify, draftRecordKey(profileId, "crosshair-designer"));
  const designerDirty =
    designerSession !== null &&
    JSON.stringify(designerSession.initial) !== JSON.stringify(designerSession.current);

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
  const stockFile = controls.draft.cl_crosshair_file;
  const stockArtPaths = /^crosshair[1-7]$/i.test(stockFile)
    ? [
        `materials/vgui/crosshairs/${stockFile.toLowerCase()}.vtf`,
        `materials/vgui/crosshairs/${stockFile.toLowerCase()}.vmt`,
      ]
    : [];
  const stockArtConflict = stockArtPaths.flatMap((path) => stockArtSources?.hits[path] ?? [])[0];
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
  const pendingPack = dirty || mode !== activeMode || designerDirty;
  useExplicitDraft(pendingPack);
  function discardPack() {
    setDesignerOpen(false);
    setDesignerSession(null);
    discard();
    setMode(activeMode);
    if (mode !== activeMode) controls.reset();
  }
  function openDesigner(fromPreset = false) {
    if (!designerSession) {
      const initial = {
        design:
          parseDesign(designLibrary(draft.design)[draft.shape]) ??
          (fromPreset ? designFromPreset(draft.shape) : defaultCrosshairDesign()),
        name: draft.shape.startsWith("design-") ? draft.shape.slice(7).replaceAll("-", " ") : "",
      };
      setDesignerSession({ initial, current: initial });
    }
    setSource("designs");
    setDesignerOpen(true);
  }
  function closeDesigner() {
    setDesignerOpen(false);
    setDesignerSession(null);
  }
  function saveDesigner() {
    if (!designerSession) return;
    saveDesign(
      designerSession.current.design,
      designerSession.current.name.trim() || "My crosshair",
    );
    closeDesigner();
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
    const applied = await onApply(
      draft.shape,
      draft.assignments,
      draft.customRgba ?? undefined,
      color,
      libraryPayload(),
      draft.design,
      { scale: controls.draft.cl_crosshair_scale, stock, libraryNames: Object.keys(draft.library) },
    );
    // The host catches native failures/refusals and resolves false. Only a
    // confirmed write owns these bytes now; keep them for every failed retry.
    if (applied !== true || currentProfile.current !== profileId) return;
    acknowledge(sent, color);
    controls.patch({ cl_crosshair_file: "" });
  }

  const editingDesign =
    mode === "custom" && source === "designs" && designerOpen && designerSession !== null;
  const editorPixels = editingDesign
    ? {
        width: 64,
        height: 64,
        rgba: Array.from(renderCrosshairDesign(designerSession.current.design)),
      }
    : null;

  return (
    <section data-testid="settings-crosshair" className="min-w-0 text-left">
      <PaneHeader
        title="Crosshair"
        actions={
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
        }
      />
      {mode !== activeMode ? (
        <p className="t-meta mb-4">
          {activeMode === "custom" ? "Custom is installed" : "In-game is active"} · mode change not
          applied
        </p>
      ) : null}
      {record?.sourceChanged ? (
        <div className="pane-note mb-4" data-testid="crosshair-source-changed">
          <p>
            This saved crosshair pack changed outside execs. Its previews and weapon assignments may
            not match the saved design. Review its assets, then Build pack or remove the saved pack.
          </p>
          {mode !== "custom" ? (
            <button
              type="button"
              className="btn btn-ghost mt-2"
              onClick={() => chooseMode("custom")}
            >
              Review custom pack
            </button>
          ) : null}
        </div>
      ) : null}
      {record && sourceStatus && !["none", "current"].includes(sourceStatus.state) ? (
        <div className="pane-note mb-4" data-testid="crosshair-script-source-status">
          <p>
            {sourceStatus.state === "changed"
              ? "TF2's weapon scripts changed since this pack was built. Review the pack and Build pack again to refresh its scripts."
              : sourceStatus.state === "unverified"
                ? "This older crosshair pack has no recorded TF2 weapon-script version. Review and Build pack to verify it against the current game files."
                : `Could not check TF2's weapon scripts: ${sourceStatus.reason ?? "the source is unavailable"}.`}
          </p>
          {mode !== "custom" ? (
            <button
              type="button"
              className="btn btn-ghost mt-2"
              onClick={() => chooseMode("custom")}
            >
              Review custom pack
            </button>
          ) : null}
        </div>
      ) : null}
      {hudOverlayState === "enabled" || hudOverlayState === "possible" ? (
        <div className="pane-note mb-4" data-testid="crosshair-hud-overlay-notice">
          <p>
            {hudOverlayState === "enabled"
              ? `${hudName ?? "Your HUD"} has a crosshair overlay selected. TF2 may draw it along with the engine crosshair shown here.`
              : `${hudName ?? "Your HUD"} includes crosshair overlay controls. Its in-game state cannot be confirmed from the saved options.`}
          </p>
          {onOpenHud ? (
            <button type="button" className="btn btn-ghost mt-2" onClick={onOpenHud}>
              Open HUD options
            </button>
          ) : null}
        </div>
      ) : null}
      {mode === "stock" && stockArtConflict ? (
        <div className="pane-note mb-4" data-testid="crosshair-stock-art-notice">
          <p>
            {stockArtConflict.pack} also supplies {stockArtConflict.member}. The preview uses
            Valve's original sprite, so TF2 may draw different art.
          </p>
          {onOpenMods ? (
            <button type="button" className="btn btn-ghost mt-2" onClick={onOpenMods}>
              Open installed mods
            </button>
          ) : null}
        </div>
      ) : null}
      {mode === "stock" && stockArtSources?.incomplete.length ? (
        <p className="pane-note mb-4" data-testid="crosshair-source-scan-incomplete">
          Some custom packs could not be checked for crosshair art: {stockArtSources.incomplete[0]}
        </p>
      ) : null}
      <CrosshairControls
        {...controls}
        sprites={stockSprites}
        custom={mode === "custom"}
        scene={scene}
        customContent={
          mode === "custom" ? (
            <div>
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
                    { id: "builtin", label: "Shapes" },
                    { id: "designs", label: "My designs" },
                    { id: "community", label: "Community" },
                    { id: "import", label: "Import PNG" },
                  ]}
                />
              </div>
              {source === "builtin" ? (
                <p className="t-meta mb-4">
                  Select a shape, then Customize shape to make an editable copy. Saved copies appear
                  in My designs.
                </p>
              ) : source === "designs" ? (
                <p className="t-meta mb-4">
                  Your named crosshairs. Design your own starts a new one; select a design to edit
                  it.
                </p>
              ) : null}
              {editingDesign ? (
                <CrosshairDesigner
                  open
                  embedded
                  showActions={false}
                  initial={designerSession.initial.design}
                  initialName={designerSession.initial.name}
                  value={designerSession.current}
                  color={color}
                  onChange={(current) =>
                    setDesignerSession((session) => (session ? { ...session, current } : null))
                  }
                  onSave={saveDesigner}
                  onClose={closeDesigner}
                />
              ) : (
                <>
                  {source === "designs" || source === "community" ? (
                    <input
                      aria-label="Find a crosshair"
                      placeholder="Find a crosshair"
                      className="input mb-4 w-full"
                      value={search}
                      onChange={(event) => setSearch(event.target.value)}
                    />
                  ) : null}
                  {source === "import" ? (
                    <PngImportField locked={locked} onImport={setImportedPng} />
                  ) : null}
                  <CrosshairLibraryChips
                    choices={filteredChoices}
                    selected={draft.shape}
                    color={color}
                    customRgba={draft.customRgba}
                    previewFor={previewFor}
                    locked={locked}
                    canBrowseCommunity={isTauri()}
                    hasDesign={Boolean(designLibrary(draft.design)[draft.shape])}
                    showDesigner={
                      source === "designs" ||
                      (source === "builtin" &&
                        (CROSSHAIR_SHAPES as readonly string[]).includes(draft.shape))
                    }
                    designerLabel={source === "builtin" ? "Customize shape" : undefined}
                    showCommunity={source === "community"}
                    onSelect={(shape) => setDraft((current) => ({ ...current, shape }))}
                    onRemove={removeLibraryEntry}
                    onOpenDesigner={() => openDesigner(source === "builtin")}
                    onOpenCommunity={() => setPickerOpen(true)}
                  />
                  {filteredChoices.length === 0 && source !== "import" ? (
                    <p className="pane-note mt-3">
                      {source === "designs"
                        ? "Create a named design, then build it into your pack."
                        : source === "community"
                          ? "Add crosshairs from the Venom library to use them here."
                          : "No crosshairs match."}
                    </p>
                  ) : null}
                  {designerDirty ? (
                    <button
                      type="button"
                      onClick={() => openDesigner()}
                      className="btn btn-ghost mt-3"
                    >
                      Resume unsaved design
                    </button>
                  ) : null}
                </>
              )}
            </div>
          ) : undefined
        }
        preview={
          mode === "custom" ? (
            <CrosshairPreview
              shape={editingDesign ? "designer-preview" : draft.shape}
              customRgba={editingDesign ? null : draft.customRgba}
              color={color}
              preview={editorPixels ?? previewFor(draft.shape)}
              scale={controls.draft.cl_crosshair_scale}
              scene={scene}
            />
          ) : undefined
        }
        previewActions={
          mode === "custom" ? (
            <div className="action-panel mt-4 block">
              <div className="flex items-start gap-3">
                <div className="surface shrink-0 p-2">
                  <CrosshairThumb
                    shape={editingDesign ? "designer-preview" : draft.shape}
                    customRgba={editingDesign ? null : draft.customRgba}
                    color={color}
                    preview={editorPixels ?? previewFor(draft.shape)}
                    size={40}
                  />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="t-row capitalize">
                    {editingDesign
                      ? designerSession.current.name || "My crosshair"
                      : crosshairShapeLabel(draft.shape)}
                  </p>
                  <p className="t-meta mt-1">
                    {editingDesign
                      ? "Save to library to use this design."
                      : `${Object.keys(draft.assignments).length} weapon overrides · size ${controls.draft.cl_crosshair_scale}`}
                  </p>
                </div>
              </div>
              <div className="mt-4 flex flex-wrap items-center gap-2">
                {editingDesign ? (
                  <>
                    <button
                      type="button"
                      data-testid="crosshair-designer-save"
                      className="btn btn-primary"
                      onClick={saveDesigner}
                    >
                      Save to library
                    </button>
                    <button type="button" className="btn btn-ghost" onClick={closeDesigner}>
                      Cancel design
                    </button>
                  </>
                ) : (
                  <>
                    <button
                      type="button"
                      data-testid="crosshair-build"
                      className="btn btn-primary"
                      disabled={removeLocked || editingDesign || designerDirty}
                      onClick={() => {
                        void build().catch(() => {});
                      }}
                    >
                      Build pack
                    </button>
                    {pendingPack ? (
                      <button
                        type="button"
                        className="btn btn-ghost"
                        disabled={busy}
                        onClick={discardPack}
                      >
                        Discard custom edits
                      </button>
                    ) : null}
                  </>
                )}
              </div>
              {editingDesign ? (
                <p className="t-meta mt-3">Save the design, then Build pack to apply it.</p>
              ) : dirty || activeMode !== "custom" ? (
                <p className="t-meta mt-3">
                  {dirty
                    ? "Custom edits have not been built."
                    : record
                      ? "Your saved pack is inactive."
                      : "Build applies the base shape and weapon overrides."}
                </p>
              ) : null}
              <p className="t-meta mt-3">Color and display size save automatically.</p>
            </div>
          ) : activeMode === "custom" ? (
            <div className="action-panel mt-4 block">
              <p className="t-meta mb-3">Your custom designs and weapon overrides stay saved.</p>
              <button
                type="button"
                className="btn btn-primary"
                disabled={removeLocked}
                onClick={() => {
                  void onDeactivate?.().catch(() => {});
                }}
              >
                Use in-game crosshair
              </button>
              <button
                type="button"
                className="btn btn-quiet ml-2"
                disabled={busy}
                onClick={discardPack}
              >
                Cancel
              </button>
            </div>
          ) : (
            <p className="pane-note mt-4">Changes save automatically.</p>
          )
        }
      />

      {mode === "custom" ? (
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
      ) : null}
      <section className="section">
        <Disclosure
          profileId={profileId}
          storageKey="crosshair-about"
          summary={mode === "custom" ? "About crosshair packs and previews" : "About previews"}
        >
          {record ? (
            <button
              type="button"
              className="btn btn-ghost mt-3"
              disabled={removeLocked}
              onClick={onRemove}
            >
              Remove saved pack
            </button>
          ) : null}
          {mode === "custom" ? (
            <p className="pane-note mt-3">
              {CROSSHAIR_CASUAL_COPY} Build pack applies the base shape and every weapon override.
            </p>
          ) : null}
          <p className="pane-note mt-3">
            {COMMUNITY_CROSSHAIR_CREDIT} Scene screenshots by yttrium and Oblique (CompVMInstaller).
            Stock crosshair previews are decoded from your own copy of the game. execs is not
            affiliated with Valve or Steam; Team Fortress 2 and its sprites are © Valve Corporation.
          </p>
        </Disclosure>
      </section>
      {pickerOpen ? (
        <CommunityPicker
          open
          existing={draft.library}
          color={color}
          onAdd={addCommunity}
          onClose={() => setPickerOpen(false)}
        />
      ) : null}
    </section>
  );
}
