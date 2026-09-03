import { ArrowSquareOut, DownloadSimple, Eye, EyeSlash, Trash } from "@phosphor-icons/react";
import { useEffect, useMemo, useState } from "react";
import { ApplyBar } from "./components/ui/ApplyBar";
import { ClassTabs } from "./components/ui/ClassTabs";
import { Disclosure } from "./components/ui/Disclosure";
import { PaneHeader } from "./components/ui/PaneHeader";
import { Segmented } from "./components/ui/Segmented";
import { useAppStatus, useCanWrite } from "./hooks/useAppStatus";
import { draftRecordKey, useSeededDraft } from "./hooks/useSeededDraft";
import { prefetchViewmodelPreviews, useViewmodelPreview } from "./hooks/useViewmodelPreview";
import type { Api } from "./lib/api";
import { isTauri, openExternal, type ViewmodelHideMode, type ViewmodelRecord } from "./lib/bridge";
import { type ViewmodelGroupInfo, viewmodelGroupsForClass } from "./lib/viewmodel-groups";
import {
  VIEWMODEL_PREVIEW_CREDIT,
  VIEWMODEL_SLOT_LABELS,
  VIEWMODEL_SLOTS,
  type ViewmodelSlot,
  viewmodelBlankStem,
  viewmodelGroupPreview,
  viewmodelStemForGroup,
} from "./lib/viewmodel-previews";
import {
  HIDE_MODE_LABELS,
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

/**
 * The Viewmodels pane, laid out the way CompVMInstaller's "visual image guide"
 * works: one big first-person screenshot, and the option under the pointer
 * decides what it shows — the weapon while the group is visible, the empty
 * view once it is hidden. Toggling swaps the two on the spot.
 */
export function ViewmodelPane({
  api,
  profileId,
  record,
  onBuild,
  onImport,
  onRemove,
}: {
  api: Api;
  /** The profile this draft belongs to; a switch discards it. */
  profileId: string | null;
  record: ViewmodelRecord | null;
  onBuild: (hidden: string[], preload: boolean, hideMode: ViewmodelHideMode) => void;
  onImport: (preload: boolean) => void;
  onRemove: () => void;
}) {
  const { running } = useAppStatus();
  const locked = !useCanWrite();
  const recordKey = draftRecordKey(profileId, JSON.stringify(record ?? null));
  // biome-ignore lint/correctness/useExhaustiveDependencies: recordKey covers record by value.
  const seeded = useMemo(() => seedViewmodelDraft(record), [recordKey]);
  const [draft, setDraft] = useSeededDraft(seeded, serializeViewmodelDraft, recordKey);
  const [classId, setClassId] = useState<ViewmodelClass>("scout");
  /** The group under the pointer (or last toggled); null shows the class blank. */
  const [focusGroup, setFocusGroup] = useState<string | null>(null);
  // Building needs TF2's own studiomdl, which only the Windows depot ships.
  // Assume yes until the probe says otherwise, so the button never flickers
  // disabled on a machine that can build.
  const [canBuild, setCanBuild] = useState(true);
  const canFetchPreviews = isTauri();

  useEffect(() => {
    if (!isTauri()) {
      return;
    }
    let cancelled = false;
    api
      .viewmodelBuildAvailable()
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
  }, [api]);

  const groups = viewmodelGroupsForClass(classId);
  const hiddenSet = new Set(draft.hidden);

  // Switching class resets the stage to that class's empty view (upstream
  // behaviour) and warms every picture the class can show.
  useEffect(() => {
    setFocusGroup(null);
    if (!canFetchPreviews) {
      return;
    }
    const stems = [
      viewmodelBlankStem(classId),
      ...viewmodelGroupsForClass(classId).map(
        (group) => viewmodelGroupPreview(group.id)?.image ?? viewmodelBlankStem(classId),
      ),
    ];
    prefetchViewmodelPreviews(api, stems);
  }, [api, classId, canFetchPreviews]);

  const focusHidden = focusGroup !== null && hiddenSet.has(focusGroup);
  const stem =
    focusGroup === null
      ? viewmodelBlankStem(classId)
      : viewmodelStemForGroup(classId, focusGroup, focusHidden);
  const preview = useViewmodelPreview(api, canFetchPreviews ? stem : null);
  const focusInfo = focusGroup ? viewmodelGroupPreview(focusGroup) : null;
  const focusLabel = focusGroup ? groups.find((group) => group.id === focusGroup)?.label : null;
  const stageSrc = preview.src;

  const dirty =
    serializeHiddenGroups(draft.hidden) !== serializeHiddenGroups(seeded.hidden) ||
    draft.hideMode !== seeded.hideMode;
  const builtPack = record?.source === "compiled";
  const allClassHidden = groups.every((group) => hiddenSet.has(group.id));
  const isSoldier = classId === "soldier";

  function hiddenCountFor(cls: ViewmodelClass): number {
    return viewmodelGroupsForClass(cls).filter((group) => hiddenSet.has(group.id)).length;
  }

  function toggle(group: ViewmodelGroupInfo) {
    setFocusGroup(group.id);
    setDraft((current) => ({
      ...current,
      hidden: toggleHiddenGroup(current.hidden, group.id),
    }));
  }

  // Building compiles with studiomdl, so this pane keeps its button — and with
  // it the one vocabulary the automatic panes now put in the toast.
  const buildStatus = !canBuild
    ? "Building needs TF2's studiomdl (Windows only)"
    : running
      ? "Draft kept until TF2 closes"
      : draft.hidden.length === 0 && record
        ? "Nothing hidden — use Remove pack to restore stock"
        : draft.hidden.length === 0
          ? "Nothing hidden yet"
          : dirty || !builtPack
            ? "Unsaved changes"
            : "Up to date";

  const stageCaption =
    focusGroup === null
      ? `${capitalize(classId)} · nothing out`
      : `${capitalize(classId)} · ${focusLabel ?? focusGroup} — ${focusHidden ? "hidden" : "shown"}`;

  return (
    <section data-testid="settings-viewmodels" className="min-w-0 text-left">
      <PaneHeader
        title="Viewmodels"
        lede="Hover a group to preview it; click to hide it."
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

      <div
        id={GROUPS_PANEL_ID}
        role="tabpanel"
        aria-labelledby={`${CLASS_TAB_PREFIX}-${classId}`}
        className="mt-6 grid gap-8 lg:grid-cols-[minmax(0,1fr)_19rem]"
      >
        <div className="lg:sticky lg:top-0 lg:self-start">
          <figure
            data-testid="viewmodel-stage"
            data-stem={stem}
            data-hidden={focusHidden ? "true" : "false"}
            className="surface vm-stage relative m-0 aspect-video w-full"
          >
            {stageSrc ? (
              <img
                key={stageSrc}
                data-testid="viewmodel-preview-image"
                src={stageSrc}
                alt={stageCaption}
                className="absolute inset-0 size-full rounded-[inherit] object-cover enter-fade"
              />
            ) : (
              <p className="t-meta absolute inset-0 grid place-items-center px-6 text-center">
                {preview.loading
                  ? "Loading preview…"
                  : focusHidden || focusGroup === null
                    ? "Nothing on screen."
                    : "No preview yet."}
              </p>
            )}
            <figcaption className="absolute bottom-2.5 left-3 rounded-md bg-bg/80 px-2 py-0.5 text-[12px] text-ink-muted backdrop-blur-sm">
              {stageCaption}
            </figcaption>
          </figure>
          {focusGroup && focusInfo ? (
            <p className="mt-3 text-[12px] leading-5 text-ink-faint">{focusInfo.weapons}</p>
          ) : null}
        </div>

        <div className="min-w-0">
          <div className="flex items-center justify-between gap-3">
            <p className="t-row capitalize">{classId}</p>
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
              className="btn btn-quiet px-2 py-1 text-[12.5px]"
            >
              {allClassHidden ? "Show all" : "Hide all"}
            </button>
          </div>

          {VIEWMODEL_SLOTS.map((slot) => {
            const inSlot = groups.filter(
              (group) => (viewmodelGroupPreview(group.id)?.slot ?? "primary") === slot,
            );
            if (inSlot.length === 0) {
              return null;
            }
            return (
              <SlotGroup
                key={slot}
                slot={slot}
                groups={inSlot}
                hiddenSet={hiddenSet}
                locked={locked}
                describedBy={isSoldier ? SOLDIER_NOTE_ID : undefined}
                onFocus={setFocusGroup}
                onToggle={toggle}
              />
            );
          })}

          {isSoldier ? (
            <p id={SOLDIER_NOTE_ID} className="mt-3 text-[12px] leading-5 text-ink-faint">
              {SOLDIER_ORIGINAL_NOTE}
            </p>
          ) : null}
        </div>
      </div>

      <section className="section">
        <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-3">
          <div className="min-w-0">
            <h3 className="t-row">Hide mode</h3>
          </div>
          <Segmented
            label="Hide mode"
            testIdPrefix="viewmodel-mode"
            options={(["full", "weapon"] as const).map((mode) => ({
              id: mode,
              label: HIDE_MODE_LABELS[mode],
            }))}
            value={draft.hideMode}
            disabled={locked}
            onChange={(mode) => setDraft((current) => ({ ...current, hideMode: mode }))}
          />
        </div>
      </section>

      <section className="section">
        <Disclosure
          profileId={profileId}
          storageKey="viewmodel-pack"
          summary="Pack and preload"
          testId="viewmodel-pack-disclosure"
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
              {record ? "Replace VPK…" : "Import VPK…"}
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

          <p className="t-meta mt-4 max-w-[62ch]">
            Building or importing turns Casual preload on; the switch lives on the Mods pane.
          </p>
        </Disclosure>
      </section>

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
        actionLabel={builtPack ? "Rebuild pack" : "Build pack"}
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

function capitalize(value: string): string {
  return value.length > 0 ? `${value[0].toUpperCase()}${value.slice(1)}` : value;
}

/** One slot's groups as hover-to-preview, click-to-hide rows. */
function SlotGroup({
  slot,
  groups,
  hiddenSet,
  locked,
  describedBy,
  onFocus,
  onToggle,
}: {
  slot: ViewmodelSlot;
  groups: ViewmodelGroupInfo[];
  hiddenSet: Set<string>;
  locked: boolean;
  describedBy?: string;
  onFocus: (id: string | null) => void;
  onToggle: (group: ViewmodelGroupInfo) => void;
}) {
  return (
    <div className="mt-4">
      <p className="eyebrow">{VIEWMODEL_SLOT_LABELS[slot]}</p>
      <ul className="mt-1 list-none p-0">
        {groups.map((group) => {
          const hidden = hiddenSet.has(group.id);
          return (
            <li key={group.id} className="border-b border-edge last:border-b-0">
              <button
                type="button"
                role="switch"
                aria-checked={hidden}
                aria-describedby={describedBy}
                data-testid={`viewmodel-group-${group.id}`}
                data-hidden={hidden ? "true" : "false"}
                disabled={locked}
                onMouseEnter={() => onFocus(group.id)}
                onFocus={() => onFocus(group.id)}
                onClick={() => onToggle(group)}
                className="row w-full min-w-0 justify-start gap-3 rounded-md text-left transition-colors duration-150 hover:bg-panel disabled:cursor-not-allowed disabled:opacity-50"
              >
                <span
                  aria-hidden="true"
                  className={`flex size-6 shrink-0 items-center justify-center rounded-md ${
                    hidden ? "bg-brand/15 text-brand" : "text-ink-faint"
                  }`}
                >
                  {hidden ? <EyeSlash size={15} weight="bold" /> : <Eye size={15} />}
                </span>
                <span className="min-w-0 flex-1 text-[14px] text-ink">{group.label}</span>
                <span className="shrink-0 text-[11.5px] text-ink-faint">
                  {hidden ? "Hidden" : "Shown"}
                </span>
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
