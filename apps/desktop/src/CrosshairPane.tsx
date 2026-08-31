import { ArrowSquareOut, MagnifyingGlass, PencilSimple, Plus, X } from "@phosphor-icons/react";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  type CrosshairAssetPayload,
  type CrosshairRecord,
  fetchCommunityCrosshair,
  isTauri,
  openExternal,
  type StockCrosshairSprite,
} from "./lib/bridge";
import {
  COMMUNITY_CROSSHAIR_CREDIT,
  type CommunityCrosshairEntry,
  searchCommunityCrosshairs,
} from "./lib/community-crosshairs";
import {
  type CrosshairDesign,
  DESIGN_LIMITS,
  DESIGN_STYLES,
  defaultCrosshairDesign,
  parseDesign,
  renderCrosshairDesign,
  serializeDesign,
} from "./lib/crosshair-designer";
import {
  assignmentFor,
  assignSlotForAllClasses,
  CROSSHAIR_CANVAS_SIZE,
  CROSSHAIR_CASUAL_COPY,
  CROSSHAIR_SHAPES,
  CROSSHAIR_STOCK_OVERRIDE_NOTE,
  type CrosshairColor,
  type CrosshairShape,
  CUSTOM_CROSSHAIR_SHAPE,
  catalogSlots,
  copyClassToAllClasses,
  DESIGNED_CROSSHAIR_NAME,
  isBuiltinCrosshairShape,
  renderCrosshairRgba,
  seedCrosshairDraft,
  slotAssignment,
  TF2_CLASSES,
  weaponsForClass,
} from "./lib/crosshair-ui";
import type { GameplayLayer } from "./lib/gameplay-ui";
import { hexToRgb, rgbToHex } from "./lib/hud-ui";
import { canWriteSettings } from "./lib/settings-ui";
import { StockCrosshairSettings } from "./StockCrosshairSettings";

const ALL_CLASSES_TAB = "all" as const;

type ClassTab = typeof ALL_CLASSES_TAB | (typeof TF2_CLASSES)[number];

type PreviewPixels = { width: number; height: number; rgba: number[] };

