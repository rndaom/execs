/**
 * The single write gate.
 *
 * Five per-pane helpers (`canRecordBinds`, `canApplyGameplay`, `canEditLaunch`,
 * `canWriteSettings`, `canSaveCfg`) all computed `!running && !busy`. They now
 * delegate here so the rule — no writes while TF2 runs, no writes while another
 * one is in flight — lives in exactly one place.
 */
export function canWrite(running: boolean, busy: boolean): boolean {
  return !running && !busy;
}
