import { Check, CheckCircle, Copy, Info, Plus, WarningCircle, X } from "@phosphor-icons/react";
import { useEffect, useRef, useState } from "react";
import { Alert } from "./components/ui/Alert";
import { Disclosure } from "./components/ui/Disclosure";
import { PaneHeader } from "./components/ui/PaneHeader";
import { useAppStatus } from "./hooks/useAppStatus";
import { useAutosave } from "./hooks/useAutosave";
import { useCopyFeedback } from "./hooks/useCopyFeedback";
import { useExplicitDraft } from "./hooks/useExplicitDraft";
import { draftRecordKey, useSeededDraft } from "./hooks/useSeededDraft";
import { copyButtonLabel } from "./lib/copy-ui";
import {
  appendLaunchOption,
  forbiddenLaunchNotice,
  forbiddenLaunchTokens,
  launchOptionGroups,
  removeLaunchOption,
  type SteamWriteStatus,
  steamWriteCopy,
  strippedLaunchNotice,
  strippedLaunchTokens,
} from "./lib/launch-ui";

export function LaunchPane({
  profileId = null,
  value,
  saved,
  steamWrite,
  lastSave,
  onChange,
  onSave,
}: {
  profileId?: string | null;
  value: string;
  /** What the profile holds; the field is a draft of it. */
  saved: string;
  steamWrite?: SteamWriteStatus | null;
  /** What was sent to the backend last save and what came back. */
  lastSave?: { sent: string; saved: string } | null;
  onChange: (value: string) => void;
  /** The existing queued save reports its outcome and owns the error toast. */
  onSave: () => Promise<boolean>;
}) {
  const { running, busy } = useAppStatus();
  const [composer, setComposer] = useSeededDraft(
    { open: false, text: "" },
    JSON.stringify,
    draftRecordKey(profileId, "launch-option"),
  );
  const { open: adding, text: option } = composer;
  const composerPending = option.trim().length > 0;
  useExplicitDraft(composerPending);
  const [retrying, setRetrying] = useState(false);
  const [retryFailed, setRetryFailed] = useSeededDraft<boolean>(
    false,
    String,
    draftRecordKey(profileId, "launch-retry", value),
  );
  const retryPending = useRef(false);
  const current = useRef({ profileId, value });
  current.current = { profileId, value };
  const optionInput = useRef<HTMLInputElement>(null);
  const addButton = useRef<HTMLButtonElement>(null);
  const tokenContainer = useRef<HTMLDivElement>(null);
  const focusAfterRemove = useRef<number | null>(null);
  const wasAdding = useRef(false);
  useEffect(() => {
    if (adding) optionInput.current?.focus();
    else if (wasAdding.current) addButton.current?.focus();
    wasAdding.current = adding;
  }, [adding]);
  useEffect(() => {
    if (focusAfterRemove.current === null) return;
    const tokens =
      tokenContainer.current?.querySelectorAll<HTMLButtonElement>("[data-launch-token]");
    const next = tokens?.[focusAfterRemove.current] ?? addButton.current;
    focusAfterRemove.current = null;
    next?.focus();
  });
  const status = steamWrite ? steamWriteCopy(steamWrite) : "";
  const { feedback, copy } = useCopyFeedback();
  // Typing is a draft: the lock defers the write, it does not lock the field.
  const { flush } = useAutosave({
    dirty: value !== saved,
    locked: running,
    token: value,
    save: onSave,
  });

  // The backend strips these on save; flagging them as you type means the
  // textarea never silently changes under the user.
  const forbidden = forbiddenLaunchTokens(value);
  const stripped = lastSave ? strippedLaunchTokens(lastSave.sent, lastSave.saved) : [];
  const groups = launchOptionGroups(value);
  const closeComposer = () => setComposer({ open: false, text: "" });

  async function retrySteamWrite() {
    if (retryPending.current || running || busy || value !== saved || composerPending) return;
    retryPending.current = true;
    setRetrying(true);
    setRetryFailed(false);
    const sent = value;
    const owner = profileId;
    const stillCurrent = () =>
      current.current.profileId === owner && current.current.value === sent;
    try {
      const applied = await onSave();
      if (stillCurrent()) setRetryFailed(applied !== true);
    } catch {
      // SettingsHost owns the detailed error. Do not publish a second toast.
      if (stillCurrent()) setRetryFailed(true);
    } finally {
      retryPending.current = false;
      setRetrying(false);
    }
  }

  return (
    <div data-testid="settings-launch" className="min-w-0 text-left">
      <PaneHeader title="Launch options" lede="Startup options for this profile." />

      <div className="max-w-[980px]">
        <section aria-labelledby="launch-tokens-label">
          <h2 id="launch-tokens-label" className="t-section">
            Launch option tokens
          </h2>
          <div
            ref={tokenContainer}
            className="surface mt-3 flex min-h-16 flex-wrap items-center gap-2 p-3"
          >
            {groups ? (
              groups.map((group, index) => (
                <button
                  key={`${group.start}:${group.text}`}
                  type="button"
                  data-launch-token
                  aria-label={`Remove ${group.text}`}
                  className="btn btn-ghost max-w-full gap-3 bg-panel-raised text-left"
                  onClick={() => {
                    focusAfterRemove.current = index;
                    onChange(removeLaunchOption(value, group));
                  }}
                >
                  <span className="min-w-0 whitespace-pre-wrap break-all">{group.text}</span>
                  <X size={13} aria-hidden="true" className="shrink-0" />
                </button>
              ))
            ) : (
              <p className="t-meta">Edit this command sequence in the launch string below.</p>
            )}
            <button
              type="button"
              ref={addButton}
              data-testid="launch-add-open"
              className="btn btn-ghost"
              disabled={adding || groups === null}
              title={
                groups === null
                  ? "Edit this command sequence in the launch string below."
                  : undefined
              }
              onClick={() => setComposer({ open: true, text: "" })}
              aria-expanded={adding}
            >
              <Plus size={15} aria-hidden="true" /> Add option
            </button>
          </div>
          {adding ? (
            <form
              className="mt-3 flex flex-wrap items-end gap-2"
              onKeyDown={(event) => {
                if (event.key === "Escape") {
                  event.preventDefault();
                  closeComposer();
                }
              }}
              onSubmit={(event) => {
                event.preventDefault();
                if (!option.trim() || groups === null) return;
                onChange(appendLaunchOption(value, option));
                closeComposer();
              }}
            >
              <label className="t-meta min-w-0 flex-1">
                Option and value
                <input
                  ref={optionInput}
                  value={option}
                  onChange={(event) => setComposer({ open: true, text: event.target.value })}
                  placeholder="For example, -console"
                  className="field mt-1 w-full px-3 py-2"
                  autoComplete="off"
                  spellCheck={false}
                />
              </label>
              <button
                type="submit"
                data-testid="launch-add-submit"
                className="btn btn-primary"
                disabled={!option.trim() || groups === null}
              >
                Add option
              </button>
              <button type="button" className="btn btn-ghost" onClick={closeComposer}>
                Cancel
              </button>
            </form>
          ) : null}
          <div className="mt-6 flex items-center justify-between gap-3">
            <label className="t-section" htmlFor="launch-options">
              Launch string
            </label>
            <button
              type="button"
              data-testid="launch-copy"
              onClick={() => void copy(value)}
              className="btn btn-ghost"
            >
              {feedback === "copied" ? <Check size={15} weight="bold" /> : <Copy size={15} />}
              <span aria-live="polite">{copyButtonLabel(feedback, "Copy launch options")}</span>
            </button>
          </div>
          <textarea
            id="launch-options"
            data-testid="launch-options"
            value={value}
            onChange={(event) => onChange(event.target.value)}
            onBlur={flush}
            aria-describedby={forbidden.length > 0 ? "launch-forbidden" : undefined}
            rows={2}
            spellCheck={false}
            className={`surface mt-3 min-h-20 w-full resize-y bg-bg px-4 py-3 text-[14px] leading-7 text-ink placeholder:text-ink-faint focus:outline-none ${
              forbidden.length > 0 ? "border-warn/70" : ""
            }`}
          />

          {forbidden.length > 0 ? (
            <Alert tone="warn" testId="launch-forbidden" className="mt-3">
              <span className="flex items-start gap-2">
                <WarningCircle
                  aria-hidden="true"
                  size={16}
                  weight="fill"
                  className="mt-0.5 shrink-0"
                />
                <span id="launch-forbidden">{forbiddenLaunchNotice(forbidden)}</span>
              </span>
            </Alert>
          ) : null}

          {stripped.length > 0 ? (
            <Alert tone="info" testId="launch-stripped" className="mt-3">
              {strippedLaunchNotice(stripped)}
            </Alert>
          ) : null}

          <div className="surface mt-4 flex flex-wrap items-center justify-between gap-3 p-4">
            <p
              data-testid="launch-steam-status"
              aria-live="polite"
              className="t-meta flex items-center gap-2"
            >
              {retryFailed ? (
                <WarningCircle size={16} className="shrink-0 text-warn" aria-hidden="true" />
              ) : steamWrite === "written" && value === saved && !retrying ? (
                <CheckCircle size={16} className="text-ok" weight="fill" />
              ) : (
                <Info size={16} aria-hidden="true" />
              )}
              {retrying
                ? "Checking whether Steam can be updated…"
                : retryFailed
                  ? "Could not confirm the Steam update. Copy the launch options or retry."
                  : (value === saved && status) ||
                    "Options save with this profile. Steam updates only while it is closed."}
            </p>
            <button
              type="button"
              data-testid="launch-steam-retry"
              disabled={running || busy || retrying || value !== saved || composerPending}
              title={
                running
                  ? "Available after TF2 closes."
                  : composerPending
                    ? "Add or cancel the option first."
                    : value !== saved
                      ? "Wait for the profile save to finish."
                      : "Checks Steam again and writes only when it is closed."
              }
              onClick={() => void retrySteamWrite()}
              className="btn btn-ghost"
            >
              {retrying ? "Checking Steam…" : "Write to Steam"}
            </button>
          </div>
        </section>
        <section
          className="surface mt-4 flex items-start gap-3 p-4"
          aria-labelledby="launch-steam-guide"
        >
          <Info size={18} aria-hidden="true" className="mt-0.5 shrink-0 text-ink-muted" />
          <div>
            <h2 id="launch-steam-guide" className="t-row">
              Apply through Steam
            </h2>
            <ol className="t-meta mt-2 list-decimal space-y-1 pl-4">
              <li>Open Team Fortress 2 in your Steam Library.</li>
              <li>Open Properties, then General → Launch Options.</li>
              <li>Paste the launch options above.</li>
            </ol>
          </div>
        </section>
        <Disclosure
          profileId={profileId}
          storageKey="launch-removed-options"
          summary="Options execs removes"
          className="mt-5"
        >
          <p className="t-meta mt-2">
            Reset and wrapper flags: <code className="text-ink-muted">-autoconfig</code>,{" "}
            <code className="text-ink-muted">-default</code>,{" "}
            <code className="text-ink-muted">-dxlevel</code>,{" "}
            <code className="text-ink-muted">+quit</code>,{" "}
            <code className="text-ink-muted">gamemoderun %command%</code>.
          </p>
        </Disclosure>
      </div>
    </div>
  );
}