export function CrosshairPane({
  running,
  busy,
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
  running: boolean;
  busy: boolean;
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
  const locked = !canWriteSettings(running, busy);
  // Key the seed by record CONTENT: unrelated writes (e.g. stock apply) reload
  // the profile detail with a new object identity, and resetting the draft
  // then would wipe un-applied work (imported PNG, color, overrides).
  const recordKey = JSON.stringify(record ?? null);
  // biome-ignore lint/correctness/useExhaustiveDependencies: recordKey covers record by value.
  const seeded = useMemo(() => seedCrosshairDraft(record), [recordKey]);
  const [draft, setDraft] = useState(seeded);
  const [classTab, setClassTab] = useState<ClassTab>(ALL_CLASSES_TAB);
  const [fetchedPreviews, setFetchedPreviews] = useState<Record<string, PreviewPixels>>({});
  const [pickerOpen, setPickerOpen] = useState(false);
  const [designerOpen, setDesignerOpen] = useState(false);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    setDraft(seeded);
  }, [seeded]);

  function previewFor(name: string): PreviewPixels | null {
    const fetched = fetchedPreviews[name];
    if (fetched) {
      return fetched;
    }
    const stored = packPreviews?.[name];
    if (stored) {
      return { width: stored.width, height: stored.height, rgba: stored.rgba };
    }
    return null;
  }

  // biome-ignore lint/correctness/useExhaustiveDependencies: previewFor reads only state listed in the deps.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) {
      return;
    }
    const ctx = canvas.getContext("2d");
    if (!ctx) {
      return;
    }
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    if (draft.shape === CUSTOM_CROSSHAIR_SHAPE && draft.customRgba) {
      const image = ctx.createImageData(CROSSHAIR_CANVAS_SIZE, CROSSHAIR_CANVAS_SIZE);
      image.data.set(draft.customRgba);
      ctx.putImageData(image, 0, 0);
      return;
    }
    if (isBuiltinCrosshairShape(draft.shape)) {
      const image = ctx.createImageData(CROSSHAIR_CANVAS_SIZE, CROSSHAIR_CANVAS_SIZE);
      image.data.set(renderCrosshairRgba(draft.shape, draft.color));
      ctx.putImageData(image, 0, 0);
      return;
    }
    const preview = previewFor(draft.shape);
    if (preview && preview.width === CROSSHAIR_CANVAS_SIZE) {
      const image = ctx.createImageData(preview.width, preview.height);
      image.data.set(preview.rgba);
      ctx.putImageData(image, 0, 0);
    }
  }, [draft.shape, draft.customRgba, draft.color, fetchedPreviews, packPreviews]);

  const classTabs: ClassTab[] = [ALL_CLASSES_TAB, ...TF2_CLASSES];
  const weapons = classTab === ALL_CLASSES_TAB ? [] : weaponsForClass(classTab);
  const slots = catalogSlots();
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

  function importPng(file: File) {
    const url = URL.createObjectURL(file);
    const image = new Image();
    image.onload = () => {
      const scratch = document.createElement("canvas");
      scratch.width = CROSSHAIR_CANVAS_SIZE;
      scratch.height = CROSSHAIR_CANVAS_SIZE;
      const ctx = scratch.getContext("2d");
      if (!ctx) {
        URL.revokeObjectURL(url);
        return;
      }
      ctx.clearRect(0, 0, CROSSHAIR_CANVAS_SIZE, CROSSHAIR_CANVAS_SIZE);
      ctx.drawImage(image, 0, 0, CROSSHAIR_CANVAS_SIZE, CROSSHAIR_CANVAS_SIZE);
      const pixels = Array.from(
        ctx.getImageData(0, 0, CROSSHAIR_CANVAS_SIZE, CROSSHAIR_CANVAS_SIZE).data,
      );
      setDraft({ ...draft, shape: CUSTOM_CROSSHAIR_SHAPE, customRgba: pixels });
      URL.revokeObjectURL(url);
    };
    image.onerror = () => {
      URL.revokeObjectURL(url);
    };
    image.src = url;
  }

  function shapeLabel(shape: CrosshairShape): string {
    return shape === CUSTOM_CROSSHAIR_SHAPE ? "imported PNG" : shape;
  }

  function addCommunity(id: string, preview: PreviewPixels, bytes: number[]) {
    setFetchedPreviews((current) => ({ ...current, [id]: preview }));
    setDraft((current) => ({
      ...current,
      shape: id,
      library: { ...current.library, [id]: { format: "vtf", bytes } },
    }));
  }

  function removeLibraryEntry(name: string) {
    setDraft((current) => {
      const library = { ...current.library };
      delete library[name];
      const assignments = Object.fromEntries(
        Object.entries(current.assignments).filter(([, value]) => value !== name),
      );
      return {
        ...current,
        library,
        assignments,
        shape: current.shape === name ? "cross" : current.shape,
        design: name === DESIGNED_CROSSHAIR_NAME ? null : current.design,
      };
    });
  }

  function saveDesign(design: CrosshairDesign) {
    const rgba = Array.from(renderCrosshairDesign(design, draft.color));
    const serialized = serializeDesign(design);
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
      design: serialized,
      library: {
        ...current.library,
        [DESIGNED_CROSSHAIR_NAME]: { format: "rgba", bytes: rgba },
      },
    }));
    setDesignerOpen(false);
  }

  function applyLibraryPayload(): Record<string, CrosshairAssetPayload> {
    const payload: Record<string, CrosshairAssetPayload> = {};
    for (const [name, entry] of Object.entries(draft.library)) {
      if (entry.bytes !== null) {
        payload[name] = { format: entry.format, bytes: entry.bytes };
      }
    }
    return payload;
  }

  return (
    <section data-testid="settings-crosshair" className="min-w-0 text-left">
      <StockCrosshairSettings
        running={running}
        busy={busy}
        layer={layer}
        effective={effective}
        sprites={stockSprites}
        managedText={managedText}
        onSave={onSaveStock}
      />

      <section className="section">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="text-sm font-semibold text-ink">Custom crosshairs</h2>
            <p className="mt-0.5 max-w-3xl text-xs leading-5 text-ink-muted">
              Install a first-party VTF crosshair for every weapon — pick a shape, a community
              crosshair, or design your own; then override individual weapons if you want.
            </p>
          </div>
          <span
            className={`badge ${
              record
                ? "border border-health/50 bg-health/10 text-health"
                : "border border-edge text-ink-faint"
            }`}
          >
            {record ? "Pack installed" : "Not installed"}
          </span>
        </div>

        <div className="mt-4 grid gap-6 xl:grid-cols-[15rem_1fr]">
          <aside>
            <div className="surface bg-black p-4">
              <canvas
                ref={canvasRef}
                data-testid="crosshair-preview"
                width={CROSSHAIR_CANVAS_SIZE}
                height={CROSSHAIR_CANVAS_SIZE}
                aria-label={`Preview of ${shapeLabel(draft.shape)} crosshair`}
                className="mx-auto block aspect-square w-full max-w-44"
                style={{ imageRendering: "pixelated" }}
              >
                Crosshair preview
              </canvas>
            </div>
            <div className="mt-2 flex items-center justify-between gap-2 text-[11px] text-ink-faint">
              <span>Selected</span>
              <span className="capitalize text-ink-muted">{shapeLabel(draft.shape)}</span>
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
                      setDraft({ ...draft, color: [rgb.r, rgb.g, rgb.b] });
                    }}
                    className="h-7 w-10 cursor-pointer rounded-md border border-edge-strong bg-panel disabled:opacity-50"
                  />
                  {draft.color ? (
                    <button
                      type="button"
                      data-testid="crosshair-color-reset"
                      disabled={locked}
                      onClick={() => setDraft({ ...draft, color: null })}
                      className="text-[11px] text-ink-muted underline decoration-edge underline-offset-2 hover:text-ink"
                    >
                      Reset
                    </button>
                  ) : null}
                </span>
              </label>
              <p className="mt-1 text-[10px] leading-4 text-ink-faint">
                Tints the built-in shapes and your designs. Community VTFs and imported PNGs keep
                their own colors.
              </p>
            </div>

            <label className="eyebrow mt-5 block">
              Import a 64 × 64 PNG
              <input
                data-testid="crosshair-import-png"
                type="file"
                accept="image/png"
                disabled={locked}
                className="mt-2 block w-full text-xs normal-case tracking-normal text-ink-muted file:mr-3 file:rounded-lg file:border file:border-edge-strong file:bg-panel file:px-3 file:py-1.5 file:text-xs file:font-medium file:text-ink hover:file:bg-panel-raised disabled:opacity-50"
                onChange={(event) => {
                  const file = event.target.files?.[0];
                  if (file) {
                    importPng(file);
                  }
                  event.target.value = "";
                }}
              />
            </label>
          </aside>

          <div className="min-w-0">
            <fieldset>
              <div className="flex flex-wrap items-end justify-between gap-2">
                <div>
                  <legend className="text-[13px] font-medium text-ink">Base crosshair</legend>
                  <p className="mt-0.5 text-xs leading-5 text-ink-muted">
                    Used unless a weapon has an override.
                  </p>
                </div>
                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    data-testid="crosshair-open-designer"
                    disabled={locked}
                    onClick={() => setDesignerOpen(true)}
                    className="btn btn-ghost px-3 py-1.5 text-[11px]"
                  >
                    <PencilSimple size={13} />
                    {draft.design ? "Edit your design" : "Design your own"}
                  </button>
                  <button
                    type="button"
                    data-testid="crosshair-open-community"
                    disabled={locked || !isTauri()}
                    onClick={() => setPickerOpen(true)}
                    className="btn btn-ghost px-3 py-1.5 text-[11px]"
                  >
                    <Plus size={13} />
                    Community crosshairs
                  </button>
                </div>
              </div>
              <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
                {shapeChoices.map((shape) => {
                  const selected = draft.shape === shape;
                  const isLibrary = !isBuiltinCrosshairShape(shape);
                  return (
                    <label
                      key={shape}
                      className={`group/chip relative cursor-pointer rounded-lg border px-3 py-2.5 text-center text-xs font-medium outline-none transition-colors focus-within:ring-2 focus-within:ring-brand ${
                        selected
                          ? "border-brand/70 bg-brand/10 text-brand"
                          : "border-edge bg-panel/60 text-ink-muted hover:border-edge-strong hover:text-ink"
                      }`}
                    >
                      <input
                        type="radio"
                        name="crosshair-shape"
                        data-testid={`crosshair-shape-${shape}`}
                        checked={selected}
                        disabled={locked}
                        onChange={() => setDraft({ ...draft, shape })}
                        className="sr-only"
                      />
                      <span className={isLibrary ? "block truncate" : "capitalize"}>
                        {shapeLabel(shape)}
                      </span>
                      {isLibrary ? (
                        <button
                          type="button"
                          aria-label={`Remove ${shape} from the library`}
                          data-testid={`crosshair-library-remove-${shape}`}
                          disabled={locked}
                          onClick={(event) => {
                            event.preventDefault();
                            removeLibraryEntry(shape);
                          }}
                          className="absolute -top-1.5 -right-1.5 hidden size-4 items-center justify-center rounded-full border border-edge-strong bg-panel text-ink-muted group-hover/chip:flex hover:text-ink"
                        >
                          <X size={9} weight="bold" />
                        </button>
                      ) : null}
                    </label>
                  );
                })}
              </div>
            </fieldset>

            <div className="mt-6 border-t border-edge/60 pt-5">
              <div className="flex flex-wrap items-end justify-between gap-3">
                <div>
                  <h3 className="text-[13px] font-medium text-ink">Weapon overrides</h3>
                  <p className="mt-0.5 text-xs leading-5 text-ink-muted">
                    Set whole slots for every class at once, or pick a class to fine-tune single
                    weapons.
                  </p>
                </div>
                {classTab !== ALL_CLASSES_TAB ? (
                  <button
                    type="button"
                    data-testid="crosshair-copy-class"
                    disabled={locked}
                    onClick={() => setDraft(copyClassToAllClasses(draft, classTab))}
                    className="btn btn-ghost px-3 py-1.5 text-[11px]"
                  >
                    Apply {classTab}'s shapes to all classes
                  </button>
                ) : (
                  <span className="text-xs capitalize text-ink-faint">
                    {slots.length} weapon slots
                  </span>
                )}
              </div>

              <div
                className="mt-3 flex flex-wrap gap-1 rounded-xl bg-panel p-1"
                role="tablist"
                aria-label="TF2 class"
              >
                {classTabs.map((id, classIndex) => (
                  <button
                    key={id}
                    id={`crosshair-class-tab-${id}`}
                    type="button"
                    role="tab"
                    aria-selected={classTab === id}
                    aria-controls="crosshair-weapons-panel"
                    tabIndex={classTab === id ? 0 : -1}
                    data-testid={`crosshair-class-${id}`}
                    data-active={classTab === id ? "true" : "false"}
                    onClick={() => setClassTab(id)}
                    onKeyDown={(event) => {
                      let nextIndex: number | null = null;
                      if (event.key === "ArrowRight") {
                        nextIndex = (classIndex + 1) % classTabs.length;
                      } else if (event.key === "ArrowLeft") {
                        nextIndex = (classIndex - 1 + classTabs.length) % classTabs.length;
                      } else if (event.key === "Home") {
                        nextIndex = 0;
                      } else if (event.key === "End") {
                        nextIndex = classTabs.length - 1;
                      }
                      if (nextIndex === null) {
                        return;
                      }
                      event.preventDefault();
                      const nextClass = classTabs[nextIndex];
                      setClassTab(nextClass);
                      requestAnimationFrame(() => {
                        document.getElementById(`crosshair-class-tab-${nextClass}`)?.focus();
                      });
                    }}
                    className={`rounded-lg px-2 py-1.5 text-xs font-medium capitalize outline-none transition-colors focus-visible:ring-2 focus-visible:ring-brand ${
                      classTab === id
                        ? "bg-brand text-on-brand"
                        : "text-ink-muted hover:bg-panel-raised hover:text-ink"
                    }`}
                  >
                    {id === ALL_CLASSES_TAB ? "All classes" : id}
                  </button>
                ))}
              </div>

              {classTab === ALL_CLASSES_TAB ? (
                <div
                  id="crosshair-weapons-panel"
                  className="mt-3"
                  data-testid="crosshair-all-classes"
                  role="tabpanel"
                  aria-labelledby={`crosshair-class-tab-${ALL_CLASSES_TAB}`}
                >
                  <div className="grid gap-2 md:grid-cols-2">
                    {slots.map((slot) => {
                      const shared = slotAssignment(draft, slot);
                      return (
                        <label
                          key={slot}
                          className="flex min-w-0 items-center justify-between gap-3 border-b border-edge/60 py-2.5 text-sm text-ink"
                        >
                          <span className="min-w-0">
                            <span className="block">
                              {slot === "pda" ? "PDA" : slot[0].toUpperCase() + slot.slice(1)}
                            </span>
                            <span className="mt-0.5 block text-[10px] uppercase tracking-widest text-ink-faint">
                              {shared === null ? "Mixed shapes" : "Every class"}
                            </span>
                          </span>
                          <select
                            data-testid={`crosshair-slot-${slot}`}
                            aria-label={`Crosshair for every ${slot} weapon`}
                            disabled={locked}
                            value={shared ?? "mixed"}
                            onChange={(event) => {
                              const value = event.target.value;
                              if (value === "mixed") {
                                return;
                              }
                              setDraft(
                                assignSlotForAllClasses(draft, slot, value as CrosshairShape),
                              );
                            }}
                            className="field max-w-36 shrink-0 px-2 py-1.5 text-xs capitalize text-ink outline-none focus:border-brand focus:ring-1 focus:ring-brand disabled:opacity-50"
                          >
                            {shared === null ? (
                              <option value="mixed" disabled>
                                mixed
                              </option>
                            ) : null}
                            {shapeChoices.map((shape) => (
                              <option key={shape} value={shape}>
                                {shapeLabel(shape)}
                              </option>
                            ))}
                          </select>
                        </label>
                      );
                    })}
                  </div>
                  <p className="mt-2 text-[11px] leading-4 text-ink-faint">
                    Slot picks apply to every weapon in that slot across all nine classes.
                  </p>
                </div>
              ) : (
                <div
                  id="crosshair-weapons-panel"
                  className="mt-3 grid gap-x-8 md:grid-cols-2"
                  data-testid="crosshair-weapons"
                  role="tabpanel"
                  aria-labelledby={`crosshair-class-tab-${classTab}`}
                >
                  {weapons.map((weapon) => (
                    <label
                      key={weapon.script}
                      className="flex min-w-0 items-center justify-between gap-3 border-b border-edge/60 py-2.5 text-sm text-ink"
                    >
                      <span className="min-w-0">
                        <span className="block truncate text-[13px]">{weapon.label}</span>
                        <span className="mt-0.5 block text-[10px] uppercase tracking-widest text-ink-faint">
                          {weapon.slot}
                        </span>
                      </span>
                      <select
                        data-testid={`crosshair-weapon-${weapon.script}`}
                        aria-label={`Crosshair for ${weapon.label}`}
                        disabled={locked}
                        value={assignmentFor(draft, weapon.script)}
                        onChange={(event) => {
                          const value = event.target.value as CrosshairShape;
                          setDraft({
                            ...draft,
                            assignments: { ...draft.assignments, [weapon.script]: value },
                          });
                        }}
                        className="field max-w-32 shrink-0 px-2 py-1.5 text-xs capitalize text-ink outline-none focus:border-brand focus:ring-1 focus:ring-brand disabled:opacity-50"
                      >
                        {shapeChoices.map((shape) => (
                          <option key={shape} value={shape}>
                            {shapeLabel(shape)}
                          </option>
                        ))}
                      </select>
                    </label>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>

        <div className="mt-6 border-t border-edge/60 pt-4">
          <div className="mb-3 grid gap-x-8 gap-y-1 text-xs leading-5 text-ink-muted md:grid-cols-2">
            <p>{CROSSHAIR_CASUAL_COPY}</p>
            <p className="text-ink">{CROSSHAIR_STOCK_OVERRIDE_NOTE}</p>
          </div>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="text-xs text-ink-faint">
              Applying writes a first-party pack to this profile's custom folder.{" "}
              {COMMUNITY_CROSSHAIR_CREDIT}
            </p>
            <div className="flex shrink-0 flex-wrap gap-2">
              {record ? (
                <button
                  type="button"
                  data-testid="crosshair-remove"
                  disabled={locked}
                  onClick={onRemove}
                  className="btn btn-ghost"
                >
                  Remove pack
                </button>
              ) : null}
              <button
                type="button"
                data-testid="crosshair-apply"
                disabled={locked}
                onClick={() =>
                  onApply(
                    draft.shape,
                    draft.assignments,
                    draft.customRgba ?? undefined,
                    draft.color,
                    applyLibraryPayload(),
                    draft.design,
                  )
                }
                className="btn btn-primary"
              >
                {running ? "Close TF2 to apply" : record ? "Update crosshairs" : "Apply crosshairs"}
              </button>
            </div>
          </div>
        </div>
      </section>

      {locked ? (
        <p className="mt-4 text-sm text-ink-muted">
          {running
            ? "Close TF2 before changing crosshair files."
            : "Finish the current profile task before changing crosshairs."}
        </p>
      ) : null}

      {pickerOpen ? (
        <CommunityPicker
          existing={draft.library}
          onAdd={addCommunity}
          onClose={() => setPickerOpen(false)}
        />
      ) : null}

      {designerOpen ? (
        <CrosshairDesigner
          initial={parseDesign(draft.design) ?? defaultCrosshairDesign()}
          color={draft.color}
          onSave={saveDesign}
          onClose={() => setDesignerOpen(false)}
        />
      ) : null}
    </section>
  );
}

function CommunityPicker({
  existing,
  onAdd,
  onClose,
}: {
  existing: Record<string, unknown>;
  onAdd: (id: string, preview: PreviewPixels, bytes: number[]) => void;
  onClose: () => void;
}) {
  const [query, setQuery] = useState("");
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [previews, setPreviews] = useState<Record<string, PreviewPixels>>({});
  const matches = searchCommunityCrosshairs(query);

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") {
        onClose();
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  async function pick(entry: CommunityCrosshairEntry) {
    if (busyId) {
      return;
    }
    setBusyId(entry.id);
    setError(null);
    try {
      const fetched = await fetchCommunityCrosshair(entry.file);
      const preview = { width: fetched.width, height: fetched.height, rgba: fetched.rgba };
      setPreviews((current) => ({ ...current, [entry.id]: preview }));
      onAdd(entry.id, preview, fetched.bytes);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not download that crosshair.");
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Community crosshairs"
      data-testid="crosshair-community-picker"
      className="fixed inset-0 z-50 flex flex-col bg-bg/95 p-4 backdrop-blur-sm sm:p-6"
      onClick={(event) => {
        if (event.target === event.currentTarget) {
          onClose();
        }
      }}
      onKeyDown={() => {}}
    >
      <div className="mx-auto flex min-h-0 w-full max-w-3xl flex-1 flex-col">
        <div className="flex items-center justify-between gap-3">
          <div>
            <p className="text-sm font-semibold text-ink">Community crosshairs</p>
            <p className="text-xs text-ink-muted">
              The Venom Crosshairs pack — pick one and it downloads into your library.
            </p>
          </div>
          <button
            type="button"
            data-testid="crosshair-picker-close"
            onClick={onClose}
            aria-label="Close community crosshairs"
            className="btn btn-ghost p-2"
          >
            <X size={16} />
          </button>
        </div>

        <label className="relative mt-3 block">
          <MagnifyingGlass
            size={14}
            className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-ink-faint"
          />
          <input
            type="search"
            data-testid="crosshair-picker-search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search crosshairs…"
            className="field w-full py-2 pr-3 pl-8 text-xs text-ink placeholder:text-ink-faint focus:border-brand focus:outline-none"
          />
        </label>

        {error ? (
          <p className="mt-2 rounded-lg border border-team-red/50 bg-team-red/10 px-3 py-2 text-xs text-ink">
            {error}
          </p>
        ) : null}

        <div className="mt-3 min-h-0 flex-1 overflow-y-auto">
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 md:grid-cols-4">
            {matches.map((entry) => {
              const added = entry.id in existing;
              const preview = previews[entry.id];
              return (
                <button
                  key={entry.id}
                  type="button"
                  data-testid={`crosshair-community-${entry.id}`}
                  disabled={busyId !== null || added}
                  onClick={() => void pick(entry)}
                  className={`flex items-center justify-between gap-2 rounded-lg border px-3 py-2 text-left text-xs transition-colors ${
                    added
                      ? "border-health/50 bg-health/10 text-health"
                      : "border-edge bg-panel/60 text-ink-muted hover:border-edge-strong hover:text-ink"
                  } disabled:cursor-not-allowed`}
                >
                  <span className="min-w-0 truncate">{entry.file}</span>
                  <span className="shrink-0 text-[10px] text-ink-faint">
                    {added ? "Added" : busyId === entry.id ? "…" : preview ? "Ready" : ""}
                  </span>
                </button>
              );
            })}
          </div>
          {matches.length === 0 ? (
            <p className="py-8 text-center text-xs text-ink-muted">No crosshairs match.</p>
          ) : null}
        </div>

        <p className="mt-3 flex items-center gap-1 text-[11px] text-ink-faint">
          {COMMUNITY_CROSSHAIR_CREDIT}
          <button
            type="button"
            onClick={() => void openExternal("https://github.com/hbivnm/Venom-Crosshairs")}
            className="inline-flex items-center gap-0.5 text-brand underline decoration-brand/40 underline-offset-2"
          >
            Venom Crosshairs
            <ArrowSquareOut size={11} />
          </button>
        </p>
      </div>
    </div>
  );
}

function CrosshairDesigner({
  initial,
  color,
  onSave,
  onClose,
}: {
  initial: CrosshairDesign;
  color: CrosshairColor | null;
  onSave: (design: CrosshairDesign) => void;
  onClose: () => void;
}) {
  const [design, setDesign] = useState<CrosshairDesign>(initial);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") {
        onClose();
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  useEffect(() => {
    const ctx = canvasRef.current?.getContext("2d");
    if (!ctx) {
      return;
    }
    const image = ctx.createImageData(CROSSHAIR_CANVAS_SIZE, CROSSHAIR_CANVAS_SIZE);
    image.data.set(renderCrosshairDesign(design, color));
    ctx.putImageData(image, 0, 0);
  }, [design, color]);

  function patch(update: Partial<CrosshairDesign>) {
    setDesign((current) => ({ ...current, ...update }));
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Crosshair designer"
      data-testid="crosshair-designer"
      className="fixed inset-0 z-50 grid place-items-center bg-bg/95 p-4 backdrop-blur-sm"
      onClick={(event) => {
        if (event.target === event.currentTarget) {
          onClose();
        }
      }}
      onKeyDown={() => {}}
    >
      <div className="overlay w-full max-w-2xl p-5">
        <div className="flex items-center justify-between gap-3">
          <div>
            <p className="text-sm font-semibold text-ink">Design your own crosshair</p>
            <p className="text-xs text-ink-muted">
              Rendered at real sprite size — what you see is what gets baked.
            </p>
          </div>
          <button
            type="button"
            data-testid="crosshair-designer-close"
            onClick={onClose}
            aria-label="Close designer"
            className="btn btn-ghost p-2"
          >
            <X size={16} />
          </button>
        </div>

        <div className="mt-4 grid gap-5 sm:grid-cols-[11rem_1fr]">
          <div>
            <div className="surface bg-black p-3">
              <canvas
                ref={canvasRef}
                data-testid="crosshair-designer-preview"
                width={CROSSHAIR_CANVAS_SIZE}
                height={CROSSHAIR_CANVAS_SIZE}
                className="mx-auto block aspect-square w-full max-w-36"
                style={{ imageRendering: "pixelated" }}
              />
            </div>
            <div className="mt-3 flex flex-wrap gap-1">
              {DESIGN_STYLES.map((style) => (
                <button
                  key={style}
                  type="button"
                  aria-pressed={design.style === style}
                  data-testid={`crosshair-designer-style-${style}`}
                  onClick={() => patch({ style })}
                  className={`rounded-lg px-2.5 py-1.5 text-xs capitalize transition-colors ${
                    design.style === style
                      ? "bg-brand text-on-brand"
                      : "bg-panel text-ink-muted hover:text-ink"
                  }`}
                >
                  {style}
                </button>
              ))}
            </div>
          </div>

          <div className="grid content-start gap-3">
            <DesignerSlider
              id="designer-size"
              label={design.style === "circle" ? "Radius" : "Length"}
              value={design.size}
              min={DESIGN_LIMITS.size.min}
              max={DESIGN_LIMITS.size.max}
              onChange={(size) => patch({ size })}
            />
            <DesignerSlider
              id="designer-thickness"
              label="Thickness"
              value={design.thickness}
              min={DESIGN_LIMITS.thickness.min}
              max={DESIGN_LIMITS.thickness.max}
              onChange={(thickness) => patch({ thickness })}
            />
            {design.style !== "circle" && design.style !== "dot" ? (
              <DesignerSlider
                id="designer-gap"
                label="Gap"
                value={design.gap}
                min={DESIGN_LIMITS.gap.min}
                max={DESIGN_LIMITS.gap.max}
                onChange={(gap) => patch({ gap })}
              />
            ) : null}
            <DesignerSlider
              id="designer-outline"
              label="Outline"
              value={design.outline}
              min={DESIGN_LIMITS.outline.min}
              max={DESIGN_LIMITS.outline.max}
              onChange={(outline) => patch({ outline })}
            />
            <DesignerSlider
              id="designer-opacity"
              label="Opacity"
              value={design.opacity}
              min={DESIGN_LIMITS.opacity.min}
              max={DESIGN_LIMITS.opacity.max}
              onChange={(opacity) => patch({ opacity })}
            />
            <div className="flex flex-wrap gap-x-6 gap-y-2">
              {design.style !== "dot" ? (
                <label className="flex items-center gap-2 text-xs text-ink">
                  <input
                    type="checkbox"
                    data-testid="crosshair-designer-dot"
                    checked={design.dot}
                    onChange={(event) => patch({ dot: event.target.checked })}
                    className="accent-brand"
                  />
                  Center dot
                </label>
              ) : null}
              {design.dot && design.style !== "dot" ? (
                <DesignerSlider
                  id="designer-dot-size"
                  label="Dot size"
                  value={design.dotSize}
                  min={DESIGN_LIMITS.dotSize.min}
                  max={DESIGN_LIMITS.dotSize.max}
                  compact
                  onChange={(dotSize) => patch({ dotSize })}
                />
              ) : null}
              <label className="flex items-center gap-2 text-xs text-ink">
                <input
                  type="checkbox"
                  data-testid="crosshair-designer-shadow"
                  checked={design.shadow}
                  onChange={(event) => patch({ shadow: event.target.checked })}
                  className="accent-brand"
                />
                Drop shadow
              </label>
            </div>
          </div>
        </div>

        <div className="mt-5 flex items-center justify-end gap-2 border-t border-edge/60 pt-4">
          <button type="button" onClick={onClose} className="btn btn-ghost">
            Cancel
          </button>
          <button
            type="button"
            data-testid="crosshair-designer-save"
            onClick={() => onSave(design)}
            className="btn btn-primary"
          >
            Save to library
          </button>
        </div>
      </div>
    </div>
  );
}

function DesignerSlider({
  id,
  label,
  value,
  min,
  max,
  compact = false,
  onChange,
}: {
  id: string;
  label: string;
  value: number;
  min: number;
  max: number;
  compact?: boolean;
  onChange: (value: number) => void;
}) {
  return (
    <div className={compact ? "flex items-center gap-2" : undefined}>
      <div
        className={compact ? "flex items-center gap-2" : "flex items-center justify-between gap-3"}
      >
        <label htmlFor={id} className="text-xs font-medium text-ink">
          {label}
        </label>
        <output htmlFor={id} className="font-mono text-xs text-ink-muted">
          {value}
        </output>
      </div>
      <input
        id={id}
        data-testid={id}
        type="range"
        min={min}
        max={max}
        step={1}
        value={value}
        onChange={(event) => onChange(Number(event.target.value))}
        className={`${compact ? "w-24" : "mt-1.5 w-full"} cursor-pointer accent-brand`}
      />
    </div>
  );
}
