import { ArrowCounterClockwise } from "@phosphor-icons/react";
import { type ReactNode, useState } from "react";
import { ClassIcon } from "../components/ui/ClassIcon";
import { ClassTabs } from "../components/ui/ClassTabs";
import {
  assignmentFor,
  assignSlotForAllClasses,
  type CrosshairColor,
  type CrosshairDraft,
  type CrosshairShape,
  catalogSlots,
  effectiveAssignments,
  slotAssignment,
  TF2_CLASSES,
  type Tf2Class,
  WEAPON_CATALOG,
  type WeaponSlot,
  weaponsForClass,
} from "../lib/crosshair-ui";
import { ChoiceArt, type GalleryGroup } from "./CrosshairGallery";
import { CrosshairThumb } from "./CrosshairThumb";
import type { PreviewPixels } from "./useCrosshairDraft";

export const ALL_CLASSES = "all" as const;
export type ClassChoice = typeof ALL_CLASSES | Tf2Class;

/** The row being chosen for: a slot across every class, or one weapon. */
type Target = { kind: "slot"; slot: WeaponSlot } | { kind: "weapon"; script: string };

const MAIN = "__main__";
const PANEL_ID = "crosshair-weapons-panel";
const TAB_PREFIX = "crosshair-class-tab";

export function slotLabel(slot: string): string {
  return slot === "pda" ? "PDA" : slot[0].toUpperCase() + slot.slice(1);
}

function classLabel(classId: string): string {
  return classId[0].toUpperCase() + classId.slice(1);
}

function firstTarget(classId: ClassChoice): Target {
  return classId === ALL_CLASSES
    ? { kind: "slot", slot: catalogSlots()[0] }
    : { kind: "weapon", script: weaponsForClass(classId)[0].script };
}

/**
 * Crosshairs that differ for some weapons, laid out on the page: class tabs,
 * the class's weapons, and the choices for the selected weapon beside them as
 * pictures. Nothing drops down; "Main" removes an exception.
 */
