# Files

Files edits the profile's cfg files directly. Unlike the other panes, it never saves on its own: use **Save** (Ctrl+S) or **Save all**.

- **Your cfgs** are editable. Files from HUDs, packs and the game itself open read-only, and their findings are advice only.
- **`config.cfg`** is TF2's own file. TF2 rewrites it when the game closes.
- **New cfg** (Ctrl+N) asks whether the file runs at startup, for a class or as a helper, then puts it in the right folder.
- **Save as new cfg** (Ctrl+Shift+S) copies the open file to a new cfg of your own; the original stays as it is.
- Edits are kept while you move between files, and closing execs with unsaved edits asks Save, Discard or Cancel.
- If a file changes outside execs while you edit it, Files asks you to compare before saving.

## Problems and Help

**Problems** lists syntax and safety issues. A few, such as unsafe write commands, block saving until you fix them. Saved passwords and remote-console settings are allowed but noted, because they would travel with an exported profile.

**Help** searches an offline TF2 command reference. It was reviewed on a fixed date, so your game may have commands it doesn't know; a command missing from the reference isn't necessarily wrong.
