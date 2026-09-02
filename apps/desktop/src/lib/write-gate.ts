/**
 * The single write gate: no writes while TF2 runs, and no writes while another
 * one is in flight.
 *
 * Every per-pane helper (`canRecordBinds`, `canApplyGameplay`, `canEditLaunch`,
 * `canWriteSettings`, `canSaveCfg`) delegates here, so the rule lives in
 * exactly one place.
 */
export function canWrite(running: boolean, busy: boolean): boolean {
  return !running && !busy;
}
