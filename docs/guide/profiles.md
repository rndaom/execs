# Profiles

A profile is your whole TF2 customization: your cfg files, `config.cfg`, everything in `tf/custom` (HUD, mods, sounds, crosshair pack), and your launch options. execs keeps each profile in its own data folder and puts one of them into TF2 at a time.

## First run

execs finds TF2 through your Steam libraries. You can also browse to the folder yourself; execs only accepts a folder whose `tf/steam.inf` says it is Team Fortress 2.

- **If TF2 already has customization**, execs saves it as your first profile. Your files are copied, not moved, and nothing in TF2 changes.
- **If TF2 is unused**, execs builds a first profile from a mastercomfig preset.

If TF2 has not been played on this PC for a while, its `config.cfg` may exist only in Steam Cloud's copy. execs saves that copy into the profile and reads it until TF2 writes its own file.

## Switching

Switching replaces the whole live setup with the chosen profile, exactly. Files from the old profile are removed only if they are unchanged, then the new profile's files are written. If a switch is ever cut off, execs says so and lets you finish it.

**Compare with current…** shows what a switch would change before you make it: HUD, sounds, packs, cfg files, settings and launch options. It never shows saved passwords.

## Changes made in TF2

When TF2 closes, execs takes changes you made in the game (binds, options, `config.cfg`) into the active profile automatically. If a pack appears in or disappears from `tf/custom`, it asks what to do:

- **Update** takes the change into the profile.
- **Restore removed** puts a removed pack back.
- **Keep** leaves the pack as it is without adding it to the profile.

## New profiles

**New profile** can start from your **current setup** (your `config.cfg`: binds, audio and other in-game settings) or from **Fresh TF2** (Valve's defaults). Pick a mastercomfig preset and addons, then **Create** to add it without switching, or **Create and switch**.

Your current profile is never converted. To try mastercomfig on a setup that doesn't use it, make a new profile from your current setup; switching back undoes it.

## Rename, duplicate, delete

- **Rename** changes only the name.
- **Duplicate** makes an inactive copy of a saved profile.
- **Delete** removes the profile from execs. It offers to export first, and never removes files from TF2. Deleting the active profile asks whether to switch to another one first or leave TF2 as it is.

## Export and import

**Export** writes the profile to a ZIP you can keep or share. Before you share it, the review lists anything that may contain saved passwords, such as `rcon_password` in a cfg.

**Import** accepts a profile ZIP from execs, or a creator ZIP with `cfg/` and `custom/` folders. The review counts the files, notes anything left out, and flags cfg commands before you trust the creator. An import never switches to the new profile.

## Restore points

A restore point is a saved copy of a profile on this PC. **Restore** adds it as a new profile; TF2 doesn't change until you switch to it. execs keeps 3, 5 or 10 points per profile (5 by default) and removes the oldest when you save a new one.
