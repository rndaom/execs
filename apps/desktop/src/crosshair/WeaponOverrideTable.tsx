import { ClassTabs } from "../components/ui/ClassTabs";
import { Disclosure } from "../components/ui/Disclosure";
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
import { CrosshairChoice } from "./CrosshairChoice";
import type { PreviewPixels } from "./useCrosshairDraft";

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
  previewFor,
  onSelectClass,
  onChange,
}: {
  draft: CrosshairDraft;
  choices: CrosshairShape[];
  classTab: ClassTab;
  locked: boolean;
  previewFor: (name: string) => PreviewPixels | null;
  onSelectClass: (tab: ClassTab) => void;
  onChange: (next: CrosshairDraft) => void;
}) {
  const slots = catalogSlots();
  const tabs = [ALL_CLASSES_TAB, ...TF2_CLASSES].map((id) => ({
    id,
    label: <span className="capitalize">{id === ALL_CLASSES_TAB ? "All classes" : id}</span>,
  }));
  const overrides = Object.keys(draft.assignments).length;

  return (
    <Disclosure
      storageKey="crosshair-overrides"
      summary={
        <span className="flex items-center gap-2">
          Weapon overrides
          {overrides > 0 ? <span className="badge tnum">{overrides}</span> : null}
        </span>
      }
      testId="crosshair-overrides"
      className="mt-8 border-t border-edge pt-2"
    >
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
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
                <div key={slot} className="row min-h-11 text-[14px] text-ink">
                  <span className="min-w-0">
                    <span className="block">{slotLabel(slot)}</span>
                    <span className="eyebrow mt-0.5 block">
                      {shared === null ? "Mixed shapes" : "Every class"}
                    </span>
                  </span>
                  <CrosshairChoice
                    testId={`crosshair-slot-${slot}`}
                    label={`Crosshair for every ${slot} weapon`}
                    value={shared ?? draft.shape}
                    mixed={shared === null}
                    choices={choices}
                    color={draft.color}
                    customRgba={draft.customRgba}
                    previewFor={previewFor}
                    disabled={locked}
                    onChange={(shape) => onChange(assignSlotForAllClasses(draft, slot, shape))}
                  />
                </div>
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
            <div key={weapon.script} className="row min-h-11 text-[14px] text-ink">
              <span className="min-w-0">
                <span className="block truncate text-[14px]">{weapon.label}</span>
                <span className="eyebrow mt-0.5 block">{weapon.slot}</span>
              </span>
              <CrosshairChoice
                testId={`crosshair-weapon-${weapon.script}`}
                label={`Crosshair for ${weapon.label}`}
                value={assignmentFor(draft, weapon.script)}
                choices={choices}
                color={draft.color}
                customRgba={draft.customRgba}
                previewFor={previewFor}
                disabled={locked}
                onChange={(shape) =>
                  onChange({
                    ...draft,
                    assignments: { ...draft.assignments, [weapon.script]: shape },
                  })
                }
              />
            </div>
          ))}
        </div>
      )}
    </Disclosure>
  );
}
