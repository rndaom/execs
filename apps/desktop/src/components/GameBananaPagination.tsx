import { ArrowLeft, ArrowRight } from "@phosphor-icons/react";
import type { GameBananaPager } from "../lib/gamebanana-browser-ui";

type PageLink = number | "gap-start" | "gap-end";

export function gameBananaPageLinks(page: number, pageCount: number): PageLink[] {
  if (pageCount <= 7) return Array.from({ length: pageCount }, (_, index) => index + 1);
  const keep = new Set([1, pageCount, page - 1, page, page + 1]);
  const ordered = [...keep]
    .filter((value) => value >= 1 && value <= pageCount)
    .sort((a, b) => a - b);
  const links: PageLink[] = [];
  ordered.forEach((value, index) => {
    if (index > 0 && value - ordered[index - 1] > 1) {
      links.push(value === pageCount ? "gap-end" : "gap-start");
    }
    links.push(value);
  });
  return links;
}

export function GameBananaPagination({
  position,
  page,
  pager,
  loading,
  onPage,
  compact = false,
}: {
  position: "top" | "bottom";
  page: number;
  pager: GameBananaPager;
  loading: boolean;
  onPage: (page: number) => void;
  compact?: boolean;
}) {
  const links = pager.pageCount ? gameBananaPageLinks(page, pager.pageCount) : [];
  const legacy = position === "bottom";
  return (
    <nav
      aria-label={`GameBanana pages, ${position}`}
      className={`flex flex-wrap items-center justify-between gap-3 ${
        compact
          ? ""
          : position === "top"
            ? "mt-3 border-y border-edge py-3"
            : "mt-4 border-t border-edge pt-4"
      }`}
    >
      <p
        data-testid={legacy ? "mods-gb-page-label" : "mods-gb-page-label-top"}
        className={compact ? "sr-only" : "t-meta tnum"}
        aria-live={position === "top" ? "polite" : undefined}
        aria-atomic={position === "top" ? "true" : undefined}
      >
        {pager.label}
      </p>
      <div className="flex flex-wrap items-center gap-1.5">
        <button
          type="button"
          data-testid={legacy ? "mods-gb-page-prev" : "mods-gb-page-prev-top"}
          className="btn btn-ghost"
          aria-label="Previous GameBanana page"
          disabled={loading || !pager.hasPrevious}
          onClick={() => onPage(page - 1)}
        >
          <ArrowLeft size={13} />
          Previous
        </button>
        {links.map((link) =>
          typeof link === "string" ? (
            <span key={link} aria-hidden="true" className="px-1 text-ink-faint">
              …
            </span>
          ) : (
            <button
              key={link}
              type="button"
              className="btn btn-quiet min-w-8 px-2"
              aria-label={`GameBanana page ${link}`}
              aria-current={link === page ? "page" : undefined}
              disabled={loading || link === page}
              onClick={() => onPage(link)}
            >
              {link}
            </button>
          ),
        )}
        <button
          type="button"
          data-testid={legacy ? "mods-gb-page-next" : "mods-gb-page-next-top"}
          className="btn btn-ghost"
          aria-label="Next GameBanana page"
          disabled={loading || !pager.hasNext}
          onClick={() => onPage(page + 1)}
        >
          Next
          <ArrowRight size={13} />
        </button>
      </div>
    </nav>
  );
}
