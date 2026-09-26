import { useEffect, useMemo, useState } from "react";
import { Disclosure } from "./components/ui/Disclosure";
import { PaneHeader } from "./components/ui/PaneHeader";
import { PaneSection } from "./components/ui/PaneSection";
import { SwitchRow } from "./components/ui/Switch";
import { useAppStatus } from "./hooks/useAppStatus";
import { useAutosave } from "./hooks/useAutosave";
import { draftRecordKey, useSeededDraft } from "./hooks/useSeededDraft";
import { OFFICIAL_ADDON_DETAILS } from "./lib/comfig-ui";
import {
  ALL_TRACERS_NOTE,
  clampGameplay,
  clampInt,
  FLIP_VIEWMODELS_NOTE,
  FOV_MAX,
  FOV_MIN,
  formatCvarNumber,
  type GameplayLayer,
  type GameplaySettings,
  gameplayPath,
  parseSensitivityInput,
  seedGameplay,
  serializeGameplay,
  serializeGameplayScope,
} from "./lib/gameplay-ui";

export type GameplayPaneProps = {
  /** The profile this draft belongs to; a switch discards it. */
  profileId: string | null;
  layer: GameplayLayer;
  effective: Record<string, string>;
  managedText: string;
  /** The mastercomfig transparent-viewmodels addon state (mirrors the Comfig pane). */
  transparentViewmodels: boolean;
  /** Official addon belongs to a Comfig profile. */
  canUseComfigAddons: boolean;
  onToggleTransparentViewmodels: () => void;
  onOpenComfig?: () => void;
  onDrawViewmodelChange?: (shown: boolean) => void;
  /** Resolves when the write settles; the toast reports it. */
  onSave: (gameplayText: string) => Promise<unknown>;
};

