import { ArrowSquareOut, DownloadSimple, Trash } from "@phosphor-icons/react";
import { useEffect, useMemo, useState } from "react";
import { ApplyBar } from "./components/ui/ApplyBar";
import { ClassTabs } from "./components/ui/ClassTabs";
import { PaneHeader } from "./components/ui/PaneHeader";
import { PaneSection } from "./components/ui/PaneSection";
import { SwitchRow } from "./components/ui/Switch";
import { useAppStatus, useCanWrite } from "./hooks/useAppStatus";
import { useSeededDraft } from "./hooks/useSeededDraft";
import {
  isTauri,
  openExternal,
  type ViewmodelHideMode,
  type ViewmodelRecord,
  viewmodelBuildAvailable,
} from "./lib/bridge";
import { viewmodelGroupsForClass } from "./lib/viewmodel-groups";
import {
  previewSlotHidden,
  VIEWMODEL_PREVIEW_CREDIT,
  VIEWMODEL_PREVIEW_SLOTS,
  VIEWMODEL_PREVIEW_WEAPONS,
  type ViewmodelPreviewSlot,
  viewmodelPreviewSrc,
} from "./lib/viewmodel-previews";
import {
  HIDE_MODE_LABELS,
  HIDE_MODE_NOTES,
  SOLDIER_ORIGINAL_NOTE,
  seedViewmodelDraft,
  serializeHiddenGroups,
  toggleHiddenGroup,
  VIEWMODEL_CASUAL_COPY,
  VIEWMODEL_CLASSES,
  type ViewmodelClass,
  type ViewmodelDraft,
} from "./lib/viewmodel-ui";

const CLASS_TAB_PREFIX = "viewmodel-class-tab";
const GROUPS_PANEL_ID = "viewmodel-groups-panel";
const SOLDIER_NOTE_ID = "viewmodel-soldier-original-note";

function serializeViewmodelDraft(draft: ViewmodelDraft): string {
  return JSON.stringify([serializeHiddenGroups(draft.hidden), draft.hideMode, draft.preload]);
}

