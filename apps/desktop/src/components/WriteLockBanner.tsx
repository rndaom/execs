/** The read-only strip shown while `tf_win64.exe` / `tf_linux64` is running. */
export function WriteLockBanner({
  running,
  degraded,
}: {
  running: boolean;
  degraded: string | null;
}) {
  if (!running && !degraded) {
    return null;
  }
  if (running) {
    return (
      <div
        role="status"
        data-testid="tf2-write-lock"
        className="border-b border-team-red bg-team-red/20 px-4 py-2 text-center text-sm text-ink"
      >
        TF2 is running — execs is read-only until the game quits.
      </div>
    );
  }
  return (
    <div
      role="status"
      data-testid="write-lock-degraded"
      className="border-b border-q-strange/60 bg-q-strange/15 px-4 py-2 text-center text-sm text-ink"
    >
      {degraded}
    </div>
  );
}
