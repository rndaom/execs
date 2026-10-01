import { DotsThree } from "@phosphor-icons/react";
import { useEffect, useMemo, useRef, useState } from "react";
import { Alert } from "./components/ui/Alert";
import { ApplyBar } from "./components/ui/ApplyBar";
import {
  ContextMenu,
  ContextMenuItem,
  type ContextMenuPosition,
} from "./components/ui/ContextMenu";
import { Disclosure } from "./components/ui/Disclosure";
import { Modal } from "./components/ui/Modal";
import { PaneHeader } from "./components/ui/PaneHeader";
import { CrosshairDesigner, type CrosshairDesignerDraft } from "./crosshair/CrosshairDesigner";
import { CrosshairGallery, type GalleryGroup } from "./crosshair/CrosshairGallery";
import { CrosshairStage } from "./crosshair/CrosshairStage";
import { crosshairPixelsFor } from "./crosshair/crosshairPixels";
import {
  designLibrary,
  type PreviewPixels,
  useCrosshairDraft,
} from "./crosshair/useCrosshairDraft";
import { useCrosshairImport } from "./crosshair/useCrosshairImport";
import { WeaponCrosshairs } from "./crosshair/WeaponCrosshairs";
import { useAppStatus } from "./hooks/useAppStatus";
import { useExplicitDraft } from "./hooks/useExplicitDraft";
import { draftRecordKey, useSeededDraft } from "./hooks/useSeededDraft";
import type {
  ContentIndex,
  CrosshairAssetPayload,
  CrosshairRecord,
  CrosshairSourceStatus,
  StockCrosshairSprite,
} from "./lib/bridge";
import { copyToClipboard } from "./lib/copy-ui";
import {
  defaultCrosshairDesign,
  designCode,
  designFromPreset,
  designLabel,
  parseDesign,
  renderCrosshairDesign,
} from "./lib/crosshair-designer";
import { crosshairLabel } from "./lib/crosshair-labels";
import {
  CROSSHAIR_PRESETS,
  isCrosshairPreset,
  presetDesign,
  presetPixels,
} from "./lib/crosshair-presets";
import {
  fileCrosshairSize,
  type GameDisplay,
  resolveGameDisplay,
  scriptCrosshairSize,
} from "./lib/crosshair-size";
import {
  CROSSHAIR_CANVAS_SIZE,
  CROSSHAIR_CASUAL_COPY,
  CROSSHAIR_SHAPES,
  type CrosshairColor,
  type CrosshairDraft,
  type CrosshairShape,
  CUSTOM_CROSSHAIR_SHAPE,
  crosshairLibraryDirty,
  crosshairNeedsPack,
  EXTERNAL_CROSSHAIR_CHOICE,
  effectiveAssignments,
  isBuiltinCrosshairShape,
  planCrosshair,
  TF2_CROSSHAIR_CHOICES,
  TF2_DEFAULT_CHOICE,
  tf2CrosshairFile,
} from "./lib/crosshair-ui";
import { type GameplayLayer, seedGameplay } from "./lib/gameplay-ui";
import { CrosshairLook, useCrosshairControls } from "./StockCrosshairSettings";

/** Settings the build remembers for when the pack is switched off. */
type BuildSettings = {
  scale: number;
  stock: { file: string; scale: number };
  libraryNames?: string[];
};

type DesignerSession = {
  initial: CrosshairDesignerDraft;
  current: CrosshairDesignerDraft;
  /** The saved design being edited; null for a new one. */
  editing: string | null;
};

const DISPLAY_KEY = "execs.crosshair.display";

function readCustomDisplay(): GameDisplay | null {
  try {
    const raw = window.localStorage.getItem(DISPLAY_KEY);
    const value = raw ? (JSON.parse(raw) as Partial<GameDisplay>) : null;
    return value && typeof value.width === "number" && typeof value.height === "number"
      ? { width: value.width, height: value.height, windowed: value.windowed === true }
      : null;
  } catch {
    return null;
  }
}

function writeCustomDisplay(display: GameDisplay | null) {
  try {
    if (display) window.localStorage.setItem(DISPLAY_KEY, JSON.stringify(display));
    else window.localStorage.removeItem(DISPLAY_KEY);
  } catch {
    // The preview falls back to TF2's own setting.
  }
}

