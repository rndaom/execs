import { ClassTabs } from "../components/ui/ClassTabs";
import {
  assignmentFor,
  assignSlotForAllClasses,
  type CrosshairDraft,
  type CrosshairShape,
  catalogSlots,
  copyClassToAllClasses,
  slotAssignment,
  TF2_CLASSES,
  type Tf2Class,
  weaponsForClass,
} from "../lib/crosshair-ui";
import { crosshairShapeLabel } from "./CrosshairPreview";

export const ALL_CLASSES_TAB = "all" as const;

export type ClassTab = typeof ALL_CLASSES_TAB | Tf2Class;

const PANEL_ID = "crosshair-weapons-panel";
const TAB_PREFIX = "crosshair-class-tab";

function slotLabel(slot: string): string {
  return slot === "pda" ? "PDA" : slot[0].toUpperCase() + slot.slice(1);
}

/**
 * Per-slot ("All classes") and per-weapon crosshair overrides behind one class
 * tablist. Picking the base shape for a slot clears the overrides rather than
 * freezing them, so the base-shape fallback keeps working.
 */
export function WeaponOverrideTable({
  draft,
  choices,
  classTab,
  locked,
  onSelectClass,
  onChange,
}: {
  draft: CrosshairDraft;
  choices: CrosshairShape[];
  classTab: ClassTab;
  locked: boolean;
  onSelectClass: (tab: ClassTab) => void;
  onChange: (next: CrosshairDraft) => void;
}) {
  const slots = catalogSlots();
  const tabs = [ALL_CLASSES_TAB, ...TF2_CLASSES].map((id) => ({
    id,
    label: <span className="capitalize">{id === ALL_CLASSES_TAB ? "All classes" : id}</span>,
  }));

  return (
    <div className="mt-8 border-t border-edge pt-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h3 className="t-row">Weapon overrides</h3>
          <p className="t-meta mt-0.5">
            Set whole slots for every class at once, or pick a class to fine-tune single weapons.
          </p>
        </div>
        {classTab !== ALL_CLASSES_TAB ? (
          <button
            type="button"
            data-testid="crosshair-copy-class"
            disabled={locked}
            onClick={() => onChange(copyClassToAllClasses(draft, classTab))}
            className="btn btn-ghost"
          >
            Apply {classTab}'s shapes to all classes
          </button>
        ) : (
          <span className="tnum text-[12.5px] text-ink-faint">{slots.length} weapon slots</span>
        )}
      </div>

      <div className="mt-3">
        <ClassTabs
          tabs={tabs}
          selected={classTab}
          label="TF2 class"
          idPrefix={TAB_PREFIX}
          panelId={PANEL_ID}
          onSelect={onSelectClass}
        />
      </div>

      {classTab === ALL_CLASSES_TAB ? (
        <div
          id={PANEL_ID}
          className="mt-3"
          data-testid="crosshair-all-classes"
          role="tabpanel"
          aria-labelledby={`${TAB_PREFIX}-${ALL_CLASSES_TAB}`}
        >
          <div className="grid gap-2 md:grid-cols-2">
            {slots.map((slot) => {
              const shared = slotAssignment(draft, slot);
              return (
                <label key={slot} className="row min-h-11 text-[14px] text-ink">
                  <span className="min-w-0">
                    <span className="block">{slotLabel(slot)}</span>
                    <span className="eyebrow mt-0.5 block">
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
                      onChange(assignSlotForAllClasses(draft, slot, value as CrosshairShape));
                    }}
                    className="field max-w-40 shrink-0 px-2 py-1.5 text-[13px] capitalize text-ink outline-none disabled:opacity-50"
                  >
                    {shared === null ? (
                      <option value="mixed" disabled>
                        mixed
                      </option>
                    ) : null}
                    {choices.map((shape) => (
                      <option key={shape} value={shape}>
                        {crosshairShapeLabel(shape)}
                      </option>
                    ))}
                  </select>
                </label>
              );
            })}
          </div>
          <p className="mt-3 text-[12px] leading-5 text-ink-faint">
            Slot picks apply to every weapon in that slot across all nine classes.
          </p>
        </div>
      ) : (
        <div
          id={PANEL_ID}
          className="mt-3 grid gap-x-8 md:grid-cols-2"
          data-testid="crosshair-weapons"
          role="tabpanel"
          aria-labelledby={`${TAB_PREFIX}-${classTab}`}
        >
          {weaponsForClass(classTab).map((weapon) => (
            <label key={weapon.script} className="row min-h-11 text-[14px] text-ink">
              <span className="min-w-0">
                <span className="block truncate text-[14px]">{weapon.label}</span>
                <span className="eyebrow mt-0.5 block">{weapon.slot}</span>
              </span>
              <select
                data-testid={`crosshair-weapon-${weapon.script}`}
                aria-label={`Crosshair for ${weapon.label}`}
                disabled={locked}
                value={assignmentFor(draft, weapon.script)}
                onChange={(event) =>
                  onChange({
                    ...draft,
                    assignments: {
                      ...draft.assignments,
                      [weapon.script]: event.target.value as CrosshairShape,
                    },
                  })
                }
                className="field max-w-36 shrink-0 px-2 py-1.5 text-[13px] capitalize text-ink outline-none disabled:opacity-50"
              >
                {choices.map((shape) => (
                  <option key={shape} value={shape}>
                    {crosshairShapeLabel(shape)}
                  </option>
                ))}
              </select>
            </label>
          ))}
        </div>
      )}
    </div>
  );
}
