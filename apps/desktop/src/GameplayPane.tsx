import { useEffect, useMemo, useState } from "react";
import {
  type CrosshairFile,
  CROSSHAIR_FILES,
  CROSSHAIR_SCALE_MAX,
  CROSSHAIR_SCALE_MIN,
  COLOR_MAX,
  COLOR_MIN,
  canApplyGameplay,
  clampGameplay,
  FLIP_VIEWMODELS_NOTE,
  FOV_MAX,
  FOV_MIN,
  type GameplayLayer,
  type GameplaySettings,
  type GameplayToggle,
  gameplayAutoexecPatch,
  gameplayDirty,
  gameplayPath,
  seedGameplay,
  serializeGameplay,
} from "./lib/gameplay-ui";

export type GameplayPaneProps = {
  running: boolean;
  busy: boolean;
  layer: GameplayLayer;
  effective: Record<string, string>;
  managedText: string;
  onSave: (gameplayText: string, autoexecPatch?: { path: string; text: string }) => void;
};

export function GameplayPane({
  running,
  busy,
  layer,
  effective,
  managedText,
  onSave,
}: GameplayPaneProps) {
  const seeded = useMemo(
    () => seedGameplay(managedText, effective),
    [managedText, effective],
  );
  const [draft, setDraft] = useState(seeded);
  const locked = !canApplyGameplay(running, busy);
  const dirty = gameplayDirty(draft, seeded);

  useEffect(() => {
    setDraft(seeded);
  }, [seeded]);

  function patch(update: Partial<GameplaySettings>) {
    setDraft((current) => ({ ...current, ...update }));
  }

  function onApply() {
    if (!canApplyGameplay(running, busy)) {
      return;
    }
    const next = clampGameplay(draft);
    setDraft(next);
    onSave(serializeGameplay(next), gameplayAutoexecPatch(layer));
  }

  return (
    <form
      data-testid="settings-gameplay"
      className="flex flex-col gap-5 text-left"
      onSubmit={(event) => {
        event.preventDefault();
        onApply();
      }}
    >
      <p className="text-sm text-ink-muted">
        FOV, viewmodels, and stock crosshair. Writes{" "}
        <span className="text-ink">{gameplayPath(layer)}</span>.
      </p>

      <section className="flex flex-col gap-3">
        <p className="font-display text-sm tracking-wide text-ink-muted">Field of view</p>
        <SliderRow
          id="gameplay-fov"
          testId="gameplay-fov"
          label="FOV"
          value={draft.fov_desired}
          min={FOV_MIN}
          max={FOV_MAX}
          disabled={locked}
          onChange={(fov_desired) => patch({ fov_desired })}
        />
      </section>

      <section className="flex flex-col gap-3">
        <p className="font-display text-sm tracking-wide text-ink-muted">Viewmodels</p>
        <SliderRow
          id="gameplay-viewmodel-fov"
          testId="gameplay-viewmodel-fov"
          label="Viewmodel FOV"
          value={draft.viewmodel_fov}
          min={FOV_MIN}
          max={FOV_MAX}
          disabled={locked}
          onChange={(viewmodel_fov) => patch({ viewmodel_fov })}
        />
        <ToggleRow
          id="gameplay-min-viewmodels"
          testId="gameplay-min-viewmodels"
          label="Min viewmodels"
          value={draft.tf_use_min_viewmodels}
          disabled={locked}
          onChange={(tf_use_min_viewmodels) => patch({ tf_use_min_viewmodels })}
        />
        <ToggleRow
          id="gameplay-draw-viewmodel"
          testId="gameplay-draw-viewmodel"
          label="Draw viewmodel"
          value={draft.r_drawviewmodel}
          disabled={locked}
          onChange={(r_drawviewmodel) => patch({ r_drawviewmodel })}
        />
        <ToggleRow
          id="gameplay-tracers-fp"
          testId="gameplay-tracers-fp"
          label="First-person tracers"
          value={draft.r_drawtracers_firstperson}
          disabled={locked}
          onChange={(r_drawtracers_firstperson) => patch({ r_drawtracers_firstperson })}
        />
        <ToggleRow
          id="gameplay-tracers"
          testId="gameplay-tracers"
          label="Tracers"
          value={draft.r_drawtracers}
          disabled={locked}
          onChange={(r_drawtracers) => patch({ r_drawtracers })}
        />
        <ToggleRow
          id="gameplay-flip"
          testId="gameplay-flip"
          label="Flip viewmodels"
          value={draft.cl_flipviewmodels}
          disabled={locked}
          note={FLIP_VIEWMODELS_NOTE}
          onChange={(cl_flipviewmodels) => patch({ cl_flipviewmodels })}
        />
      </section>

      <section className="flex flex-col gap-3">
        <p className="font-display text-sm tracking-wide text-ink-muted">Crosshair</p>
        <label className="flex flex-col gap-1 text-sm text-ink" htmlFor="gameplay-crosshair-file">
          File
          <select
            id="gameplay-crosshair-file"
            data-testid="gameplay-crosshair-file"
            value={draft.cl_crosshair_file}
            disabled={locked}
            onChange={(event) =>
              patch({ cl_crosshair_file: event.target.value as CrosshairFile })
            }
            className="rounded-lg border border-edge bg-bg px-3 py-2 text-sm text-ink focus:border-brand focus:outline-none disabled:opacity-50"
          >
            {CROSSHAIR_FILES.map((file) => (
              <option key={file || "default"} value={file}>
                {file === "" ? "Default" : file}
              </option>
            ))}
          </select>
        </label>
        <SliderRow
          id="gameplay-crosshair-scale"
          testId="gameplay-crosshair-scale"
          label="Scale"
          value={draft.cl_crosshair_scale}
          min={CROSSHAIR_SCALE_MIN}
          max={CROSSHAIR_SCALE_MAX}
          disabled={locked}
          onChange={(cl_crosshair_scale) => patch({ cl_crosshair_scale })}
        />
        <div className="flex items-center gap-3">
          <span
            aria-hidden
            className="size-8 shrink-0 rounded-pill border border-edge"
            style={{
              backgroundColor: `rgba(${draft.cl_crosshair_red}, ${draft.cl_crosshair_green}, ${draft.cl_crosshair_blue}, ${draft.cl_crosshair_alpha / 255})`,
            }}
          />
          <p className="text-xs text-ink-muted">Stock color</p>
        </div>
        <SliderRow
          id="gameplay-crosshair-red"
          testId="gameplay-crosshair-red"
          label="Red"
          value={draft.cl_crosshair_red}
          min={COLOR_MIN}
          max={COLOR_MAX}
          disabled={locked}
          onChange={(cl_crosshair_red) => patch({ cl_crosshair_red })}
        />
        <SliderRow
          id="gameplay-crosshair-green"
          testId="gameplay-crosshair-green"
          label="Green"
          value={draft.cl_crosshair_green}
          min={COLOR_MIN}
          max={COLOR_MAX}
          disabled={locked}
          onChange={(cl_crosshair_green) => patch({ cl_crosshair_green })}
        />
        <SliderRow
          id="gameplay-crosshair-blue"
          testId="gameplay-crosshair-blue"
          label="Blue"
          value={draft.cl_crosshair_blue}
          min={COLOR_MIN}
          max={COLOR_MAX}
          disabled={locked}
          onChange={(cl_crosshair_blue) => patch({ cl_crosshair_blue })}
        />
        <SliderRow
          id="gameplay-crosshair-alpha"
          testId="gameplay-crosshair-alpha"
          label="Opacity"
          value={draft.cl_crosshair_alpha}
          min={COLOR_MIN}
          max={COLOR_MAX}
          disabled={locked}
          onChange={(cl_crosshair_alpha) => patch({ cl_crosshair_alpha })}
        />
      </section>

      <div>
        <button
          type="submit"
          data-testid="gameplay-apply"
          disabled={locked || !dirty}
          className="rounded-pill bg-brand px-5 py-2 text-sm font-medium text-on-brand hover:bg-brand-hover disabled:opacity-40"
        >
          {running ? "Close TF2 to apply" : "Apply"}
        </button>
      </div>
    </form>
  );
}

