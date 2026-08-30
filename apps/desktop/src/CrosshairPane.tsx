import { useEffect, useMemo, useRef, useState } from "react";
import type { CrosshairRecord } from "./lib/bridge";
import {
  assignmentFor,
  CROSSHAIR_CANVAS_SIZE,
  CROSSHAIR_CASUAL_COPY,
  CROSSHAIR_SHAPES,
  CROSSHAIR_STOCK_OVERRIDE_NOTE,
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
  onImportPng,
}: {
  running: boolean;
  busy: boolean;
  record: CrosshairRecord | null;
  onApply: (shape: CrosshairShape, assignments: Record<string, string>) => void;
  onRemove: () => void;
  onImportPng?: (bytes: Uint8Array, name: string) => void;
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
    const pixels = renderCrosshairRgba(draft.shape);
    const image = ctx.createImageData(CROSSHAIR_CANVAS_SIZE, CROSSHAIR_CANVAS_SIZE);
    image.data.set(pixels);
    ctx.putImageData(image, 0, 0);
  }, [draft.shape]);

  const weapons = weaponsForClass(classId);

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
          {CROSSHAIR_SHAPES.map((shape) => (
            <label key={shape} className="flex items-center gap-2">
              <input
                type="radio"
                name="crosshair-shape"
                data-testid={`crosshair-shape-${shape}`}
                checked={draft.shape === shape}
                disabled={locked}
                onChange={() => setDraft({ ...draft, shape })}
              />
              {shape}
            </label>
          ))}
        </fieldset>
      </div>

      {onImportPng ? (
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
              if (!file) {
                return;
              }
              void file.arrayBuffer().then((buffer) => {
                onImportPng(new Uint8Array(buffer), file.name);
              });
            }}
          />
        </label>
      ) : null}

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
              {CROSSHAIR_SHAPES.map((shape) => (
                <option key={shape} value={shape}>
                  {shape}
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
          onClick={() => onApply(draft.shape, draft.assignments)}
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
