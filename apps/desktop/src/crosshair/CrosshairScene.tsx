/** Neutral code-native backdrop for judging crosshair contrast and size. */
export function CrosshairScene() {
  return (
    <div
      data-testid="crosshair-neutral-scene"
      aria-hidden="true"
      className="pointer-events-none absolute inset-0 bg-[linear-gradient(135deg,#37322e_0%,#272525_48%,#191a1b_100%)]"
    >
      <div className="absolute inset-[12%] rounded-sm border border-white/10" />
      <div className="absolute top-1/2 right-[12%] left-[12%] border-t border-white/10" />
      <div className="absolute top-[12%] bottom-[12%] left-1/2 border-l border-white/10" />
      <span className="t-meta absolute bottom-2.5 right-2.5 rounded-md bg-bg/80 px-2 py-0.5">
        Neutral reference · not game footage
      </span>
    </div>
  );
}