function SliderRow({
  id,
  testId,
  label,
  value,
  min,
  max,
  disabled,
  onChange,
}: {
  id: string;
  testId: string;
  label: string;
  value: number;
  min: number;
  max: number;
  disabled: boolean;
  onChange: (value: number) => void;
}) {
  return (
    <div>
      <div className="flex items-center justify-between gap-3">
        <label htmlFor={id} className="text-sm text-ink">
          {label}
        </label>
        <span className="text-sm text-ink-muted">{value}</span>
      </div>
      <input
        id={id}
        data-testid={testId}
        type="range"
        min={min}
        max={max}
        step={1}
        value={value}
        disabled={disabled}
        onChange={(event) => onChange(Number(event.target.value))}
        className="mt-1 w-full accent-brand disabled:opacity-50"
      />
    </div>
  );
}

function ToggleRow({
  id,
  testId,
  label,
  value,
  disabled,
  note,
  onChange,
}: {
  id: string;
  testId: string;
  label: string;
  value: GameplayToggle;
  disabled: boolean;
  note?: string;
  onChange: (value: GameplayToggle) => void;
}) {
  return (
    <div>
      <label htmlFor={id} className="flex items-center gap-2 text-sm text-ink">
        <input
          id={id}
          data-testid={testId}
          type="checkbox"
          checked={value === 1}
          disabled={disabled}
          onChange={(event) => onChange(event.target.checked ? 1 : 0)}
        />
        {label}
      </label>
      {note ? <p className="mt-1 pl-6 text-xs text-ink-muted">{note}</p> : null}
    </div>
  );
}
