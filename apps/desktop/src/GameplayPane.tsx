import { useEffect, useMemo, useState } from "react";
import { Disclosure } from "./components/ui/Disclosure";
import { PaneHeader } from "./components/ui/PaneHeader";
import { PaneSection } from "./components/ui/PaneSection";
import { SliderRow } from "./components/ui/SliderRow";
import { SwitchRow } from "./components/ui/Switch";
import { useAppStatus } from "./hooks/useAppStatus";
import { useAutosave } from "./hooks/useAutosave";
import { draftRecordKey, useSeededDraft } from "./hooks/useSeededDraft";
import {
  ALL_TRACERS_NOTE,
  clampGameplay,
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
  /** Viewmodel FOV, visibility and transparency live in the Viewmodels pane. */
  onOpenViewmodels?: () => void;
  /** Resolves when the write settles; the toast reports it. */
  onSave: (gameplayText: string) => Promise<unknown>;
};

export function GameplayPane({
  profileId,
  layer,
  effective,
  managedText,
  onOpenViewmodels,
  onSave,
}: GameplayPaneProps) {
  const { running } = useAppStatus();
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

      <PaneSection id="gameplay-mouse" title="Mouse" as="fieldset">
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
        <PaneSection id="gameplay-weapons" title="Weapons" as="fieldset" first>
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
          <SwitchRow
            id="gameplay-medigun-autoheal"
            testId="gameplay-medigun-autoheal"
            label="Medigun auto-heal"
            description="Click once to keep healing instead of holding fire."
            checked={draft.tf_medigun_autoheal === 1}
            onChange={(next) => patch({ tf_medigun_autoheal: next ? 1 : 0 })}
          />
        </PaneSection>

        <PaneSection id="gameplay-combat-feedback" title="Combat feedback" as="fieldset" first>
          <SwitchRow
            id="gameplay-combattext"
            testId="gameplay-combattext"
            label="Damage numbers"
            description="Show the damage you deal over each target."
            checked={draft.hud_combattext === 1}
            onChange={(next) => patch({ hud_combattext: next ? 1 : 0 })}
          />
          <SwitchRow
            id="gameplay-combattext-batching"
            testId="gameplay-combattext-batching"
            label="Combine damage numbers"
            description="Merge hits that land close together into one number."
            checked={draft.hud_combattext_batching === 1}
            note={draft.hud_combattext === 1 ? undefined : "Applies when damage numbers are on."}
            onChange={(next) => patch({ hud_combattext_batching: next ? 1 : 0 })}
          />
          <SwitchRow
            id="gameplay-combattext-healing"
            testId="gameplay-combattext-healing"
            label="Healing numbers"
            description="Show health restored per second over players you heal."
            checked={draft.hud_combattext_healing === 1}
            onChange={(next) => patch({ hud_combattext_healing: next ? 1 : 0 })}
          />
        </PaneSection>
      </div>

      <div className="section pane-split">
        <PaneSection
          id="gameplay-viewmodels"
          title="Viewmodels"
          description="Viewmodel FOV, visibility, left-handed and transparent viewmodels are in Viewmodels."
          first
        >
          {onOpenViewmodels ? (
            <button
              type="button"
              data-testid="gameplay-open-viewmodels"
              className="btn btn-ghost mt-3"
              onClick={onOpenViewmodels}
            >
              Open Viewmodels
            </button>
          ) : null}
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
      <p className="pane-note mt-6">
        Saved to {gameplayPath(layer)}. Changes made in TF2’s options are picked up after the game
        closes.
      </p>
    </section>
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
