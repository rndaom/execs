import { useContext, useEffect, useState } from "react";
import { ClassTabs } from "./components/ui/ClassTabs";
import { PaneHeader } from "./components/ui/PaneHeader";
import { useAppStatus } from "./hooks/useAppStatus";
import { AutosaveActivity, useAutosave } from "./hooks/useAutosave";
import { draftRecordKey, useSeededDraft } from "./hooks/useSeededDraft";
import {
  applyRecordedBind,
  BIND_ACTIONS,
  type BindActionId,
  type BindsLayer,
  bindsFilePath,
  displayedKeyForAction,
  parseManagedBinds,
  recorderOutcomeForKey,
  sourceKeyFromKeyboardEvent,
  sourceKeyFromMouseButton,
  sourceKeyFromWheelDelta,
  UNBINDABLE_KEY_NOTICE_MS,
} from "./lib/binds-ui";

export type BindsPaneProps = {
  /** The profile this draft belongs to; a switch must never reuse it. */
  profileId: string | null;
  layer: BindsLayer;
  effectiveBinds: Record<string, string>;
  managedText: string;
  /** Resolves when the managed cfg write settles. */
  onSave: (bindsText: string) => Promise<unknown>;
};

const BIND_GROUPS: Array<{
  id: string;
  title: string;
  ids: BindActionId[];
}> = [
  {
    id: "movement",
    title: "Movement",
    ids: ["forward", "back", "moveleft", "moveright", "jump", "duck"],
  },
  {
    id: "combat",
    title: "Combat",
    ids: ["attack", "attack2", "reload"],
  },
  {
    id: "teamplay",
    title: "Teamplay",
    ids: ["medic", "use", "voice"],
  },
  {
    id: "loadouts",
    title: "Loadouts",
    ids: ["loadout0", "loadout1", "loadout2", "loadout3"],
  },
];

