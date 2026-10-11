# HUD

Each profile has one HUD.

## Browsing and installing

The catalog comes from [hud-db](https://github.com/mastercomfig/hud-db), with activity and popularity from [TF2 HUDs](https://tf2huds.dev/huds). Sorting by activity, downloads or views leaves out HUDs that have no figure for it; **A to Z** shows them all. Activity dates are changes to a HUD's TF2 HUDs listing, not its release date.

**Install** downloads the HUD from its author. Some authors only offer a page with several files; execs then opens the page so you can download the one you want and import it.

## Importing

**Import HUD** takes a ZIP, 7z or RAR, or a folder you already extracted. execs checks that it is a TF2 HUD (its `info.vdf` declares UI version 3) before installing it. An archive with several HUDs inside asks you to import the one you want as a folder.

When you install or import a HUD over another one, the old HUD is kept as a backup outside TF2's HUD folders. App settings → Storage lists those backups.

## HUD options

HUDs with a [TF2HUD.Editor](https://github.com/CriticalFlaw/TF2HUD.Editor) schema list their options under **Installed**, grouped the way the HUD's author grouped them. Some HUDs draw their own crosshair; that crosshair appears on top of TF2's, so it can show two at once. A HUD crosshair glyph picks a shape from the HUD's font, so the character shown in execs isn't a picture of it.

The author's screenshots show the HUD's defaults; open TF2 to see it with your options.

## Return to stock HUD

Removes the profile's HUD and its option cfgs, and leaves everything else as it is.

## Casual

HUDs work on Valve Casual servers. Custom materials that a HUD replaces may not.
