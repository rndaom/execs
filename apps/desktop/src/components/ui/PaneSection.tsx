import type { ReactNode } from "react";

/**
 * The pane rhythm: a hairline-separated flat section with a title, an optional
 * one-line description and optional right-hand meta. De-carded by construction
 * — no per-section box (AGENTS.md, "Design decisions").
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
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <div className="min-w-0">
          <h2 id={headingId} className="t-section">
            {title}
          </h2>
          {description ? <p className="t-meta mt-1">{description}</p> : null}
        </div>
        {meta ? <div className="t-meta shrink-0 text-ink-faint">{meta}</div> : null}
      </div>
      {children}
    </Tag>
  );
}
