/**
 * Serializes HUD catalog/state reloads. A non-refresh reload requested while an
 * explicit refresh is running executes afterward, so it reads the refreshed
 * cache instead of replacing the refresh result with stale data.
 */
export class HudReloadQueue {
  private tail: Promise<void> = Promise.resolve();

  enqueue<T>(work: () => Promise<T>): Promise<T> {
    const run = this.tail.then(work, work);
    this.tail = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  }
}