export function GameplayPane({
  profileId,
  layer,
  effective,
  managedText,
  transparentViewmodels,
  canUseComfigAddons,
  onToggleTransparentViewmodels,
  onOpenComfig,
  onDrawViewmodelChange,
  onSave,
}: GameplayPaneProps) {
  const { running, busy } = useAppStatus();
  const seeded = useMemo(() => seedGameplay(managedText, effective), [managedText, effective]);
  const [draft, setDraft] = useSeededDraft(
    seeded,
    (value) => serializeGameplayScope(value, "gameplay"),
    draftRecordKey(profileId, gameplayPath(layer)),
  );
  const token = serializeGameplayScope(draft, "gameplay");
  const dirty = token !== serializeGameplayScope(seeded, "gameplay");
  // Everything here is a draft of one managed cfg, so nothing is disabled: the
  // write lock defers the save, it does not take the sliders away.
  const text = serializeGameplay(clampGameplay(draft));
  useAutosave({ dirty, locked: running, token, save: () => onSave(text) });
  // The addon toggle is not part of the draft: it is a comfig package write
  // that has to wait for the queue like any other.
  const addonLocked = running || busy;

  function patch(update: Partial<GameplaySettings>) {
    setDraft((current) => ({ ...current, ...update }));
  }

  return (
    <section data-testid="settings-gameplay" className="min-w-0 text-left">
      <div className="hero-row gameplay-workspace">
        <div>
          <PaneHeader title="Gameplay" />
          <div className="grid gap-6">
            <SliderRow
              id="gameplay-fov"
              testId="gameplay-fov"
              label="World FOV"
              description="How much of the world you can see."
              value={draft.fov_desired}
              min={FOV_MIN}
              max={FOV_MAX}
              suffix="°"
              onChange={(fov_desired) => patch({ fov_desired })}
            />
            {/* The readout keeps an imported fraction until the slider moves. */}
            <SliderRow
              id="gameplay-viewmodel-fov"
              testId="gameplay-viewmodel-fov"
              label="Viewmodel FOV"
              description="Weapon perspective, independent of your world view."
              value={draft.viewmodel_fov}
              inputValue={clampInt(draft.viewmodel_fov, 1, 179)}
              min={1}
              max={179}
              suffix="°"
              onChange={(viewmodel_fov) => patch({ viewmodel_fov })}
            />
          </div>
        </div>
        <aside
          className="surface hero-preview mt-8 self-start p-5"
          aria-label="Field of view values"
        >
          <h2 className="t-section">Field of view</h2>
          <dl className="mt-4 grid gap-3">
            <div className="flex items-baseline justify-between gap-3 border-b border-edge pb-3">
              <dt className="t-meta">World</dt>
              <dd className="tnum t-row">{draft.fov_desired}°</dd>
            </div>
            <div className="flex items-baseline justify-between gap-3">
              <dt className="t-meta">Weapon</dt>
              <dd className="tnum t-row">{draft.viewmodel_fov}°</dd>
            </div>
          </dl>
          <p className="t-meta mt-5 border-t border-edge pt-4">
            These values describe the cfg settings. Open TF2 to see the result with your HUD and
            viewmodel.
          </p>
        </aside>
      </div>

      <PaneSection
        id="gameplay-mouse"
        title="Mouse"
        description="Changes made in TF2’s options are picked up after the game closes."
        as="fieldset"
      >
        <div className="mt-3 grid gap-4 sm:grid-cols-2">
          <NumberField
            id="gameplay-sensitivity"
            testId="gameplay-sensitivity"
            label="Sensitivity"
            description="TF2’s default is 3."
            value={draft.sensitivity}
            resetKey={profileId}
            onChange={(sensitivity) => patch({ sensitivity })}
          />
          <NumberField
            id="gameplay-zoom-sensitivity"
            testId="gameplay-zoom-sensitivity"
            label="Zoomed sensitivity ratio"
            description="Multiplies sensitivity while scoped. TF2’s default is 1."
            value={draft.zoom_sensitivity_ratio}
            resetKey={profileId}
            onChange={(zoom_sensitivity_ratio) => patch({ zoom_sensitivity_ratio })}
          />
        </div>
      </PaneSection>

      <div className="section pane-split">
        <PaneSection id="gameplay-viewmodels" title="Viewmodels and weapons" as="fieldset" first>
          <SwitchRow
            id="gameplay-draw-viewmodel"
            testId="gameplay-draw-viewmodel"
            label="Draw viewmodel"
            checked={draft.r_drawviewmodel === 1}
            onChange={(next) => {
              patch({ r_drawviewmodel: next ? 1 : 0 });
              onDrawViewmodelChange?.(next);
            }}
          />
          <SwitchRow
            id="gameplay-min-viewmodels"
            testId="gameplay-min-viewmodels"
            label="Min viewmodels"
            description="Compact weapon placement."
            checked={draft.tf_use_min_viewmodels === 1}
            onChange={(next) => patch({ tf_use_min_viewmodels: next ? 1 : 0 })}
          />
          <SwitchRow
            id="gameplay-autoreload"
            testId="gameplay-autoreload"
            label="Auto reload"
            description="Reload clip weapons when you stop firing."
            checked={draft.cl_autoreload === 1}
            onChange={(next) => patch({ cl_autoreload: next ? 1 : 0 })}
          />
          <SwitchRow
            id="gameplay-fastswitch"
            testId="gameplay-fastswitch"
            label="Fast weapon switch"
            description="Select a weapon without a confirmation click."
            checked={draft.hud_fastswitch !== 0}
            note={
              draft.hud_fastswitch !== 0 && draft.hud_fastswitch !== 1
                ? `Your cfg uses weapon selection mode ${draft.hud_fastswitch}. It is kept until you change this switch; enabling it selects the standard fast-switch mode.`
                : undefined
            }
            onChange={(next) => patch({ hud_fastswitch: next ? 1 : 0 })}
          />
        </PaneSection>

        <section className="min-w-0">
          {/* The engine refuses r_drawtracers on any live server, so it is not an
            "obvious toggle" — it and its neighbours live behind a disclosure. */}
          <Disclosure
            profileId={profileId}
            storageKey="gameplay-advanced"
            summary="Advanced"
            testId="gameplay-advanced"
            defaultOpen
          >
            <fieldset className="min-w-0">
              <legend className="sr-only">Advanced gameplay options</legend>
              <SwitchRow
                id="gameplay-flip"
                testId="gameplay-flip"
                label="Left-handed viewmodels"
                checked={draft.cl_flipviewmodels === 1}
                note={FLIP_VIEWMODELS_NOTE}
                onChange={(next) => patch({ cl_flipviewmodels: next ? 1 : 0 })}
              />
              <SwitchRow
                id="gameplay-transparent-viewmodels"
                testId="gameplay-transparent-viewmodels"
                label="Transparent viewmodels"
                description={OFFICIAL_ADDON_DETAILS["transparent-viewmodels"]}
                checked={transparentViewmodels}
                disabled={addonLocked || !canUseComfigAddons}
                note={
                  canUseComfigAddons
                    ? "Managed in Comfig. Applies when you select it."
                    : "Available with a Comfig profile."
                }
                onChange={() => onToggleTransparentViewmodels()}
              />
              {onOpenComfig ? (
                <button type="button" className="btn btn-ghost mt-2" onClick={onOpenComfig}>
                  Open Comfig addons
                </button>
              ) : null}
              <SwitchRow
                id="gameplay-tracers-fp"
                testId="gameplay-tracers-fp"
                label="First-person tracers"
                checked={draft.r_drawtracers_firstperson === 1}
                onChange={(next) => patch({ r_drawtracers_firstperson: next ? 1 : 0 })}
              />
              <SwitchRow
                id="gameplay-tracers"
                testId="gameplay-tracers"
                label="All tracers"
                checked={draft.r_drawtracers === 1}
                note={ALL_TRACERS_NOTE}
                onChange={(next) => patch({ r_drawtracers: next ? 1 : 0 })}
              />
            </fieldset>
          </Disclosure>
        </section>
      </div>
      <p className="pane-note mt-6">Saved to {gameplayPath(layer)}.</p>
    </section>
  );
}

