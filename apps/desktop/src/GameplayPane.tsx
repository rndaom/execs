import { useEffect, useMemo, useState } from "react";
import {
  ALL_TRACERS_NOTE,
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
  /** The mastercomfig transparent-viewmodels addon state (mirrors the Comfig pane). */
  transparentViewmodels: boolean;
  /** Comfig-layer profile with official packages installed. */
  canUseComfigAddons: boolean;
  onToggleTransparentViewmodels: () => void;
  onSave: (gameplayText: string, autoexecPatch?: { path: string; text: string }) => void;
};

export function GameplayPane({
  running,
  busy,
  layer,
  effective,
  managedText,
  transparentViewmodels,
  canUseComfigAddons,
  onToggleTransparentViewmodels,
  onSave,
}: GameplayPaneProps) {
  const seeded = useMemo(() => seedGameplay(managedText, effective), [managedText, effective]);
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
      className="min-w-0 text-left"
      onSubmit={(event) => {
        event.preventDefault();
        onApply();
      }}
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="max-w-2xl text-[13px] leading-6 text-ink-muted">
          Tune what you see without changing competitive game logic. Every option is stored in your
          active profile.
        </p>
        <p className="font-mono text-[11px] text-ink-faint">{gameplayPath(layer)}</p>
      </div>

      <dl className="mt-4 flex flex-wrap gap-x-8 gap-y-2">
        <SummaryStat label="World FOV" value={`${draft.fov_desired}°`} />
        <SummaryStat label="Weapon FOV" value={`${draft.viewmodel_fov}°`} />
        <SummaryStat label="Weapon side" value={draft.cl_flipviewmodels === 1 ? "Left" : "Right"} />
        <SummaryStat label="Viewmodel" value={draft.r_drawviewmodel === 1 ? "Visible" : "Hidden"} />
      </dl>

      <section className="section">
        <h2 className="text-sm font-semibold text-ink">Framing</h2>
        <p className="mt-0.5 text-xs leading-5 text-ink-muted">
          World FOV changes peripheral vision. Viewmodel FOV only changes the weapon framing.
        </p>
        <div className="mt-4 grid gap-x-10 gap-y-5 md:grid-cols-2">
          <SliderRow
            id="gameplay-fov"
            testId="gameplay-fov"
            label="World FOV"
            value={draft.fov_desired}
            min={FOV_MIN}
            max={FOV_MAX}
            disabled={locked}
            suffix="°"
            onChange={(fov_desired) => patch({ fov_desired })}
          />
          <SliderRow
            id="gameplay-viewmodel-fov"
            testId="gameplay-viewmodel-fov"
            label="Viewmodel FOV"
            value={draft.viewmodel_fov}
            min={FOV_MIN}
            max={FOV_MAX}
            disabled={locked}
            suffix="°"
            onChange={(viewmodel_fov) => patch({ viewmodel_fov })}
          />
        </div>
      </section>

      <fieldset className="section">
        <legend className="sr-only">Viewmodel details</legend>
        <h2 className="text-sm font-semibold text-ink">Viewmodel details</h2>
        <p className="mt-0.5 text-xs leading-5 text-ink-muted">
          Compact positioning, visibility, and tracer preferences.
        </p>
        <div className="mt-2 grid md:grid-cols-2 md:gap-x-10">
          <ToggleRow
            id="gameplay-min-viewmodels"
            testId="gameplay-min-viewmodels"
            label="Min viewmodels"
            description="Use TF2's compact weapon placement."
            value={draft.tf_use_min_viewmodels}
            disabled={locked}
            onChange={(tf_use_min_viewmodels) => patch({ tf_use_min_viewmodels })}
          />
          <ToggleRow
            id="gameplay-draw-viewmodel"
            testId="gameplay-draw-viewmodel"
            label="Draw viewmodel"
            description="Show your equipped weapon in first person."
            value={draft.r_drawviewmodel}
            disabled={locked}
            onChange={(r_drawviewmodel) => patch({ r_drawviewmodel })}
          />
          <ToggleRow
            id="gameplay-tracers-fp"
            testId="gameplay-tracers-fp"
            label="First-person tracers"
            description="Show tracers from your own weapon."
            value={draft.r_drawtracers_firstperson}
            disabled={locked}
            onChange={(r_drawtracers_firstperson) => patch({ r_drawtracers_firstperson })}
          />
          <ToggleRow
            id="gameplay-tracers"
            testId="gameplay-tracers"
            label="All tracers"
            description="Render tracer effects in the world."
            value={draft.r_drawtracers}
            disabled={locked}
            note={ALL_TRACERS_NOTE}
            onChange={(r_drawtracers) => patch({ r_drawtracers })}
          />
          <ToggleRow
            id="gameplay-flip"
            testId="gameplay-flip"
            label="Left-handed viewmodels"
            description="Mirror the first-person weapon to the left."
            value={draft.cl_flipviewmodels}
            disabled={locked}
            note={FLIP_VIEWMODELS_NOTE}
            onChange={(cl_flipviewmodels) => patch({ cl_flipviewmodels })}
          />
          <ToggleRow
            id="gameplay-transparent-viewmodels"
            testId="gameplay-transparent-viewmodels"
            label="Transparent viewmodels"
            description="Make your weapon translucent (mastercomfig addon, applies immediately)."
            value={transparentViewmodels ? 1 : 0}
            disabled={locked || !canUseComfigAddons}
            note={
              canUseComfigAddons
                ? "Needs a HUD with transparent-viewmodel support and DirectX 9. mastercomfig turns post-processing and anti-aliasing off while this is on."
                : "Requires mastercomfig — install official packages on the Comfig pane first."
            }
            onChange={() => onToggleTransparentViewmodels()}
          />
        </div>
      </fieldset>

      <div className="sticky bottom-0 z-10 mt-8 flex flex-wrap items-center justify-between gap-3 border-t border-edge bg-bg/95 py-3 backdrop-blur">
        <p className="text-xs text-ink-muted" aria-live="polite">
          {running
            ? "TF2 is open — your draft is safe, but it cannot be written yet."
            : dirty
              ? "Unsaved gameplay changes"
              : "Gameplay settings are up to date"}
        </p>
        <button
          type="submit"
          data-testid="gameplay-apply"
          disabled={locked || !dirty}
          className="btn btn-primary"
        >
          {running ? "Close TF2 to apply" : "Apply gameplay"}
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
  suffix = "",
  onChange,
}: {
  id: string;
  testId: string;
  label: string;
  value: number;
  min: number;
  max: number;
  disabled: boolean;
  suffix?: string;
  onChange: (value: number) => void;
}) {
  return (
    <div>
      <div className="flex items-center justify-between gap-3">
        <label htmlFor={id} className="text-[13px] font-medium text-ink">
          {label}
        </label>
        <output htmlFor={id} className="font-mono text-xs text-ink-muted">
          {value}
          {suffix}
        </output>
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
        className="mt-3 w-full cursor-pointer accent-brand disabled:cursor-not-allowed disabled:opacity-50"
      />
      <div className="mt-1 flex justify-between font-mono text-[10px] text-ink-faint">
        <span>{min}</span>
        <span>{max}</span>
      </div>
    </div>
  );
}

