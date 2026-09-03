/**
 * The single write gate: no writes while TF2 runs, and no writes while another
 * one is in flight.
 *
 * Every per-pane helper (`canRecordBinds`, `canWriteSettings`, `canSaveCfg`)
 * delegates here, so the rule lives in exactly one place. Panes that autosave
 * do not gate their controls on it at all: an edit made while TF2 runs is a
 * draft, and `useAutosave` holds the write until the lock lifts.
 */
export function canWrite(running: boolean, busy: boolean): boolean {
  return !running && !busy;
}
