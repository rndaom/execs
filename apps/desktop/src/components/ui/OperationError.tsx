import { useEffect } from "react";

/** Dismiss feedback without changing any draft, recovery or write-lock state. */
export function OperationError({
  message,
  onDismiss,
  className = "",
}: {
  message: string | null;
  onDismiss?: () => void;
  className?: string;
}) {
  useEffect(() => {
    if (!message || !onDismiss) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onDismiss();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [message, onDismiss]);
  if (!message) return null;
  return (
    <div
      role="alert"
      className={`t-body flex shrink-0 items-start justify-between gap-4 border-b border-error/50 bg-error/10 px-5 py-2 text-ink ${className}`}
    >
      <span>{message}</span>
      {onDismiss ? (
        <button type="button" className="btn btn-ghost shrink-0" onClick={onDismiss}>
          Dismiss error
        </button>
      ) : null}
    </div>
  );
}
