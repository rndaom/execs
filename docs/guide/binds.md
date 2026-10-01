# Binds

Click an action, then press a key or mouse button. Keys you add are saved to the profile's `execs_binds.cfg` (in `tf/cfg/overrides/` with mastercomfig, otherwise `tf/cfg/`) and run every time TF2 starts.

- **Mouse buttons**: right and middle click record as `mouse2` and `mouse3`; Mouse 4 and 5 record without the side buttons navigating the app.
- **Keys TF2 names differently**: `;` `'` `,` `.` `/` `\` `-` `=`, Right Shift, Pause and similar keys are saved with TF2's own key names.
- **A key that already does something**: execs asks before giving it a new action.
- **Removing a key** leaves it doing nothing. If `config.cfg` also binds that key, execs writes an `unbind` so the old bind can't come back.

## Custom commands

Type a command, then record a key. Separate several commands with a semicolon, for example `say gg; voicemenu 2 6`.

## Binds changed in TF2

If you rebind a key in TF2's own options, execs takes the new key into the profile after the game closes. Class cfgs, launch options and commands you type in the console can still change binds while you play.