export function ViewmodelPane({
  record,
  onBuild,
  onImport,
  onRemove,
  onTogglePreload,
}: {
  record: ViewmodelRecord | null;
  onBuild: (hidden: string[], preload: boolean, hideMode: ViewmodelHideMode) => void;
  onImport: (preload: boolean) => void;
  onRemove: () => void;
  onTogglePreload: (enabled: boolean) => void;
}) {
  const { running } = useAppStatus();
  const locked = !useCanWrite();
  const recordKey = JSON.stringify(record ?? null);
  // biome-ignore lint/correctness/useExhaustiveDependencies: recordKey covers record by value.
  const seeded = useMemo(() => seedViewmodelDraft(record), [recordKey]);
  const [draft, setDraft] = useSeededDraft(seeded, serializeViewmodelDraft, recordKey);
  const [classId, setClassId] = useState<ViewmodelClass>("scout");
  const [slot, setSlot] = useState<ViewmodelPreviewSlot>("primary");
  // Building needs TF2's own studiomdl, which only the Windows depot ships.
  // Assume yes until the probe says otherwise, so the button never flickers
  // disabled on a machine that can build.
  const [canBuild, setCanBuild] = useState(true);

  useEffect(() => {
    if (!isTauri()) {
      return;
    }
    let cancelled = false;
    viewmodelBuildAvailable()
      .then((available) => {
        if (!cancelled) {
          setCanBuild(available);
        }
      })
      .catch(() => {
        // A failed probe is not evidence the machine cannot build.
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const slotsForClass = VIEWMODEL_PREVIEW_SLOTS.filter(
    (item) => VIEWMODEL_PREVIEW_WEAPONS[classId][item] !== undefined,
  );
  const activeSlot = slotsForClass.includes(slot) ? slot : slotsForClass[0];
  const previewSrc = viewmodelPreviewSrc(classId, activeSlot);
  const previewWeapon = VIEWMODEL_PREVIEW_WEAPONS[classId][activeSlot];
  const groups = viewmodelGroupsForClass(classId);
  const hiddenSet = new Set(draft.hidden);
  const previewHidden = previewSlotHidden(classId, activeSlot, hiddenSet);
  const dirty =
    serializeHiddenGroups(draft.hidden) !== serializeHiddenGroups(seeded.hidden) ||
    draft.hideMode !== seeded.hideMode;
  const builtPack = record?.source === "compiled";
  const allClassHidden = groups.every((group) => hiddenSet.has(group.id));
  const isSoldier = classId === "soldier";

  function hiddenCountFor(cls: ViewmodelClass): number {
    return viewmodelGroupsForClass(cls).filter((group) => hiddenSet.has(group.id)).length;
  }

  const buildStatus = !canBuild
    ? "Building packs needs TF2's studiomdl (Windows only for now)."
    : running
      ? "Close TF2 to build."
      : draft.hidden.length === 0 && record
        ? "Nothing ticked — use Remove pack above to restore stock viewmodels."
        : draft.hidden.length === 0
          ? "Nothing hidden yet — tick groups above, then build."
          : dirty || !builtPack
            ? "Build compiles with TF2's own studiomdl in an isolated staging folder (Windows)."
            : "The installed pack matches these choices.";

  return (
    <section data-testid="settings-viewmodels" className="min-w-0 text-left">
      <PaneHeader
        title="Viewmodels"
        lede="Pick a class, tick the animation groups to hide, then build. Field of view and min viewmodels live on the Gameplay pane."
        actions={
          <>
            <span className="tnum t-meta text-ink-faint">
              {draft.hidden.length} hidden {draft.hidden.length === 1 ? "group" : "groups"}
            </span>
            <span
              data-testid="viewmodel-pack-status"
              className={`badge ${record ? "badge-ok" : ""}`}
            >
              {record ? (builtPack ? "Built pack" : "Imported pack") : "No pack installed"}
            </span>
          </>
        }
      />

      <section aria-label="Hide viewmodels">
        <div>
          <ClassTabs
            tabs={VIEWMODEL_CLASSES.map((id) => {
              const count = hiddenCountFor(id);
              return {
                id,
                label: <span className="capitalize">{id}</span>,
                meta: count > 0 ? count : undefined,
              };
            })}
            selected={classId}
            label="TF2 class"
            idPrefix={CLASS_TAB_PREFIX}
            panelId={GROUPS_PANEL_ID}
            onSelect={setClassId}
          />
        </div>

        <div
          id={GROUPS_PANEL_ID}
          role="tabpanel"
          aria-labelledby={`${CLASS_TAB_PREFIX}-${classId}`}
          className="mt-5 grid gap-8 lg:grid-cols-[minmax(0,1fr)_minmax(0,20rem)]"
        >
          <div>
            <figure className="surface vm-stage relative aspect-video w-full">
              {previewSrc ? (
                <img
                  data-testid="viewmodel-preview-image"
                  data-hidden={previewHidden ? "true" : "false"}
                  src={previewSrc}
                  alt={`${previewWeapon ?? activeSlot} first-person view for ${classId}`}
                  className={`absolute inset-0 size-full object-contain object-[80%_100%] p-5 drop-shadow-[0_12px_28px_rgba(0,0,0,0.6)] transition-opacity ${
                    previewHidden ? "opacity-0" : "opacity-100"
                  }`}
                />
              ) : (
                <p className="t-meta absolute inset-0 grid place-items-center">
                  No reference image for this slot.
                </p>
              )}
              {previewHidden ? (
                <p
                  data-testid="viewmodel-preview-hidden"
                  className="t-meta absolute inset-0 grid place-items-center px-6 text-center"
                >
                  {draft.hideMode === "weapon"
                    ? "Weapon hidden — your hands keep animating."
                    : "Weapon and hands hidden."}
                </p>
              ) : null}
              <figcaption className="absolute bottom-2.5 left-3 text-[12px] text-ink-muted">
                <span className="capitalize">{classId}</span> · {previewWeapon ?? activeSlot}
              </figcaption>
            </figure>
            <div className="mt-2 flex gap-1">
              {slotsForClass.map((item) => (
                <button
                  key={item}
                  type="button"
                  data-testid={`viewmodel-slot-${item}`}
                  data-active={activeSlot === item ? "true" : "false"}
                  onClick={() => setSlot(item)}
                  className={`rounded-lg px-3 py-1.5 text-[13px] capitalize transition-colors duration-150 ${
                    activeSlot === item
                      ? "bg-panel-raised text-ink"
                      : "text-ink-muted hover:bg-panel hover:text-ink"
                  }`}
                >
                  {item}
                </button>
              ))}
            </div>
            <p className="mt-3 text-[12px] leading-5 text-ink-faint">
              Reference imagery only — groups map to animation sets, not single weapons.
            </p>
          </div>

          <div className="min-w-0">
            <div className="flex items-center justify-between gap-3">
              <p className="t-row capitalize">{classId} groups</p>
              <button
                type="button"
                data-testid="viewmodel-hide-all-class"
                disabled={locked}
                onClick={() => {
                  setDraft((current) => {
                    let hidden = current.hidden;
                    for (const group of groups) {
                      const has = hidden.includes(group.id);
                      if (allClassHidden ? has : !has) {
                        hidden = toggleHiddenGroup(hidden, group.id);
                      }
                    }
                    return { ...current, hidden };
                  });
                }}
                className="text-[12.5px] text-ink-muted underline decoration-edge-strong underline-offset-2 hover:text-ink disabled:opacity-40"
              >
                {allClassHidden ? "Show all" : "Hide all"}
              </button>
            </div>
            <ul className="mt-1 list-none p-0">
              {groups.map((group) => {
                const hidden = hiddenSet.has(group.id);
                return (
                  <li key={group.id} className="border-b border-edge">
                    <label
                      className="flex min-h-11 cursor-pointer items-center gap-3 py-2.5"
                      htmlFor={`viewmodel-group-${group.id}`}
                    >
                      <input
                        id={`viewmodel-group-${group.id}`}
                        data-testid={`viewmodel-group-${group.id}`}
                        type="checkbox"
                        checked={hidden}
                        disabled={locked}
                        aria-describedby={isSoldier ? SOLDIER_NOTE_ID : undefined}
                        onChange={() =>
                          setDraft((current) => ({
                            ...current,
                            hidden: toggleHiddenGroup(current.hidden, group.id),
                          }))
                        }
                        className="size-4 shrink-0 accent-brand disabled:opacity-40"
                      />
                      <span className="min-w-0 flex-1 text-[14px] text-ink">{group.label}</span>
                      {isSoldier ? (
                        <span
                          data-testid={`viewmodel-group-original-${group.id}`}
                          className="badge shrink-0"
                        >
                          + Original
                        </span>
                      ) : null}
                    </label>
                  </li>
                );
              })}
            </ul>
            {isSoldier ? (
              <p id={SOLDIER_NOTE_ID} className="mt-3 text-[12px] leading-5 text-ink-faint">
                {SOLDIER_ORIGINAL_NOTE}
              </p>
            ) : null}
          </div>
        </div>

        <div className="mt-8 border-t border-edge pt-5">
          <h3 className="t-row">What a hidden group removes</h3>
          <div className="mt-3 flex flex-wrap gap-2">
            {(["full", "weapon"] as const).map((mode) => (
              <button
                key={mode}
                type="button"
                data-testid={`viewmodel-mode-${mode}`}
                aria-pressed={draft.hideMode === mode}
                disabled={locked}
                onClick={() => setDraft((current) => ({ ...current, hideMode: mode }))}
                className={`btn ${
                  draft.hideMode === mode
                    ? "btn-ghost border-transparent text-ink shadow-[inset_0_0_0_1.5px_var(--color-brand)]"
                    : "btn-ghost"
                }`}
              >
                {HIDE_MODE_LABELS[mode]}
              </button>
            ))}
          </div>
          <p className="mt-3 min-h-10 max-w-[62ch] text-[12.5px] leading-5 text-ink-faint">
            {HIDE_MODE_NOTES[draft.hideMode]}
          </p>
        </div>
      </section>

      <PaneSection
        title="Pack and preload"
        description="Prefer a ready-made pack? Import any prebuilt viewmodel VPK instead of building."
      >
        <div className="mt-4 flex flex-wrap items-center gap-2">
          <button
            type="button"
            data-testid="viewmodel-import"
            disabled={locked}
            onClick={() => onImport(draft.preload)}
            className="btn btn-ghost"
          >
            <DownloadSimple size={15} />
            {record ? "Replace with a VPK…" : "Import prebuilt VPK…"}
          </button>
          {record ? (
            <button
              type="button"
              data-testid="viewmodel-remove"
              disabled={locked}
              onClick={onRemove}
              className="btn btn-ghost"
            >
              <Trash size={14} />
              Remove pack
            </button>
          ) : null}
        </div>

        <div className="mt-4 max-w-xl">
          <SwitchRow
            id="viewmodel-preload"
            testId="viewmodel-preload"
            label="Casual preload"
            description="Precache on itemtest before joining Valve Casual so the pack applies there. Community and listen servers work without it."
            checked={draft.preload}
            disabled={locked}
            onChange={(next) => {
              // With a pack installed the write is the source of truth: flipping
              // the draft here would leave the switch in the new position even
              // when the command fails. Let the reseeded record move it. Without
              // a pack there is nothing to write — this is just the preference
              // the next build/import will use.
              if (record) {
                onTogglePreload(next);
                return;
              }
              setDraft((current) => ({ ...current, preload: next }));
            }}
          />
        </div>
      </PaneSection>

      <p className="t-meta mt-12 text-ink-faint">
        {VIEWMODEL_CASUAL_COPY} Hidden-viewmodel animations from{" "}
        <button
          type="button"
          onClick={() => void openExternal("https://github.com/Yttrium-tYcLief/CompVMInstaller")}
          className="inline-flex items-center gap-0.5 text-ink-muted underline decoration-edge-strong underline-offset-2 hover:text-ink"
        >
          Yttrium's Competitive Viewmodels
          <ArrowSquareOut size={11} />
        </button>{" "}
        (©2018 yttrium), fetched from the original project and rebuilt locally.{" "}
        {VIEWMODEL_PREVIEW_CREDIT}
      </p>

      <ApplyBar
        status={buildStatus}
        actionLabel={builtPack ? "Rebuild pack" : "Build and install pack"}
        lockedLabel="Close TF2 to build"
        running={running}
        locked={!canBuild || locked}
        dirty={draft.hidden.length > 0 && (dirty || !builtPack)}
        testId="viewmodel-build"
        onApply={() => onBuild(draft.hidden, draft.preload, draft.hideMode)}
      />
    </section>
  );
}