function SliderRow({
  id,
  testId,
  label,
  description,
  value,
  inputValue,
  min,
  max,
  step = 1,
  suffix = "",
  onChange,
}: {
  id: string;
  testId: string;
  label: string;
  description: string;
  value: number;
  inputValue?: number;
  min: number;
  max: number;
  step?: number;
  suffix?: string;
  onChange: (value: number) => void;
}) {
  return (
    <div>
      <div className="flex items-start justify-between gap-3">
        <div>
          <label htmlFor={id} className="t-row">
            {label}
          </label>
          <p id={`${id}-description`} className="t-meta mt-1">
            {description}
          </p>
        </div>
        <output
          htmlFor={id}
          className="tnum min-w-16 rounded-md border border-edge-strong bg-panel px-3 py-1.5 text-center text-[18px] font-medium text-ink"
        >
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
        step={step}
        value={inputValue ?? value}
        aria-describedby={`${id}-description`}
        onChange={(event) => onChange(Number(event.target.value))}
        className="range mt-3 block w-full"
      />
      <div className="tnum mt-1 flex justify-between text-[11px] text-ink-faint">
        <span>{min}</span>
        <span>{max}</span>
      </div>
    </div>
  );
}

/**
 * Exact decimal entry. The text the player types is kept while it is being
 * edited; only a valid number reaches the draft, so nothing is rounded.
 */
function NumberField({
  id,
  testId,
  label,
  description,
  value,
  resetKey,
  onChange,
}: {
  id: string;
  testId: string;
  label: string;
  description?: string;
  value: number;
  /** A different profile replaces whatever was typed. */
  resetKey: string | null;
  onChange: (value: number) => void;
}) {
  const [text, setText] = useState(() => formatCvarNumber(value));
  // biome-ignore lint/correctness/useExhaustiveDependencies: only a new profile or an outside value change replaces typed text.
  useEffect(() => {
    setText((current) => {
      const parsed = parseSensitivityInput(current);
      return parsed.value === value ? current : formatCvarNumber(value);
    });
  }, [value, resetKey]);
  const parsed = parseSensitivityInput(text);
  const describedBy = [
    description ? `${id}-description` : null,
    parsed.problem ? `${id}-problem` : null,
  ]
    .filter(Boolean)
    .join(" ");
  return (
    <div className="min-w-0">
      <label htmlFor={id} className="t-row block">
        {label}
      </label>
      {description ? (
        <p id={`${id}-description`} className="t-meta mt-1">
          {description}
        </p>
      ) : null}
      <input
        id={id}
        data-testid={testId}
        type="text"
        inputMode="decimal"
        autoComplete="off"
        spellCheck={false}
        value={text}
        aria-invalid={parsed.problem ? true : undefined}
        aria-describedby={describedBy || undefined}
        onChange={(event) => {
          setText(event.target.value);
          const next = parseSensitivityInput(event.target.value);
          if (next.value !== null) onChange(next.value);
        }}
        onBlur={() => {
          if (parsed.value !== null) setText(formatCvarNumber(parsed.value));
        }}
        className={`field tnum mt-2 block w-40 px-3 py-2 text-[15px] text-ink focus:outline-none ${
          parsed.problem ? "border-warn/70" : ""
        }`}
      />
      {parsed.problem ? (
        <p id={`${id}-problem`} role="alert" className="t-meta mt-1.5 text-warn">
          {parsed.problem} The saved value stays {formatCvarNumber(value)}.
        </p>
      ) : null}
    </div>
  );
}
