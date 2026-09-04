/** The read-only strip shown while `tf_win64.exe` / `tf_linux64` is running. */
export function WriteLockBanner({
  running,
  degraded,
  maintenance,
}: {
  running: boolean;
  degraded: string | null;
  maintenance?: string | null;
}) {
  if (!running && !degraded && !maintenance) {
    return null;
  }
  if (degraded) {
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
  if (maintenance) {
    return (
      <div
        role="status"
        data-testid="maintenance-write-lock"
        className="t-body border-b border-warn/50 bg-warn/10 px-4 py-2 text-center text-ink"
      >
        {maintenance}
      </div>
    );
  }
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
