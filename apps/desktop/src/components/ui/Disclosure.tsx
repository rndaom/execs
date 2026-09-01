import { type ReactNode, useCallback, useState } from "react";

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
 * Closed by default; the open state is remembered per pane in localStorage.
 */
export function Disclosure({
  storageKey,
  summary,
  defaultOpen = false,
  testId,
  className = "",
  children,
}: {
  /** Stable per-pane key, e.g. `comfig-modules`. */
  storageKey: string;
  summary: ReactNode;
  defaultOpen?: boolean;
  testId?: string;
  className?: string;
  children?: ReactNode;
}) {
  const [open, setOpen] = useState(() =>
    typeof window === "undefined" ? defaultOpen : readStored(storageKey, defaultOpen),
  );

  const onToggle = useCallback(
    (event: React.SyntheticEvent<HTMLDetailsElement>) => {
      const next = event.currentTarget.open;
      setOpen(next);
      writeStored(storageKey, next);
    },
    [storageKey],
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
