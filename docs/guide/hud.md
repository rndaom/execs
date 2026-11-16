# HUD

Each profile has one HUD.

## Browsing and installing

The catalog comes from [hud-db](https://github.com/mastercomfig/hud-db), with activity and popularity from [TF2 HUDs](https://tf2huds.dev/huds). Sorting by activity, downloads or views leaves out HUDs that have no figure for it; **A to Z** shows them all. Activity dates are changes to a HUD's TF2 HUDs listing, not its release date.

**Install** downloads the HUD from its author. Some authors only offer a page with several files; execs then opens the page so you can download the one you want and import it.

A HUD that is on GameBanana but not in this list can be installed from Mods: find it under Browse and choose **Install HUD**. It then appears here like an imported HUD.

## Importing

**Import HUD** takes a ZIP, 7z or RAR, or a folder you already extracted. execs checks that it is a TF2 HUD (its `info.vdf` declares UI version 3) before installing it. An archive with several HUDs inside asks you to import the one you want as a folder. If what you picked isn't a HUD at all, execs says so and offers **Open Mods**, where ordinary mods are imported.

An imported HUD that is also in the catalog shows **Match to catalog** on the Installed view. Matching it lets execs check that HUD for updates; a folder named after a download (`rayshud-master`) is renamed to the catalog's name.

When you install or import a HUD over another one, the old HUD is kept as a backup outside TF2's HUD folders. App settings → Storage lists those backups.

## HUD options

HUDs with a [TF2HUD.Editor](https://github.com/CriticalFlaw/TF2HUD.Editor) schema list their options under **Installed**, grouped the way the HUD's author grouped them. Some HUDs draw their own crosshair; that crosshair appears on top of TF2's, so it can show two at once. A HUD crosshair glyph picks a shape from the HUD's font, so the character shown in execs isn't a picture of it.

Options come from the editor's own list of HUDs, as of the execs release you have. A HUD installed from the catalog is matched by its repository; an imported one by its folder name (`rayshud-master` counts as rayshud). Some HUDs share one common set of options instead of having their own.

Each option is tried against the HUD's files before it is offered. One that does not fit, because the file or section it edits is not in the version you have, is left alone. These sit under one line below the other options, such as "12 options aren't available for this version"; open it to see each one's reason. This happens when the HUD has changed since its options were written. Options that would write outside execs's own folders are unavailable too. A HUD where no option fits shows no options.

The author's screenshots show the HUD's defaults; open TF2 to see it with your options.

## Return to stock HUD

Removes the profile's HUD and its option cfgs, and leaves everything else as it is.

## Casual

HUDs work on Valve Casual servers. Custom materials that a HUD replaces may not.
