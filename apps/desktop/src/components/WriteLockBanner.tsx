import { LockSimple, Warning } from "@phosphor-icons/react";

/** The write-lock strip shown while `tf_win64.exe` / `tf_linux64` is running. */
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
      <div role="status" data-testid="write-lock-degraded" className="app-banner app-banner-warn">
        <Warning size={15} weight="fill" aria-hidden="true" />
        <span>{degraded}</span>
      </div>
    );
  }
  if (maintenance) {
    return (
      <div
        role="status"
        data-testid="maintenance-write-lock"
        className="app-banner app-banner-warn"
      >
        <Warning size={15} weight="fill" aria-hidden="true" />
        <span>{maintenance}</span>
      </div>
    );
  }
  return (
    <div role="status" data-testid="tf2-write-lock" className="app-banner app-banner-warn">
      <LockSimple size={15} weight="fill" aria-hidden="true" />
      <span>
        TF2 is running — settings keep drafts until it closes. Files requires Save after closing
        TF2.
      </span>
    </div>
  );
}
