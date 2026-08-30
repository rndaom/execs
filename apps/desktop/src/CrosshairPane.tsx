import { useEffect, useMemo, useRef, useState } from "react";
import type { CrosshairRecord } from "./lib/bridge";
import {
  assignmentFor,
  CROSSHAIR_CANVAS_SIZE,
  CROSSHAIR_CASUAL_COPY,
  CROSSHAIR_SHAPES,
  CROSSHAIR_STOCK_OVERRIDE_NOTE,
  CUSTOM_CROSSHAIR_SHAPE,
  type CrosshairShape,
  renderCrosshairRgba,
  seedCrosshairDraft,
  TF2_CLASSES,
  weaponsForClass,
} from "./lib/crosshair-ui";
import { canWriteSettings } from "./lib/settings-ui";

export function CrosshairPane({
  running,
  busy,
  record,
  onApply,
  onRemove,
}: {
  running: boolean;
  busy: boolean;
  record: CrosshairRecord | null;
  onApply: (shape: CrosshairShape, assignments: Record<string, string>, customRgba?: number[]) => void;
  onRemove: () => void;
}) {
  const locked = !canWriteSettings(running, busy);
  const seeded = useMemo(() => seedCrosshairDraft(record), [record]);
  const [draft, setDraft] = useState(seeded);
  const [classId, setClassId] = useState<(typeof TF2_CLASSES)[number]>("scout");
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
      image.data.set(renderCrosshairRgba(draft.shape));
    }
    ctx.putImageData(image, 0, 0);
  }, [draft.shape, draft.customRgba]);

  const weapons = weaponsForClass(classId);
  const shapeChoices: CrosshairShape[] =
    draft.customRgba || draft.shape === CUSTOM_CROSSHAIR_SHAPE
      ? [...CROSSHAIR_SHAPES, CUSTOM_CROSSHAIR_SHAPE]
      : [...CROSSHAIR_SHAPES];

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
      const pixels = Array.from(ctx.getImageData(0, 0, CROSSHAIR_CANVAS_SIZE, CROSSHAIR_CANVAS_SIZE).data);
      setDraft({ ...draft, shape: CUSTOM_CROSSHAIR_SHAPE, customRgba: pixels });
      URL.revokeObjectURL(url);
    };
    image.onerror = () => {
      URL.revokeObjectURL(url);
    };
    image.src = url;
  }

  return (
    <section data-testid="settings-crosshair" className="flex flex-col gap-5 text-left">
      <p className="text-sm text-ink-muted">{CROSSHAIR_CASUAL_COPY}</p>
      <p className="text-xs text-ink-muted">{CROSSHAIR_STOCK_OVERRIDE_NOTE}</p>

      <div className="flex flex-wrap items-start gap-4">
        <canvas
          ref={canvasRef}
          data-testid="crosshair-preview"
          width={CROSSHAIR_CANVAS_SIZE}
          height={CROSSHAIR_CANVAS_SIZE}
          className="rounded-lg border border-edge bg-black"
          style={{ width: 128, height: 128, imageRendering: "pixelated" }}
        />
        <fieldset className="flex flex-col gap-2 text-sm text-ink">
          <legend className="font-display text-sm tracking-wide">Shape</legend>
          {shapeChoices.map((shape) => (
            <label key={shape} className="flex items-center gap-2">
              <input
                type="radio"
                name="crosshair-shape"
                data-testid={`crosshair-shape-${shape}`}
                checked={draft.shape === shape}
                disabled={locked}
                onChange={() => setDraft({ ...draft, shape })}
              />
              {shape === CUSTOM_CROSSHAIR_SHAPE ? "imported PNG" : shape}
            </label>
          ))}
        </fieldset>
      </div>

      <label className="text-sm text-ink">
        Import PNG
        <input
          data-testid="crosshair-import-png"
          type="file"
          accept="image/png"
          disabled={locked}
          className="mt-1 block text-xs text-ink-muted"
          onChange={(event) => {
            const file = event.target.files?.[0];
            if (file) {
              importPng(file);
            }
            event.target.value = "";
          }}
        />
      </label>

      <div className="flex flex-wrap gap-2">
        {TF2_CLASSES.map((id) => (
          <button
            key={id}
            type="button"
            data-testid={`crosshair-class-${id}`}
            data-active={classId === id ? "true" : "false"}
            onClick={() => setClassId(id)}
            className={`rounded-pill px-3 py-1 text-xs ${
              classId === id
                ? "bg-brand text-on-brand"
                : "border border-edge text-ink hover:bg-panel-raised"
            }`}
          >
            {id}
          </button>
        ))}
      </div>

      <div className="flex flex-col gap-2" data-testid="crosshair-weapons">
        {weapons.map((weapon) => (
          <label
            key={weapon.script}
            className="flex items-center justify-between gap-3 text-sm text-ink"
          >
            <span>{weapon.label}</span>
            <select
              data-testid={`crosshair-weapon-${weapon.script}`}
              disabled={locked}
              value={assignmentFor(draft, weapon.script)}
              onChange={(event) => {
                const value = event.target.value as CrosshairShape;
                setDraft({
                  ...draft,
                  assignments: { ...draft.assignments, [weapon.script]: value },
                });
              }}
              className="rounded-lg border border-edge bg-bg px-2 py-1 text-sm text-ink"
            >
              {shapeChoices.map((shape) => (
                <option key={shape} value={shape}>
                  {shape === CUSTOM_CROSSHAIR_SHAPE ? "imported PNG" : shape}
                </option>
              ))}
            </select>
          </label>
        ))}
      </div>

      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          data-testid="crosshair-apply"
          disabled={locked}
          onClick={() =>
            onApply(
              draft.shape,
              draft.assignments,
              draft.customRgba ?? undefined,
            )
          }
          className="rounded-pill bg-brand px-4 py-2 text-sm font-medium text-on-brand hover:bg-brand-hover disabled:opacity-40"
        >
          {running ? "Close TF2 to apply" : record ? "Update crosshairs" : "Apply crosshairs"}
        </button>
        {record ? (
          <button
            type="button"
            data-testid="crosshair-remove"
            disabled={locked}
            onClick={onRemove}
            className="rounded-pill border border-edge px-4 py-2 text-sm text-ink hover:bg-panel-raised disabled:opacity-40"
          >
            Remove pack
          </button>
        ) : null}
      </div>
    </section>
  );
}
