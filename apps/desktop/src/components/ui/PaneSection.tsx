import type { ReactNode } from "react";

/**
 * The pane rhythm: a hairline-separated flat section with a title, an optional
 * one-line description and optional right-hand meta. De-carded by construction
 * — no per-section box (AGENTS.md, Design decisions).
 */
export function PaneSection({
  title,
  description,
  meta,
  id,
  as = "section",
  first = false,
  className = "",
  children,
}: {
  title: ReactNode;
  description?: ReactNode;
  meta?: ReactNode;
  id?: string;
  /** `fieldset` when the body is a group of related inputs. */
  as?: "section" | "fieldset";
  /** Drops the top hairline for the first section on a page. */
  first?: boolean;
  className?: string;
  children?: ReactNode;
}) {
  const Tag = as;
  const headingId = id ? `${id}-heading` : undefined;
  return (
    <Tag className={`${first ? "" : "section"} ${className}`.trim()} aria-labelledby={headingId}>
      {as === "fieldset" ? <legend className="sr-only">{title}</legend> : null}
      <div className="flex flex-wrap items-end justify-between gap-x-4 gap-y-1">
        <div className="min-w-0">
          <h2 id={headingId} className="text-sm font-semibold text-ink">
            {title}
          </h2>
          {description ? (
            <p className="mt-0.5 text-xs leading-5 text-ink-muted">{description}</p>
          ) : null}
        </div>
        {meta ? <div className="shrink-0 text-xs text-ink-faint">{meta}</div> : null}
      </div>
      {children}
    </Tag>
  );
}