function monitorSize() {
  if (typeof window === "undefined" || !window.screen?.width) return null;
  const ratio = window.devicePixelRatio || 1;
  return {
    width: Math.round(window.screen.width * ratio),
    height: Math.round(window.screen.height * ratio),
  };
}

/** A cfg-safe remembered stock file (the native build refuses anything else). */
function safeStockFile(file: string): string {
  return /^[A-Za-z0-9_\-./]{0,128}$/.test(file) ? file : "";
}

/**
 * The Crosshair pane.
 *
 * One gallery holds every crosshair: TF2's own sprites, execs shapes and the
 * player's designs and imports. TF2 draws its own sprites by itself; anything
 * else, or a different crosshair for some weapons, needs the custom pack,
 * which only an explicit Build writes. Size and colour are cvars and
 * autosave. The preview shows the crosshair at its real in-game size.
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
  launchOptions = "",
  gameResolution = null,
  onPreviewVtf,
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
    settings?: BuildSettings,
  ) => Promise<boolean>;
  onRemove: () => void;
  /** Switch the pack off, letting TF2 draw `stock` itself. */
  onDeactivate?: (stock?: { file: string; scale: number }) => Promise<unknown>;
  stockArtSources?: ContentIndex | null;
  sourceStatus?: CrosshairSourceStatus | null;
  onOpenMods?: () => void;
  hudOverlayState?: "enabled" | "disabled" | "possible" | "none";
  hudName?: string;
  onOpenHud?: () => void;
  /** The profile's saved launch options; `-w`/`-h` set the game resolution. */
  launchOptions?: string;
  /** TF2's saved video resolution, when it could be read. */
  gameResolution?: {
    width: number;
    height: number;
    windowed?: boolean;
    borderless?: boolean;
  } | null;
  /** Decode a VTF the player picked, for its preview. */
  onPreviewVtf?: (bytes: number[]) => Promise<StockCrosshairSprite>;
}) {
  const { running, busy } = useAppStatus();
  const currentProfile = useRef(profileId);
  currentProfile.current = profileId;
  const packLive = record !== null && !record.inactive;
  const savedStock = useMemo(
    () => seedGameplay(managedText, effective).cl_crosshair_file,
    [managedText, effective],
  );

  const {
    draft,
    setDraft,
    seeded,
    previewFor,
    removeLibraryEntry,
    saveDesign,
    addImage,
    addVtf,
    libraryPayload,
    acknowledge,
    discard,
    savedAssignments,
  } = useCrosshairDraft(profileId, record, packPreviews, savedStock);

  // The colour lives on the record too; it never decides whether files change.
  const plainDraft = { ...draft, color: null };
  const plainSeed = { ...seeded, color: null };
  const needsPack = crosshairNeedsPack(plainDraft, plainSeed);
  // A build from TF2's own crosshair writes size and colour itself, so they
  // wait for it rather than racing it.
  const controls = useCrosshairControls(
    profileId,
    effective,
    managedText,
    onSaveStock,
    packLive || !needsPack,
  );
  const color: CrosshairColor = [
    controls.draft.cl_crosshair_red,
    controls.draft.cl_crosshair_green,
    controls.draft.cl_crosshair_blue,
  ];
  const scale = controls.draft.cl_crosshair_scale;
  const plan = planCrosshair({
    draft: plainDraft,
    seeded: plainSeed,
    packLive,
    stockFile: controls.draft.cl_crosshair_file,
  });

  // With no pack running, a TF2 choice is just cl_crosshair_file: keep the
  // cvar draft on it so it autosaves like size and colour.
  const patchControls = controls.patch;
  useEffect(() => {
    if (packLive || needsPack) return;
    const file = tf2CrosshairFile(draft.shape);
    if (file !== null && file !== controls.draft.cl_crosshair_file) {
      patchControls({ cl_crosshair_file: file });
    }
  }, [packLive, needsPack, draft.shape, controls.draft.cl_crosshair_file, patchControls]);

  const [designer, setDesigner] = useSeededDraft<DesignerSession | null>(
    null,
    JSON.stringify,
    draftRecordKey(profileId, "crosshair-designer"),
  );
  const designerDirty =
    designer !== null && JSON.stringify(designer.initial) !== JSON.stringify(designer.current);
  const [working, setWorking] = useState(false);
  useExplicitDraft(plan.kind !== "none" || designerDirty || working);

  const [display, setCustomDisplay] = useState(readCustomDisplay);
  const resolvedDisplay = resolveGameDisplay({
    custom: display,
    launchOptions,
    saved: gameResolution,
    monitor: monitorSize(),
  });
  const [menu, setMenu] = useState<ContextMenuPosition | null>(null);
  const [confirmRemove, setConfirmRemove] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  const designs = designLibrary(draft.design);
  const labelFor = (name: string) => crosshairLabel(name, designs);
  const pixelsFor = (name: string): PreviewPixels | null =>
    crosshairPixelsFor(name, { previewFor, stockSprites, customRgba: draft.customRgba });

  const imports = useCrosshairImport({
    onImage: (pixels, label) => addImage(pixels, label),
    onVtf: (bytes, sprite, label) => addVtf(bytes, sprite, label),
    previewVtf: (bytes) =>
      onPreviewVtf
        ? onPreviewVtf(bytes)
        : Promise.reject(new Error("VTF previews need the desktop app.")),
  });

  const usesLegacyImage =
    draft.customRgba !== null ||
    previewFor(CUSTOM_CROSSHAIR_SHAPE) !== null ||
    draft.shape === CUSTOM_CROSSHAIR_SHAPE ||
    Object.values(draft.assignments).includes(CUSTOM_CROSSHAIR_SHAPE);
  const yours = [
    ...(usesLegacyImage ? [CUSTOM_CROSSHAIR_SHAPE] : []),
    ...Object.keys(draft.library).filter((name) => !isCrosshairPreset(name)),
  ];
  // Earlier execs shapes stay listed only while this profile still uses one.
  const inUse = new Set([
    draft.shape,
    seeded.shape,
    ...Object.values(draft.assignments),
    ...Object.values(seeded.assignments),
  ]);
  const shapes = [
    ...CROSSHAIR_PRESETS.map((preset) => preset.name),
    ...CROSSHAIR_SHAPES.filter((name) => inUse.has(name)),
  ];
  const showExternal =
    draft.shape === EXTERNAL_CROSSHAIR_CHOICE || seeded.shape === EXTERNAL_CROSSHAIR_CHOICE;
  const hasSavedVtf = Object.entries(draft.library).some(
    ([name, entry]) => name.startsWith("venom_") || entry.format === "vtf",
  );
  const groups: GalleryGroup[] = [
    {
      id: "tf2",
      title: "Team Fortress 2",
      items: [...TF2_CROSSHAIR_CHOICES, ...(showExternal ? [EXTERNAL_CROSSHAIR_CHOICE] : [])],
    },
    { id: "execs", title: "Shapes", items: shapes },
    {
      id: "yours",
      title: "Yours",
      note: hasSavedVtf
        ? "Earlier VTF crosshairs stay in this profile's pack. New Venom downloads are no longer offered."
        : undefined,
      items: yours,
    },
  ];
  const isOwn = (name: string) => yours.includes(name);
  const designFor = (name: string) => presetDesign(name) ?? parseDesign(designs[name]);

  function chooseBase(name: CrosshairShape) {
    setNotice(null);
    // An exception that now matches the main crosshair is no exception.
    setDraft((current) => ({
      ...current,
      shape: name,
      assignments: Object.fromEntries(
        Object.entries(current.assignments).filter(([, value]) => value !== name),
      ),
    }));
  }

  function openDesigner(source: { edit?: string; duplicate?: string } = {}) {
    const from = source.edit ?? source.duplicate;
    const saved = from ? designFor(from) : null;
    // A new design starts from the shape on screen, so "make it a bit
    // bigger" is one step.
    const design =
      saved ??
      presetDesign(draft.shape) ??
      (isBuiltinCrosshairShape(draft.shape) && draft.shape !== CUSTOM_CROSSHAIR_SHAPE
        ? designFromPreset(draft.shape)
        : defaultCrosshairDesign());
    const name = from
      ? source.duplicate
        ? (isCrosshairPreset(from)
            ? `My ${labelFor(from).toLowerCase()}`
            : `${labelFor(from)} copy`
          ).slice(0, 40)
        : (designLabel(designs[from]) ?? labelFor(from))
      : "";
    const initial = { name, design };
    setDesigner({ initial, current: initial, editing: source.edit ?? null });
  }

  function saveDesigner() {
    if (!designer) return;
    saveDesign(
      designer.current.design,
      designer.current.name.trim() || "My crosshair",
      designer.editing ?? undefined,
    );
    setDesigner(null);
  }

  function discardAll() {
    setDesigner(null);
    discard();
    imports.cancel();
  }

  async function build() {
    if (working) return;
    const sent = draft;
    const stockFile = safeStockFile(
      tf2CrosshairFile(draft.shape) ??
        (packLive ? (record?.stock?.file ?? "") : controls.draft.cl_crosshair_file),
    );
    setWorking(true);
    try {
      // Settle any queued size or colour save first, so it cannot land after
      // the build and put back the old crosshair file.
      await controls.flush();
      // execs shapes are drawn here and sent with every build that uses them;
      // ones no longer used drop out of the pack.
      const presets = [...new Set([draft.shape, ...Object.values(draft.assignments)])].filter(
        isCrosshairPreset,
      );
      const library = libraryPayload();
      for (const name of Object.keys(library)) {
        if (isCrosshairPreset(name)) delete library[name];
      }
      for (const name of presets) {
        library[name] = { format: "rgba", bytes: Array.from(presetPixels(name) ?? []) };
      }
      const libraryNames = [
        ...Object.keys(draft.library).filter((name) => !isCrosshairPreset(name)),
        ...presets,
      ];
      const applied = await onApply(
        draft.shape,
        draft.assignments,
        draft.customRgba ?? undefined,
        color,
        library,
        draft.design,
        { scale, stock: { file: stockFile, scale }, libraryNames },
      );
      // The host catches native failures/refusals and resolves false. Only a
      // confirmed write owns these bytes now; keep them for every failed retry.
      if (applied !== true || currentProfile.current !== profileId) return;
      acknowledge(sent, color);
      controls.patch({ cl_crosshair_file: "" });
    } catch {
      // Reported by the host; the draft stays for a retry.
    } finally {
      setWorking(false);
    }
  }

  async function switchToTf2(file: string) {
    if (working || !onDeactivate) return;
    setWorking(true);
    try {
      await controls.flush();
      const result = await onDeactivate({ file: safeStockFile(file), scale });
      if (result === false || currentProfile.current !== profileId) return;
      controls.patch({ cl_crosshair_file: file });
    } catch {
      // Reported by the host.
    } finally {
      setWorking(false);
    }
  }

  // What the preview shows: the design being edited, or the main crosshair.
  const previewName = designer ? "designer-preview" : draft.shape;
  const previewPixels: PreviewPixels | null = designer
    ? {
        width: CROSSHAIR_CANVAS_SIZE,
        height: CROSSHAIR_CANVAS_SIZE,
        rgba: renderCrosshairDesign(designer.current.design),
      }
    : pixelsFor(previewName);
  const drawsWithPack = plan.kind === "build" || (packLive && plan.kind === "none");
  const drawn =
    previewName === TF2_DEFAULT_CHOICE ||
    previewName === EXTERNAL_CROSSHAIR_CHOICE ||
    !previewPixels
      ? null
      : drawsWithPack || designer
        ? scriptCrosshairSize(previewPixels.width, previewPixels.height, scale)
        : fileCrosshairSize(scale);
  const filter =
    tf2CrosshairFile(previewName) !== null || draft.library[previewName]?.format === "vtf"
      ? ("linear" as const)
      : ("nearest" as const);
  const stageLabel = designer
    ? designer.current.name.trim() || "New design"
    : labelFor(previewName);

  const stockArtFile = tf2CrosshairFile(previewName);
  const stockArtConflict = stockArtFile
    ? [
        `materials/vgui/crosshairs/${stockArtFile}.vtf`,
        `materials/vgui/crosshairs/${stockArtFile}.vmt`,
      ].flatMap((path) => stockArtSources?.hits[path] ?? [])[0]
    : undefined;

  // Only new designs or imports make this a build: TF2 draws its own sprite
  // either way, but the pack is where they are kept.
  const libraryOnly =
    plan.kind === "build" &&
    tf2CrosshairFile(draft.shape) !== null &&
    Object.keys(effectiveAssignments(draft)).length === 0 &&
    crosshairLibraryDirty(plainDraft, plainSeed);
  const barStatus =
    plan.kind === "deactivate"
      ? "TF2 will draw its own crosshair again. Your custom crosshairs stay saved in this profile."
      : libraryOnly
        ? "Build the pack to keep your new crosshairs in this profile."
        : packLive
          ? "These changes are not in TF2 yet."
          : "Custom crosshairs need a small pack. Nothing changes in TF2 until you build it.";

  return (
    <section data-testid="settings-crosshair" className="min-w-0 text-left">
      <PaneHeader
        title="Crosshair"
        actions={
          <>
            <span
              className="badge"
              data-live={packLive}
              data-testid="crosshair-live-state"
              title={
                packLive
                  ? "A custom crosshair pack is installed for this profile."
                  : "TF2 draws its own crosshair; no custom pack is installed."
              }
            >
              {packLive ? "Custom pack on" : "TF2 draws its own crosshair"}
            </span>
            {record ? (
              <button
                type="button"
                className="btn btn-ghost px-2.5"
                aria-label="More crosshair actions"
                data-testid="crosshair-more"
                aria-haspopup="menu"
                onClick={(event) => {
                  const bounds = event.currentTarget.getBoundingClientRect();
                  setMenu({ x: bounds.right - 256, y: bounds.bottom + 6 });
                }}
              >
                <DotsThree size={18} weight="bold" />
              </button>
            ) : null}
          </>
        }
      />

      <div className="grid gap-3 empty:hidden" data-testid="crosshair-notices">
        {record?.sourceChanged ? (
          <div className="pane-note" data-testid="crosshair-source-changed">
            <p>
              This crosshair pack was changed outside execs, so its pictures and per-weapon choices
              may not match what TF2 draws. Build it again, or remove it from the ⋯ menu.
            </p>
            {!designer ? (
              <button
                type="button"
                className="btn btn-ghost mt-2"
                disabled={running || busy || working}
                onClick={() => void build()}
              >
                Rebuild crosshair pack
              </button>
            ) : null}
          </div>
        ) : null}
        {packLive && sourceStatus && !["none", "current"].includes(sourceStatus.state) ? (
          <div className="pane-note" data-testid="crosshair-script-source-status">
            <p>
              {sourceStatus.state === "changed"
                ? "TF2's weapon scripts changed since this pack was built. Build it again to pick up the update."
                : sourceStatus.state === "unverified"
                  ? "This older crosshair pack has no recorded TF2 weapon-script version. Build it again to check it against the current game files."
                  : `Could not check TF2's weapon scripts: ${sourceStatus.reason ?? "the source is unavailable"}.`}
            </p>
            {sourceStatus.state !== "unavailable" && !record?.sourceChanged ? (
              <button
                type="button"
                className="btn btn-ghost mt-2"
                disabled={running || busy || working}
                onClick={() => void build()}
              >
                Rebuild crosshair pack
              </button>
            ) : null}
          </div>
        ) : null}
        {hudOverlayState === "enabled" || hudOverlayState === "possible" ? (
          <div className="pane-note" data-testid="crosshair-hud-overlay-notice">
            <p>
              {hudOverlayState === "enabled"
                ? `${hudName ?? "Your HUD"} has a crosshair overlay selected. TF2 may draw it on top of the crosshair here.`
                : `${hudName ?? "Your HUD"} includes crosshair overlay controls. Their in-game state cannot be confirmed from the saved options.`}
            </p>
            {onOpenHud ? (
              <button type="button" className="btn btn-ghost mt-2" onClick={onOpenHud}>
                Open HUD options
              </button>
            ) : null}
          </div>
        ) : null}
        {stockArtConflict ? (
          <div className="pane-note" data-testid="crosshair-stock-art-notice">
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
        {stockArtSources?.incomplete.length ? (
          <p className="pane-note" data-testid="crosshair-source-scan-incomplete">
            Some custom packs could not be checked for crosshair art:{" "}
            {stockArtSources.incomplete[0]}
          </p>
        ) : null}
      </div>

      <div className="crosshair-layout">
        <div className="min-w-0">
          {designer ? (
            <CrosshairDesigner
              value={designer.current}
              color={color}
              editing={designer.editing}
              onChange={(current) =>
                setDesigner((session) => (session ? { ...session, current } : null))
              }
              onClose={() => setDesigner(null)}
            />
          ) : (
            <>
              <section aria-labelledby="crosshair-choice-heading">
                <h2 id="crosshair-choice-heading" className="t-section">
                  Main crosshair
                </h2>
                <div className="mt-4">
                  <CrosshairGallery
                    groups={groups}
                    value={draft.shape}
                    color={color}
                    pixelsFor={pixelsFor}
                    labelFor={labelFor}
                    isDesign={(name) => designFor(name) !== null}
                    isOwn={isOwn}
                    onSelect={chooseBase}
                    onNewDesign={() => openDesigner()}
                    onImport={(file) => void imports.pick(file)}
                    onEdit={(name) => openDesigner({ edit: name })}
                    onDuplicate={(name) => openDesigner({ duplicate: name })}
                    onCopyCode={(name) => {
                      const design = designFor(name);
                      if (!design) return;
                      void copyToClipboard(designCode(design, labelFor(name))).then((result) =>
                        setNotice(
                          result === "copied"
                            ? `Copied the code for ${labelFor(name)}. Paste it into New design → Paste code.`
                            : "Could not copy the code.",
                        ),
                      );
                    }}
                    onRemove={removeLibraryEntry}
                  />
                </div>
                {imports.reading ? <p className="t-meta mt-3">Reading the VTF…</p> : null}
                {imports.error ? (
                  <Alert
                    tone="error"
                    testId="crosshair-import-error"
                    className="mt-3 px-3 py-2 text-[13px]"
                  >
                    {imports.error}
                  </Alert>
                ) : null}
                {imports.pending ? (
                  <div className="pane-note mt-3" data-testid="crosshair-import-resize">
                    <p>
                      That image is {imports.pending.width} × {imports.pending.height}. Crosshair
                      sprites are 64 × 64, so it will be fitted inside, keeping its shape.
                    </p>
                    <div className="mt-2 flex gap-2">
                      <button
                        type="button"
                        data-testid="crosshair-import-fit"
                        className="btn btn-ghost"
                        onClick={imports.fit}
                      >
                        Fit to 64 × 64
                      </button>
                      <button type="button" className="btn btn-quiet" onClick={imports.cancel}>
                        Cancel
                      </button>
                    </div>
                  </div>
                ) : null}
                {notice ? (
                  <p className="t-meta mt-3" role="status">
                    {notice}
                  </p>
                ) : null}
              </section>

              <WeaponCrosshairs
                draft={draft}
                groups={[
                  { id: "tf2", title: "Team Fortress 2", items: [...TF2_CROSSHAIR_CHOICES] },
                  { id: "execs", title: "Shapes", items: shapes },
                  { id: "yours", title: "Yours", items: yours },
                ]}
                color={color}
                disabledReason={
                  draft.shape === EXTERNAL_CROSSHAIR_CHOICE
                    ? "A material from another pack can only be used for every weapon. Choose a main crosshair above to set different ones per weapon."
                    : undefined
                }
                savedAssignments={savedAssignments}
                pixelsFor={pixelsFor}
                labelFor={labelFor}
                onChange={(next: CrosshairDraft) => setDraft(next)}
              />
            </>
          )}

          <section className="section">
            <Disclosure
              profileId={profileId}
              storageKey="crosshair-about"
              summary="How crosshair size and packs work"
            >
              <div className="mt-3 grid max-w-[62ch] gap-2 t-meta">
                <p>
                  TF2 draws crosshairs in screen pixels. At size 32 a 64 px sprite covers 64 px
                  whatever your resolution, so the same crosshair looks smaller at 2560 × 1440 than
                  at 1280 × 720. The preview uses your game resolution for that reason.
                </p>
                <p>
                  TF2's own crosshairs need nothing extra. Anything else, or a different crosshair
                  for some weapons, is built into a small pack in tf/custom from your own copy of
                  TF2's weapon scripts. {CROSSHAIR_CASUAL_COPY}
                </p>
                <p>
                  Hit markers and team colours are not part of TF2's crosshair. Hit sounds are in
                  Sounds and damage numbers in Gameplay; some HUDs add hit markers in their own
                  options.
                </p>
                <p>
                  Previously installed Venom Crosshairs are credited to HbiVnm and their respective
                  creators. Stock crosshair previews are decoded from your own copy of the game.
                  execs is not affiliated with Valve or Steam; Team Fortress 2 and its sprites are ©
                  Valve Corporation.
                </p>
              </div>
            </Disclosure>
          </section>
        </div>

        <aside className="crosshair-side" aria-label="Preview, size and color">
          <CrosshairStage
            pixels={previewPixels}
            filter={designer ? "nearest" : filter}
            drawn={drawn}
            color={color}
            display={resolvedDisplay}
            label={stageLabel}
            emptyText={
              previewName === TF2_DEFAULT_CHOICE
                ? "Each weapon draws its own TF2 crosshair"
                : previewName === EXTERNAL_CROSSHAIR_CHOICE
                  ? "This material comes from another pack and cannot be previewed"
                  : "Preview unavailable"
            }
            onChangeDisplay={(next) => {
              writeCustomDisplay(next);
              setCustomDisplay(next);
            }}
          />
          <div className="mt-6 border-t border-edge pt-5">
            <CrosshairLook draft={controls.draft} patch={controls.patch} />
          </div>
        </aside>
      </div>

      {designer ? (
        <ApplyBar
          testId="crosshair-designer-save"
          status={
            designer.editing
              ? "Saving updates this design wherever it is used."
              : "Saving adds this design to Yours and makes it your main crosshair."
          }
          actionLabel="Save design"
          running={false}
          locked={false}
          dirty
          extra={
            <button
              type="button"
              className="btn btn-ghost"
              data-testid="crosshair-designer-cancel"
              onClick={() => setDesigner(null)}
            >
              Cancel
            </button>
          }
          onApply={saveDesigner}
        />
      ) : plan.kind !== "none" ? (
        <ApplyBar
          testId={plan.kind === "build" ? "crosshair-build" : "crosshair-use-tf2"}
          status={<span data-testid="crosshair-pending">{barStatus}</span>}
          actionLabel={
            working
              ? plan.kind === "build"
                ? "Building…"
                : "Switching…"
              : plan.kind === "build"
                ? "Build crosshair pack"
                : "Switch to TF2's crosshair"
          }
          lockedLabel="Waiting for TF2 to close"
          running={running}
          locked={running || busy || working}
          dirty
          extra={
            <button
              type="button"
              className="btn btn-ghost"
              data-testid="crosshair-discard"
              disabled={busy || working}
              onClick={discardAll}
            >
              Discard changes
            </button>
          }
          onApply={() => {
            if (plan.kind === "build") void build();
            else if (plan.kind === "deactivate") void switchToTf2(plan.file);
          }}
        />
      ) : null}

      {menu ? (
        <ContextMenu label="Crosshair actions" position={menu} onClose={() => setMenu(null)}>
          <ContextMenuItem
            data-testid="crosshair-remove-pack"
            disabled={running || busy}
            onSelect={() => {
              setMenu(null);
              setConfirmRemove(true);
            }}
          >
            Remove crosshair pack…
          </ContextMenuItem>
        </ContextMenu>
      ) : null}
      <Modal
        open={confirmRemove}
        title="Remove the crosshair pack?"
        description="This deletes the pack from this profile, with every design and image saved in it. TF2 goes back to each weapon's own crosshair. Export the profile first if you want a copy."
        className="fixed top-1/2 left-1/2 z-50 w-[min(28rem,calc(100vw-2rem))] -translate-x-1/2 -translate-y-1/2 p-5"
        onClose={() => setConfirmRemove(false)}
      >
        <div className="mt-5 flex justify-end gap-2">
          <button type="button" className="btn btn-ghost" onClick={() => setConfirmRemove(false)}>
            Cancel
          </button>
          <button
            type="button"
            className="btn btn-danger"
            data-testid="crosshair-remove-confirm"
            disabled={running || busy}
            onClick={() => {
              setConfirmRemove(false);
              discardAll();
              onRemove();
            }}
          >
            Remove pack
          </button>
        </div>
      </Modal>
    </section>
  );
}
