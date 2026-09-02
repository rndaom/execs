import { useEffect, useState } from "react";
import { PaneHeader } from "./components/ui/PaneHeader";
import { PaneSection } from "./components/ui/PaneSection";
import { useAppStatus } from "./hooks/useAppStatus";
import {
  applyRecordedBind,
  BIND_ACTIONS,
  type BindActionId,
  type BindsLayer,
  bindsFilePath,
  canRecordBinds,
  displayedKeyForAction,
  parseManagedBinds,
  recorderOutcomeForKey,
  sourceKeyFromKeyboardEvent,
  sourceKeyFromMouseButton,
  sourceKeyFromWheelDelta,
  UNBINDABLE_KEY_NOTICE_MS,
} from "./lib/binds-ui";

export type BindsPaneProps = {
  layer: BindsLayer;
  effectiveBinds: Record<string, string>;
  managedText: string;
  onSave: (bindsText: string) => void;
};

const BIND_GROUPS: Array<{
  title: string;
  ids: BindActionId[];
}> = [
  {
    title: "Movement",
    ids: ["forward", "back", "moveleft", "moveright", "jump", "duck"],
  },
  {
    title: "Teamplay",
    ids: ["medic", "use", "voice"],
  },
  {
    title: "Loadouts",
    ids: ["loadout0", "loadout1", "loadout2", "loadout3"],
  },
];

export function BindsPane({ layer, effectiveBinds, managedText, onSave }: BindsPaneProps) {
  const { running, busy } = useAppStatus();
  const [recordingId, setRecordingId] = useState<BindActionId | null>(null);
  const [recorderNotice, setRecorderNotice] = useState<string | null>(null);
  const canRecord = canRecordBinds(running, busy);
  const managedKeys = parseManagedBinds(managedText);

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
      const next = applyRecordedBind(managedText, recordingId, outcome.key);
      setRecordingId(null);
      if (next !== managedText) {
        onSave(next);
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
  }, [recordingId, canRecord, managedText, onSave]);

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

  const recordingAction = recordingId
    ? BIND_ACTIONS.find((action) => action.id === recordingId)
    : null;

  return (
    <section data-testid="settings-binds" className="min-w-0 text-left">
      <PaneHeader
        title="Binds"
        lede="Click an action, then press a key, button or scroll."
        actions={<p className="t-meta font-mono text-ink-faint">{bindsFilePath(layer)}</p>}
      />

      <div
        aria-live="polite"
        className={`overflow-hidden rounded-lg border transition-colors duration-150 ${
          recordingAction ? "border-brand px-4 py-3" : "h-0 border-transparent px-4 py-0"
        }`}
      >
        {recordingAction ? (
          <>
            <p className="t-body text-ink">
              Recording <span className="font-medium">{recordingAction.label}</span> — press a key.
              Escape cancels.
            </p>
            {recorderNotice ? (
              <p data-testid="bind-recorder-notice" className="t-meta mt-1">
                {recorderNotice}
              </p>
            ) : null}
          </>
        ) : null}
      </div>

      {BIND_GROUPS.map((group) => (
        <PaneSection
          key={group.title}
          id={`binds-${group.title.toLowerCase()}`}
          title={group.title}
        >
          <ul className="mt-2 grid sm:grid-cols-2 sm:gap-x-10">
            {group.ids.map((actionId) => {
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
                    onClick={() => onRow(action.id)}
                    className="flex min-h-11 w-full min-w-0 items-center gap-3 rounded-md py-3 text-left outline-none focus-visible:ring-2 focus-visible:ring-brand disabled:opacity-50"
                  >
                    <span className="min-w-0 flex-1">
                      <span className="t-row block">{action.label}</span>
                    </span>
                    <span
                      data-testid={`bind-key-${action.id}`}
                      className={`min-w-14 shrink-0 rounded-md border px-2.5 py-1.5 text-center font-mono text-[12.5px] uppercase tracking-wide transition-colors duration-150 ${
                        listening
                          ? "border-brand text-ink"
                          : "border-edge-strong bg-bg text-ink group-hover:border-ink-faint"
                      }`}
                    >
                      {listening ? "…" : (bound ?? "—")}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        </PaneSection>
      ))}

      {!canRecord ? (
        <p className="t-meta mt-8">
          {running ? "Close TF2 to change binds." : "Finish the current task first."}
        </p>
      ) : null}
    </section>
  );
}
