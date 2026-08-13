export default function HomePage() {
  return (
    <div className="flex flex-col gap-10">
      <section className="pt-10 text-center">
        <h1 className="font-display text-5xl leading-tight">
          TF2 configs, <span className="text-accent">shared</span>
        </h1>
        <p className="mx-auto mt-4 max-w-xl text-ink-muted">
          Browse community configs, see exactly what they change before you install, and put them
          in your game with one click. Every upload is linted for safety.
        </p>
      </section>
      <section>
        {/* Increment 5 replaces this with the browse grid (ConfigCard + FilterBar + search) */}
        <div className="rounded-lg border border-edge bg-panel p-10 text-center text-ink-faint">
          Config browsing arrives in a later increment.
        </div>
      </section>
    </div>
  );
}
