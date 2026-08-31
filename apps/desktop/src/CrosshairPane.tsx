import { useEffect, useMemo, useRef, useState } from "react";
import type { CrosshairRecord } from "./lib/bridge";
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

export function CrosshairPane({
  running,
  busy,
  record,
  layer,
  effective,
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
  managedText: string;
  onSaveStock: (gameplayText: string) => void;
  onApply: (
    shape: CrosshairShape,
    assignments: Record<string, string>,
    customRgba?: number[],
    color?: CrosshairColor | null,
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
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    setDraft(seeded);
  }, [seeded]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) {
      return;
    }
    const ctx = canvas.getContext("2d");
    if (!ctx) {
      return;
    }
    const image = ctx.createImageData(CROSSHAIR_CANVAS_SIZE, CROSSHAIR_CANVAS_SIZE);
    if (draft.shape === CUSTOM_CROSSHAIR_SHAPE && draft.customRgba) {
      image.data.set(draft.customRgba);
    } else {
      image.data.set(renderCrosshairRgba(draft.shape, draft.color));
    }
    ctx.putImageData(image, 0, 0);
  }, [draft.shape, draft.customRgba, draft.color]);

  const classTabs: ClassTab[] = [ALL_CLASSES_TAB, ...TF2_CLASSES];
  const weapons = classTab === ALL_CLASSES_TAB ? [] : weaponsForClass(classTab);
  const slots = catalogSlots();
  const usesCustom =
    draft.customRgba !== null ||
    draft.shape === CUSTOM_CROSSHAIR_SHAPE ||
    Object.values(draft.assignments).includes(CUSTOM_CROSSHAIR_SHAPE);
  const shapeChoices: CrosshairShape[] = usesCustom
    ? [...CROSSHAIR_SHAPES, CUSTOM_CROSSHAIR_SHAPE]
    : [...CROSSHAIR_SHAPES];
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

  return (
    <section data-testid="settings-crosshair" className="min-w-0 text-left">
      <StockCrosshairSettings
        running={running}
        busy={busy}
        layer={layer}
        effective={effective}
        managedText={managedText}
        onSave={onSaveStock}
      />

      <section className="section">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="text-sm font-semibold text-ink">Custom crosshairs</h2>
            <p className="mt-0.5 max-w-3xl text-xs leading-5 text-ink-muted">
              Install a first-party VTF crosshair for every weapon — pick one shape and color, then
              override individual weapons if you want.
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
              <span>Base shape</span>
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
                Baked into the shapes. Imported PNGs keep their own colors.
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
              <legend className="text-[13px] font-medium text-ink">Base shape</legend>
              <p className="mt-0.5 text-xs leading-5 text-ink-muted">
                This shape is used unless a weapon has an override.
              </p>
              <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
                {shapeChoices.map((shape) => {
                  const selected = draft.shape === shape;
                  return (
                    <label
                      key={shape}
                      className={`cursor-pointer rounded-lg border px-3 py-2.5 text-center text-xs font-medium capitalize outline-none transition-colors focus-within:ring-2 focus-within:ring-brand ${
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
                      {shapeLabel(shape)}
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
              Applying writes a first-party pack to this profile's custom folder.
            </p>
            <div className="flex flex-wrap gap-2">
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
    </section>
  );
}