export function BindsPane({
  profileId,
  layer,
  effectiveBinds,
  managedText,
  onSave,
}: BindsPaneProps) {
  const active = useContext(AutosaveActivity);
  const { running, busy } = useAppStatus();
  const [recordingId, setRecordingId] = useState<BindActionId | null>(null);
  const [recorderNotice, setRecorderNotice] = useState<string | null>(null);
  const [activeGroupId, setActiveGroupId] = useState("movement");
  const path = bindsFilePath(layer);
  const [draft, setDraft] = useSeededDraft(
    managedText,
    (text) => text,
    draftRecordKey(profileId, path),
  );
  const dirty = draft !== managedText;
  useAutosave({ dirty, locked: running, token: draft, save: () => onSave(draft) });

  // Recording changes only the in-memory draft. Busy work still blocks input,
  // while TF2's write lock is handled by autosave after the game closes.
  const canRecord = active && !busy;
  const managedKeys = parseManagedBinds(draft);

  useEffect(() => {
    if (recordingId === null || !canRecord) {
      return;
    }

    let armed = false;
    const armTimer = window.setTimeout(() => {
      armed = true;
    }, 0);

    function finish(key: string | null) {
      const outcome = recorderOutcomeForKey(key);
      if (outcome.kind === "unbindable") {
        // Keep listening: the recorder must not sit open with no explanation
        // just because the key is outside TF2's table.
        setRecorderNotice(outcome.message);
        return;
      }
      if (outcome.kind === "cancel" || !recordingId) {
        setRecordingId(null);
        return;
      }
      const next = applyRecordedBind(draft, recordingId, outcome.key);
      setRecordingId(null);
      if (next !== draft) {
        setDraft(next);
      }
    }

    function onKeyDown(event: KeyboardEvent) {
      if (event.repeat) {
        return;
      }
      event.preventDefault();
      event.stopPropagation();
      finish(sourceKeyFromKeyboardEvent(event));
    }

    function onMouseDown(event: MouseEvent) {
      if (!armed) {
        return;
      }
      // Category navigation ends capture; its click must not become mouse1.
      if (event.target instanceof HTMLElement && event.target.closest("[data-bind-navigation]")) {
        setRecordingId(null);
        setRecorderNotice(null);
        return;
      }
      event.preventDefault();
      event.stopPropagation();
      finish(sourceKeyFromMouseButton(event.button));
    }

    function onWheel(event: WheelEvent) {
      if (!armed || event.deltaY === 0) {
        return;
      }
      event.preventDefault();
      event.stopPropagation();
      finish(sourceKeyFromWheelDelta(event.deltaY));
    }

    window.addEventListener("keydown", onKeyDown, true);
    window.addEventListener("mousedown", onMouseDown, true);
    window.addEventListener("wheel", onWheel, { capture: true, passive: false });
    return () => {
      window.clearTimeout(armTimer);
      window.removeEventListener("keydown", onKeyDown, true);
      window.removeEventListener("mousedown", onMouseDown, true);
      window.removeEventListener("wheel", onWheel, true);
    };
  }, [recordingId, canRecord, draft, setDraft]);

  useEffect(() => {
    if (!canRecord) {
      setRecordingId(null);
    }
  }, [canRecord]);

  // The notice is transient: it explains one rejected key, then gets out of the
  // way so the recorder line reads true again.
  useEffect(() => {
    if (recorderNotice === null) {
      return;
    }
    const timer = window.setTimeout(() => setRecorderNotice(null), UNBINDABLE_KEY_NOTICE_MS);
    return () => window.clearTimeout(timer);
  }, [recorderNotice]);

  function onRow(actionId: BindActionId) {
    if (!canRecord) {
      return;
    }
    setRecorderNotice(null);
    setRecordingId((current) => (current === actionId ? null : actionId));
  }

  const activeGroup = BIND_GROUPS.find((group) => group.id === activeGroupId) ?? BIND_GROUPS[0];

  return (
    <section data-testid="settings-binds" className="min-w-0 text-left">
      <PaneHeader title="Binds" />

      <div data-bind-navigation>
        <ClassTabs
          tabs={BIND_GROUPS.map((group) => ({ id: group.id, label: group.title }))}
          selected={activeGroupId}
          label="Bind categories"
          idPrefix="bind-category"
          panelId="bind-category-panel"
          onSelect={(id) => {
            setRecordingId(null);
            setRecorderNotice(null);
            setActiveGroupId(id);
          }}
        />
      </div>

      <div
        id="bind-category-panel"
        role="tabpanel"
        aria-labelledby={`bind-category-${activeGroup.id}`}
        className="mt-5"
      >
        <div className="pane-toolbar mb-2">
          <h2 className="t-section">{activeGroup.title}</h2>
          <p className="t-meta">Select an action to record a binding.</p>
        </div>
        <ul className="pane-split gap-y-0">
          {activeGroup.ids.map((actionId) => {
            const action = BIND_ACTIONS.find((item) => item.id === actionId);
            if (!action) {
              return null;
            }
            const listening = recordingId === action.id;
            const bound = displayedKeyForAction(effectiveBinds, managedKeys, action.id);
            return (
              <li
                key={action.id}
                data-testid={`bind-row-${action.id}`}
                data-recording={listening ? "true" : "false"}
                className="group border-b border-edge"
              >
                <button
                  type="button"
                  data-testid={`bind-record-${action.id}`}
                  disabled={!canRecord}
                  aria-label={`Record a key for ${action.label}. Current binding ${bound ?? "unbound"}`}
                  aria-pressed={listening}
                  aria-describedby={`bind-hint-${action.id}`}
                  onClick={() => onRow(action.id)}
                  className="flex min-h-16 w-full min-w-0 items-center gap-3 rounded-md py-3 text-left outline-none focus-visible:ring-2 focus-visible:ring-brand disabled:opacity-50"
                >
                  <span className="min-w-0 flex-1">
                    <span className="t-row block">{action.label}</span>
                    <span
                      id={`bind-hint-${action.id}`}
                      data-testid={listening && recorderNotice ? "bind-recorder-notice" : undefined}
                      aria-live="polite"
                      className="t-meta block min-h-5 text-ink-faint"
                    >
                      {listening ? (recorderNotice ?? "Esc cancels") : "\u00a0"}
                    </span>
                  </span>
                  <span
                    data-testid={`bind-key-${action.id}`}
                    className={`min-w-20 shrink-0 rounded-md border px-3 py-2 text-center text-[13px] font-medium uppercase tracking-wide transition-colors duration-150 ${
                      listening
                        ? "border-brand bg-brand/5 text-ink ring-1 ring-brand"
                        : "border-edge-strong bg-bg text-ink group-hover:border-ink-faint"
                    }`}
                  >
                    {listening ? "Press a key" : (bound ?? "—")}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      </div>

      {!canRecord ? <p className="t-meta mt-8">Finish the current task first.</p> : null}
      <p className="pane-note mt-6">Saved to {path}.</p>
    </section>
  );
}
