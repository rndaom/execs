import { type ReactNode, useCallback, useEffect, useState } from "react";
import { draftRecordKey } from "../../hooks/useSeededDraft";

const PREFIX = "execs.disclosure.";

function readStored(key: string, fallback: boolean): boolean {
  // A blocked or unavailable localStorage must never cost the user the
  // section — it just means the disclosure forgets between launches.
  try {
    const stored = window.localStorage.getItem(PREFIX + key);
    return stored === null ? fallback : stored === "1";
  } catch {
    return fallback;
  }
}

function writeStored(key: string, open: boolean) {
  try {
    window.localStorage.setItem(PREFIX + key, open ? "1" : "0");
  } catch {
    // Ignored: remembering the state is a convenience, not a requirement.
  }
}

/**
 * A section that folds away. Used for the secondary depth every pane keeps
 * behind its one real decision ("Fine-tune modules", "Advanced").
 *
 * Closed by default; the open state is remembered per profile in localStorage.
 */
export function Disclosure({
  profileId,
  storageKey,
  summary,
  defaultOpen = false,
  testId,
  className = "",
  onOpenChange,
  children,
}: {
  /** Active profile; a switch loads that profile's remembered state. */
  profileId: string | null;
  /** Stable per-pane key, e.g. `comfig-modules`. */
  storageKey: string;
  summary: ReactNode;
  defaultOpen?: boolean;
  testId?: string;
  className?: string;
  /**
   * Fired with the remembered state on mount and on every toggle, so a section
   * whose content costs something (a network fetch) can wait to be opened.
   * `<details>` keeps its children mounted either way.
   */
  onOpenChange?: (open: boolean) => void;
  children?: ReactNode;
}) {
  const scopedKey = draftRecordKey(profileId, storageKey);
  const [open, setOpen] = useState(() =>
    typeof window === "undefined" ? defaultOpen : readStored(scopedKey, defaultOpen),
  );

  useEffect(() => {
    setOpen(readStored(scopedKey, defaultOpen));
  }, [scopedKey, defaultOpen]);

  // biome-ignore lint/correctness/useExhaustiveDependencies: report the state, not the callback's identity.
  useEffect(() => {
    onOpenChange?.(open);
  }, [open]);

  const onToggle = useCallback(
    (event: React.SyntheticEvent<HTMLDetailsElement>) => {
      const next = event.currentTarget.open;
      setOpen(next);
      writeStored(scopedKey, next);
    },
    [scopedKey],
  );

  return (
    <details
      data-testid={testId}
      open={open}
      onToggle={onToggle}
      className={`disclosure ${className}`.trim()}
    >
      <summary>
        <span aria-hidden="true" className="disclosure-caret">
          ›
        </span>
        {summary}
      </summary>
      {children}
    </details>
  );
}
