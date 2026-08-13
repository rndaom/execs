import Link from "next/link";
import { CATEGORIES } from "@/db/schema";

const TF_CLASSES = [
  "scout",
  "soldier",
  "pyro",
  "demoman",
  "heavy",
  "engineer",
  "medic",
  "sniper",
  "spy",
];

export interface FilterState {
  q?: string;
  category?: string;
  tfClass?: string;
  sort?: string;
}

function hrefWith(state: FilterState, patch: Partial<FilterState>): string {
  const next = { ...state, ...patch };
  const params = new URLSearchParams();
  if (next.q) params.set("q", next.q);
  if (next.category) params.set("category", next.category);
  if (next.tfClass) params.set("class", next.tfClass);
  if (next.sort && next.sort !== "new") params.set("sort", next.sort);
  const qs = params.toString();
  return qs ? `/?${qs}` : "/";
}

function Chip({ active, href, children }: { active: boolean; href: string; children: React.ReactNode }) {
  return (
    <Link
      href={href}
      className={`rounded-pill border px-3 py-1 text-xs transition-colors ${
        active ? "border-brand bg-brand text-on-brand" : "border-edge text-ink-muted hover:border-ink-muted"
      }`}
    >
      {children}
    </Link>
  );
}

export function FilterBar({ state }: { state: FilterState }) {
  return (
    <div className="flex flex-col gap-3">
      <form action="/" className="flex gap-2">
        <input
          type="search"
          name="q"
          defaultValue={state.q ?? ""}
          placeholder="Search configs…"
          className="w-full max-w-sm rounded-pill border border-edge bg-panel px-4 py-1.5 text-sm outline-none placeholder:text-ink-faint focus:border-brand"
        />
        {state.category && <input type="hidden" name="category" value={state.category} />}
        {state.tfClass && <input type="hidden" name="class" value={state.tfClass} />}
        {state.sort && state.sort !== "new" && <input type="hidden" name="sort" value={state.sort} />}
        <button
          type="submit"
          className="rounded-pill bg-brand px-4 py-1.5 text-sm font-semibold text-on-brand hover:bg-brand-hover"
        >
          Search
        </button>
      </form>
      <div className="flex flex-wrap items-center gap-1.5">
        <span className="mr-1 text-xs text-ink-faint">Category:</span>
        <Chip active={!state.category} href={hrefWith(state, { category: undefined })}>
          all
        </Chip>
        {CATEGORIES.map((c) => (
          <Chip key={c} active={state.category === c} href={hrefWith(state, { category: c })}>
            {c.replace("-", " ")}
          </Chip>
        ))}
      </div>
      <div className="flex flex-wrap items-center gap-1.5">
        <span className="mr-1 text-xs text-ink-faint">Class:</span>
        <Chip active={!state.tfClass} href={hrefWith(state, { tfClass: undefined })}>
          any
        </Chip>
        {TF_CLASSES.map((c) => (
          <Chip key={c} active={state.tfClass === c} href={hrefWith(state, { tfClass: c })}>
            {c}
          </Chip>
        ))}
        <span className="mx-2 text-xs text-ink-faint">·</span>
        <span className="mr-1 text-xs text-ink-faint">Sort:</span>
        <Chip active={(state.sort ?? "new") === "new"} href={hrefWith(state, { sort: undefined })}>
          newest
        </Chip>
        <Chip active={state.sort === "top"} href={hrefWith(state, { sort: "top" })}>
          most downloaded
        </Chip>
      </div>
    </div>
  );
}
