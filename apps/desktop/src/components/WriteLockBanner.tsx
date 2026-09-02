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
        className="t-body border-b border-warn/50 bg-warn/10 px-4 py-2 text-center text-ink"
      >
        TF2 is running — execs is read-only.
      </div>
    );
  }
  return (
    <div
      role="status"
      data-testid="write-lock-degraded"
      className="t-body border-b border-warn/50 bg-warn/10 px-4 py-2 text-center text-ink"
    >
      {degraded}
    </div>
  );
}
