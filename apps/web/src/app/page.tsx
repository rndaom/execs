import Link from "next/link";
import { ConfigCard } from "@/components/config-card";
import { FilterBar } from "@/components/filter-bar";
import { CATEGORIES, type Category } from "@/db/schema";
import { browseConfigs, type SortKey } from "@/lib/queries";

export default async function HomePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

  const q = one(params.q);
  const rawCategory = one(params.category);
  const category = CATEGORIES.includes(rawCategory as Category)
    ? (rawCategory as Category)
    : undefined;
  const tfClass = one(params.class);
  const sort: SortKey = one(params.sort) === "top" ? "top" : "new";
  const cursor = one(params.cursor);

  const { items, nextCursor } = await browseConfigs({ q, category, tfClass, sort, cursor });
  const isFiltered = Boolean(q || category || tfClass || cursor);

  return (
    <div className="flex flex-col gap-8">
      {!isFiltered && (
        <section className="pt-6 text-center">
          <h1 className="font-display text-5xl leading-tight">
            TF2 configs, <span className="text-brand">shared</span>
          </h1>
          <p className="mx-auto mt-4 max-w-xl text-ink-muted">
            Browse community configs, see exactly what they change before you install, and put
            them in your game with one click. Every upload is linted for safety.
          </p>
        </section>
      )}

      <FilterBar state={{ q, category, tfClass, sort }} />

      {items.length === 0 ? (
        <div className="rounded-lg border border-edge bg-panel p-10 text-center text-ink-faint">
          {q ? `No configs match “${q}”.` : "No configs here yet — be the first to upload one."}
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {items.map((item) => (
            <ConfigCard key={item.id} config={item} ownerName={item.ownerName} />
          ))}
        </div>
      )}

      {nextCursor && (
        <div className="text-center">
          <Link
            href={`/?${new URLSearchParams({
              ...(q ? { q } : {}),
              ...(category ? { category } : {}),
              ...(tfClass ? { class: tfClass } : {}),
              ...(sort !== "new" ? { sort } : {}),
              cursor: nextCursor,
            })}`}
            className="rounded-pill border border-edge px-6 py-2 text-sm text-ink-muted hover:border-brand hover:text-brand"
          >
            Load more
          </Link>
        </div>
      )}
    </div>
  );
}
