import { useEffect, useState } from "react";
import {
  applyRecordedBind,
  BIND_ACTIONS,
  type BindActionId,
  type BindsLayer,
  bindsFilePath,
  canRecordBinds,
  displayedKeyForAction,
  parseManagedBinds,
  sourceKeyFromKeyboardEvent,
  sourceKeyFromMouseButton,
  sourceKeyFromWheelDelta,
} from "./lib/binds-ui";

export type BindsPaneProps = {
  running: boolean;
  busy: boolean;
  layer: BindsLayer;
  effectiveBinds: Record<string, string>;
  managedText: string;
  onSave: (bindsText: string, autoexecPatch?: { path: string; text: string }) => void;
};

const BIND_GROUPS: Array<{
  title: string;
  description: string;
  ids: BindActionId[];
}> = [
  {
    title: "Movement",
    description: "The keys you use every life.",
    ids: ["forward", "back", "moveleft", "moveright", "jump", "duck"],
  },
  {
    title: "Teamplay",
    description: "Communication and interaction.",
    ids: ["medic", "use", "voice"],
  },
  {
    title: "Loadouts",
    description: "Jump straight to a saved item preset.",
    ids: ["loadout0", "loadout1", "loadout2", "loadout3"],
  },
];

export function BindsPane({
  running,
  busy,
  layer,
  effectiveBinds,
  managedText,
  onSave,
}: BindsPaneProps) {
  const [recordingId, setRecordingId] = useState<BindActionId | null>(null);
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
      if (!key) {
        return;
      }
      if (key === "escape" || !recordingId) {
        setRecordingId(null);
        return;
      }
      const next = applyRecordedBind(managedText, recordingId, key);
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
      if (!armed) {
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

  function onRow(actionId: BindActionId) {
    if (!canRecord) {
      return;
    }
    setRecordingId((current) => (current === actionId ? null : actionId));
  }

  const recordingAction = recordingId
    ? BIND_ACTIONS.find((action) => action.id === recordingId)
    : null;

  return (
    <section data-testid="settings-binds" className="min-w-0 text-left">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="max-w-2xl text-[13px] leading-6 text-ink-muted">
          Choose an action and press any keyboard key, mouse button, or scroll direction. Escape
          cancels recording.
        </p>
        <span className="font-mono text-[11px] text-ink-faint">{bindsFilePath(layer)}</span>
      </div>

      <div
        aria-live="polite"
        className={`mt-3 overflow-hidden rounded-lg border transition-colors ${
          recordingAction
            ? "border-brand bg-brand/10 px-4 py-3"
            : "h-0 border-transparent px-4 py-0"
        }`}
      >
        {recordingAction ? (
          <p className="text-sm text-ink">
            Recording <span className="font-medium text-brand">{recordingAction.label}</span> —
            press the new key now.
          </p>
        ) : null}
      </div>

      {BIND_GROUPS.map((group) => (
        <section key={group.title} className="section">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h2 className="text-sm font-semibold text-ink">{group.title}</h2>
            <p className="text-xs text-ink-faint">{group.description}</p>
          </div>
          <ul className="mt-1 grid sm:grid-cols-2 sm:gap-x-10 xl:grid-cols-3">
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
                  className={`group border-b border-edge/60 transition-colors ${
                    listening ? "bg-brand/10" : ""
                  }`}
                >
                  <button
                    type="button"
                    data-testid={`bind-record-${action.id}`}
                    disabled={!canRecord}
                    aria-label={`Record a key for ${action.label}. Current binding ${bound ?? "unbound"}`}
                    aria-pressed={listening}
                    onClick={() => onRow(action.id)}
                    className="flex w-full min-w-0 items-center gap-3 rounded-md py-3 text-left outline-none focus-visible:ring-2 focus-visible:ring-brand disabled:opacity-50"
                  >
                    <span className="min-w-0 flex-1">
                      <span className="block text-[13px] font-medium text-ink">{action.label}</span>
                      <span className="mt-0.5 block text-xs text-ink-faint">
                        {listening ? "Waiting for input" : "Click to rebind"}
                      </span>
                    </span>
                    <span
                      data-testid={`bind-key-${action.id}`}
                      className={`min-w-14 shrink-0 rounded-md border px-2.5 py-1.5 text-center font-mono text-xs uppercase tracking-wide ${
                        listening
                          ? "border-brand bg-brand text-on-brand"
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
        </section>
      ))}

      {!canRecord ? (
        <p className="mt-4 text-sm text-ink-muted">
          {running ? "Close TF2 before changing binds." : "Finish the current profile task first."}
        </p>
      ) : null}
    </section>
  );
}
