/** Serializes settings work that may write profile files and shares one busy lease. */
export class SettingsBusyQueue {
  private tail: Promise<void> = Promise.resolve();
  private pending = 0;

  constructor(private readonly onBusyChange: (busy: boolean) => void) {}

  get active(): boolean {
    return this.pending > 0;
  }

  run<T>(work: () => Promise<T>): Promise<T> {
    this.pending += 1;
    if (this.pending === 1) {
      this.onBusyChange(true);
    }

    const run = this.tail.then(
      () => work(),
      () => work(),
    );
    this.tail = run.then(
      () => undefined,
      () => undefined,
    );
    void run.then(
      () => this.release(),
      () => this.release(),
    );
    return run;
  }

  private release() {
    this.pending -= 1;
    if (this.pending === 0) {
      this.onBusyChange(false);
    }
  }
}