function ToggleRow({
  id,
  testId,
  label,
  description,
  value,
  disabled,
  note,
  onChange,
}: {
  id: string;
  testId: string;
  label: string;
  description: string;
  value: GameplayToggle;
  disabled: boolean;
  note?: string;
  onChange: (value: GameplayToggle) => void;
}) {
  const noteId = note ? `${id}-note` : undefined;
  return (
    <div className="border-b border-edge/60 py-3.5">
      <label htmlFor={id} className="flex cursor-pointer items-start justify-between gap-4">
        <span className="min-w-0">
          <span className="block text-[13px] font-medium text-ink">{label}</span>
          <span className="mt-0.5 block text-xs leading-5 text-ink-muted">{description}</span>
        </span>
        <input
          id={id}
          data-testid={testId}
          type="checkbox"
          checked={value === 1}
          disabled={disabled}
          aria-describedby={noteId}
          onChange={(event) => onChange(event.target.checked ? 1 : 0)}
          className="peer sr-only"
        />
        <span
          aria-hidden="true"
          className="relative mt-0.5 h-6 w-11 shrink-0 rounded-pill border border-edge-strong bg-bg transition-colors after:absolute after:left-1 after:top-1 after:size-3.5 after:rounded-full after:bg-ink-muted after:transition-transform peer-checked:border-brand peer-checked:bg-brand peer-checked:after:translate-x-5 peer-checked:after:bg-on-brand peer-focus-visible:ring-2 peer-focus-visible:ring-brand peer-focus-visible:ring-offset-2 peer-focus-visible:ring-offset-bg peer-disabled:opacity-40"
        />
      </label>
      {note ? (
        <p id={noteId} className="mt-2 text-[11px] leading-4 text-ink-faint">
          {note}
        </p>
      ) : null}
    </div>
  );
}

function SummaryStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline gap-2">
      <dt className="eyebrow">{label}</dt>
      <dd className="m-0 text-sm font-semibold text-ink">{value}</dd>
    </div>
  );
}
