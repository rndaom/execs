# Launch

Launch options are saved with the profile. **Add option** offers a searchable list of TF2 options; you can also edit the full launch string directly.

## Getting them into Steam

Steam keeps its own copy of TF2's launch options and only reads it while closed.

- With Steam closed, **Write to Steam** saves them directly.
- With Steam open, **Launch TF2** offers **Restart Steam and launch**: execs closes Steam, writes the options, then starts Steam and TF2.
- Copying the options to the clipboard never marks Steam as updated.

The header warns when the active profile's options differ from Steam's copy.

## Options TF2 remembers

Some options, such as `-w`/`-h` or `-console`, are saved by TF2 into its own settings. They stay in effect after you remove them or switch profiles; change them back in TF2.

For resolution, prefer TF2's video settings. Launch flags can set a video mode your screen doesn't support. Heights below 480 px need `-small`.

## Options execs removes

`-autoconfig`, `-default`, `-dxlevel` and `+quit` reset or close the game, so execs never saves them on a profile. Anything before `%command%`, such as `gamemoderun`, `mangohud` or an environment variable, is kept exactly as written.