export function WeaponCrosshairs({
  draft,
  groups,
  color,
  pixelsFor,
  labelFor,
  onChange,
  disabledReason,
  savedAssignments,
}: {
  draft: CrosshairDraft;
  groups: GalleryGroup[];
  color: CrosshairColor;
  pixelsFor: (name: string) => PreviewPixels | null;
  labelFor: (name: string) => string;
  onChange: (next: CrosshairDraft) => void;
  /** Why exceptions cannot be set right now, if they cannot. */
  disabledReason?: string;
  /** Exceptions kept in a switched-off pack. */
  savedAssignments: Record<string, string>;
}) {
  const [classId, setClassId] = useState<ClassChoice>(ALL_CLASSES);
  const [target, setTarget] = useState<Target>(() => firstTarget(ALL_CLASSES));
  const differing = effectiveAssignments(draft);
  const count = Object.keys(differing).length;
  const canRestore = count === 0 && Object.keys(savedAssignments).length > 0;
  const disabled = Boolean(disabledReason);

  const tabs = [ALL_CLASSES, ...TF2_CLASSES].map((id) => ({
    id,
    label: (
      <>
        {id === ALL_CLASSES ? null : <ClassIcon classId={id} size={16} />}
        <span>{id === ALL_CLASSES ? "All classes" : classLabel(id)}</span>
      </>
    ),
    meta:
      id === ALL_CLASSES
        ? undefined
        : weaponsForClass(id).filter((weapon) => weapon.script in differing).length || undefined,
  }));

  const rows =
    classId === ALL_CLASSES
      ? catalogSlots().map((slot) => ({
          key: `slot:${slot}`,
          group: "Every class",
          title: `${slotLabel(slot)} weapons`,
          value: slotAssignment(draft, slot),
          target: { kind: "slot", slot } as Target,
          testId: `crosshair-slot-${slot}`,
        }))
      : weaponsForClass(classId).map((weapon) => ({
          key: weapon.script,
          group: slotLabel(weapon.slot),
          title: weapon.label,
          value: assignmentFor(draft, weapon.script) as CrosshairShape | null,
          target: { kind: "weapon", script: weapon.script } as Target,
          testId: `crosshair-weapon-${weapon.script}`,
        }));
  const sameTarget = (a: Target, b: Target) =>
    a.kind === b.kind &&
    (a.kind === "slot" ? a.slot === (b as typeof a).slot : a.script === (b as typeof a).script);
  const current =
    target.kind === "slot"
      ? slotAssignment(draft, target.slot)
      : assignmentFor(draft, target.script);
  const targetTitle =
    target.kind === "slot"
      ? `Every ${slotLabel(target.slot).toLowerCase()} weapon`
      : (WEAPON_CATALOG.find((weapon) => weapon.script === target.script)?.label ?? target.script);
  const usesMain = current === draft.shape;

  function choose(choice: string) {
    if (target.kind === "slot") {
      onChange(assignSlotForAllClasses(draft, target.slot, choice === MAIN ? draft.shape : choice));
      return;
    }
    const assignments = { ...draft.assignments };
    if (choice === MAIN || choice === draft.shape) delete assignments[target.script];
    else assignments[target.script] = choice;
    onChange({ ...draft, assignments });
  }

  let lastGroup = "";
  return (
    <section
      className="section crosshair-perweapon-section"
      aria-labelledby="crosshair-weapons-heading"
    >
      <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
        <div className="min-w-0">
          <h2 id="crosshair-weapons-heading" className="t-section">
            Per weapon
          </h2>
          <p className="t-meta mt-1" data-testid="crosshair-weapon-count">
            {count === 0
              ? "Every weapon uses the main crosshair."
              : `${count} ${count === 1 ? "weapon uses" : "weapons use"} a different crosshair.`}
          </p>
        </div>
        {count > 0 ? (
          <button
            type="button"
            className="btn btn-quiet"
            data-testid="crosshair-weapons-reset"
            onClick={() => onChange({ ...draft, assignments: {} })}
          >
            <ArrowCounterClockwise size={14} />
            Reset every weapon
          </button>
        ) : null}
      </div>

      {disabledReason ? <p className="pane-note mt-3">{disabledReason}</p> : null}
      {canRestore && !disabled ? (
        <div className="pane-note mt-3" data-testid="crosshair-restore-weapons">
          <p>Your earlier per-weapon crosshairs are kept with the switched-off pack.</p>
          <button
            type="button"
            className="btn btn-ghost mt-2"
            onClick={() => onChange({ ...draft, assignments: { ...savedAssignments } })}
          >
            Restore them
          </button>
        </div>
      ) : null}

      <div className="mt-4">
        <ClassTabs
          tabs={tabs}
          selected={classId}
          label="TF2 class"
          idPrefix={TAB_PREFIX}
          panelId={PANEL_ID}
          onSelect={(next) => {
            setClassId(next);
            setTarget(firstTarget(next));
          }}
        />
      </div>

      <div
        id={PANEL_ID}
        role="tabpanel"
        aria-labelledby={`${TAB_PREFIX}-${classId}`}
        className="crosshair-perweapon"
        data-disabled={disabled || undefined}
      >
        <div className="crosshair-perweapon-list" data-testid="crosshair-weapons">
          {rows.map((row) => {
            const heading = row.group !== lastGroup ? row.group : null;
            lastGroup = row.group;
            const selected = sameTarget(row.target, target);
            const main = row.value === draft.shape;
            return (
              <div key={row.key}>
                {heading ? <p className="eyebrow mt-4 mb-1 first:mt-1">{heading}</p> : null}
                <button
                  type="button"
                  data-testid={row.testId}
                  data-value={row.value ?? "mixed"}
                  aria-pressed={selected}
                  disabled={disabled}
                  className="crosshair-editor-weapon"
                  onClick={() => setTarget(row.target)}
                >
                  {row.value === null ? (
                    <span className="crosshair-thumb grid size-8 place-items-center text-ink-faint">
                      …
                    </span>
                  ) : (
                    <CrosshairThumb pixels={pixelsFor(row.value)} color={color} size={32} />
                  )}
                  <span className="min-w-0 flex-1 truncate text-left">{row.title}</span>
                  <span
                    className={`max-w-[45%] truncate text-right text-[12.5px] ${main ? "text-ink-faint" : "text-ink"}`}
                  >
                    {row.value === null ? "Mixed" : main ? "Main" : labelFor(row.value)}
                  </span>
                </button>
              </div>
            );
          })}
        </div>

        <div className="crosshair-perweapon-choices">
          <div className="flex items-center gap-3">
            <span className="crosshair-editor-current" aria-hidden="true">
              {current === null ? (
                <span className="text-ink-faint">…</span>
              ) : (
                <ChoiceArt name={current} pixels={pixelsFor(current)} color={color} />
              )}
            </span>
            <div className="min-w-0">
              <p className="t-row truncate" data-testid="crosshair-editor-target">
                {targetTitle}
              </p>
              <p className="t-meta truncate">
                {current === null ? "Mixed" : usesMain ? "Main crosshair" : labelFor(current)}
              </p>
            </div>
          </div>
          <div
            className="mt-4 grid gap-4"
            role="radiogroup"
            aria-label={`Crosshair for ${targetTitle}`}
          >
            <div className="crosshair-grid crosshair-grid-compact">
              <Choice
                name={MAIN}
                label="Main crosshair"
                shortLabel="Main"
                art={
                  <ChoiceArt
                    name={draft.shape}
                    pixels={pixelsFor(draft.shape)}
                    color={color}
                    size={48}
                  />
                }
                selected={usesMain}
                disabled={disabled}
                onPick={choose}
              />
            </div>
            {groups.map((group) =>
              group.items.length ? (
                <div key={group.id}>
                  <p className="eyebrow mb-2">{group.title}</p>
                  <div className="crosshair-grid crosshair-grid-compact">
                    {group.items.map((name) => (
                      <Choice
                        key={name}
                        name={name}
                        label={labelFor(name)}
                        art={
                          <ChoiceArt name={name} pixels={pixelsFor(name)} color={color} size={48} />
                        }
                        selected={!usesMain && current === name}
                        disabled={disabled}
                        onPick={choose}
                      />
                    ))}
                  </div>
                </div>
              ) : null,
            )}
          </div>
        </div>
      </div>
    </section>
  );
}

function Choice({
  name,
  label,
  shortLabel,
  art,
  selected,
  disabled,
  onPick,
}: {
  name: string;
  label: string;
  shortLabel?: string;
  art: ReactNode;
  selected: boolean;
  disabled: boolean;
  onPick: (name: string) => void;
}) {
  return (
    // biome-ignore lint/a11y/useSemanticElements: picking applies immediately; native radios would apply on every arrow key.
    <button
      type="button"
      role="radio"
      aria-checked={selected}
      title={label}
      disabled={disabled}
      data-testid={`crosshair-weapon-option-${name === MAIN ? "main" : name}`}
      data-selected={selected}
      className="crosshair-choice crosshair-choice-sm"
      onClick={() => onPick(name)}
    >
      {art}
      <span className="crosshair-choice-name">{shortLabel ?? label}</span>
    </button>
  );
}
